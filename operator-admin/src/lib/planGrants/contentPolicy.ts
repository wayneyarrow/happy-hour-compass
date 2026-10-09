/**
 * Public content policy for grant recipients — pure, client-safe.
 *
 * Applies ONLY to venues whose EffectiveAccess.contentEnforced is true (a
 * grant has started — see grantState.ts). Every other venue gets
 * UNRESTRICTED_POLICY and its public content is exactly as before.
 *
 * Content is never deleted or rewritten: everything here is a read-time
 * view. Content outside the effective plan is "paused" (inactive publicly)
 * and returns automatically — only up to the new tier — when a grant or
 * subscription lifts the effective plan again.
 *
 * Deterministic rules (approved Part 1):
 *   - Recurring events / weekly Daily Specials: hidden when the effective
 *     plan can't use recurring content. Seeded recurring items stay active
 *     (the existing grandfathered exceptions in src/lib/plans.ts).
 *     One-time items are unaffected.
 *   - Food / drink specials: first N in the operator's stored order.
 *   - Images: first N by sort_order (hero first).
 *   - Search tags: first N in stored order (0 on Free — tags stop
 *     influencing discovery entirely).
 *
 * Callers apply these BEFORE any occurrence expansion, counting, ranking or
 * pagination, so search counts and homepage totals never include paused
 * content.
 */

import {
  canManageGrandfatheredRecurringDailySpecial,
  canManageGrandfatheredRecurringEvent,
  maxDrinkSpecials,
  maxFoodSpecials,
  maxImages,
  maxSearchTags,
  type OperatorPlan,
} from "@/lib/plans";

export type PublicContentPolicy =
  | { enforced: false }
  | { enforced: true; plan: OperatorPlan };

export const UNRESTRICTED_POLICY: PublicContentPolicy = { enforced: false };

export function enforcedPolicy(plan: OperatorPlan): PublicContentPolicy {
  return { enforced: true, plan };
}

function limitFor(policy: PublicContentPolicy, max: (p: OperatorPlan) => number): number {
  return policy.enforced ? max(policy.plan) : Infinity;
}

export const publicImageLimit = (p: PublicContentPolicy) => limitFor(p, maxImages);
export const publicFoodSpecialLimit = (p: PublicContentPolicy) => limitFor(p, maxFoodSpecials);
export const publicDrinkSpecialLimit = (p: PublicContentPolicy) => limitFor(p, maxDrinkSpecials);
export const publicSearchTagLimit = (p: PublicContentPolicy) => limitFor(p, maxSearchTags);

/** First `max` items, in their existing order. Infinity returns the list unchanged. */
export function takeFirst<T>(items: T[], max: number): T[] {
  return max === Infinity || items.length <= max ? items : items.slice(0, max);
}

function isRecurringEventValue(recurrence: string | null | undefined): boolean {
  return !!recurrence && recurrence !== "none";
}

/** Whether a published event is publicly active under the policy. */
export function isEventPubliclyActive(
  policy: PublicContentPolicy,
  event: { recurrence: string | null | undefined; isSeededEvent: boolean }
): boolean {
  if (!policy.enforced || !isRecurringEventValue(event.recurrence)) return true;
  return canManageGrandfatheredRecurringEvent(policy.plan, event.isSeededEvent);
}

/** Whether a published Daily Special is publicly active under the policy. */
export function isDailySpecialPubliclyActive(
  policy: PublicContentPolicy,
  special: { scheduleType: string | null | undefined; isSeededSpecial: boolean }
): boolean {
  if (!policy.enforced || special.scheduleType !== "weekly") return true;
  return canManageGrandfatheredRecurringDailySpecial(policy.plan, special.isSeededSpecial);
}

/**
 * Truncates a raw hh_food_details / hh_drink_details value to its first
 * `max` items, preserving the stored format (JSON array, or legacy
 * pipe/newline text), so every downstream parser/counter sees exactly the
 * publicly-active items.
 */
export function truncateRawSpecials(raw: string | null, max: number): string | null {
  if (raw == null || max === Infinity || !raw.trim()) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.length <= max ? raw : JSON.stringify(parsed.slice(0, max));
    }
  } catch {
    /* legacy text — fall through */
  }
  const delimiter = raw.includes("|") ? "|" : "\n";
  const parts = raw.split(delimiter).map((s) => s.trim()).filter(Boolean);
  return parts.length <= max ? raw : parts.slice(0, max).join(delimiter === "|" ? " | " : "\n");
}

/** Number of items in a raw specials value (same rules as truncateRawSpecials). */
export function countRawSpecials(raw: string | null): number {
  if (raw == null || !raw.trim()) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => x != null && x !== "").length;
  } catch {
    /* legacy text */
  }
  const delimiter = raw.includes("|") ? "|" : "\n";
  return raw.split(delimiter).filter((s) => s.trim()).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator-facing paused-content summary
// ─────────────────────────────────────────────────────────────────────────────

export type ContentCounts = {
  recurringEvents: number;
  seededRecurringEvents: number;
  weeklySpecials: number;
  seededWeeklySpecials: number;
  foodSpecials: number;
  drinkSpecials: number;
  images: number;
  searchTags: number;
};

export type PausedContentSummary = {
  recurringEvents: number;
  weeklySpecials: number;
  foodSpecials: number;
  drinkSpecials: number;
  images: number;
  searchTags: number;
  total: number;
};

/** How much of a venue's stored, published content is paused publicly. */
export function summarizePausedContent(policy: PublicContentPolicy, counts: ContentCounts): PausedContentSummary {
  if (!policy.enforced) {
    return { recurringEvents: 0, weeklySpecials: 0, foodSpecials: 0, drinkSpecials: 0, images: 0, searchTags: 0, total: 0 };
  }
  const over = (n: number, max: number) => (max === Infinity ? 0 : Math.max(0, n - max));
  const recurringEvents = isEventPubliclyActive(policy, { recurrence: "weekly", isSeededEvent: false })
    ? 0
    : counts.recurringEvents - counts.seededRecurringEvents;
  const weeklySpecials = isDailySpecialPubliclyActive(policy, { scheduleType: "weekly", isSeededSpecial: false })
    ? 0
    : counts.weeklySpecials - counts.seededWeeklySpecials;
  const summary = {
    recurringEvents: Math.max(0, recurringEvents),
    weeklySpecials: Math.max(0, weeklySpecials),
    foodSpecials: over(counts.foodSpecials, publicFoodSpecialLimit(policy)),
    drinkSpecials: over(counts.drinkSpecials, publicDrinkSpecialLimit(policy)),
    images: over(counts.images, publicImageLimit(policy)),
    searchTags: over(counts.searchTags, publicSearchTagLimit(policy)),
  };
  return {
    ...summary,
    total:
      summary.recurringEvents + summary.weeklySpecials + summary.foodSpecials +
      summary.drinkSpecials + summary.images + summary.searchTags,
  };
}
