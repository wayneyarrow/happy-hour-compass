/**
 * POST /api/webhooks/stripe
 *
 * Handles Stripe webhook events and syncs payment/subscription state into
 * venue_subscriptions. This is the ONLY path that updates plan_code and
 * subscription status — the Checkout success redirect is informational only.
 *
 * Phase 2B: every event is resolved to a VENUE, never an operator.
 * operator_id is carried in metadata purely for audit/notification identity
 * — it never determines which entity's entitlement is updated.
 *
 * Verified events handled:
 *   checkout.session.completed      → activate plan after first checkout
 *   customer.subscription.updated   → sync plan, status, period dates,
 *                                      cancel_at_period_end
 *   customer.subscription.deleted   → downgrade to free + cancelled status
 *   invoice.payment_succeeded       → mark active, refresh period dates
 *   invoice.payment_failed          → mark past_due + Slack ops-alerts
 *
 * VENUE RESOLUTION (see resolveVenueForEvent() below):
 *   1. session/subscription metadata.venue_id   (set by our checkout session)
 *   2. venue_subscriptions lookup by billing_provider_customer_id
 *   3. venue_subscriptions lookup by billing_provider_subscription_id
 *      (used only where a customer id is unavailable)
 *
 *   If metadata.venue_id and the stored customer/subscription mapping name
 *   DIFFERENT venues, this is never silently resolved one way or the other —
 *   see the "mismatch" branch, which reports critically and drops the event
 *   without writing anything. operator_id is never used to resolve or
 *   validate venue ownership — it is attached to notifications only.
 *
 * API-version note (2026-05-27.dahlia):
 *   - Subscription.current_period_start/end were removed; period dates are now
 *     on each SubscriptionItem (sub.items.data[0].current_period_start/end).
 *   - Invoice.subscription was removed; the subscription reference is now in
 *     invoice.parent.subscription_details.subscription.
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { syncVenueStripeSubscription, getVenuePlanCode, getVenueSubscription, resolvePlanCodeFromVenueSubscription } from "@/lib/venueSubscriptions";
import { resolveVenueIdentity, type ResolveVenueResult, type VenueIdentityCandidate } from "@/lib/stripeVenueIdentity";
import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";
import { logPlanChangeEvent } from "@/lib/planChangeEvents";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";
import { reportOperationalError } from "@/lib/observability/reportOperationalError";

export const dynamic = "force-dynamic";

// ── Observability ────────────────────────────────────────────────────────────
//
// "stripe-webhook" covers structural failures (signature/config/unhandled
// exception). "stripe-subscription" covers DB-sync/payload/venue-resolution
// failures for verified, successfully-received Stripe events — the
// "customer paid but HHC didn't activate/record it for the right venue"
// class of bug. Severity is per-branch, based on actual impact — see each
// branch's inline comment.
const STRIPE_WEBHOOK_FLOW = "stripe-webhook";
const STRIPE_SUBSCRIPTION_FLOW = "stripe-subscription";

// ─── Helper: extract a string ID from an expandable Stripe field ───────────────

function extractId(field: string | { id: string } | null | undefined): string | null {
  if (!field) return null;
  if (typeof field === "string") return field;
  return field.id;
}

// ─── Helper: get period dates from the first subscription item ────────────────

function getSubPeriod(sub: Stripe.Subscription): { periodStart: string; periodEnd: string } | null {
  const item = sub.items.data[0];
  if (!item) return null;
  return {
    periodStart: new Date(item.current_period_start * 1000).toISOString(),
    periodEnd:   new Date(item.current_period_end   * 1000).toISOString(),
  };
}

// ─── Helper: extract subscription ID from invoice parent (dahlia API) ─────────

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (!parent || parent.type !== "subscription_details") return null;
  return extractId(parent.subscription_details?.subscription);
}

// ─── Helper: look up venue by Stripe customer / subscription ID ───────────────

async function resolveVenueByCustomer(customerId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("venue_subscriptions")
    .select("venue_id")
    .eq("billing_provider_customer_id", customerId)
    .maybeSingle();
  return (data as { venue_id: string } | null)?.venue_id ?? null;
}

async function resolveVenueBySubscriptionId(subscriptionId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("venue_subscriptions")
    .select("venue_id")
    .eq("billing_provider_subscription_id", subscriptionId)
    .maybeSingle();
  return (data as { venue_id: string } | null)?.venue_id ?? null;
}


/**
 * The single venue-resolution authority for every event handler below.
 *
 * Resolves via UP TO THREE independent sources — metadata.venue_id, a
 * venue_subscriptions lookup by customer id, and a venue_subscriptions
 * lookup by subscription id — and checks ALL of them whenever more than one
 * identifier is available on the event. Never resolves via operator_id.
 *
 * "Priority order" governs which single source to trust when only ONE
 * identity is known (metadata is preferred when nothing else is available
 * yet, e.g. a brand-new subscription with no venue_subscriptions row at
 * all). It never means "ignore a contradictory lower-priority mapping" —
 * customer id and subscription id are BOTH checked whenever both are
 * present on the event, even though customer id would otherwise take
 * priority; if they (or metadata) disagree about which venue owns this
 * event, that is a mismatch regardless of which source would have "won" a
 * priority ordering. This closes a real gap the original priority-order-as-
 * short-circuit implementation had: a customer id mapped to Venue A and a
 * subscription id mapped to Venue B, with no metadata to arbitrate, would
 * previously resolve silently to A (customer id was checked first) without
 * ever noticing B disagreed.
 *
 * Any disagreement fails closed — the caller must not use any of the
 * candidate values; it must fail loudly (reportCriticalFailure) and drop
 * the event without writing anything. This can never be silently guessed
 * away: it would mean metadata was tampered/corrupted, or a Stripe
 * customer/subscription id got attached to the wrong venue's row.
 */
