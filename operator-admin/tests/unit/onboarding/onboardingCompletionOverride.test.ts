import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVenueSetupStatus, type VenueSetupStatus } from "../../../src/lib/venueSetupStatus";
import { computeEffectiveOnboarding, isOnboardingComplete } from "../../../src/lib/homepagePhase";
import { computeVenueReadiness, type VenueReadinessInput } from "../../../src/lib/venueReadiness";

/**
 * Phase 1B — Manual Venue Onboarding Completion.
 *
 * Covers the effective onboarding calculation
 * (automaticOnboardingComplete OR manualOverrideActive) added on top of the
 * pre-existing, unchanged automatic calculation (isOnboardingComplete(),
 * homepagePhase.ts). computeVenueSetupStatus() and computeEffectiveOnboarding()
 * are pure functions with no I/O, so these are real function-call tests
 * (not source-text regex assertions) — see the Phase 1A investigation for
 * why every consumer (Founder Dashboard, Action Center, Control Panel Health
 * Panel, operator admin/home V1→V2 gate) routes through one of these two
 * functions rather than re-deriving the OR logic independently.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A venue satisfying every automatic onboarding requirement. */
const FULLY_QUALIFYING: VenueReadinessInput = {
  hh_times:         "Monday: 4 PM-6 PM",
  business_hours:   { monday: { open: "11:00", close: "22:00" } },
  hh_food_details:  JSON.stringify([{ name: "Wings", price: "$5" }]),
  hh_drink_details: JSON.stringify([{ name: "House Wine", price: "$6" }]),
  imageCount: 1,
  operatorImageCount: 1,
};

/** Same as above, but with no food specials — a legitimate drink-only venue. */
const MISSING_FOOD_SPECIALS: VenueReadinessInput = {
  ...FULLY_QUALIFYING,
  hh_food_details: null,
};

function setupStatus(
  input: VenueReadinessInput,
  isPublished: boolean,
  manualOverrideActive = false,
): VenueSetupStatus {
  return computeVenueSetupStatus(input, isPublished, manualOverrideActive);
}

// ── 1. Fully qualifying venue → automatic complete ───────────────────────────

test("1. a venue satisfying every automatic requirement is automatically complete, no override needed", () => {
  const status = setupStatus(FULLY_QUALIFYING, true);
  assert.equal(status.onboardingComplete, true);
  assert.equal(status.onboardingCompletionMode, "automatic");
  assert.deepEqual(status.missingItems, []);
});

// ── 2. Venue missing food specials → incomplete automatically ────────────────

test("2. a venue missing food specials is NOT automatically complete", () => {
  const status = setupStatus(MISSING_FOOD_SPECIALS, true);
  assert.equal(status.onboardingComplete, false);
  assert.equal(status.onboardingCompletionMode, "incomplete");
  assert.deepEqual(status.missingItems, ["Food specials"]);
});

// ── 3. Same venue + manual override → effective complete ─────────────────────

test("3. the same venue with a manual override applied is effectively complete", () => {
  const status = setupStatus(MISSING_FOOD_SPECIALS, true, /* manualOverrideActive */ true);
  assert.equal(status.onboardingComplete, true);
  assert.equal(status.onboardingCompletionMode, "manual");
});

// ── 4. Manual override retains underlying missing item(s) ────────────────────

test("4. manual override does NOT falsify missingItems — food specials still listed as missing", () => {
  const status = setupStatus(MISSING_FOOD_SPECIALS, true, true);
  assert.deepEqual(status.missingItems, ["Food specials"]);
});

// ── 5. Manually completed venue may retain a setup score below 100% ──────────
// (setupHealthScorePct itself lives in actionCenter.ts / venueHealth.ts, both
// derived from missingItems.length — asserting the missingItems contract here
// is what guarantees those percentages are never silently forced to 100%.)

test("5. manual override leaves enough missing items that a score derived from them is below 100%", () => {
  const status = setupStatus(MISSING_FOOD_SPECIALS, true, true);
  const SETUP_ITEMS_TOTAL = 6; // matches actionCenter.ts / venueHealth.ts SETUP_ITEMS_TOTAL
  const pct = Math.round(((SETUP_ITEMS_TOTAL - status.missingItems.length) / SETUP_ITEMS_TOTAL) * 100);
  assert.ok(pct < 100, `expected score below 100%, got ${pct}%`);
  assert.equal(status.onboardingComplete, true); // ...while still effectively complete
});

// ── 6. Clearing override → returns to dynamically calculated incomplete state ─

