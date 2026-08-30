/**
 * Venue-level subscription helpers for Happy Hour Compass — Phase 2B LIVE
 * entitlement/billing source (built as Phase 2A additive foundation; see
 * supabase/migrations/083_venue_subscriptions.sql,
 * 085_venue_plan_entitlement_atomic_sync.sql, 086_venue_subscriptions_
 * cutover_safety.sql, and the Phase 2 investigation report for background).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PHASE 2B STATUS
 * ─────────────────────────────────────────────────────────────────────────
 * This file is now the LIVE source of truth for plan/entitlement/billing
 * state, read from every Operator Admin page/action, the Stripe checkout/
 * webhook/portal actions, Discover ranking, and Control Panel venue
 * displays. The legacy operator-level equivalents in src/lib/subscriptions.ts
 * (getOperatorPlanCode, updateOperatorPlan, syncStripeSubscription) remain
 * present and functionally unchanged, but are no longer called from any live
 * entitlement/billing path — see that file's own header note and Part 16 of
 * the Phase 2B task report for the full list of what still legitimately
 * calls them (migrations, tests, rollback reference only).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THAT MATTERS MOST: NO OPERATOR-LEVEL FALLBACK
 * ─────────────────────────────────────────────────────────────────────────
 * src/lib/subscriptions.ts's getOperatorPlanCode() falls back from
 * operator_subscriptions to operators.plan to 'free' — that fallback chain
 * is CORRECT for that file, because every venue an operator owns shares one
 * plan today. It must NOT be copied here. Once one operator can own venues
 * with different plans (Landing = Premium, Il Mercato = Free — the entire
 * point of Phase 2), there is no single operators.plan value that could
 * ever be a correct answer for "this venue's plan" — falling back to it
 * would silently leak one venue's paid entitlement onto a sibling Free
 * venue, or vice versa. The contract of every function below is therefore
 * exactly two states, never three:
 *
 *   venue_subscriptions row exists → its plan_code
 *   no row                         → 'free'
 *
 * operators.plan / operator_subscriptions are never read by
 * getVenueSubscription() or getVenuePlanCode(). If a future migration-only
 * utility genuinely needs to read the operator-level value (e.g. the
 * one-time backfill embedded in migration 083 itself, which is pure SQL and
 * lives there, not here), it must be named and documented as migration-only
 * and must never be reachable from the public helper contract this file
 * exports.
 *
 * All functions here are server-side only — they use the admin client
 * (service-role key) and must never be imported from Client Components.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { parseOperatorPlan, PLANS, type OperatorPlan } from "@/lib/plans";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";

const VENUE_PLAN_UPDATE_FLOW = "venue-plan-update";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type VenueSubscriptionStatus = "active" | "pending" | "cancelled" | "past_due";
export type VenueBillingProvider    = "manual" | "stripe";

export type VenueSubscriptionRow = {
  id:                                string;
  venue_id:                          string;
  plan_code:                         OperatorPlan;
  status:                            VenueSubscriptionStatus;
  billing_provider:                  VenueBillingProvider;
  billing_provider_customer_id:      string | null;
  billing_provider_subscription_id:  string | null;
  current_period_start:              string | null;
  current_period_end:                string | null;
  cancel_at_period_end:              boolean;
  created_at:                        string;
  updated_at:                        string;
};

const VENUE_SUBSCRIPTION_SELECT =
  "id, venue_id, plan_code, status, billing_provider, " +
  "billing_provider_customer_id, billing_provider_subscription_id, " +
  "current_period_start, current_period_end, cancel_at_period_end, " +
  "created_at, updated_at";

// Raw shape returned by Supabase before type coercions — no generated
// Supabase types in this project (same pattern as SubscriptionDbRow in
// src/lib/subscriptions.ts).
type VenueSubscriptionDbRow = {
  id: string;
  venue_id: string;
  plan_code: string | null;
  status: string | null;
  billing_provider: string | null;
  billing_provider_customer_id: string | null;
  billing_provider_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  created_at: string;
  updated_at: string;
};

function coerceVenueSubscriptionRow(row: VenueSubscriptionDbRow): VenueSubscriptionRow {
  return {
    id:                               row.id,
    venue_id:                         row.venue_id,
    plan_code:                        parseOperatorPlan(row.plan_code),
    status:                           (row.status ?? "active") as VenueSubscriptionStatus,
    billing_provider:                 (row.billing_provider ?? "manual") as VenueBillingProvider,
    billing_provider_customer_id:     row.billing_provider_customer_id,
    billing_provider_subscription_id: row.billing_provider_subscription_id,
    current_period_start:             row.current_period_start,
    current_period_end:               row.current_period_end,
    cancel_at_period_end:             row.cancel_at_period_end ?? false,
    created_at:                       row.created_at,
    updated_at:                       row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure resolution logic — no I/O, unit-testable directly.
//
// Extracted the same way computeActiveVenueId() was pulled out of
// resolveVenuesAndActiveVenue() in src/lib/impersonation.ts: this is the one
// piece of "what does this venue's plan resolve to" that has no Supabase
// call of its own, so it's the piece that gets a real, executable test
// (tests/unit/subscriptions/venuePlanResolution.test.ts) rather than a
// static source-text assertion.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The entire Phase 2 entitlement-resolution contract in one function:
 *   row exists → its plan_code
 *   no row     → 'free'
 * Never consults any operator-level value — see this file's header.
 */
