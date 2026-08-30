import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVenueIdentity } from "../../../src/lib/stripeVenueIdentity";

/**
 * Executable coverage for Part 5 of the Phase 2B billing architecture
 * review: identity-mismatch safety. resolveVenueIdentity() has no I/O of
 * its own (the three inputs are already-resolved values), so — unlike the
 * webhook route itself — this can be tested with real assertions rather
 * than static source-text matching, the same pattern already used for
 * computeActiveVenueId()/highestPlan()/resolvePlanCodeFromVenueSubscription().
 *
 * Every scenario named explicitly in the task is covered below, plus the
 * baseline single-source-known cases.
 */

const VENUE_A = "venue-a";
const VENUE_B = "venue-b";
const VENUE_C = "venue-c";

// ─────────────────────────────────────────────────────────────────────────
// Baseline: single known identity resolves cleanly
// ─────────────────────────────────────────────────────────────────────────

test("only metadata known → resolves to that venue (e.g. brand-new subscription, no venue_subscriptions row yet)", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: VENUE_A,
    customerMappedVenueId: null,
    subscriptionMappedVenueId: null,
  });
  assert.deepEqual(result, { venueId: VENUE_A, mismatch: false });
});

test("only customer mapping known (no metadata, no subscription mapping) → resolves to that venue", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: null,
    customerMappedVenueId: VENUE_A,
    subscriptionMappedVenueId: null,
  });
  assert.deepEqual(result, { venueId: VENUE_A, mismatch: false });
});

test("only subscription mapping known → resolves to that venue", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: null,
    customerMappedVenueId: null,
    subscriptionMappedVenueId: VENUE_A,
  });
  assert.deepEqual(result, { venueId: VENUE_A, mismatch: false });
});

test("nothing known at all → null, not a mismatch (the existing 'could not resolve venue' warn-and-drop path)", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: null,
    customerMappedVenueId: null,
    subscriptionMappedVenueId: null,
  });
  assert.deepEqual(result, { venueId: null, mismatch: false });
});

test("all three agree → resolves cleanly, no mismatch", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: VENUE_A,
    customerMappedVenueId: VENUE_A,
    subscriptionMappedVenueId: VENUE_A,
  });
  assert.deepEqual(result, { venueId: VENUE_A, mismatch: false });
});

// ─────────────────────────────────────────────────────────────────────────
// Part 5's explicit scenarios — every disagreement fails closed
// ─────────────────────────────────────────────────────────────────────────

test("metadata venue A + stored customer mapped to venue B → fails closed", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: VENUE_A,
    customerMappedVenueId: VENUE_B,
    subscriptionMappedVenueId: null,
  });
  assert.equal(result.mismatch, true);
  assert.equal(result.venueId, null);
  assert.ok(!result.mismatch === false); // type-narrowing sanity
  if (result.mismatch) {
    assert.deepEqual(
      result.candidates.map((c) => c.venueId).sort(),
      [VENUE_A, VENUE_B].sort()
    );
  }
});

test("metadata venue A + subscription mapped to venue B → fails closed", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: VENUE_A,
    customerMappedVenueId: null,
    subscriptionMappedVenueId: VENUE_B,
  });
  assert.equal(result.mismatch, true);
  assert.equal(result.venueId, null);
});

test("customer mapped to A + subscription mapped to B (no metadata to arbitrate) → fails closed — the exact gap the original short-circuiting implementation missed", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: null,
    customerMappedVenueId: VENUE_A,
    subscriptionMappedVenueId: VENUE_B,
  });
  assert.equal(result.mismatch, true);
  assert.equal(result.venueId, null);
  if (result.mismatch) {
    assert.equal(result.candidates.length, 2);
    assert.ok(result.candidates.some((c) => c.source === "customer" && c.venueId === VENUE_A));
    assert.ok(result.candidates.some((c) => c.source === "subscription" && c.venueId === VENUE_B));
  }
});

test("unknown customer (null) + subscription metadata containing venue A → resolves cleanly to A (only one source known)", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: VENUE_A,
    customerMappedVenueId: null,
    subscriptionMappedVenueId: null,
  });
  assert.deepEqual(result, { venueId: VENUE_A, mismatch: false });
});

test("stale/cancelled subscription id mapped to a DIFFERENT venue than the current customer/metadata → fails closed rather than trusting the stale mapping", () => {
  // Models a subscription id left over on an old, no-longer-relevant
  // venue_subscriptions row (e.g. a venue that changed Stripe subscriptions)
  // while the customer and metadata agree on the CURRENT venue.
  const result = resolveVenueIdentity({
    metadataVenueId: VENUE_A,
    customerMappedVenueId: VENUE_A,
    subscriptionMappedVenueId: VENUE_C, // stale mapping, disagrees
  });
  assert.equal(result.mismatch, true);
  assert.equal(result.venueId, null);
});

test("three-way contradiction (metadata=A, customer=B, subscription=C) is detected the same way as a two-way one", () => {
  const result = resolveVenueIdentity({
    metadataVenueId: VENUE_A,
    customerMappedVenueId: VENUE_B,
    subscriptionMappedVenueId: VENUE_C,
  });
  assert.equal(result.mismatch, true);
  if (result.mismatch) {
    assert.equal(result.candidates.length, 3);
  }
});

test("no mismatch is ever silently resolved by 'priority' — every populated source is included in the comparison regardless of which one would traditionally take priority", () => {
  // If priority-order-as-short-circuit were still in effect, a populated
  // metadataVenueId would make the function never even look at a
  // disagreeing customer/subscription mapping. Confirmed here that a
  // metadata+customer agreement does NOT mask a disagreeing subscription.
  const result = resolveVenueIdentity({
    metadataVenueId: VENUE_A,
    customerMappedVenueId: VENUE_A,
    subscriptionMappedVenueId: VENUE_B,
  });
  assert.equal(result.mismatch, true);
});
