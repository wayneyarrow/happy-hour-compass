/**
 * Authorization rules for changePlanAction (src/app/admin/subscription/
 * changePlanAction.ts) — the manual-upgrade bypass fix.
 *
 * THE BYPASS: changePlanAction is an exported Server Action. For a venue
 * with no Stripe-backed subscription it writes the target plan straight to
 * venue_subscriptions (billing_provider "manual") via updateVenuePlan(). The
 * Change Plan modal only ever sends Free there (paid upgrades go to Stripe
 * Checkout), but the action itself accepted any plan from any owner — so an
 * owner invoking it directly could take Pro/Premium/Enterprise without
 * paying. That manual path exists for founder support (impersonation).
 *
 * Rules (decided BEFORE any billing, plan-history, audit, note or
 * notification write):
 *   - Founder impersonation: unchanged — may still set any plan manually.
 *     The impersonation itself must be re-verified per request
 *     (verifyImpersonatingFounder) — a valid session cookie alone is not
 *     enough.
 *   - Normal operators (owners):
 *       • Enterprise is never self-serve → rejected.
 *       • No Stripe-backed subscription → only Free is allowed (paid plans
 *         must be bought through Stripe Checkout).
 *       • Stripe-backed → unchanged (Pro ↔ Premium price change in place;
 *         Free cancels the real subscription).
 */

import type { OperatorPlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";

export type PlanChangeDecision = { allowed: true } | { allowed: false; error: string };

export const PAID_PLAN_REQUIRES_CHECKOUT_ERROR =
  "Paid plans must be purchased through checkout. Choose a plan from the Change Plan menu to continue.";
export const ENTERPRISE_NOT_SELF_SERVE_ERROR =
  "Enterprise plans are arranged with the Happy Hour Compass team. Please contact us.";
export const IMPERSONATION_NOT_VERIFIED_ERROR =
  "Your support session could not be verified. Please sign in to the Control Panel again.";

/** Pure decision — no I/O. */
export function decidePlanChange(input: {
  targetPlan: OperatorPlan;
  isCurrentlyStripeBacked: boolean;
  isImpersonating: boolean;
}): PlanChangeDecision {
  if (input.isImpersonating) return { allowed: true };
  if (input.targetPlan === "enterprise") return { allowed: false, error: ENTERPRISE_NOT_SELF_SERVE_ERROR };
  if (!input.isCurrentlyStripeBacked && input.targetPlan !== "free") {
    return { allowed: false, error: PAID_PLAN_REQUIRES_CHECKOUT_ERROR };
  }
  return { allowed: true };
}

/**
 * Server-side re-verification of an impersonation session for a billing
 * action: the request must carry the live Supabase login of the SAME founder
 * who started the session, and that founder must still be a Control Panel
 * admin. Closes the gap where the impersonation cookie alone (validated only
 * for existence/expiry in resolveOperatorContext) would carry founder
 * authority — e.g. after the founder's admin access was revoked, or if the
 * cookie reached another browser.
 */
export async function verifyImpersonatingFounder(sessionFounderEmail: string | null): Promise<boolean> {
  if (!sessionFounderEmail) return false;
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    const email = user?.email?.trim().toLowerCase();
    if (!email || email !== sessionFounderEmail.trim().toLowerCase()) return false;
    return await isControlPanelAdmin(email);
  } catch {
    return false;
  }
}
