import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePlanCodeFromVenueSubscription,
  type VenueSubscriptionRow,
} from "../../../src/lib/venueSubscriptions";
import { resolvePlanCodeFromJoinedField } from "../../../src/lib/discover/venuePlanSource";

/**
 * Pins the core Phase 2 invariant (Phase 2A foundation — see the Phase 2
 * investigation report and supabase/migrations/083_venue_subscriptions.sql):
 * a venue's plan resolves from ITS OWN venue_subscriptions row only, never
 * from a sibling venue or from any operator-level value.
 *
 * resolvePlanCodeFromVenueSubscription() is the one piece of venue-plan
 * resolution with no Supabase I/O of its own — extracted the same way
 * computeActiveVenueId() was pulled out of resolveVenuesAndActiveVenue() in
 * src/lib/impersonation.ts (see tests/unit/impersonation/
 * computeActiveVenueId.test.ts) — specifically so it can be unit-tested
 * directly with real assertions, rather than only a static source-text
 * check. getVenueSubscription()/getVenuePlanCode() themselves are not
 * directly unit-tested here (real Supabase admin client calls, no DI seam —
 * same reasoning as every other flow-specific test in this repo); see
 * venueSubscriptionsRegression.test.ts for their static structural coverage.
 */

function row(overrides: Partial<VenueSubscriptionRow> = {}): VenueSubscriptionRow {
  return {
    id: "sub-1",
    venue_id: "venue-1",
    plan_code: "premium",
    status: "active",
    billing_provider: "manual",
    billing_provider_customer_id: null,
    billing_provider_subscription_id: null,
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("no venue_subscriptions row → Free", () => {
  assert.equal(resolvePlanCodeFromVenueSubscription(null), "free");
});

test("row exists → its own plan_code, whatever it is", () => {
  assert.equal(resolvePlanCodeFromVenueSubscription(row({ plan_code: "premium" })), "premium");
  assert.equal(resolvePlanCodeFromVenueSubscription(row({ plan_code: "pro" })), "pro");
  assert.equal(resolvePlanCodeFromVenueSubscription(row({ plan_code: "free" })), "free");
  assert.equal(resolvePlanCodeFromVenueSubscription(row({ plan_code: "enterprise" })), "enterprise");
});

test("core Phase 2 invariant: Venue A Premium + Venue B no row, same operator — each resolves independently", () => {
  // Two venues owned by the same operator (the operator identity plays no
  // role in this function's signature at all — that is the point).
  const venueAPremium = row({ venue_id: "venue-a", plan_code: "premium" });
  const venueBNoRow: VenueSubscriptionRow | null = null;

  const planA = resolvePlanCodeFromVenueSubscription(venueAPremium);
  const planB = resolvePlanCodeFromVenueSubscription(venueBNoRow);

  assert.equal(planA, "premium");
  assert.equal(planB, "free");
  assert.notEqual(planA, planB);
});

test("Venue A's plan lookup never falls back to a sibling venue's row — passing Venue B's row never influences Venue A's resolution", () => {
  // resolvePlanCodeFromVenueSubscription() takes exactly one row and returns
  // exactly one plan — there is no operator id, no venue list, and no way
  // for a second venue's data to reach this function's result. Demonstrated
  // by resolving the same two rows in both orders and confirming each call
  // is independent of the other having run at all.
  const venueA = row({ venue_id: "venue-a", plan_code: "premium" });
  const venueB = row({ venue_id: "venue-b", plan_code: "free" });

  assert.equal(resolvePlanCodeFromVenueSubscription(venueA), "premium");
  assert.equal(resolvePlanCodeFromVenueSubscription(venueB), "free");
  // Re-run in reverse order — result must be identical, proving no shared
  // mutable state or cross-call memoization could leak one venue's plan
  // into the other's resolution.
  assert.equal(resolvePlanCodeFromVenueSubscription(venueB), "free");
  assert.equal(resolvePlanCodeFromVenueSubscription(venueA), "premium");
});

// ─────────────────────────────────────────────────────────────────────────
// Discover/Featured join-field resolution (Phase 2A preparation only — see
// src/lib/discover/venuePlanSource.ts; NOT wired into any live query yet).
// ─────────────────────────────────────────────────────────────────────────

test("resolvePlanCodeFromJoinedField: null join → Free", () => {
  assert.equal(resolvePlanCodeFromJoinedField(null), "free");
  assert.equal(resolvePlanCodeFromJoinedField(undefined), "free");
});

test("resolvePlanCodeFromJoinedField: today's shape — { plan } from the operators join", () => {
  assert.equal(resolvePlanCodeFromJoinedField({ plan: "premium" }), "premium");
  assert.equal(resolvePlanCodeFromJoinedField({ plan: null }), "free");
});

test("resolvePlanCodeFromJoinedField: future shape — { plan_code } from the venue_subscriptions join", () => {
  assert.equal(resolvePlanCodeFromJoinedField({ plan_code: "pro" }), "pro");
  assert.equal(resolvePlanCodeFromJoinedField({ plan_code: null }), "free");
});

test("resolvePlanCodeFromJoinedField: plan_code takes priority when both happen to be present", () => {
  assert.equal(
    resolvePlanCodeFromJoinedField({ plan: "premium", plan_code: "free" }),
    "free"
  );
});
