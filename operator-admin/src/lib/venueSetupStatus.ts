import { computeVenueReadiness, type VenueReadinessInput } from "./venueReadiness";
import { isOnboardingComplete } from "./homepagePhase";

export type VenueSetupStatus = {
  onboardingComplete: boolean;
  /** Human-readable labels for each unmet V2-activation criterion. */
  missingItems: string[];
};

/**
 * Shared helper that computes whether a venue has completed onboarding
 * (i.e. Venue HQ / Homepage V2 is active) and which criteria are still unmet.
 *
 * Reuses isOnboardingComplete() from homepagePhase.ts so the founder dashboard
 * count exactly matches what each operator sees on their own homepage.
 *
 * Used by:
 *   - app/admin/home/page.tsx  (V1 → V2 transition gate)
 *   - src/lib/data/founderDashboard.ts  (platform-wide onboarding count)
 */
export function computeVenueSetupStatus(
  input: VenueReadinessInput,
  isPublished: boolean,
): VenueSetupStatus {
  const { signals } = computeVenueReadiness(input);
  const onboardingComplete = isOnboardingComplete(signals, isPublished);

  // Surface each unmet gate criterion. Order matches homepagePhase.ts criteria.
  const missingItems: string[] = [];
  if (!isPublished)                    missingItems.push("Not published");
  if (!signals.hasHappyHourTimes)      missingItems.push("Happy hour times");
  if (!signals.hasBusinessHours)       missingItems.push("Business hours");
  if (!signals.hasOperatorVenueImage)  missingItems.push("Photo");
  if (!signals.hasFoodSpecials)        missingItems.push("Food specials");
  if (!signals.hasDrinkSpecials)       missingItems.push("Drink specials");

  return { onboardingComplete, missingItems };
}