test("6. with manualOverrideActive=false again, the venue returns to the dynamic incomplete state", () => {
  const withOverride = setupStatus(MISSING_FOOD_SPECIALS, true, true);
  assert.equal(withOverride.onboardingComplete, true);

  const cleared = setupStatus(MISSING_FOOD_SPECIALS, true, false);
  assert.equal(cleared.onboardingComplete, false);
  assert.equal(cleared.onboardingCompletionMode, "incomplete");
});

// ── 9. Automatic-complete venue remains unaffected by the override machinery ─

test("9. a fully qualifying venue is unaffected whether or not manualOverrideActive is passed", () => {
  const withoutOverrideParam = computeVenueSetupStatus(FULLY_QUALIFYING, true);
  const withOverrideFalse    = computeVenueSetupStatus(FULLY_QUALIFYING, true, false);
  assert.deepEqual(withoutOverrideParam, withOverrideFalse);
  assert.equal(withoutOverrideParam.onboardingComplete, true);
  assert.equal(withoutOverrideParam.onboardingCompletionMode, "automatic");
});

test("manual mode takes precedence in onboardingCompletionMode even when automatic is also satisfied", () => {
  // Edge case: a founder applies an override, then the operator later also
  // completes every automatic item. The mode should still read "manual" —
  // it's the more specific, human-reviewed signal — not silently flip back
  // to "automatic" underneath the founder.
  const status = setupStatus(FULLY_QUALIFYING, true, true);
  assert.equal(status.onboardingComplete, true);
  assert.equal(status.onboardingCompletionMode, "manual");
});

// ── 10 & 11. Published seeded venue scenario ──────────────────────────────────

test("10. a published seeded venue with no further operator action remains still-onboarding (publication alone never completes onboarding)", () => {
  // Seeded + published + claimed + nothing else done: only isPublished is
  // true, none of the other 5 automatic signals are satisfied.
  const seededPublishedOnly: VenueReadinessInput = {
    hh_times: null,
    business_hours: null,
    hh_food_details: null,
    hh_drink_details: null,
    imageCount: 0,
    operatorImageCount: 0,
  };
  const status = setupStatus(seededPublishedOnly, true);
  assert.equal(status.onboardingComplete, false);
  assert.ok(status.missingItems.includes("Happy hour times"));
  assert.ok(!status.missingItems.includes("Not published")); // it IS published
});

test("11. a manual override on that same published seeded venue completes onboarding without touching publication", () => {
  const seededPublishedOnly: VenueReadinessInput = {
    hh_times: null,
    business_hours: null,
    hh_food_details: null,
    hh_drink_details: null,
    imageCount: 0,
    operatorImageCount: 0,
  };
  const status = setupStatus(seededPublishedOnly, true, true);
  assert.equal(status.onboardingComplete, true);
  assert.equal(status.onboardingCompletionMode, "manual");
  // isPublished is a caller-supplied input, never derived or mutated here —
  // computeVenueSetupStatus has no way to change publication status, which is
  // exactly the "independent of onboarding" invariant this test protects.
});

// ── computeEffectiveOnboarding() — the lower-level canonical OR ─────────────

test("computeEffectiveOnboarding: automatic-complete signals + no override => automatic", () => {
  const { signals } = computeVenueReadiness(FULLY_QUALIFYING);
  const result = computeEffectiveOnboarding(signals, true, false);
  assert.equal(result.onboardingComplete, true);
  assert.equal(result.onboardingCompletionMode, "automatic");
});

test("computeEffectiveOnboarding: incomplete signals + override => manual, effectively complete", () => {
  const { signals } = computeVenueReadiness(MISSING_FOOD_SPECIALS);
  const result = computeEffectiveOnboarding(signals, true, true);
  assert.equal(result.onboardingComplete, true);
  assert.equal(result.onboardingCompletionMode, "manual");
});

test("computeEffectiveOnboarding: incomplete signals + no override => incomplete", () => {
  const { signals } = computeVenueReadiness(MISSING_FOOD_SPECIALS);
  const result = computeEffectiveOnboarding(signals, true, false);
  assert.equal(result.onboardingComplete, false);
  assert.equal(result.onboardingCompletionMode, "incomplete");
});

test("isOnboardingComplete() itself is unchanged by this feature — pure automatic calculation, no override parameter exists", () => {
  assert.equal(isOnboardingComplete.length, 2); // (signals, isPublished) — no 3rd param
  const { signals } = computeVenueReadiness(MISSING_FOOD_SPECIALS);
  assert.equal(isOnboardingComplete(signals, true), false);
});