async function resolveVenueForEvent(params: {
  metadataVenueId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
}): Promise<ResolveVenueResult> {
  const [byCustomer, bySubscription] = await Promise.all([
    params.customerId ? resolveVenueByCustomer(params.customerId) : Promise.resolve(null),
    params.subscriptionId ? resolveVenueBySubscriptionId(params.subscriptionId) : Promise.resolve(null),
  ]);

  return resolveVenueIdentity({
    metadataVenueId: params.metadataVenueId,
    customerMappedVenueId: byCustomer,
    subscriptionMappedVenueId: bySubscription,
  });
}

/** Reports a venue-resolution mismatch critically and returns nothing further to do. */
async function reportVenueMismatch(params: {
  eventId: string;
  eventType: string;
  stage: string;
  candidates: VenueIdentityCandidate[];
  customerId: string | null;
  subscriptionId: string | null;
}): Promise<void> {
  const summary = params.candidates.map((c) => `${c.source}=${c.venueId}`).join(", ");
  await reportCriticalFailure({
    error: new Error(
      `Venue resolution mismatch: independently-known identities disagree (${summary}). Refusing to guess.`
    ),
    flow: STRIPE_SUBSCRIPTION_FLOW,
    stage: params.stage,
    title: "Stripe Venue Resolution Mismatch",
    technicalSummary: "two or more independently-known venue identities (metadata / customer mapping / subscription mapping) disagree",
    context: {
      stripeEventId: params.eventId,
      stripeEventType: params.eventType,
      candidates: summary,
      stripeCustomerId: params.customerId,
      stripeSubscriptionId: params.subscriptionId,
    },
    slackFields: {
      "Stripe Event": params.eventId,
      "Conflicting identities": summary,
    },
  });
}

// ─── Helper: map Stripe subscription status → HHC SubscriptionStatus ──────────

function toHhcStatus(stripeStatus: string): "active" | "pending" | "cancelled" | "past_due" {
  switch (stripeStatus) {
    case "active":             return "active";
    case "past_due":           return "past_due";
    case "canceled":           return "cancelled";
    case "incomplete":
    case "incomplete_expired":
    case "trialing":           return "pending";
    default:                   return "active";
  }
}

