/**
 * Public-facing presentation data for the Free/Pro/Premium plans — pricing,
 * subtitles, key benefit bullets, and the feature comparison table.
 *
 * Single source of truth shared by the operator admin's plan-change UI
 * (ChangePlanModal.tsx) and the public marketing pricing table
 * (app/(website)/business/BusinessPricingTable.tsx), so the two can never
 * quietly disagree about what a plan costs or includes. Feature limits
 * themselves (maxImages, maxUsers, etc.) still come from plans.ts — this
 * file only adds the human-readable copy layer on top.
 *
 * Enterprise is intentionally excluded here, matching the existing
 * self-serve boundary already established in ChangePlanModal.tsx: it is a
 * sales-assisted tier, not a self-serve or public pricing-table plan.
 */

import {
  maxUsers,
  maxImages,
  maxFoodSpecials,
  maxDrinkSpecials,
  maxSearchTags,
  canUseRecurringEvents,
  canUseDiscoverPlacement,
  canUsePromotionalCampaigns,
  analyticsTier,
  type AnalyticsTier,
} from "./plans";

export const VISIBLE_PLANS = ["free", "pro", "premium"] as const;
export type VisiblePlan = (typeof VISIBLE_PLANS)[number];

export const PLAN_SUBTITLES: Record<VisiblePlan, string> = {
  free:    "For venues getting started",
  pro:     "Unlock better visibility and recurring promotions",
  premium: "Stand out from the competition with maximum visibility",
};

export const PLAN_PRICES: Record<VisiblePlan, string> = {
  free:    "$0",
  pro:     "$9.99",
  premium: "$19.99",
};

export const PLAN_KEY_BENEFITS: Record<VisiblePlan, string[]> = {
  free: [
    "Basic venue listing",
    "5 photos",
    "3 food and drink specials",
    "One-time events",
    "Basic analytics",
    "1 team member",
  ],
  pro: [
    "Recurring events",
    "5 search tags",
    "Expanded analytics",
    "2 team members",
    "10 photos",
    "6 food and drink specials",
  ],
  premium: [
    "Featured Discover placement",
    "Promotional campaigns",
    "Advanced analytics",
    "5 team members",
    "25 photos",
    "10 food and drink specials",
    "10 search tags",
  ],
};

const ANALYTICS_SHORT: Record<AnalyticsTier, string> = {
  basic:    "Basic",
  expanded: "Expanded",
  advanced: "Advanced",
};

function formatLimit(n: number): string {
  if (n === Infinity) return "Unlimited";
  if (n === 0) return "—";
  return String(n);
}

export type FeatureRow = { label: string; values: Record<VisiblePlan, string> };

/** Builds the Free/Pro/Premium comparison table rows straight from plans.ts entitlements. */
export function buildFeatureRows(): FeatureRow[] {
  function row(label: string, fn: (p: VisiblePlan) => string): FeatureRow {
    return {
      label,
      values: Object.fromEntries(
        VISIBLE_PLANS.map((p) => [p, fn(p)])
      ) as Record<VisiblePlan, string>,
    };
  }
  return [
    row("Users",                          (p) => formatLimit(maxUsers(p))),
    row("Images",                         (p) => formatLimit(maxImages(p))),
    row("Food Specials",                  (p) => formatLimit(maxFoodSpecials(p))),
    row("Drink Specials",                 (p) => formatLimit(maxDrinkSpecials(p))),
    row("Events",                         (p) => canUseRecurringEvents(p) ? "Recurring events" : "One-time events"),
    row("Search Tags",                    (p) => formatLimit(maxSearchTags(p))),
    row("Analytics",                      (p) => ANALYTICS_SHORT[analyticsTier(p)]),
    row("Featured Placement on Discover", (p) => canUseDiscoverPlacement(p) ? "Included" : "—"),
    row("Promotional Campaigns",          (p) => canUsePromotionalCampaigns(p) ? "Included" : "—"),
  ];
}
