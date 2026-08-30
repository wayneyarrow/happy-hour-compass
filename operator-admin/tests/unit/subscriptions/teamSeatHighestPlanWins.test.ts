import { test } from "node:test";
import assert from "node:assert/strict";
import { highestPlan } from "../../../src/lib/venueSubscriptions";

/**
 * Executable pure-function coverage for the Phase 2B temporary team-seat
 * rule (Part 5 of the task): highest-plan-wins across an operator's
 * currently-manageable venues. highestPlan() has no I/O of its own — the
 * same "extract the pure decision logic" pattern already used for
 * computeActiveVenueId() and resolvePlanCodeFromVenueSubscription() — so
 * it gets real, executable assertions rather than a static source check.
 * getOperatorHighestVenuePlan() itself (which calls this after querying
 * venues/venue_subscriptions) is not directly unit-tested — real Supabase
 * admin client calls, no DI seam, same reasoning as every other flow-
 * specific contract test in this repo.
 */

test("empty list → Free", () => {
  assert.equal(highestPlan([]), "free");
});

test("Free + Free → Free seat cap", () => {
  assert.equal(highestPlan(["free", "free"]), "free");
});

test("Free + Pro → Pro seat cap", () => {
  assert.equal(highestPlan(["free", "pro"]), "pro");
});

test("Free + Premium → Premium seat cap", () => {
  assert.equal(highestPlan(["free", "premium"]), "premium");
});

test("Pro + Premium → Premium seat cap", () => {
  assert.equal(highestPlan(["pro", "premium"]), "premium");
});

test("order-independent — the highest plan wins regardless of list order", () => {
  assert.equal(highestPlan(["premium", "free", "pro"]), "premium");
  assert.equal(highestPlan(["pro", "premium", "free"]), "premium");
});

test("enterprise outranks every other plan", () => {
  assert.equal(highestPlan(["premium", "enterprise", "pro"]), "enterprise");
});

test("a single-venue list returns that venue's own plan unchanged", () => {
  assert.equal(highestPlan(["pro"]), "pro");
});
