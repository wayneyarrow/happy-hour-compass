/**
 * Specials Adoption — pure classification rules for the Action Center
 * "Specials Adoption" card/report. No I/O.
 *
 * Counting rules for Daily Special rows live in dailySpecialAdoptionCounts.ts
 * (shared with the venue Feature Adoption card). This file only adds the
 * venue-level rules built on top of them.
 */

import type { DailySpecialAdoptionCounts } from "./dailySpecialAdoptionCounts";

/**
 * Onboarding status, derived from the SAME inputs and precedence the Venue
 * Funnel uses (classifyVenueLane(), venueFunnel.ts, lanes 3-7) — never a
 * parallel definition:
 *   complete       — computeSetupHealth().onboardingComplete (automatic OR
 *                    the founder's manual override)
 *   in_progress    — account activated, onboarding incomplete, at least one
 *                    of the 6 automatic signals satisfied
 *   not_started    — account activated, all 6 signals still missing
 *   not_activated  — operator attached but account_activated_at not set
 *   no_operator    — no operator attached to the venue
 * Unlike the Funnel lane, this is NOT overridden by plan (paid_plan) or
 * upgrade-opportunity status — the campaign rule needs the onboarding fact
 * itself; the Funnel lane is shown separately as the "stage".
 */
export type OnboardingStatus = "complete" | "in_progress" | "not_started" | "not_activated" | "no_operator";

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  complete: "Complete",
  in_progress: "In progress",
  not_started: "Not started",
  not_activated: "Account not activated",
  no_operator: "No operator",
};

export function deriveOnboardingStatus(input: {
  hasOperator: boolean;
  onboardingComplete: boolean;
  accountActivatedAt: string | null;
  missingItemsCount: number;
}): OnboardingStatus {
  if (!input.hasOperator) return "no_operator";
  if (input.onboardingComplete) return "complete";
  if (!input.accountActivatedAt) return "not_activated";
  return input.missingItemsCount < 6 ? "in_progress" : "not_started";
}

/** Minimum days since operator account activation before a venue enters the initial campaign list. */
export const CAMPAIGN_MIN_DAYS_SINCE_ACTIVATION = 14;

/**
 * Initial Customer Success campaign list (applied to verified venues only):
 * at least 14 days since the operator's account activation, onboarding in
 * progress or complete, and zero operator-created Daily Specials (drafts
 * count as created). Venues with only seeded/platform Specials still
 * qualify — seeded content is not operator adoption.
 *
 * `daysSinceActivation` is the Venue Funnel's own "Since account activated"
 * age: daysSince(operators.account_activated_at). An unknown activation
 * date never qualifies (never guessed).
 */
export function isSpecialsCampaignCandidate(input: {
  daysSinceActivation: number | null;
  onboardingStatus: OnboardingStatus;
  counts: Pick<DailySpecialAdoptionCounts, "operatorTotal">;
}): boolean {
  if (input.daysSinceActivation === null || input.daysSinceActivation < CAMPAIGN_MIN_DAYS_SINCE_ACTIVATION) return false;
  if (input.onboardingStatus !== "in_progress" && input.onboardingStatus !== "complete") return false;
  return input.counts.operatorTotal === 0;
}

/** Primary adoption signal: counted in VENUES, not Special entries. */
export function hasAdoptedDailySpecials(counts: Pick<DailySpecialAdoptionCounts, "operatorTotal">): boolean {
  return counts.operatorTotal > 0;
}
