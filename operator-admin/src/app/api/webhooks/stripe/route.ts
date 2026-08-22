/**
 * POST /api/webhooks/stripe
 *
 * Handles Stripe webhook events and syncs payment/subscription state into
 * operator_subscriptions. This is the ONLY path that updates plan_code and
 * subscription status — the Checkout success redirect is informational only.
 *
 * Verified events handled:
 *   checkout.session.completed      → activate plan after first checkout
 *   customer.subscription.updated   → sync plan, status, period dates
 *   customer.subscription.deleted   → downgrade to free + cancelled status
 *   invoice.payment_succeeded       → mark active, refresh period dates
 *   invoice.payment_failed          → mark past_due + Slack ops-alerts
 *
 * Operator resolution order (for events without operator_id metadata):
 *   1. subscription.metadata.operator_id   (set by our checkout session)
 *   2. billing_provider_customer_id lookup (fallback for externally-created subs)
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
import { syncStripeSubscription, getOperatorPlanCode } from "@/lib/subscriptions";
import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";
import { logPlanChangeEvent } from "@/lib/planChangeEvents";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";
import { reportOperationalError } from "@/lib/observability/reportOperationalError";

export const dynamic = "force-dynamic";

// ── Observability ────────────────────────────────────────────────────────────
//
// "stripe-webhook" covers structural failures (signature/config/unhandled
// exception) that already had Slack coverage before this task — those are
// enriched with Sentry + one HHC reference IN PLACE, reusing the exact same
// existing sendSlackAlert() call (same channel, same volume) rather than
// adding a second alert (see the task report's "existing-alert
// consolidation" section for why).
//
// "stripe-subscription" covers DB-sync/payload failures for verified,
// successfully-received Stripe events — the "customer paid but HHC didn't
// activate/record it" class of bug. All five DB-sync branches across the
// five verified event types are now instrumented: checkout.session.completed
// (both its missing-fields and DB-sync branches), customer.subscription.updated,
// customer.subscription.deleted, invoice.payment_succeeded, and
// invoice.payment_failed. Severity is per-branch, based on actual impact —
// see each branch's inline comment and the task report for the reasoning
// (in short: anything that changes plan_code, or that hides a failed
// payment from HHC entirely, is critical; a status/period-date-only
// refresh that self-corrects on the next event is operational).
//
// Every reportCriticalFailure()/reportOperationalError() call here is
// purely additive: none of them introduce a new throw, change an HTTP
// status, or alter control flow — see Part 10 of the task report for why
// that's required (Stripe's retry semantics must never change because
// observability was added).
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

// ─── Helper: look up operator by Stripe customer ID ───────────────────────────

async function resolveOperatorByCustomer(customerId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("operator_subscriptions")
    .select("operator_id")
    .eq("billing_provider_customer_id", customerId)
    .maybeSingle();
  return (data as { operator_id: string } | null)?.operator_id ?? null;
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
    //
    // This alert already existed before this task and fires once per
    // incoming event (potentially high-volume during an outage) — adding a
    // *second*, reportCriticalFailure()-driven Slack call here would double
    // every one of those alerts. Instead: capture Sentry + one HHC reference
    // via reportOperationalError() (Sentry-only), and fold that reference
    // into this SAME existing sendSlackAlert() call so Sentry and Slack
    // correlate — channel, severity, volume, and message are all unchanged.
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
    // Same consolidation reasoning as the missing-webhook-secret branch
    // above: this alert already existed and fires once per failing event —
    // enrich it in place with Sentry + one HHC reference rather than
    // sending a second alert. Sentry capture happens first so the report's
    // hhcErrorId/sentryEventId are available to fold into this same call.
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
    // Return 500 so Stripe retries delivery — unchanged by the reporting
    // added above (see Part 10 of the task report: nothing here can alter
    // this status).
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

      const operatorId     = session.metadata?.operator_id ?? null;
      const targetPlan     = session.metadata?.target_plan ?? null;
      const customerId     = extractId(session.customer);
      const subscriptionId = extractId(session.subscription);

      console.log("[webhook/stripe] checkout.session.completed: resolved fields:", {
        operatorId, targetPlan, customerId, subscriptionId,
      });

      if (!operatorId || !targetPlan || !customerId || !subscriptionId) {
        console.error("[webhook/stripe] checkout.session.completed: missing required fields — cannot activate plan", {
          operatorId, targetPlan, customerId, subscriptionId, sessionId: session.id,
        });
        // Stripe considers this checkout complete (money has moved) but HHC
        // cannot activate it — and unlike a DB-sync failure, there is no
        // later event to reconcile from: a subscription.updated event would
        // only arrive for a subscriptionId we don't even have here if that
        // was the missing field, and operator_id/target_plan are only ever
        // set by our OWN checkout session creation, so a later event can't
        // supply them either. Not safely recoverable elsewhere → critical.
        await reportCriticalFailure({
          error: new Error(
            `checkout.session.completed missing required fields: ${[
              !operatorId ? "operator_id" : null,
              !targetPlan ? "target_plan" : null,
              !customerId ? "customer" : null,
              !subscriptionId ? "subscription" : null,
            ].filter(Boolean).join(", ")}`
          ),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "checkout-completed-invalid-payload",
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "checkout session missing required fields for activation",
          context: { stripeEventId: event.id, stripeSessionId: session.id },
          slackFields: { "Stripe Event": event.id, "Checkout Session": session.id },
        });
        break;
      }

      const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId   = stripeSub.items.data[0]?.price?.id ?? null;
      const period    = getSubPeriod(stripeSub);

      console.log("[webhook/stripe] checkout.session.completed: Stripe subscription details:", {
        subscriptionId,
        priceId,
        stripeStatus: stripeSub.status,
        period,
      });

      const oldPlanForCheckout = await getOperatorPlanCode(operatorId);

      const result = await syncStripeSubscription(operatorId, {
        customerId,
        subscriptionId,
        planCode:    targetPlan,
        status:      "active",
        periodStart: period?.periodStart ?? null,
        periodEnd:   period?.periodEnd   ?? null,
      });

      console.log("[webhook/stripe] checkout.session.completed: DB sync result:", {
        operatorId,
        planCode: targetPlan,
        customerId,
        subscriptionId,
        ok: result.ok,
        error: result.error ?? null,
      });

      if (!result.ok) {
        console.error("[webhook/stripe] checkout.session.completed: DB sync failed:", result.error);
        // Highest-priority gap this task exists to close: Stripe has
        // successfully charged the customer and told us so, but the plan
        // activation write failed — silently, before this task. No throw
        // here (see the file-header comment) — this branch's existing
        // behavior already returns 200 to Stripe either way, and a retry
        // wouldn't help without human intervention (the event itself
        // already fully arrived and was valid); the goal is visibility, not
        // changing that response.
        await reportCriticalFailure({
          error: new Error(result.error ?? "syncStripeSubscription failed"),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "checkout-completed-sync",
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "database sync failed (checkout activation)",
          context: {
            stripeEventId: event.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            planCode: targetPlan,
          },
          slackFields: {
            "Stripe Event": event.id,
            Subscription: subscriptionId,
            Plan: targetPlan,
          },
        });
      } else if (oldPlanForCheckout !== targetPlan) {
        console.log("[webhook/stripe] checkout.session.completed: plan activated successfully →", targetPlan);
        await logPlanChangeEvent({
          operatorId,
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

    // ── Subscription updated → plan / status changes ───────────────────────────
    case "customer.subscription.updated": {
      const sub        = event.data.object as Stripe.Subscription;
      const customerId = extractId(sub.customer);
      if (!customerId) break;

      const metaOperatorId = sub.metadata?.operator_id ?? null;
      const operatorId     = metaOperatorId ?? await resolveOperatorByCustomer(customerId);

      if (!operatorId) {
        console.warn("[webhook/stripe] customer.subscription.updated: could not resolve operator", { customerId, subId: sub.id });
        break;
      }

      const priceId  = sub.items.data[0]?.price?.id ?? null;
      const planCode = toPlanCode(priceId);
      const hhcStatus = toHhcStatus(sub.status);
      const period   = getSubPeriod(sub);

      console.log("[webhook/stripe] customer.subscription.updated:", {
        subId: sub.id,
        customerId,
        operatorId,
        priceId,
        planCode: planCode ?? "(unchanged)",
        stripeStatus: sub.status,
        hhcStatus,
        period,
      });

      // Capture old plan before sync if a plan change is included.
      const oldPlanForUpdate = planCode ? await getOperatorPlanCode(operatorId) : null;

      const result = await syncStripeSubscription(operatorId, {
        customerId,
        subscriptionId: sub.id,
        ...(planCode ? { planCode } : {}),
        status:      hhcStatus,
        periodStart: period?.periodStart ?? null,
        periodEnd:   period?.periodEnd   ?? null,
      });

      console.log("[webhook/stripe] customer.subscription.updated: DB sync result:", { ok: result.ok, error: result.error ?? null });

      if (!result.ok) {
        console.error("[webhook/stripe] customer.subscription.updated: DB sync failed:", result.error);
        // Severity depends on actual impact: when this update carries a
        // plan (price) change, a failed sync leaves HHC's entitlement
        // materially inconsistent with what Stripe now has (an upgrade/
        // downgrade the operator paid for silently didn't take effect) —
        // critical. When there's no plan change (a period-date/status-only
        // refresh, e.g. a renewal), a failed sync is comparatively benign —
        // it's stale but not wrong about entitlement, and typically
        // self-corrects on the next Stripe event for the same subscription
        // — operational, Sentry-only, no Slack page.
        if (planCode) {
          await reportCriticalFailure({
            error: new Error(result.error ?? "syncStripeSubscription failed"),
            flow: STRIPE_SUBSCRIPTION_FLOW,
            stage: "subscription-updated-sync",
            title: "Stripe Subscription Sync Failed",
            technicalSummary: "database sync failed (plan change)",
            context: {
              stripeEventId: event.id,
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
              planCode,
            },
            slackFields: {
              "Stripe Event": event.id,
              Subscription: sub.id,
              Plan: planCode,
            },
          });
        } else {
          reportOperationalError({
            error: new Error(result.error ?? "syncStripeSubscription failed"),
            flow: STRIPE_SUBSCRIPTION_FLOW,
            stage: "subscription-updated-sync",
            severity: "operational",
            context: {
              stripeEventId: event.id,
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
            },
          });
        }
      } else if (planCode && oldPlanForUpdate && planCode !== oldPlanForUpdate) {
        await logPlanChangeEvent({
          operatorId,
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

    // ── Subscription deleted → downgrade to free ───────────────────────────────
    case "customer.subscription.deleted": {
      const sub        = event.data.object as Stripe.Subscription;
      const customerId = extractId(sub.customer);
      if (!customerId) break;

      const metaOperatorId = sub.metadata?.operator_id ?? null;
      const operatorId     = metaOperatorId ?? await resolveOperatorByCustomer(customerId);

      console.log("[webhook/stripe] customer.subscription.deleted:", { subId: sub.id, customerId, operatorId });

      if (!operatorId) {
        console.warn("[webhook/stripe] customer.subscription.deleted: could not resolve operator", { customerId, subId: sub.id });
        break;
      }

      const oldPlanForDelete = await getOperatorPlanCode(operatorId);

      const result = await syncStripeSubscription(operatorId, {
        customerId,
        subscriptionId: sub.id,
        planCode:    "free",
        status:      "cancelled",
        periodStart: null,
        periodEnd:   null,
      });

      console.log("[webhook/stripe] customer.subscription.deleted: DB sync result:", { ok: result.ok, error: result.error ?? null });

      if (!result.ok) {
        console.error("[webhook/stripe] customer.subscription.deleted: DB sync failed:", result.error);
        // Always critical: this event always represents an entitlement
        // change (downgrade to free), unlike subscription.updated, which
        // can be a benign period-date-only refresh.
        await reportCriticalFailure({
          error: new Error(result.error ?? "syncStripeSubscription failed"),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "subscription-deleted-sync",
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "database sync failed (downgrade to free)",
          context: {
            stripeEventId: event.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
          },
          slackFields: {
            "Stripe Event": event.id,
            Subscription: sub.id,
            Plan: "free",
          },
        });
      } else {
        await logPlanChangeEvent({
          operatorId,
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

    // ── Invoice paid → refresh active status + period dates ───────────────────
    case "invoice.payment_succeeded": {
      const invoice        = event.data.object as Stripe.Invoice;
      const subscriptionId = getInvoiceSubscriptionId(invoice);

      console.log("[webhook/stripe] invoice.payment_succeeded:", { invoiceId: invoice.id, subscriptionId });

      if (!subscriptionId) break;

      const sub        = await stripe.subscriptions.retrieve(subscriptionId);
      const customerId = extractId(sub.customer);
      if (!customerId) break;

      const metaOperatorId = sub.metadata?.operator_id ?? null;
      const operatorId     = metaOperatorId ?? await resolveOperatorByCustomer(customerId);

      if (!operatorId) {
        console.warn("[webhook/stripe] invoice.payment_succeeded: could not resolve operator", { customerId, subscriptionId });
        break;
      }

      const period = getSubPeriod(sub);

      console.log("[webhook/stripe] invoice.payment_succeeded: syncing active status:", { operatorId, subscriptionId, period });

      const result = await syncStripeSubscription(operatorId, {
        customerId,
        subscriptionId: sub.id,
        status:      "active",
        periodStart: period?.periodStart ?? null,
        periodEnd:   period?.periodEnd   ?? null,
      });

      console.log("[webhook/stripe] invoice.payment_succeeded: DB sync result:", { ok: result.ok, error: result.error ?? null });

      if (!result.ok) {
        console.error("[webhook/stripe] invoice.payment_succeeded: DB sync failed:", result.error);
        // Operational, Sentry-only — this sync call never includes
        // planCode (source-confirmed above: only status + period dates),
        // and `status` is display-only everywhere in this codebase (the
        // subscription page's "Past Due"/"Active" badge is its only
        // consumer — grep confirms nothing gates feature access on it;
        // only plan_code does, via src/lib/plans.ts, which this call never
        // touches). A failed sync here leaves the status badge/period
        // dates stale, not entitlement wrong, and self-corrects on the
        // next Stripe event for the same subscription — not the "customer
        // paid but got nothing" class of bug this task targets.
        reportOperationalError({
          error: new Error(result.error ?? "syncStripeSubscription failed"),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "invoice-payment-succeeded-sync",
          severity: "operational",
          context: { stripeEventId: event.id, stripeInvoiceId: invoice.id, stripeSubscriptionId: subscriptionId },
        });
      }
      break;
    }

    // ── Invoice failed → mark past_due + Slack alert ───────────────────────────
    case "invoice.payment_failed": {
      const invoice        = event.data.object as Stripe.Invoice;
      const subscriptionId = getInvoiceSubscriptionId(invoice);

      console.log("[webhook/stripe] invoice.payment_failed:", { invoiceId: invoice.id, subscriptionId });

      if (!subscriptionId) break;

      const sub        = await stripe.subscriptions.retrieve(subscriptionId);
      const customerId = extractId(sub.customer);
      if (!customerId) break;

      const metaOperatorId = sub.metadata?.operator_id ?? null;
      const operatorId     = metaOperatorId ?? await resolveOperatorByCustomer(customerId);

      if (!operatorId) {
        console.warn("[webhook/stripe] invoice.payment_failed: could not resolve operator", { customerId, subscriptionId });
        break;
      }

      const period = getSubPeriod(sub);

      console.log("[webhook/stripe] invoice.payment_failed: syncing past_due status:", { operatorId, subscriptionId });

      const result = await syncStripeSubscription(operatorId, {
        customerId,
        subscriptionId: sub.id,
        status:      "past_due",
        periodStart: period?.periodStart ?? null,
        periodEnd:   period?.periodEnd   ?? null,
      });

      console.log("[webhook/stripe] invoice.payment_failed: DB sync result:", { ok: result.ok, error: result.error ?? null });

      if (!result.ok) {
        console.error("[webhook/stripe] invoice.payment_failed: DB sync failed:", result.error);
        // Critical, and deliberately distinct from the unconditional
        // "Stripe payment failed" #ops-alerts notification below: that one
        // is the EXPECTED business event (a customer's card was declined —
        // fires every time regardless of sync outcome, unchanged by this
        // task). This one is the opposite-direction risk from
        // invoice.payment_succeeded's failure: `status` alone doesn't gate
        // access (see that branch's comment), but failing to record a
        // failed payment means HHC has no record that this operator is
        // now behind on payment at all — a silent collections/dunning
        // blind spot with a real revenue-integrity consequence, unlike
        // merely being slow to reflect good news. Reported separately, to
        // #ops-critical, so the two alerts' meanings stay unambiguous:
        // "a customer's payment failed" vs "HHC failed to notice it."
        await reportCriticalFailure({
          error: new Error(result.error ?? "syncStripeSubscription failed"),
          flow: STRIPE_SUBSCRIPTION_FLOW,
          stage: "invoice-payment-failed-sync",
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "database sync failed (past_due not recorded)",
          context: { stripeEventId: event.id, stripeInvoiceId: invoice.id, stripeSubscriptionId: sub.id },
          slackFields: { "Stripe Event": event.id, Subscription: sub.id },
        });
      }

      // Unconditional, unchanged by this task — the expected business
      // notification that a customer's payment failed, regardless of
      // whether the sync above succeeded.
      await sendSlackAlert({
        channel:  "ops-alerts",
        severity: "warning",
        title:    "Stripe payment failed",
        message:  `Invoice payment failed — operator marked as past_due.`,
        metadata: {
          operator_id:     operatorId,
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
