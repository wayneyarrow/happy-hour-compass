/**
 * Centralized plan architecture for Happy Hour Compass.
 *
 * This file is the single source of truth for:
 *   - Plan types and constants
 *   - Entitlement helpers (canUse*, max*)
 *   - Analytics tier mapping
 *   - Trend metric types and computation
 *
 * Usage pattern:
 *   import { canUseAdvancedEvents, maxImages, analyticsTier } from "@/lib/plans";
 *
 * Values reflect the approved HHC monetization matrix.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Plan type and constants
// ─────────────────────────────────────────────────────────────────────────────

export const PLANS = ["free", "pro", "premium", "enterprise"] as const;
export type OperatorPlan = (typeof PLANS)[number];

/** Display labels for plan badges and UI copy. */
export const PLAN_LABELS: Record<OperatorPlan, string> = {
  free:       "Free",
  pro:        "Pro",
  premium:    "Premium",
  enterprise: "Enterprise",
};

/**
 * Safely coerces an unknown DB value to a valid OperatorPlan.
 * Falls back to 'free' for null, undefined, or unrecognised strings.
 * Use this when casting raw Supabase TEXT values into the typed plan.
 */
export function parseOperatorPlan(raw: unknown): OperatorPlan {
  if (raw === "pro" || raw === "premium" || raw === "enterprise") return raw;
  return "free";
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics tier
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyticsTier = "basic" | "expanded" | "advanced";

export const ANALYTICS_TIER_LABELS: Record<AnalyticsTier, string> = {
  basic:    "Basic Analytics",
  expanded: "Expanded Analytics",
  advanced: "Advanced Analytics",
};

/**
 * Maps an operator plan to its analytics capability tier.
 *
 *   FREE       → Basic     (view counts, simple totals)
 *   PRO        → Expanded  (+ trends, weekly breakdown)
 *   PREMIUM    → Advanced  (+ search rankings, campaign stats)
 *   ENTERPRISE → Advanced  (same as premium)
 */
export function analyticsTier(plan: OperatorPlan): AnalyticsTier {
  switch (plan) {
    case "free":       return "basic";
    case "pro":        return "expanded";
    case "premium":
    case "enterprise": return "advanced";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trend framework
//
// Types are defined here so analytics UI components can be built against them
// before real metrics are wired. No data is fabricated — callers provide values.
// ─────────────────────────────────────────────────────────────────────────────

export type TrendDirection = "up" | "down" | "flat";

/**
 * A single metric with current period, prior period, and derived trend.
 * current/previous are null when insufficient data exists (e.g. new operator).
 */
export type PeriodMetric = {
  current:        number | null;
  previous:       number | null;
  trendDirection: TrendDirection | null;
  trendPercent:   number | null;
};

/**
 * Derives trend direction and percent change from two period values.
 * Treats changes under 0.5% as flat to avoid noisy micro-fluctuations.
 *
 * @param current  Value for the current period.
 * @param previous Value for the comparison period.
 */
export function computeTrend(
  current: number,
  previous: number
): { trendDirection: TrendDirection; trendPercent: number } {
  if (previous === 0) {
    return { trendDirection: current > 0 ? "up" : "flat", trendPercent: 0 };
  }
  const delta = ((current - previous) / previous) * 100;
  return {
    trendDirection: delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat",
    trendPercent:   Math.abs(Math.round(delta)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entitlement helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advanced event features: recurring schedules, multi-date ranges, rich
 * descriptions, and future event-specific promotions.
 */
export function canUseAdvancedEvents(plan: OperatorPlan): boolean {
  return plan === "pro" || plan === "premium" || plan === "enterprise";
}

/**
 * Custom search tag management beyond the default auto-generated tag set.
 * Allows operators to surface their venue for specific consumer searches.
 */
export function canUseAdvancedSearchTags(plan: OperatorPlan): boolean {
  return plan === "pro" || plan === "premium" || plan === "enterprise";
}

/**
 * Featured placement in Discover surfaces and category result rankings.
 */
export function canUseDiscoverPlacement(plan: OperatorPlan): boolean {
  return plan === "premium" || plan === "enterprise";
}

/**
 * Targeted promotional campaigns for happy hour deals (push, email, in-app).
 */
export function canUsePromotionalCampaigns(plan: OperatorPlan): boolean {
  return plan === "premium" || plan === "enterprise";
}

// ─────────────────────────────────────────────────────────────────────────────
// Limit helpers
//
// Return Infinity for "unlimited". Check with: if (count < maxImages(plan))
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum number of staff/team members who can access the Operator Admin. */
export function maxUsers(plan: OperatorPlan): number {
  switch (plan) {
    case "free":       return 1;
    case "pro":        return 2;
    case "premium":    return 5;
    case "enterprise": return Infinity;
  }
}

/** Maximum number of venue images (across hero + gallery). */
export function maxImages(plan: OperatorPlan): number {
  switch (plan) {
    case "free":       return 5;
    case "pro":        return 10;
    case "premium":    return 25;
    case "enterprise": return Infinity;
  }
}

/** Maximum number of food special line items. */
export function maxFoodSpecials(plan: OperatorPlan): number {
  switch (plan) {
    case "free":       return 3;
    case "pro":        return 6;
    case "premium":    return 10;
    case "enterprise": return Infinity;
  }
}

/** Maximum number of drink special line items. */
export function maxDrinkSpecials(plan: OperatorPlan): number {
  switch (plan) {
    case "free":       return 3;
    case "pro":        return 6;
    case "premium":    return 10;
    case "enterprise": return Infinity;
  }
}
