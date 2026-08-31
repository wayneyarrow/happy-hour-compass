import { computeVenueReadiness, type VenueReadinessInput } from "./venueReadiness";
import { computeEffectiveOnboarding, type OnboardingCompletionMode } from "./homepagePhase";

export type VenueSetupStatus = {
  /** automaticOnboardingComplete OR manualOverrideActive. */
  onboardingComplete: boolean;
  /**
   * Why onboardingComplete is (or isn't) true — "automatic", "manual"
   * (Founder/Admin override — Phase 1B), or "incomplete". See
   * computeEffectiveOnboarding() in homepagePhase.ts.
   */
  onboardingCompletionMode: OnboardingCompletionMode;
  /**
   * Human-readable labels for each unmet automatic criterion. Computed from
   * the raw signals regardless of a manual override — a manually-completed
   * venue can (and often will) still list missing items here, e.g. "Food
   * specials" for a legitimately drink-only venue. Never falsified to
   * fabricate a 100% score just because an override exists.
   */
  missingItems: string[];
};

/**
 * Shared helper that computes whether a venue has completed onboarding
 * (i.e. Venue HQ / Homepage V2 is active) and which criteria are still unmet.
 *
 * Reuses computeEffectiveOnboarding() from homepagePhase.ts so the founder
 * dashboard count, Action Center reports, and the Control Panel Health Panel
 * exactly match what each operator sees on their own homepage — and so a
 * Founder/Admin manual override (Phase 1B) is respected identically
 * everywhere onboarding completion is consumed.
 *
 * Used by:
 *   - app/admin/home/page.tsx  (V1 → V2 transition gate, via computeEffectiveOnboarding directly)
 *   - src/lib/data/founderDashboard.ts  (platform-wide onboarding count)
 *   - src/lib/data/actionCenter.ts  (Active Venues Still Onboarding + summary tile)
 *   - src/lib/data/venueHealth.ts  (Control Panel venue-detail Health Panel)
 */
export function computeVenueSetupStatus(
  input: VenueReadinessInput,
  isPublished: boolean,
  manualOverrideActive: boolean = false,
): VenueSetupStatus {
  const { signals } = computeVenueReadiness(input);
  const { onboardingComplete, onboardingCompletionMode } = computeEffectiveOnboarding(
    signals,
    isPublished,
    manualOverrideActive,
  );

  // Surface each unmet automatic criterion. Order matches homepagePhase.ts's
  // isOnboardingComplete() criteria. Independent of manualOverrideActive —
  // see the missingItems doc comment above.
  const missingItems: string[] = [];
  if (!isPublished)                    missingItems.push("Not published");
  if (!signals.hasHappyHourTimes)      missingItems.push("Happy hour times");
  if (!signals.hasBusinessHours)       missingItems.push("Business hours");
  if (!signals.hasOperatorVenueImage)  missingItems.push("Photo");
  if (!signals.hasFoodSpecials)        missingItems.push("Food specials");
  if (!signals.hasDrinkSpecials)       missingItems.push("Drink specials");

  return { onboardingComplete, onboardingCompletionMode, missingItems };
}
