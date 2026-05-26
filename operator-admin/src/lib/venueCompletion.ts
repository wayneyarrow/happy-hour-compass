/**
 * Venue completion scoring — centralized source of truth.
 *
 * Pure module, no DB queries, no side effects.
 * Computes a per-indicator health status and an overall completion percentage.
 *
 * Reusable by:
 *   - VenueHealthModule (Homepage V2)
 *   - Homepage onboarding transition logic (future refactor)
 *   - Future completion progress bars and analytics
 *
 * To add a new indicator: append an entry to INDICATOR_DEFS.
 * Weight determines its share of the total percentage.
 */

import type { VenueReadinessSignals } from "./venueReadiness";

// ── Public types ──────────────────────────────────────────────────────────────

export type HealthIndicatorStatus = "complete" | "partial" | "missing";

export type HealthIndicator = {
  key: string;
  /** Short display label shown on the chip. */
  label: string;
  status: HealthIndicatorStatus;
  /** Current count (for count-based indicators like photos, specials, events). */
  count?: number;
  /** Target count (for photos and specials — shows progress toward a goal). */
  target?: number;
  /** Admin route to navigate to when the item needs attention. */
  href: string;
};

export type VenueCompletionInput = {
  signals: VenueReadinessSignals;
  /** Count of operator-uploaded images (those in the venue-images storage bucket). */
  operatorImageCount: number;
  /** Total event count for this venue (any status). */
  eventsCount: number;
  /** Count of valid food special items (from parseSpecialItemCount). */
  foodSpecialsCount: number;
  /** Count of valid drink special items (from parseSpecialItemCount). */
  drinkSpecialsCount: number;
};

export type VenueCompletion = {
  /** 0–100, rounded to nearest integer. */
  percentage: number;
  indicators: HealthIndicator[];
};

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Photo count operators are nudged toward. Matches suggestedSteps PHOTO_TARGET. */
const PHOTO_TARGET = 5;

/**
 * Combined food + drink specials target.
 * Onboarding requires at least 1 food + 1 drink (min = 2).
 * A threshold of 4 means operators with the bare minimum still see a nudge.
 * Matches suggestedSteps SPECIALS_SPARSE_THRESHOLD.
 */
const SPECIALS_TARGET = 4;

// ── Indicator definitions ─────────────────────────────────────────────────────

type IndicatorDef = {
  key: string;
  label: string;
  /**
   * Weight used for the percentage calculation.
   * Higher weight = larger contribution to overall score.
   */
  weight: number;
  href: string;
  compute: (input: VenueCompletionInput) => {
    status: HealthIndicatorStatus;
    count?: number;
    target?: number;
  };
};

const INDICATOR_DEFS: IndicatorDef[] = [
  {
    key: "hh_times",
    label: "HH Times",
    weight: 2,
    href: "/admin/happy-hours?section=times#times",
    compute: ({ signals }) => ({
      status: signals.hasHappyHourTimes ? "complete" : "missing",
    }),
  },
  {
    key: "business_hours",
    label: "Business Hours",
    weight: 2,
    href: "/admin/venue?section=business-hours#business-hours",
    compute: ({ signals }) => ({
      status: signals.hasBusinessHours ? "complete" : "missing",
    }),
  },
  {
    key: "photos",
    label: "Photos",
    weight: 2,
    href: "/admin/images",
    compute: ({ operatorImageCount }) => ({
      status:
        operatorImageCount >= PHOTO_TARGET
          ? "complete"
          : operatorImageCount > 0
          ? "partial"
          : "missing",
      count: operatorImageCount,
      target: PHOTO_TARGET,
    }),
  },
  {
    key: "specials",
    label: "Specials",
    weight: 2,
    href: "/admin/happy-hours",
    compute: ({ foodSpecialsCount, drinkSpecialsCount }) => {
      const total = foodSpecialsCount + drinkSpecialsCount;
      const hasBoth = foodSpecialsCount > 0 && drinkSpecialsCount > 0;
      return {
        status:
          hasBoth && total >= SPECIALS_TARGET
            ? "complete"
            : total > 0
            ? "partial"
            : "missing",
        count: total,
        target: SPECIALS_TARGET,
      };
    },
  },
  {
    key: "events",
    label: "Events",
    weight: 1,
    href: "/admin/events",
    compute: ({ eventsCount }) => ({
      status: eventsCount > 0 ? "complete" : "missing",
      count: eventsCount,
    }),
  },
  {
    key: "website",
    label: "Website",
    weight: 1,
    href: "/admin/venue?section=links#links",
    compute: ({ signals }) => ({
      status: signals.hasWebsite ? "complete" : "missing",
    }),
  },
  {
    key: "menu_url",
    label: "Menu",
    weight: 1,
    href: "/admin/venue?section=links#links",
    compute: ({ signals }) => ({
      status: signals.hasMenuLink ? "complete" : "missing",
    }),
  },
];

// ── Public: core computation ──────────────────────────────────────────────────

/**
 * Computes per-indicator health status and an overall completion percentage.
 *
 * Percentage is a weighted sum:
 *   complete  → full weight
 *   partial   → proportional weight (count / target) when counts are available, else 50%
 *   missing   → 0 weight
 */
export function computeVenueCompletion(input: VenueCompletionInput): VenueCompletion {
  let totalWeight = 0;
  let earnedWeight = 0;

  const indicators: HealthIndicator[] = INDICATOR_DEFS.map((def) => {
    const result = def.compute(input);
    totalWeight += def.weight;

    if (result.status === "complete") {
      earnedWeight += def.weight;
    } else if (result.status === "partial") {
      if (result.count !== undefined && result.target !== undefined && result.target > 0) {
        earnedWeight += def.weight * Math.min(result.count / result.target, 1);
      } else {
        earnedWeight += def.weight * 0.5;
      }
    }

    return {
      key: def.key,
      label: def.label,
      status: result.status,
      count: result.count,
      target: result.target,
      href: def.href,
    };
  });

  const percentage =
    totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;

  return { percentage, indicators };
}
