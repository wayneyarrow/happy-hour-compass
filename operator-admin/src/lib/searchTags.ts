/**
 * Centralized search tag catalog for Happy Hour Compass.
 *
 * This file is the single source of truth for:
 *   - The controlled tag catalog (grouped by category)
 *   - Tag validation helpers
 *   - Plan-based tag limits
 *
 * Rules:
 *   - No custom tags — operators select from this list only
 *   - Limits are enforced in server actions AND reflected in the UI
 *   - Free plan: 0 tags (search tags are a paid discovery feature)
 *
 * Future Discover Page:
 *   Tags in this catalog will power "Popular Patios", "Best Wings", etc.
 *   Adding a new tag requires a single entry here; no schema change needed.
 */

import type { OperatorPlan } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// Tag catalog
// ─────────────────────────────────────────────────────────────────────────────

export type SearchTagGroup = {
  label: string;
  tags: readonly string[];
};

export const SEARCH_TAG_GROUPS: SearchTagGroup[] = [
  {
    label: "Venue Experience",
    tags: [
      "Patio",
      "Live Music",
      "DJ",
      "Sports Viewing",
      "Trivia Nights",
      "Date Night",
      "Family Friendly",
      "Group Friendly",
      "Dog Friendly",
      "Late Night",
      "Waterfront",
      "Rooftop",
      "Lively",
      "Casual",
      "Bar Seating",
    ],
  },
  {
    label: "Food Highlights",
    tags: [
      "Wings",
      "Burgers",
      "Pizza",
      "Tacos",
      "Seafood",
      "Steak",
      "Appetizers",
      "Small Plates",
      "Vegetarian Friendly",
      "Gluten Friendly",
    ],
  },
  {
    label: "Drink Highlights",
    tags: ["Craft Beer", "Cocktails", "Wine", "Mocktails", "Local Beer"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Derived lookup
// ─────────────────────────────────────────────────────────────────────────────

const ALL_TAGS: string[] = SEARCH_TAG_GROUPS.flatMap((g) => [...g.tags]);
const TAG_SET = new Set(ALL_TAGS);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns every tag in catalog order. */
export function getAllSearchTags(): string[] {
  return ALL_TAGS;
}

/** Returns true when tag is a recognized catalog entry (exact match). */
export function isValidSearchTag(tag: string): boolean {
  return TAG_SET.has(tag);
}

/**
 * Returns the maximum number of search tags for a plan.
 * Returns Infinity for enterprise (unlimited).
 *
 *   FREE       → 0    (feature not available)
 *   PRO        → 5
 *   PREMIUM    → 10
 *   ENTERPRISE → Infinity
 */
export function getSearchTagLimitForPlan(plan: OperatorPlan): number {
  switch (plan) {
    case "free":       return 0;
    case "pro":        return 5;
    case "premium":    return 10;
    case "enterprise": return Infinity;
  }
}

/** Returns true when the plan includes at least one search tag slot. */
export function canUseSearchTags(plan: OperatorPlan): boolean {
  return plan !== "free";
}
