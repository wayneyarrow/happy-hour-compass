import type { VenueReadinessSignals } from "./venueReadiness";

/**
 * Returns true when the operator has satisfied all onboarding requirements
 * and the homepage should graduate from V1 (readiness checklist) to V2 (Venue HQ).
 *
 * V2 criteria:
 *   - Venue is published/live
 *   - Happy hour times are set
 *   - Business hours are complete
 *   - At least one operator-uploaded venue image exists
 *   - At least one food special AND at least one drink special exist
 *
 * "If applicable" limitation for food/drink specials:
 *   The current schema has no explicit "no specials" / "not applicable" flag.
 *   An empty hh_food_details or hh_drink_details is indistinguishable from
 *   "never filled in" vs "genuinely not offered." Until a nullable boolean
 *   column (e.g. hh_has_food_specials BOOLEAN) is added to the venues table,
 *   we require both to be present. A venue that truly has no food or drink
 *   specials will need to add at least one item of each type before V2 activates.
 *
 *   Options that were considered:
 *     A. Require both (current) — strictest; venues with no specials stay in V1.
 *     B. Require either food OR drink — looser; handles bars (food-only) but
 *        still ambiguous for venues with truly no specials at all.
 *     C. No specials requirement — removes food/drink from V2 gate entirely.
 *     D. Add hh_has_food_specials / hh_has_drink_specials BOOLEAN columns —
 *        proper fix; allows explicit "not applicable" but requires migration + UI.
 *
 *   Option A is implemented here per the product decision. Option D is the
 *   recommended follow-up when the "not applicable" case becomes a real friction
 *   point in operator onboarding.
 */
export function isOnboardingComplete(
  signals: VenueReadinessSignals,
  isPublished: boolean
): boolean {
  return (
    isPublished &&
    signals.hasHappyHourTimes &&
    signals.hasBusinessHours &&
    signals.hasOperatorVenueImage &&
    signals.hasFoodSpecials &&
    signals.hasDrinkSpecials
  );
}

/**
 * Distinguishes *why* a venue's onboarding is considered complete (or isn't),
 * for UI that needs to show more than a bare boolean — e.g. the Founder
 * Control Panel's "Onboarding: Complete — Manual" state (Phase 1B).
 *
 *   "automatic" — every automatic requirement above (isOnboardingComplete())
 *                  is satisfied on its own merits.
 *   "manual"    — a Founder/Admin has applied a manual override
 *                  (venues.onboarding_completed_override_at IS NOT NULL) that
 *                  makes the venue effectively complete regardless of the
 *                  automatic requirements. Takes precedence in the returned
 *                  mode even if the automatic requirements also happen to be
 *                  satisfied, since the override is the more specific,
 *                  human-reviewed signal.
 *   "incomplete"— neither the automatic requirements nor a manual override
 *                  are satisfied.
 */
export type OnboardingCompletionMode = "automatic" | "manual" | "incomplete";

export type EffectiveOnboardingResult = {
  /** automaticOnboardingComplete OR manualOverrideActive. */
  onboardingComplete: boolean;
  onboardingCompletionMode: OnboardingCompletionMode;
};

/**
 * Canonical "effective" onboarding calculation — the single place that
 * combines the automatic, dynamically-computed signal above with a Founder/
 * Admin manual override (Phase 1B). Every consumer of onboarding-completion
 * status (computeVenueSetupStatus(), the operator-facing admin/home V1→V2
 * gate, the Founder Dashboard count, Action Center reports, the Control Panel
 * venue-detail Health Panel) should route through this function — or through
 * computeVenueSetupStatus(), which itself calls this — rather than
 * re-deriving the OR logic independently, so a manual override can never be
 * respected in one place and ignored in another.
 *
 * Does NOT alter the underlying readiness signals or any setup-health
 * percentage — a manually-completed venue can still show missing items / a
 * score below 100%. See VenueSetupStatus.missingItems.
 */
export function computeEffectiveOnboarding(
  signals: VenueReadinessSignals,
  isPublished: boolean,
  manualOverrideActive: boolean
): EffectiveOnboardingResult {
  const automaticComplete = isOnboardingComplete(signals, isPublished);
  const onboardingComplete = automaticComplete || manualOverrideActive;
  const onboardingCompletionMode: OnboardingCompletionMode = manualOverrideActive
    ? "manual"
    : automaticComplete
      ? "automatic"
      : "incomplete";

  return { onboardingComplete, onboardingCompletionMode };
}
