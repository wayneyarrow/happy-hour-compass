/**
 * Active-venue plan resolution — Phase 2A preparation only.
 *
 * NOT called from resolveOperatorContext() or any page/action yet. This
 * file exists solely so Phase 2B has a single, obvious integration point
 * for centralizing "what plan does the currently active venue have" —
 * without every Operator Admin page independently querying
 * venue_subscriptions (the "avoid duplicate Stripe/database reads per page"
 * requirement from the Phase 2 investigation, Part 9).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS ISN'T WIRED INTO OperatorContext YET
 * ─────────────────────────────────────────────────────────────────────────
 * src/lib/impersonation.ts's resolveOperatorContext() / OperatorContext are
 * live, request-scoped infrastructure — literally every Operator Admin page
 * and server action calls resolveOperatorContext() today. Adding a field
 * there means adding a database query to every one of those calls, which is
 * exactly the kind of behavior change Phase 2A is scoped to avoid (see the
 * task's Part 14 scope-control list). This file is deliberately a
 * standalone, opt-in helper instead: Phase 2B wires it into
 * resolveVenuesAndActiveVenue() (or calls it directly from the handful of
 * pages that need it) once venue-scoped entitlement resolution is actually
 * meant to go live.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * INTENDED PHASE 2B SHAPE
 * ─────────────────────────────────────────────────────────────────────────
 * OperatorContext gains one of (naming TBD at 2B implementation time):
 *   activeVenuePlan:         OperatorPlan
 *   activeVenueSubscription: VenueSubscriptionRow | null
 * populated by calling getActiveVenuePlan() below once, alongside the
 * existing venues/activeVenueId resolution in resolveVenuesAndActiveVenue()
 * — one extra query per request (batchable with the existing venue-list
 * query if profiling shows it matters), not one extra query per page.
 * Every current `parseOperatorPlan(ctx.operator?.plan)` call site (see the
 * Phase 2 investigation's entitlement matrix) becomes a read of that field
 * instead of a fresh lookup.
 */

import { getVenueSubscription, resolvePlanCodeFromVenueSubscription, type VenueSubscriptionRow } from "@/lib/venueSubscriptions";
import { getVenueEffectiveAccess, getVenueEffectivePlan } from "@/lib/planGrants/server";
import { noGrantAccess, type EffectiveAccess } from "@/lib/planGrants/grantState";
import type { OperatorPlan } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// Comp / Trial grants (Part 1)
//
// `plan` is the active venue's EFFECTIVE plan — the higher of its billing
// plan (venue_subscriptions, resolved exactly as before) and an active
// Comp/Trial grant — because it is the entitlement every Operator Admin page
// gates on. `billingPlan` is the unchanged billing resolution, and is what
// the subscription page / Change Plan modal must use: Stripe Checkout and
// plan-change routing are decided from what the venue actually pays for, so
// a comped venue can still buy the same tier through the existing checkout.
// ─────────────────────────────────────────────────────────────────────────────

export type ActiveVenuePlanResult = {
  /** Effective plan for the active venue — 'free' when there is no venue. */
  plan: OperatorPlan;
  /** Billing plan (venue_subscriptions only) — 'free' when no row exists. */
  billingPlan: OperatorPlan;
  /** Full effective-access resolution (active grant, enforcement, ...). */
  access: EffectiveAccess;
  /** The raw subscription row, or null for a Free venue with no row. */
  subscription: VenueSubscriptionRow | null;
};

/**
 * Resolves the plan for a single active venue. `null` activeVenueId (no
 * venue selected — zero venues, or a 2+-venue operator mid-selection, per
 * OperatorContext.activeVenueId's own documented semantics) resolves to
 * 'free' with no subscription row, matching how every current page already
 * treats "no venue" as an empty/default state rather than an error.
 *
 * Never reads operators.plan or operator_subscriptions — see
 * src/lib/venueSubscriptions.ts's header for why that fallback is
 * deliberately absent from the venue-level contract.
 */
export async function getActiveVenuePlan(
  activeVenueId: string | null
): Promise<ActiveVenuePlanResult> {
  if (!activeVenueId) {
    return { plan: "free", billingPlan: "free", access: noGrantAccess("free"), subscription: null };
  }

  const subscription = await getVenueSubscription(activeVenueId);
  const billingPlan = resolvePlanCodeFromVenueSubscription(subscription);
  const access = await getVenueEffectiveAccess(activeVenueId, { billingPlan });
  return { plan: access.effectivePlan, billingPlan, access, subscription };
}

/** Convenience wrapper when only the effective plan code is needed. */
export async function getActiveVenuePlanCode(activeVenueId: string | null): Promise<OperatorPlan> {
  if (!activeVenueId) return "free";
  return getVenueEffectivePlan(activeVenueId);
}
