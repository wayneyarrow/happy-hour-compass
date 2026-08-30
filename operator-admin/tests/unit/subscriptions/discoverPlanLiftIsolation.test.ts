import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreVenueForDiscover } from "../../../src/lib/discover/discoverEngine";
import type { ConsumerVenue } from "../../../src/lib/data/venues";

/**
 * Executable, real-ranking-function coverage for Part 16/23 of the Phase 2B
 * task: two venues under the SAME operator, one Premium and one Free, must
 * receive independent Discover plan-lift treatment. This exercises the
 * actual live scoring function (scoreVenueForDiscover), not just the
 * upstream join-field resolver (see venuePlanResolution.test.ts for that
 * layer) — together they cover the whole path from "what venue_subscriptions
 * says" to "what score the venue actually gets."
 */

function minimalVenue(overrides: Partial<ConsumerVenue>): ConsumerVenue {
  return {
    internalBoost: 0,
    googleRating: null,
    excludeFromDiscover: false,
    operatorPlan: "free",
    ...overrides,
  } as unknown as ConsumerVenue;
}

test("core Phase 2 invariant: same operator, Venue A Premium + Venue B Free — Venue A scores higher purely from plan lift, all else equal", () => {
  const venueA = minimalVenue({ operatorPlan: "premium" });
  const venueB = minimalVenue({ operatorPlan: "free" });

  const scoreA = scoreVenueForDiscover(venueA);
  const scoreB = scoreVenueForDiscover(venueB);

  assert.ok(scoreA > scoreB, "Premium venue must score higher than its Free sibling");
  // Exact expected delta per discoverEngine's documented plan-lift table.
  assert.ok(Math.abs((scoreA - scoreB) - 0.15) < 1e-9);
});

test("Free venue (no venue_subscriptions row) receives zero plan lift — base score only", () => {
  const venue = minimalVenue({ operatorPlan: "free", internalBoost: 0, googleRating: null });
  assert.equal(scoreVenueForDiscover(venue), 1.0);
});

test("Pro plan lift is smaller than Premium/Enterprise — matches the documented 0.05 / 0.15 table", () => {
  const pro = minimalVenue({ operatorPlan: "pro" });
  const premium = minimalVenue({ operatorPlan: "premium" });
  const enterprise = minimalVenue({ operatorPlan: "enterprise" });

  const base = minimalVenue({ operatorPlan: "free" });
  const baseScore = scoreVenueForDiscover(base);

  assert.ok(Math.abs((scoreVenueForDiscover(pro) - baseScore) - 0.05) < 1e-9);
  assert.ok(Math.abs((scoreVenueForDiscover(premium) - baseScore) - 0.15) < 1e-9);
  assert.ok(Math.abs((scoreVenueForDiscover(enterprise) - baseScore) - 0.15) < 1e-9);
});

test("a Free/unclaimed venue (excludeFromDiscover: false, no plan) is never excluded from scoring by plan alone", () => {
  const seededVenue = minimalVenue({ operatorPlan: "free", excludeFromDiscover: false });
  // scoreVenueForDiscover always returns a finite, positive number — a
  // missing venue_subscriptions row must never throw or produce NaN/exclude
  // the venue from ranking (only excludeFromDiscover/geo/eligibility do that,
  // separately, unrelated to plan).
  const score = scoreVenueForDiscover(seededVenue);
  assert.ok(Number.isFinite(score) && score > 0);
});
