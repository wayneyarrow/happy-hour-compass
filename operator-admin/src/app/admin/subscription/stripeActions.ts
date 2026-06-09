"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { getMembershipRole } from "@/lib/memberships";
import { getOperatorSubscription } from "@/lib/subscriptions";
import { getStripeClient, getStripePriceId } from "@/lib/stripe";

// ─── Shared utility ────────────────────────────────────────────────────────────

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
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
      return { ok: false, error: "Only the account owner can upgrade the plan." };
    }
  }

  let priceId: string | null;
  try {
    priceId = getStripePriceId(plan);
  } catch (e) {
    console.error("[createCheckoutSessionAction] price ID error:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Billing is temporarily unavailable. Please try again later." };
  }

  if (!priceId) {
    return { ok: false, error: "No price configured for that plan." };
  }

  let stripe: ReturnType<typeof getStripeClient>;
  try {
    stripe = getStripeClient();
  } catch (e) {
    console.error("[createCheckoutSessionAction] Stripe client error:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Billing is temporarily unavailable. Please try again later." };
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
      return { ok: false, error: "Failed to create checkout session. Please try again." };
    }

    return { ok: true, url: session.url };
  } catch (e) {
    console.error("[createCheckoutSessionAction] Stripe error:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Billing is temporarily unavailable. Please try again later." };
  }
}

// ─── Customer Portal ───────────────────────────────────────────────────────────

/**
 * Creates a Stripe Customer Portal session for the current operator.
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
