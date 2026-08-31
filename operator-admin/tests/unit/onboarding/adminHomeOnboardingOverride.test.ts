import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 1B — structural regression coverage for the operator-facing
 * admin/home V1→V2 gate (src/app/admin/home/page.tsx). This is the one
 * onboarding-completion call site that did NOT already route through
 * computeVenueSetupStatus() (it called isOnboardingComplete() directly),
 * so it needed its own wiring change to respect a manual override.
 *
 * Guards tests #12 and #13 from the Phase 1B task: the operator dashboard
 * must recognize manual completion exactly as normal completion, and must
 * return to the dynamic state once the override is cleared. The underlying
 * OR logic (computeEffectiveOnboarding) is exercised with real function
 * calls in onboardingCompletionOverride.test.ts; this file only guards the
 * wiring in this specific Server Component, which has no DI seam for a
 * behavioral test (same convention as every other flow-specific contract
 * test in this repo).
 */

const SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/home/page.tsx"),
  "utf8"
);

test("no longer imports isOnboardingComplete directly — routes through computeEffectiveOnboarding instead", () => {
  assert.doesNotMatch(SOURCE, /import \{ isOnboardingComplete \} from "@\/lib\/homepagePhase";/);
  assert.match(SOURCE, /import \{ computeEffectiveOnboarding \} from "@\/lib\/homepagePhase";/);
});

test("VENUE_SELECT fetches onboarding_completed_override_at", () => {
  assert.match(SOURCE, /onboarding_completed_override_at/);
});

test("HomeVenueRow carries onboarding_completed_override_at", () => {
  const typeDecl = SOURCE.match(/type HomeVenueRow = \{[\s\S]*?\n\};/)![0];
  assert.match(typeDecl, /onboarding_completed_override_at: string \| null;/);
});

test("the V1→V2 gate calls computeEffectiveOnboarding with the venue's manual-override flag, and gates on its result", () => {
  assert.match(
    SOURCE,
    /computeEffectiveOnboarding\(readiness\.signals, isPublished, !!venue\?\.onboarding_completed_override_at\)/
  );
  assert.match(SOURCE, /if \(readiness && onboardingComplete\) \{/);
});
