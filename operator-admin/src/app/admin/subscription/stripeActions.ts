"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { getMembershipRole } from "@/lib/memberships";
import { getOperatorSubscription } from "@/lib/subscriptions";
import { getStripeClient, getStripePriceId } from "@/lib/stripe";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";

// A legitimate, authenticated, authorized operator directly blocked from
// ever reaching Stripe to pay is treated the same as an acquisition-flow
// customer directly blocked mid-journey — critical, same as
// reportCriticalFailure's other callers. Only reached past every
// expected/customer-correctable check below (not authenticated, not
// resolvable, not owner) — those remain untouched and uninstrumented.
const STRIPE_CHECKOUT_FLOW = "stripe-checkout";

// ─── Shared utility ────────────────────────────────────────────────────────────

/**
 * Preview deployments must never trust a manually-configured APP_URL — it has
 * historically been set to a single fixed value across all Vercel
 * environments (see src/lib/email.ts's header comment for the original
 * incident, where this same pattern sent staging email links to the
 * production deployment). That would leak Preview/Test-mode Stripe Checkout
 * and Customer Portal redirects into the Production admin app. VERCEL_URL is
 * always specific to the deployment actually serving the request, so Preview
 * stays self-contained regardless of how APP_URL is configured.
 */
function getAppUrl(): string {
  if (process.env.APP_URL && process.env.VERCEL_ENV !== "preview") {
    return process.env.APP_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ─── Checkout ──────────────────────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout Session for upgrading to a paid plan.
 *
 * Returns { ok: true, url } on success — the caller should redirect to url.
 * Returns { ok: false, error } on failure — caller shows user-friendly message.
 *
 * The returned URL is the ONLY thing that should trigger a redirect.
 * Do NOT use the Stripe success redirect URL as the source of truth for plan
 * activation; plan_code is updated exclusively by the webhook handler.
 */
export async function createCheckoutSessionAction(
  plan: "pro" | "premium"
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const ctx = await resolveOperatorContext();

  if (!ctx.operator && !ctx.isImpersonating) {
    return { ok: false, error: "Not authenticated." };
  }

  const operatorId = ctx.operator?.id;
  if (!operatorId) return { ok: false, error: "Could not resolve operator." };

  if (!ctx.isImpersonating) {
    const userEmail = ctx.user?.email;
    if (!userEmail) return { ok: false, error: "Could not determine current user." };
    const role = await getMembershipRole(operatorId, userEmail);
    if (role !== "owner") {
      return { ok: false, error: "Only the admin can upgrade the plan." };
    }
  }

  let priceId: string | null;
  try {
    priceId = getStripePriceId(plan);
  } catch (e) {
    console.error("[createCheckoutSessionAction] price ID error:", e instanceof Error ? e.message : e);
    const report = await reportCriticalFailure({
      error: e,
      flow: STRIPE_CHECKOUT_FLOW,
      stage: "checkout-precondition",
      title: "Stripe Checkout Blocked",
      technicalSummary: "price ID misconfigured",
      context: { operatorId, plan },
      slackFields: { Plan: plan, "Operator ID": operatorId },
    });
    return { ok: false, error: report.customerMessage };
  }

  if (!priceId) {
    return { ok: false, error: "No price configured for that plan." };
  }

  let stripe: ReturnType<typeof getStripeClient>;
  try {
    stripe = getStripeClient();
  } catch (e) {
    console.error("[createCheckoutSessionAction] Stripe client error:", e instanceof Error ? e.message : e);
    const report = await reportCriticalFailure({
      error: e,
      flow: STRIPE_CHECKOUT_FLOW,
      stage: "checkout-precondition",
      title: "Stripe Checkout Blocked",
      technicalSummary: "Stripe client initialization failed",
      context: { operatorId, plan },
      slackFields: { Plan: plan, "Operator ID": operatorId },
    });
    return { ok: false, error: report.customerMessage };
  }

  const appUrl = getAppUrl();
  const subscription = await getOperatorSubscription(operatorId);
  const existingCustomerId = subscription?.billing_provider_customer_id ?? null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: Record<string, any> = {
      mode:     "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/admin/subscription?checkout=success`,
      cancel_url:  `${appUrl}/admin/subscription`,
      metadata: {
        operator_id: operatorId,
        target_plan: plan,
      },
      subscription_data: {
        metadata: {
          operator_id: operatorId,
          target_plan: plan,
        },
      },
    };

    if (existingCustomerId) {
      params.customer = existingCustomerId;
    } else if (ctx.operator?.email) {
      params.customer_email = ctx.operator.email;
    }

    const session = await stripe.checkout.sessions.create(params);

    if (!session.url) {
      // Stripe accepted the request and returned a session object but no
      // URL to redirect to — an anomalous, unexpected shape, not a normal
      // Stripe error response (which would have thrown into the catch
      // below instead).
      const report = await reportCriticalFailure({
        error: new Error("Stripe checkout.sessions.create returned no url"),
        flow: STRIPE_CHECKOUT_FLOW,
        stage: "checkout-session-create",
        title: "Stripe Checkout Blocked",
        technicalSummary: "Stripe session created with no redirect url",
        context: { operatorId, plan, stripeSessionId: session.id },
        slackFields: { Plan: plan, "Operator ID": operatorId, "Stripe Session": session.id },
      });
      return { ok: false, error: report.customerMessage };
    }

    return { ok: true, url: session.url };
  } catch (e) {
    console.error("[createCheckoutSessionAction] Stripe error:", e instanceof Error ? e.message : e);
    const report = await reportCriticalFailure({
      error: e,
      flow: STRIPE_CHECKOUT_FLOW,
      stage: "checkout-session-create",
      title: "Stripe Checkout Blocked",
      technicalSummary: "Stripe checkout session creation failed",
      context: { operatorId, plan },
      slackFields: { Plan: plan, "Operator ID": operatorId },
    });
    return { ok: false, error: report.customerMessage };
  }
}

// ─── Customer Portal ───────────────────────────────────────────────────────────

/**
 * Creates a Stripe Customer Portal session for the current operator.
 *
 * Billing management is owner-only — same rule as plan changes
 * (createCheckoutSessionAction above, changePlanAction). Members may view
 * the subscription page but cannot open the billing portal, where they
 * could change payment methods or cancel the subscription directly with
 * Stripe. Impersonation sessions bypass this check, matching every other
 * owner-only action in this file.
 *
 * Requires billing_provider_customer_id to be set on the subscription row.
 * Returns { ok: true, url } — caller redirects to url for self-serve billing management.
 */
export async function createPortalSessionAction(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const ctx = await resolveOperatorContext();

  if (!ctx.operator && !ctx.isImpersonating) {
    return { ok: false, error: "Not authenticated." };
  }

  const operatorId = ctx.operator?.id;
  if (!operatorId) return { ok: false, error: "Could not resolve operator." };

  if (!ctx.isImpersonating) {
    const userEmail = ctx.user?.email;
    if (!userEmail) return { ok: false, error: "Could not determine current user." };
    const role = await getMembershipRole(operatorId, userEmail);
    if (role !== "owner") {
      return { ok: false, error: "Only the admin can manage billing." };
    }
  }

  const subscription = await getOperatorSubscription(operatorId);
  const customerId = subscription?.billing_provider_customer_id ?? null;

  if (!customerId) {
    return { ok: false, error: "No billing account found. Please contact support." };
  }

  let stripe: ReturnType<typeof getStripeClient>;
  try {
    stripe = getStripeClient();
  } catch (e) {
    console.error("[createPortalSessionAction] Stripe client error:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Billing is temporarily unavailable. Please try again later." };
  }

  const appUrl = getAppUrl();

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${appUrl}/admin/subscription`,
    });

    return { ok: true, url: portalSession.url };
  } catch (e) {
    console.error("[createPortalSessionAction] Stripe error:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Billing is temporarily unavailable. Please try again later." };
  }
}