// ─── Helper: map Stripe price ID → HHC plan code ──────────────────────────────

function toPlanCode(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRO_PRICE_ID)     return "pro";
  if (priceId === process.env.STRIPE_PREMIUM_PRICE_ID) return "premium";
  return null;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    console.error("[webhook/stripe] Missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhook/stripe] STRIPE_WEBHOOK_SECRET is not set");
    // Every Stripe event hits this guard identically until the env var is
    // fixed — a console.error alone is easy to miss (Vercel's log retention
    // is short-lived), and this specific misconfiguration silently prevents
    // every plan sync and plan-change notification in this environment. Alert
    // like the unhandled-error path below, rather than only logging.
    const report = reportOperationalError({
      error: new Error("STRIPE_WEBHOOK_SECRET is not set"),
      flow: STRIPE_WEBHOOK_FLOW,
      stage: "webhook-secret-missing",
      severity: "critical",
    });
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Stripe webhook misconfigured",
      message:  "STRIPE_WEBHOOK_SECRET is not set — every Stripe webhook event is being rejected before processing, blocking plan syncs and plan-change notifications in this environment.",
      metadata: {
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
        "HHC Error": report.hhcErrorId,
        "Sentry Event": report.sentryEventId ?? "unavailable",
      },
    });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (e) {
    console.error("[webhook/stripe] Failed to read body:", e);
    return NextResponse.json({ error: "Failed to read body" }, { status: 400 });
  }

  let stripe: Stripe;
  let event: Stripe.Event;
  try {
    stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[webhook/stripe] Signature verification failed:", msg);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log("[webhook/stripe] Event received:", event.type, event.id);

  try {
    await handleEvent(stripe, event);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[webhook/stripe] Unhandled error in handler", event.type, event.id, msg);
    const report = reportOperationalError({
      error: e,
      flow: STRIPE_WEBHOOK_FLOW,
      stage: "handler-exception",
      severity: "critical",
      context: { stripeEventId: event.id, stripeEventType: event.type },
    });
    await sendSlackAlert({
      channel: "ops-critical",
      severity: "critical",
      title: "Stripe webhook handler failed",
      message: `Event ${event.type} (${event.id}) threw an unhandled error.`,
      metadata: {
        error: msg,
        event_id: event.id,
        event_type: event.type,
        "HHC Error": report.hhcErrorId,
        "Sentry Event": report.sentryEventId ?? "unavailable",
      },
    });
    // Return 500 so Stripe retries delivery.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── Event dispatcher ──────────────────────────────────────────────────────────

async function handleEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {

    // ── Checkout completed → first activation ──────────────────────────────────
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      console.log("[webhook/stripe] checkout.session.completed:", {
        sessionId:   session.id,
        mode:        session.mode,
        metadata:    session.metadata,
        customerId:  extractId(session.customer),
        subscriptionId: extractId(session.subscription),
      });

      if (session.mode !== "subscription") {
        console.log("[webhook/stripe] checkout.session.completed: skipping non-subscription session, mode:", session.mode);
        break;
      }

      const metadataVenueId = session.metadata?.venue_id ?? null;
      const operatorId      = session.metadata?.operator_id ?? null;
      const targetPlan      = session.metadata?.target_plan ?? null;
      const customerId      = extractId(session.customer);
      const subscriptionId  = extractId(session.subscription);

      console.log("[webhook/stripe] checkout.session.completed: resolved fields:", {
        metadataVenueId, operatorId, targetPlan, customerId, subscriptionId,
      });

      if (!metadataVenueId || !targetPlan || !customerId || !subscriptionId) {
        console.error("[webhook/stripe] checkout.session.completed: missing required fields — cannot activate plan", {
          metadataVenueId, targetPlan, customerId, subscriptionId, sessionId: session.id,
        });
        // Stripe considers this checkout complete (money has moved) but HHC
        // cannot activate it — and unlike a DB-sync failure, there is no
        // later event to reconcile from: venue_id/target_plan are only ever
        // set by our OWN checkout session creation, so a later event can't
        // supply them either. Not safely recoverable elsewhere → critical.
        await reportCriticalFailure({
          error: new Error(
            `checkout.session.completed missing required fields: ${[
              !metadataVenueId ? "venue_id" : null,
              !targetPlan ? "target_plan" : null,
              !customerId ? "customer" : null,
              !subscriptionId ? "subscription" : null,
            ].filter(Boolean).join(", ")}`
          ),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "checkout-completed-invalid-payload",
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "checkout session missing required fields for activation",
          context: { stripeEventId: event.id, stripeSessionId: session.id, operatorId },
          slackFields: { "Stripe Event": event.id, "Checkout Session": session.id },
        });
        break;
      }

      // Confirm this customer isn't already mapped to a DIFFERENT venue
      // (e.g. a stale/reused customer id) before writing anything.
      const resolution = await resolveVenueForEvent({
        metadataVenueId,
        customerId,
        subscriptionId,
      });
      if (resolution.mismatch) {
        await reportVenueMismatch({
          eventId: event.id,
          eventType: event.type,
          stage: "checkout-completed-venue-mismatch",
          candidates: resolution.candidates,
          customerId,
          subscriptionId,
        });
        break;
      }
      const venueId = metadataVenueId;

      const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId   = stripeSub.items.data[0]?.price?.id ?? null;
      const period    = getSubPeriod(stripeSub);

      console.log("[webhook/stripe] checkout.session.completed: Stripe subscription details:", {
        subscriptionId,
        priceId,
        stripeStatus: stripeSub.status,
        period,
      });

      const existingForCheckout = await getVenueSubscription(venueId);
      const oldPlanForCheckout  = resolvePlanCodeFromVenueSubscription(existingForCheckout);

      // Residual-risk guard (Part 2 of the Phase 2B billing review): the
      // atomic customer reservation in createCheckoutSessionAction()
      // guarantees at most one Stripe Customer per venue, but cannot alone
      // prevent an operator from completing TWO separate Checkout Sessions
      // for that same customer (e.g. two browser tabs each finishing
      // payment) before either webhook lands — Stripe would then report two
      // real, separately-billing subscriptions for one venue. The upsert
      // below always tracks the newest completed checkout (that money is
      // real and must be recorded), but if the venue already had a
      // DIFFERENT, actively-billing subscription id, this is flagged
      // critically for manual reconciliation rather than silently
      // forgotten — never silently orphaning a still-billing subscription
      // with zero signal.
      if (
        existingForCheckout &&
        existingForCheckout.status === "active" &&
        existingForCheckout.billing_provider_subscription_id &&
        existingForCheckout.billing_provider_subscription_id !== subscriptionId
      ) {
        await reportCriticalFailure({
          error: new Error(
            `Venue ${venueId} already had an active Stripe subscription ` +
            `(${existingForCheckout.billing_provider_subscription_id}) when a ` +
            `DIFFERENT checkout.session.completed (${subscriptionId}) arrived. ` +
            `Both may now be billing — manual reconciliation required.`
          ),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "checkout-completed-possible-duplicate-subscription",
          title: "Possible Duplicate Stripe Subscription",
          technicalSummary: "venue already had a different active subscription id — likely a double checkout completion",
          context: {
            stripeEventId: event.id,
            venueId,
            operatorId,
            previousSubscriptionId: existingForCheckout.billing_provider_subscription_id,
            newSubscriptionId: subscriptionId,
          },
          slackFields: {
            "Stripe Event": event.id,
            "Venue ID": venueId,
            "Previous Subscription": existingForCheckout.billing_provider_subscription_id,
            "New Subscription": subscriptionId,
          },
        });
      }

      const result = await syncVenueStripeSubscription(venueId, {
        customerId,
        subscriptionId,
        planCode:    targetPlan,
        status:      "active",
        periodStart: period?.periodStart ?? null,
        periodEnd:   period?.periodEnd   ?? null,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end === true,
      });

      console.log("[webhook/stripe] checkout.session.completed: DB sync result:", {
        venueId, planCode: targetPlan, customerId, subscriptionId, ok: result.ok, error: result.error ?? null,
      });

      if (!result.ok) {
        console.error("[webhook/stripe] checkout.session.completed: DB sync failed:", result.error);
        // Highest-priority gap this exists to close: Stripe has successfully
        // charged the customer and told us so, but the plan activation write
        // failed — silently, before this instrumentation. No throw here —
        // this branch's existing behavior already returns 200 to Stripe
        // either way; the goal is visibility, not changing that response.
        await reportCriticalFailure({
          error: new Error(result.error ?? "syncVenueStripeSubscription failed"),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "checkout-completed-sync",
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "database sync failed (checkout activation)",
          context: {
            stripeEventId: event.id,
            venueId,
            operatorId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            planCode: targetPlan,
          },
          slackFields: {
            "Stripe Event": event.id,
            "Venue ID": venueId,
            Subscription: subscriptionId,
            Plan: targetPlan,
          },
        });
      } else if (oldPlanForCheckout !== targetPlan) {
        console.log("[webhook/stripe] checkout.session.completed: plan activated successfully →", targetPlan);
        await logPlanChangeEvent({
          operatorId,
          venueId,
          fromPlan:                       oldPlanForCheckout,
          toPlan:                         targetPlan,
          changedByEmail:                 null,
          trigger:                        "stripe_checkout",
          billingProviderSubscriptionId:  subscriptionId,
          billingProviderCustomerId:      customerId,
        });
      } else {
        // Plan was already targetPlan before this sync — either a retried/
        // redelivered checkout.session.completed event, or a
        // customer.subscription.updated event for the same subscription
        // already processed and wrote this plan first. Either way, the DB
        // sync above is still safe to run unconditionally (idempotent), but
        // logging a second plan_change_events row (and firing a second
        // founder notification) here would be a duplicate for the same
        // effective change.
        console.log("[webhook/stripe] checkout.session.completed: plan already", targetPlan, "— skipping duplicate plan_change_event");
      }
      break;
    }

    // ── Subscription updated → plan / status / cancel_at_period_end changes ───
    case "customer.subscription.updated": {
      const sub        = event.data.object as Stripe.Subscription;
      const customerId = extractId(sub.customer);
      if (!customerId) break;

      const metadataVenueId = sub.metadata?.venue_id ?? null;
      const operatorId      = sub.metadata?.operator_id ?? null;

      const resolution = await resolveVenueForEvent({
        metadataVenueId,
        customerId,
        subscriptionId: sub.id,
      });
      if (resolution.mismatch) {
        await reportVenueMismatch({
          eventId: event.id,
          eventType: event.type,
          stage: "subscription-updated-venue-mismatch",
          candidates: resolution.candidates,
          customerId,
          subscriptionId: sub.id,
        });
        break;
      }
      const venueId = resolution.venueId;

      if (!venueId) {
        console.warn("[webhook/stripe] customer.subscription.updated: could not resolve venue", { customerId, subId: sub.id });
        break;
      }

      const priceId  = sub.items.data[0]?.price?.id ?? null;
      const planCode = toPlanCode(priceId);
      const hhcStatus = toHhcStatus(sub.status);
      const period   = getSubPeriod(sub);
      const cancelAtPeriodEnd = sub.cancel_at_period_end === true;

      console.log("[webhook/stripe] customer.subscription.updated:", {
        subId: sub.id,
        customerId,
        venueId,
        priceId,
        planCode: planCode ?? "(unchanged)",
        stripeStatus: sub.status,
        hhcStatus,
        period,
        cancelAtPeriodEnd,
      });

      // Capture old plan before sync if a plan change is included.
      const oldPlanForUpdate = planCode ? await getVenuePlanCode(venueId) : null;

      const result = await syncVenueStripeSubscription(venueId, {
        customerId,
        subscriptionId: sub.id,
        ...(planCode ? { planCode } : {}),
        status:      hhcStatus,
        periodStart: period?.periodStart ?? null,
        periodEnd:   period?.periodEnd   ?? null,
        cancelAtPeriodEnd,
      });

      console.log("[webhook/stripe] customer.subscription.updated: DB sync result:", { ok: result.ok, error: result.error ?? null });

      if (!result.ok) {
        console.error("[webhook/stripe] customer.subscription.updated: DB sync failed:", result.error);
        // Severity depends on actual impact: when this update carries a
        // plan (price) change, a failed sync leaves HHC's entitlement
        // materially inconsistent with what Stripe now has (an upgrade/
        // downgrade the venue paid for silently didn't take effect) —
        // critical. When there's no plan change (a period-date/status/
        // cancel_at_period_end-only refresh, e.g. a renewal), a failed sync
        // is comparatively benign — stale but not wrong about entitlement,
        // and typically self-corrects on the next Stripe event for the same
        // subscription — operational, Sentry-only, no Slack page.
        if (planCode) {
          await reportCriticalFailure({
            error: new Error(result.error ?? "syncVenueStripeSubscription failed"),
            flow: STRIPE_SUBSCRIPTION_FLOW,
            stage: "subscription-updated-sync",
            title: "Stripe Subscription Sync Failed",
            technicalSummary: "database sync failed (plan change)",
            context: {
              stripeEventId: event.id,
              venueId,
              operatorId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
              planCode,
            },
            slackFields: {
              "Stripe Event": event.id,
              "Venue ID": venueId,
              Subscription: sub.id,
              Plan: planCode,
            },
          });
        } else {
          reportOperationalError({
            error: new Error(result.error ?? "syncVenueStripeSubscription failed"),
            flow: STRIPE_SUBSCRIPTION_FLOW,
            stage: "subscription-updated-sync",
            severity: "operational",
            context: {
              stripeEventId: event.id,
              venueId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
            },
          });
        }
      } else if (planCode && oldPlanForUpdate && planCode !== oldPlanForUpdate) {
        await logPlanChangeEvent({
          operatorId,
          venueId,
          fromPlan:                       oldPlanForUpdate,
          toPlan:                         planCode,
          changedByEmail:                 null,
          trigger:                        "stripe_subscription_updated",
          billingProviderSubscriptionId:  sub.id,
          billingProviderCustomerId:      customerId,
        });
      }
      break;
    }

    // ── Subscription deleted → downgrade that venue to free ────────────────────
    case "customer.subscription.deleted": {
      const sub        = event.data.object as Stripe.Subscription;
      const customerId = extractId(sub.customer);
      if (!customerId) break;

      const metadataVenueId = sub.metadata?.venue_id ?? null;
      const operatorId      = sub.metadata?.operator_id ?? null;

      const resolution = await resolveVenueForEvent({
        metadataVenueId,
        customerId,
        subscriptionId: sub.id,
      });
      if (resolution.mismatch) {
        await reportVenueMismatch({
          eventId: event.id,
          eventType: event.type,
          stage: "subscription-deleted-venue-mismatch",
          candidates: resolution.candidates,
          customerId,
          subscriptionId: sub.id,
        });
        break;
      }
      const venueId = resolution.venueId;

      console.log("[webhook/stripe] customer.subscription.deleted:", { subId: sub.id, customerId, venueId });

      if (!venueId) {
        console.warn("[webhook/stripe] customer.subscription.deleted: could not resolve venue", { customerId, subId: sub.id });
        break;
      }

      const oldPlanForDelete = await getVenuePlanCode(venueId);

      // The venue keeps its Stripe Customer (never deleted merely because
      // the subscription ends — see cancelActions.ts / Part 7 of the task)
      // but the subscription id itself is now gone at Stripe; clearing it
      // here (rather than leaving a dangling reference to a deleted Stripe
      // object) matches the existing operator-level lifecycle design.
      const result = await syncVenueStripeSubscription(venueId, {
        customerId,
        subscriptionId: sub.id,
        planCode:    "free",
        status:      "cancelled",
        periodStart: null,
        periodEnd:   null,
        cancelAtPeriodEnd: false,
      });

      console.log("[webhook/stripe] customer.subscription.deleted: DB sync result:", { ok: result.ok, error: result.error ?? null });

      if (!result.ok) {
        console.error("[webhook/stripe] customer.subscription.deleted: DB sync failed:", result.error);
        // Always critical: this event always represents an entitlement
        // change (downgrade to free), unlike subscription.updated, which
        // can be a benign period-date-only refresh.
        await reportCriticalFailure({
          error: new Error(result.error ?? "syncVenueStripeSubscription failed"),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "subscription-deleted-sync",
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "database sync failed (downgrade to free)",
          context: {
            stripeEventId: event.id,
            venueId,
            operatorId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
          },
          slackFields: {
            "Stripe Event": event.id,
            "Venue ID": venueId,
            Subscription: sub.id,
            Plan: "free",
          },
        });
      } else if (oldPlanForDelete !== "free") {
        // Replay/idempotency guard (Part 4 of the Phase 2B billing review):
        // unlike checkout.session.completed and customer.subscription.updated
        // (both already gated on "did the plan actually change"), this
        // branch previously logged a plan_change_event unconditionally on
        // every successful sync. A redelivered customer.subscription.deleted
        // for an already-free venue — or a second deletion event for a
        // venue some other path already downgraded — would otherwise insert
        // a false free→free row into the permanent plan_change_events audit
        // history (and skew any upgrade/downgrade counts derived from it,
        // e.g. founderDashboard.ts), even though notifyFounderOfPlanChange()
        // already silently no-ops its own Slack/email for fromPlan===toPlan.
        // The DB sync above stays unconditional (idempotent — always safe to
        // re-run); only the audit-log write is now gated on a real change.
        await logPlanChangeEvent({
          operatorId,
          venueId,
          fromPlan:                       oldPlanForDelete,
          toPlan:                         "free",
          changedByEmail:                 null,
          trigger:                        "stripe_subscription_deleted",
          billingProviderSubscriptionId:  sub.id,
          billingProviderCustomerId:      customerId,
        });
      }
      break;
    }

    // ── Invoice paid → refresh active status + period dates for that venue ────
    case "invoice.payment_succeeded": {
      const invoice        = event.data.object as Stripe.Invoice;
      const subscriptionId = getInvoiceSubscriptionId(invoice);

      console.log("[webhook/stripe] invoice.payment_succeeded:", { invoiceId: invoice.id, subscriptionId });

      if (!subscriptionId) break;

      const sub        = await stripe.subscriptions.retrieve(subscriptionId);
      const customerId = extractId(sub.customer);
      if (!customerId) break;

      const metadataVenueId = sub.metadata?.venue_id ?? null;

      const resolution = await resolveVenueForEvent({ metadataVenueId, customerId, subscriptionId });
      if (resolution.mismatch) {
        await reportVenueMismatch({
          eventId: event.id,
          eventType: event.type,
          stage: "invoice-payment-succeeded-venue-mismatch",
          candidates: resolution.candidates,
          customerId,
          subscriptionId,
        });
        break;
      }
      const venueId = resolution.venueId;

      if (!venueId) {
        console.warn("[webhook/stripe] invoice.payment_succeeded: could not resolve venue", { customerId, subscriptionId });
        break;
      }

      const period = getSubPeriod(sub);

      console.log("[webhook/stripe] invoice.payment_succeeded: syncing active status:", { venueId, subscriptionId, period });

      const result = await syncVenueStripeSubscription(venueId, {
        customerId,
        subscriptionId: sub.id,
        status:      "active",
        periodStart: period?.periodStart ?? null,
        periodEnd:   period?.periodEnd   ?? null,
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      });

      console.log("[webhook/stripe] invoice.payment_succeeded: DB sync result:", { ok: result.ok, error: result.error ?? null });

      if (!result.ok) {
        console.error("[webhook/stripe] invoice.payment_succeeded: DB sync failed:", result.error);
        // Operational, Sentry-only — this sync call never includes
        // planCode (status + period dates + cancel_at_period_end only), and
        // `status` is display-only (nothing gates feature access on it;
        // only plan_code does). A failed sync here leaves the status badge/
        // period dates stale, not entitlement wrong, and self-corrects on
        // the next Stripe event for the same subscription.
        reportOperationalError({
          error: new Error(result.error ?? "syncVenueStripeSubscription failed"),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "invoice-payment-succeeded-sync",
          severity: "operational",
          context: { stripeEventId: event.id, venueId, stripeInvoiceId: invoice.id, stripeSubscriptionId: subscriptionId },
        });
      }
      break;
    }

    // ── Invoice failed → mark that venue past_due + Slack alert ────────────────
    case "invoice.payment_failed": {
      const invoice        = event.data.object as Stripe.Invoice;
      const subscriptionId = getInvoiceSubscriptionId(invoice);

      console.log("[webhook/stripe] invoice.payment_failed:", { invoiceId: invoice.id, subscriptionId });

      if (!subscriptionId) break;

      const sub        = await stripe.subscriptions.retrieve(subscriptionId);
      const customerId = extractId(sub.customer);
      if (!customerId) break;

      const metadataVenueId = sub.metadata?.venue_id ?? null;

      const resolution = await resolveVenueForEvent({ metadataVenueId, customerId, subscriptionId });
      if (resolution.mismatch) {
        await reportVenueMismatch({
          eventId: event.id,
          eventType: event.type,
          stage: "invoice-payment-failed-venue-mismatch",
          candidates: resolution.candidates,
          customerId,
          subscriptionId,
        });
        break;
      }
      const venueId = resolution.venueId;

      if (!venueId) {
        console.warn("[webhook/stripe] invoice.payment_failed: could not resolve venue", { customerId, subscriptionId });
        break;
      }

      const period = getSubPeriod(sub);

      console.log("[webhook/stripe] invoice.payment_failed: syncing past_due status:", { venueId, subscriptionId });

      const result = await syncVenueStripeSubscription(venueId, {
        customerId,
        subscriptionId: sub.id,
        status:      "past_due",
        periodStart: period?.periodStart ?? null,
        periodEnd:   period?.periodEnd   ?? null,
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      });

      console.log("[webhook/stripe] invoice.payment_failed: DB sync result:", { ok: result.ok, error: result.error ?? null });

      if (!result.ok) {
        console.error("[webhook/stripe] invoice.payment_failed: DB sync failed:", result.error);
        // Critical, and deliberately distinct from the unconditional
        // "Stripe payment failed" #ops-alerts notification below: that one
        // is the EXPECTED business event (a customer's card was declined —
        // fires every time regardless of sync outcome). This one is the
        // opposite-direction risk from invoice.payment_succeeded's failure:
        // failing to record a failed payment means HHC has no record that
        // this venue is now behind on payment at all — a silent
        // collections/dunning blind spot with a real revenue-integrity
        // consequence.
        await reportCriticalFailure({
          error: new Error(result.error ?? "syncVenueStripeSubscription failed"),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "invoice-payment-failed-sync",
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "database sync failed (past_due not recorded)",
          context: { stripeEventId: event.id, venueId, stripeInvoiceId: invoice.id, stripeSubscriptionId: sub.id },
          slackFields: { "Stripe Event": event.id, "Venue ID": venueId, Subscription: sub.id },
        });
      }

      // Unconditional — the expected business notification that a
      // customer's payment failed, regardless of whether the sync above
      // succeeded. Identifies the venue explicitly, not just the operator.
      await sendSlackAlert({
        channel:  "ops-alerts",
        severity: "warning",
        title:    "Stripe payment failed",
        message:  `Invoice payment failed — venue marked as past_due.`,
        metadata: {
          venue_id:        venueId,
          subscription_id: sub.id,
          invoice_id:      invoice.id,
        },
      });
      break;
    }

    default:
      break;
  }
}
