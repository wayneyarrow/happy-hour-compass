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
import { syncStripeSubscription } from "@/lib/subscriptions";
import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";

export const dynamic = "force-dynamic";

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
    await sendSlackAlert({
      channel: "ops-critical",
      severity: "critical",
      title: "Stripe webhook handler failed",
      message: `Event ${event.type} (${event.id}) threw an unhandled error.`,
      metadata: { error: msg, event_id: event.id, event_type: event.type },
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
      } else {
        console.log("[webhook/stripe] checkout.session.completed: plan activated successfully →", targetPlan);
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
      }

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
