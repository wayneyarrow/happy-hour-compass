/**
 * Discover / Featured-ranking plan-source preparation — Phase 2A foundation
 * only. NOT wired into any live query. Production Discover ranking
 * (src/lib/discover/discoverEngine.ts, featuredEventsEngine.ts) and its
 * upstream data mappers (src/lib/data/venues.ts, events.ts) are completely
 * unchanged by this file — the `operatorPlan` field they populate today
 * still comes from the joined `operators.plan` column exactly as before.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREPARES FOR PHASE 2B
 * ─────────────────────────────────────────────────────────────────────────
 * The Discover ranking boost (`planLift()` in discoverEngine.ts /
 * featuredEventsEngine.ts) reads a venue's `operatorPlan` field, which is
 * populated by a nested Supabase select joining through the venue's
 * operator:
 *
 *   src/lib/data/venues.ts (~line 600):
 *     .select("... , operators!created_by_operator_id(plan)")
 *     operatorPlan: (row.operators as {...})?.plan → coerced to OperatorPlan
 *
 *   src/lib/data/events.ts (~line 737):
 *     "venues!venue_id(..., operators!created_by_operator_id(plan))"
 *     operatorPlan: (venue.operators as {...})?.plan → coerced to OperatorPlan
 *
 * Phase 2B changes BOTH joins from the venue's operator to the venue's own
 * subscription row:
 *
 *   FROM:  operators!created_by_operator_id(plan)
 *   TO:    venue_subscriptions(plan_code)
 *
 * with "missing subscription row = free" — i.e. a LEFT join (Supabase's
 * default nested-select join behavior already returns null rather than
 * omitting the row when no match exists, so no special LEFT JOIN syntax is
 * needed beyond swapping the joined table/column names).
 *
 * `resolvePlanCodeFromJoinedField()` below is the one coercion rule both of
 * those call sites already duplicate inline (operators.plan and
 * venue_subscriptions.plan_code are both a plain nullable TEXT column with
 * the exact same free|pro|premium|enterprise vocabulary — see migration 083
 * vs. 029/036) — Phase 2B can import this instead of re-deriving the same
 * ternary a third and fourth time.
 */

import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";

/**
 * The exact Supabase nested-select fragment Phase 2B will substitute for
 * today's `operators!created_by_operator_id(plan)` fragment in
 * src/lib/data/venues.ts. Exported as a named constant (rather than left as
 * a comment) so both the query string and this file's documentation cannot
 * silently drift apart.
 */
export const VENUE_SUBSCRIPTION_JOIN_FRAGMENT = "venue_subscriptions(plan_code)" as const;

/**
 * The shape of the joined `venue_subscriptions(plan_code)` object as
 * Supabase returns it — a single nested object (venue_id is UNIQUE, so this
 * is a one-to-one join, same cardinality as today's operators(plan) join),
 * or null when the venue has no subscription row (a Free venue).
 */
export type JoinedVenueSubscription = { plan_code: string | null } | null;

/**
 * Resolves an OperatorPlan from either shape of joined plan field this
 * codebase uses today or will use after Phase 2B:
 *   - operators.plan            (current: { plan: string | null } | null)
 *   - venue_subscriptions.plan_code (future: { plan_code: string | null } | null)
 *
 * Missing row/field → 'free', via parseOperatorPlan's existing safe
 * coercion (same fallback every current inline call site already uses,
 * just centralized). Does not itself decide WHICH join is active — callers
 * pass whichever nested field their query actually selected.
 */
export function resolvePlanCodeFromJoinedField(
  raw: { plan?: unknown; plan_code?: unknown } | null | undefined
): OperatorPlan {
  if (!raw) return "free";
  return parseOperatorPlan(raw.plan_code ?? raw.plan);
}