export function resolvePlanCodeFromVenueSubscription(
  row: VenueSubscriptionRow | null
): OperatorPlan {
  if (!row) return "free";
  return row.plan_code;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the subscription row for a venue, or null if none exists (a Free
 * venue that has never been on a paid plan). Uses the admin client — RLS
 * blocks non-service-role reads (venue_subscriptions has no permissive
 * policies, same as operator_subscriptions).
 */
export async function getVenueSubscription(
  venueId: string
): Promise<VenueSubscriptionRow | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("venue_subscriptions")
    .select(VENUE_SUBSCRIPTION_SELECT)
    .eq("venue_id", venueId)
    .maybeSingle();

  if (error) {
    console.error("[getVenueSubscription]", error.message);
    return null;
  }

  if (!data) return null;

  return coerceVenueSubscriptionRow(data as unknown as VenueSubscriptionDbRow);
}

/**
 * Returns the current plan code for a venue.
 *
 * Contract (see file header — this is intentionally NOT a 3-step fallback
 * chain like getOperatorPlanCode()):
 *   venue_subscriptions row exists → its plan_code
 *   no row                         → 'free'
 *
 * Never reads operators.plan or operator_subscriptions.
 */
export async function getVenuePlanCode(venueId: string): Promise<OperatorPlan> {
  const subscription = await getVenueSubscription(venueId);
  return resolvePlanCodeFromVenueSubscription(subscription);
}

// ─────────────────────────────────────────────────────────────────────────────
// First-checkout customer reservation (Phase 2B review fix)
//
// Closes the concurrent-first-checkout race: two simultaneous Checkout
// requests for the same never-billed venue must never each create their own
// Stripe Customer (or, worse, each end up tracking a different Stripe
// subscription while the other silently keeps billing, untracked). See
// createCheckoutSessionAction() (src/app/admin/subscription/stripeActions.ts)
// for the caller-side flow this exists for.
//
// Deliberately NOT built on sync_venue_plan_entitlement() (migration 085) —
// that RPC is an UPSERT (ON CONFLICT DO UPDATE), which would let two
// concurrent callers each "win" and overwrite each other's customer id,
// reproducing the exact race this function exists to close. A reservation
// needs the opposite behavior: on conflict, DO NOT overwrite — tell the
// loser to back off and use the winner's row instead. A plain INSERT
// relying on the existing UNIQUE(venue_id) constraint (migration 083) is
// the simplest correct primitive for that — Postgres enforces it atomically
// with no additional locking/RPC machinery needed.
// ─────────────────────────────────────────────────────────────────────────────

export type ReserveVenueStripeCustomerResult =
  | { ok: true; reserved: true; row: VenueSubscriptionRow }
  | { ok: true; reserved: false; row: VenueSubscriptionRow }
  | { ok: false; error: string };

/**
 * Atomically reserves `customerId` as venue `venueId`'s Stripe Customer,
 * ONLY if no venue_subscriptions row exists yet. plan_code is written as
 * 'free' — a reservation never grants paid entitlement on its own; only a
 * later webhook-confirmed payment does that.
 *
 * `reserved: true`  — this call created the row; caller should use `customerId`
 *                      (the one it just passed in) going forward.
 * `reserved: false` — a concurrent call already reserved a row first; caller
 *                      must use `row.billing_provider_customer_id` instead,
 *                      and should not treat `customerId` as attached to
 *                      this venue (the caller is expected to best-effort
 *                      clean up the now-unused Stripe Customer it created).
 * `ok: false`       — the reservation failed for a reason other than a
 *                      concurrent winner (a real DB error). Callers must
 *                      NOT proceed to Checkout with an unmapped customer —
 *                      report critically and stop.
 */
