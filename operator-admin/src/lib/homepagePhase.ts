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
