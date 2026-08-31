import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 1B — structural regression coverage for the Founder Dashboard's
 * onboarding count (src/lib/data/founderDashboard.ts). Same no-DI-seam,
 * static-source-text convention as actionCenterOnboardingOverride.test.ts.
 *
 * Guards test #8 from the Phase 1B task: a manually-completed venue must be
 * excluded from activation.stillOnboarding / included in
 * activation.onboardingComplete, exactly like Action Center.
 */

const SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/data/founderDashboard.ts"),
  "utf8"
);

test("the active-venues query fetches onboarding_completed_override_at", () => {
  assert.match(
    SOURCE,
    /\.select\("id, created_by_operator_id, is_published, hh_times, business_hours, hh_food_details, hh_drink_details, onboarding_completed_override_at"\)/
  );
});

test("ActiveVenueRow carries onboarding_completed_override_at", () => {
  const typeDecl = SOURCE.match(/type ActiveVenueRow = \{[\s\S]*?\n\};/)![0];
  assert.match(typeDecl, /onboarding_completed_override_at: string \| null;/);
});

// This file has two separate "for (const venue of activeVenues) {" loops —
// an earlier plan-classification loop, then the onboarding-status loop this
// feature touches. Anchor on the section header comment (unique) rather than
// the loop-open token itself, so this doesn't silently grab the wrong loop.
function onboardingLoop(): string {
  return SOURCE
    .split("// ── Compute onboarding status per active venue")[1]
    .split("const topMissingSetupItems")[0];
}

test("computeVenueSetupStatus is called with !!venue.onboarding_completed_override_at as the manual-override argument", () => {
  assert.match(onboardingLoop(), /!!venue\.onboarding_completed_override_at/);
});

test("stillOnboarding/onboardingComplete are still derived from computeVenueSetupStatus's own onboardingComplete boolean (already correct pre-Phase-1B — this guards it stays that way)", () => {
  const loop = onboardingLoop();
  assert.match(loop, /const \{ onboardingComplete, missingItems \} = computeVenueSetupStatus\(/);
  assert.match(loop, /if \(!onboardingComplete\) \{\s*\n\s*stillOnboarding\+\+;/);
});