export async function reserveVenueStripeCustomer(
  venueId: string,
  customerId: string
): Promise<ReserveVenueStripeCustomerResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("venue_subscriptions")
    .insert({
      venue_id:                     venueId,
      plan_code:                    "free",
      status:                       "active",
      billing_provider:             "stripe",
      billing_provider_customer_id: customerId,
    })
    .select(VENUE_SUBSCRIPTION_SELECT)
    .single();

  if (!error) {
    return { ok: true, reserved: true, row: coerceVenueSubscriptionRow(data as unknown as VenueSubscriptionDbRow) };
  }

  // Postgres 23505 = unique_violation. Fired on venue_subscriptions_venue_id_key
  // when a concurrent request already reserved this venue first — expected
  // under real concurrency, not an error condition.
  if ((error as { code?: string }).code === "23505") {
    const existing = await getVenueSubscription(venueId);
    if (existing) return { ok: true, reserved: false, row: existing };
    // Vanishingly unlikely: the conflict fired but the row is now gone
    // (e.g. a concurrent delete). Surface as a real error rather than ever
    // proceeding without a known-good customer mapping.
    return { ok: false, error: "Venue subscription reservation conflict could not be resolved." };
  }

  console.error("[reserveVenueStripeCustomer]", error.message);
  return { ok: false, error: error.message };
}

// ─────────────────────────────────────────────────────────────────────────────
// Write helpers
//
// Both functions below are direct venue-scoped mirrors of updateOperatorPlan()
// / syncStripeSubscription() in src/lib/subscriptions.ts, writing through the
// sync_venue_plan_entitlement() RPC (migration 085) instead of
// sync_operator_plan_entitlement(). UNUSED by any live call site in Phase 2A
// — reserved for Phase 2B to wire into changePlanAction / the Stripe webhook
// route once those cut over to venue_id. Kept here now (rather than written
// from scratch in 2B) so the write contract, RPC parameter shape, and
// observability pattern are already pinned and tested.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manually changes a venue's plan. Single-table atomic write via
 * sync_venue_plan_entitlement() (migration 085) — there is no second
 * column/table to keep in sync the way updateOperatorPlan() must for
 * operators.plan, because there is deliberately no venues.plan column.
 *
 * Does NOT touch Stripe or billing fields, and does NOT read or write any
 * operator-level table.
 */
export async function updateVenuePlan(
  venueId: string,
  newPlan: OperatorPlan
): Promise<{ ok: boolean; error?: string; hhcErrorId?: string }> {
  const supabase = createAdminClient();

  const { error } = await supabase.rpc("sync_venue_plan_entitlement", {
    p_venue_id:         venueId,
    p_plan_code:        newPlan,
    p_status:           "active",
    p_billing_provider: "manual",
  });

  if (error) {
    console.error("[updateVenuePlan] atomic entitlement sync failed:", error.message);
    const report = await reportCriticalFailure({
      error: new Error(error.message),
      flow: VENUE_PLAN_UPDATE_FLOW,
      stage: "entitlement-write",
      title: "Venue Plan Update Failed",
      technicalSummary: "atomic database write failed (venue_subscriptions)",
      context: { venueId, targetPlan: newPlan },
      slackFields: { "Venue ID": venueId, "Target Plan": newPlan },
    });
    return { ok: false, error: error.message, hhcErrorId: report.hhcErrorId };
  }

  return { ok: true };
}

/** Mirrors StripeSync (src/lib/subscriptions.ts) but scoped to a venue. */
export type VenueStripeSync = {
  customerId:           string;
  subscriptionId:       string;
  planCode?:            string;  // omit to leave plan_code unchanged
  status:               VenueSubscriptionStatus;
  periodStart:          string | null;
  periodEnd:            string | null;
  cancelAtPeriodEnd?:   boolean; // omit to leave cancel_at_period_end unchanged
};

/**
 * Syncs venue_subscriptions from a Stripe webhook event, once Stripe
 * checkout/webhooks are wired to venue_id (Phase 2B — see Part 9 of the
 * Phase 2A task). Mirrors syncStripeSubscription()'s two-path shape
 * (plan-changing vs. status/period-only), but single-table throughout —
 * there is no operators.plan-equivalent write to gate on here.
 *
 * NOT called by src/app/api/webhooks/stripe/route.ts in Phase 2A. Stripe
 * behavior is completely unchanged by this file's existence.
 */
