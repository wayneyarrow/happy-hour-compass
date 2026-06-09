/**
 * Stripe server-side foundation for Happy Hour Compass.
 *
 * Server-only — never import this from Client Components or pages that
 * render on the client.  All secrets are read exclusively from environment
 * variables and are never hard-coded or exposed to the browser.
 *
 * Architecture notes:
 *   - Happy Hour Compass owns plan limits, entitlements, and feature gating.
 *     (src/lib/plans.ts + src/lib/subscriptions.ts remain the source of truth.)
 *   - Stripe will become the source of truth for payment status, subscription
 *     status, invoices, and payment methods — fulfilled via webhooks and the
 *     Customer Portal in a follow-up task.
 *
 * Required environment variables (add to .env.local + Vercel project settings):
 *   STRIPE_SECRET_KEY              — sk_live_… or sk_test_… (server-only)
 *   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY — pk_live_… or pk_test_… (safe for browser)
 *   STRIPE_WEBHOOK_SECRET          — whsec_… (webhook signature verification)
 *   STRIPE_PRO_PRICE_ID            — price_… for the Pro monthly recurring price
 *   STRIPE_PREMIUM_PRICE_ID        — price_… for the Premium monthly recurring price
 */

import Stripe from "stripe";
import type { OperatorPlan } from "@/lib/plans";

// ─── Client ───────────────────────────────────────────────────────────────────

let _stripe: Stripe | null = null;

/**
 * Returns a lazily-initialised Stripe client.
 *
 * The client is a singleton — repeated calls return the same instance.
 * Throws if STRIPE_SECRET_KEY is not set, so any misconfiguration surfaces
 * loudly at the call site rather than silently returning a broken client.
 */
export function getStripeClient(): Stripe {
  if (_stripe) return _stripe;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "[stripe] STRIPE_SECRET_KEY is not set. Add it to .env.local and Vercel project settings."
    );
  }

  _stripe = new Stripe(secretKey, {
    apiVersion: "2026-05-27.dahlia",
    typescript: true,
  });

  return _stripe;
}

// ─── Price ID mapping ─────────────────────────────────────────────────────────

/**
 * Plans that have a corresponding Stripe price.
 * Free and Enterprise are not self-serve Stripe plans in V1.
 */
export type StripeBillablePlan = "pro" | "premium";

/**
 * Returns the Stripe Price ID for a given plan, read from environment variables.
 *
 * Throws if the env var is not set — callers creating Checkout sessions must
 * handle this and surface a user-friendly error rather than crashing silently.
 *
 * Returns null for plans that are not billed through Stripe (free, enterprise).
 */
export function getStripePriceId(plan: OperatorPlan): string | null {
  switch (plan) {
    case "pro": {
      const id = process.env.STRIPE_PRO_PRICE_ID;
      if (!id) throw new Error("[stripe] STRIPE_PRO_PRICE_ID is not set.");
      return id;
    }
    case "premium": {
      const id = process.env.STRIPE_PREMIUM_PRICE_ID;
      if (!id) throw new Error("[stripe] STRIPE_PREMIUM_PRICE_ID is not set.");
      return id;
    }
    default:
      return null;
  }
}

/**
 * True when the given plan is billed through Stripe in V1 self-serve.
 */
export function isStripeBillablePlan(plan: OperatorPlan): plan is StripeBillablePlan {
  return plan === "pro" || plan === "premium";
}
