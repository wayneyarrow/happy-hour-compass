import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 1B — structural regression coverage for src/lib/data/actionCenter.ts.
 *
 * actionCenter.ts calls createAdminClient()/Supabase directly with no DI seam
 * (same reasoning as every other flow-specific contract test in this repo —
 * see cancelVenueActionRegression.test.ts), so this is a static, structural
 * verification of the actual source text: proving the exact wiring the
 * manual-override feature requires, rather than exercising the real
 * DB-backed functions end-to-end.
 *
 * The underlying OR logic itself (computeVenueSetupStatus /
 * computeEffectiveOnboarding) is covered with real function calls in
 * onboardingCompletionOverride.test.ts — this file only guards that
 * actionCenter.ts actually consumes computeSetupHealth()'s returned
 * onboardingComplete boolean rather than re-deriving
 * "missingItems.length === 0", which would silently ignore a manual override
 * (tests 7 and 8 from the Phase 1B task: manually-completed venues excluded
 * from both the Active Still Onboarding report and the summary tile count).
 */

const SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/data/actionCenter.ts"),
  "utf8"
);

test("VENUE_SELECT fetches onboarding_completed_override_at", () => {
  assert.match(SOURCE, /onboarding_completed_override_at/);
});

test("computeSetupHealth() passes manualOverrideActive through to computeVenueSetupStatus and returns onboardingComplete", () => {
  const fn = SOURCE.match(/function computeSetupHealth\([\s\S]*?\n}/)![0];
  assert.match(fn, /!!venue\.onboarding_completed_override_at/);
  // Phase 2C added onboardingCompletionMode to this return object (reused by
  // the Venue Funnel's "Complete — Manual" badge) — additive, still includes
  // the original three fields this test pins.
  assert.match(fn, /return \{ setupHealthScorePct, missingItems, onboardingComplete, onboardingCompletionMode \};/);
});

test("getActionCenterSummary() derives stillOnboarding from computeSetupHealth's own onboardingComplete, not missingItems.length", () => {
  const fn = SOURCE.split("export async function getActionCenterSummary")[1]
    .split("export async function getSeededNeedingClaims")[0];
  // Phase 3: setupHealthScorePct is no longer destructured here — it was
  // only used by getActionCenterSummary's own upgradeOpportunities
  // computation, which Phase 3 replaced with a direct reuse of
  // getUpgradeOpportunities() (see actionCenterVenuePlanQueries.test.ts,
  // same file, for why removing that duplicate computation is itself a
  // regression fix). onboardingComplete is still consumed exactly as
  // before — the invariant this test guards is unaffected.
  assert.match(
    fn,
    /const \{ onboardingComplete \} = computeSetupHealth\(venue, mediaByVenue\);/
  );
  assert.doesNotMatch(fn, /missingItems\.length === 0/);
});

test("getActiveStillOnboarding() skips venues where onboardingComplete is true (automatic OR manual override), not merely missingItems.length === 0", () => {
  const fn = SOURCE.split("export async function getActiveStillOnboarding")[1]
    .split("export async function getInactiveOperators")[0];
  assert.match(
    fn,
    /const \{ setupHealthScorePct, missingItems, onboardingComplete \} = computeSetupHealth\(v, mediaByVenue\);/
  );
  assert.match(fn, /if \(onboardingComplete\) continue;/);
  assert.doesNotMatch(fn, /if \(missingItems\.length === 0\) continue;/);
});

test("setupHealthScorePct itself is never forced to 100 by an override — computeSetupHealth still derives it purely from missingItems.length", () => {
  const fn = SOURCE.match(/function computeSetupHealth\([\s\S]*?\n}/)![0];
  assert.match(fn, /const completedCount = SETUP_ITEMS_TOTAL - missingItems\.length;/);
  assert.doesNotMatch(fn, /onboardingComplete\s*\?\s*100/);
});