export async function syncVenueStripeSubscription(
  venueId: string,
  sync: VenueStripeSync
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient();

  if (sync.planCode !== undefined) {
    const plan = parseOperatorPlan(sync.planCode);
    const { error } = await supabase.rpc("sync_venue_plan_entitlement", {
      p_venue_id:                         venueId,
      p_plan_code:                        plan,
      p_status:                           sync.status,
      p_billing_provider:                 "stripe",
      p_billing_provider_customer_id:     sync.customerId,
      p_billing_provider_subscription_id: sync.subscriptionId,
      p_current_period_start:             sync.periodStart,
      p_current_period_end:               sync.periodEnd,
      p_cancel_at_period_end:             sync.cancelAtPeriodEnd ?? false,
    });

    if (error) {
      console.error("[syncVenueStripeSubscription] atomic entitlement sync failed:", error.message);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  }

  // Status/period-only sync — never calls the plan-changing RPC.
  const { error: subError } = await supabase
    .from("venue_subscriptions")
    .upsert(
      {
        venue_id:                          venueId,
        billing_provider:                  "stripe",
        billing_provider_customer_id:      sync.customerId,
        billing_provider_subscription_id:  sync.subscriptionId,
        status:                            sync.status,
        current_period_start:              sync.periodStart,
        current_period_end:                sync.periodEnd,
        ...(sync.cancelAtPeriodEnd !== undefined
          ? { cancel_at_period_end: sync.cancelAtPeriodEnd }
          : {}),
        updated_at:                        new Date().toISOString(),
      },
      { onConflict: "venue_id" }
    );

  if (subError) {
    console.error("[syncVenueStripeSubscription] upsert failed:", subError.message);
    return { ok: false, error: subError.message };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Team-seat entitlement (Phase 2B temporary rule)
//
// Team membership (operator_memberships) remains operator-level — an
// operator with multiple venues still has ONE team, not one per venue (see
// src/app/admin/users/actions.ts's header note; per-venue team permissions
// are explicitly out of scope for Phase 2B — see the task's scope-control
// list). But once plan is venue-level, "what is this operator's seat limit"
// has no single correct venue to read from any more.
//
// TEMPORARY RULE (documented here, not a permanent architecture decision —
// see the Phase 2 investigation report, Part 11, for the alternatives
// considered): the operator's seat limit is maxUsers() of the HIGHEST plan
// among the venues that operator can currently manage. "Currently manage"
// excludes cancelled venues specifically so a cancelled venue can never
// indefinitely inflate the seat count for venues still in active use.
//
//   Free + Free    → Free seat cap
//   Free + Pro     → Pro seat cap
//   Free + Premium → Premium seat cap
//   Pro  + Premium → Premium seat cap
//
// This does NOT change operator_memberships, invitation ownership,
// per-venue roles, or access scope — a member's access is still "every
// venue this operator owns," unchanged from Phase 1. Only the numeric seat
// LIMIT computation changes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the highest plan among all of an operator's currently-manageable
 * (non-cancelled) venues. Returns 'free' if the operator owns no venues, or
 * only cancelled ones. Used exclusively for the team-seat limit — NOT a
 * general-purpose "the operator's plan" resolver, and must not be reused as
 * one (there is no such thing as a single correct operator-wide plan once
 * venues can diverge — see this file's header).
 */
export async function getOperatorHighestVenuePlan(operatorId: string): Promise<OperatorPlan> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("venues")
    .select("id")
    .eq("created_by_operator_id", operatorId)
    .is("cancelled_at", null);

  if (error) {
    console.error("[getOperatorHighestVenuePlan]", error.message);
    return "free";
  }

  const venueIds = ((data ?? []) as { id: string }[]).map((v) => v.id);
  if (venueIds.length === 0) return "free";

  const plans = await Promise.all(venueIds.map((id) => getVenuePlanCode(id)));
  return highestPlan(plans);
}

/**
 * Pure reduction — the highest-ranked plan in a list, defaulting to 'free'
 * for an empty list. Extracted for direct unit testing (no I/O), same
 * rationale as resolvePlanCodeFromVenueSubscription() above.
 */
export function highestPlan(plans: OperatorPlan[]): OperatorPlan {
  return plans.reduce<OperatorPlan>(
    (best, p) => (PLANS.indexOf(p) > PLANS.indexOf(best) ? p : best),
    "free"
  );
}
