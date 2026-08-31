import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVenuePlanMap, type VenueSubRow } from "../../../src/lib/data/actionCenter";

/**
 * Phase 2B — Action Center venue-level plan resolution correction.
 *
 * Pins the same core Phase 2 invariant as
 * tests/unit/subscriptions/venuePlanResolution.test.ts
 * (resolvePlanCodeFromVenueSubscription), but for Action Center's own
 * BATCHED resolver: buildVenuePlanMap() takes a `.in("venue_id", [...])`
 * result (one query per report, not one getVenuePlanCode() call per venue —
 * see the function's doc comment in src/lib/data/actionCenter.ts for why),
 * and mirrors that function's row→plan_code / no-row→'free' contract.
 *
 * buildVenuePlanMap() is a pure function (no Supabase I/O) — exported
 * specifically for this direct, real-function-call test, the same
 * rationale documented on resolvePlanCodeFromVenueSubscription() itself.
 * The Supabase-backed report functions that call it (getUpgradeOpportunities
 * et al.) have no DI seam and are covered by static source-text tests in
 * actionCenterVenuePlanQueries.test.ts instead — same convention as every
 * other flow-specific test in this repo.
 */

function row(overrides: Partial<VenueSubRow> = {}): VenueSubRow {
  return {
    venue_id: "venue-1",
    plan_code: "premium",
    status: "active",
    ...overrides,
  };
}

// ── 1. No subscription row → resolves Free ──────────────────────────────────

test("1. a venue with no venue_subscriptions row is absent from the map — every call site's `?? \"free\"` resolves it to Free", () => {
  const map = buildVenuePlanMap([]);
  assert.equal(map.get("venue-with-no-row"), undefined);
  assert.equal(map.get("venue-with-no-row") ?? "free", "free");
});

// ── 2-4. Plan-code passthrough for each tier ─────────────────────────────────

test("2. a Free-plan row resolves to Free", () => {
  const map = buildVenuePlanMap([row({ plan_code: "free" })]);
  assert.equal(map.get("venue-1"), "free");
});

test("3. a Pro-plan row resolves to Pro", () => {
  const map = buildVenuePlanMap([row({ plan_code: "pro" })]);
  assert.equal(map.get("venue-1"), "pro");
});

test("4. a Premium-plan row resolves to Premium — never silently evaluated as Free", () => {
  const map = buildVenuePlanMap([row({ plan_code: "premium" })]);
  assert.equal(map.get("venue-1"), "premium");
  assert.notEqual(map.get("venue-1"), "free");
});

// ── 5. Multi-venue, same operator, different plans ───────────────────────────

test("5. one operator's two venues resolve independently by venue_id, even though buildVenuePlanMap never sees an operator id at all", () => {
  // The whole point of the Phase 2B correction: venue-level rows carry no
  // operator identity, so there is no way for one venue's plan to leak onto
  // a sibling venue owned by the same operator.
  const rows: VenueSubRow[] = [
    { venue_id: "venue-a-premium", plan_code: "premium", status: "active" },
    { venue_id: "venue-b-free",    plan_code: "free",    status: "active" },
  ];
  const map = buildVenuePlanMap(rows);
  assert.equal(map.get("venue-a-premium"), "premium");
  assert.equal(map.get("venue-b-free"), "free");
  assert.notEqual(map.get("venue-a-premium"), map.get("venue-b-free"));
});

// ── 9. Past-due paid subscription remains resolved to its paid plan ──────────

test("9. a past_due Premium subscription still resolves to Premium — never silently downgraded", () => {
  const map = buildVenuePlanMap([row({ plan_code: "premium", status: "past_due" })]);
  assert.equal(map.get("venue-1"), "premium");
});

test("9b. a past_due Pro subscription still resolves to Pro", () => {
  const map = buildVenuePlanMap([row({ plan_code: "pro", status: "past_due" })]);
  assert.equal(map.get("venue-1"), "pro");
});

// ── 10. Cancelled subscription is not treated as actively paid ───────────────

test("10. a cancelled subscription resolves to Free regardless of its stored plan_code", () => {
  const map = buildVenuePlanMap([row({ plan_code: "premium", status: "cancelled" })]);
  assert.equal(map.get("venue-1"), "free");
});

test("10b. cancelled + pro also resolves to Free", () => {
  const map = buildVenuePlanMap([row({ plan_code: "pro", status: "cancelled" })]);
  assert.equal(map.get("venue-1"), "free");
});

// ── 'pending' status is untouched — plan_code passes through as-is ──────────

test("'pending' status does not affect plan_code resolution (only 'cancelled' is special-cased)", () => {
  const map = buildVenuePlanMap([row({ plan_code: "pro", status: "pending" })]);
  assert.equal(map.get("venue-1"), "pro");
});

// ── Multiple rows in one batched call resolve independently ─────────────────

test("a single batched call with 3 venues (Free/no-row, Pro, cancelled-Premium) resolves each correctly and independently", () => {
  const rows: VenueSubRow[] = [
    { venue_id: "venue-pro", plan_code: "pro", status: "active" },
    { venue_id: "venue-cancelled-premium", plan_code: "premium", status: "cancelled" },
  ];
  const map = buildVenuePlanMap(rows);
  assert.equal(map.get("venue-pro"), "pro");
  assert.equal(map.get("venue-cancelled-premium"), "free");
  assert.equal(map.get("venue-no-row-at-all") ?? "free", "free");
});
