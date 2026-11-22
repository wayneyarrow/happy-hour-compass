/**
 * Market scope for the Control Panel Platform Analytics dashboard
 * (/control-panel/analytics). Pure — no I/O — so the attribution rules are
 * unit-testable; src/lib/data/founderDashboard.ts applies them.
 *
 * Attribution (same rules as the Phase 2 Control Panel list filters):
 *   - venues and everything recorded against a venue (views, events and
 *     their views, Daily Special clicks, plan changes, churn): the venue's
 *     CURRENT venues.market_id. Historical activity therefore follows the
 *     venue's present assignment, not where it was when the activity
 *     happened.
 *   - operators: every market where the operator owns a venue; counted once
 *     per view. Unassigned = owns no venue with a market (or none at all).
 *   - submissions: linked venue's market, else the city/province resolver
 *     (src/lib/marketAttribution.ts), else Unassigned.
 *   - suggestions: free-text city only — never market-attributed; shown
 *     under All markets only.
 */

import {
  MARKET_FILTER_ALL,
  MARKET_FILTER_UNASSIGNED,
  type MarketFilterOption,
  type MarketFilterSelection,
} from "@/lib/marketFilter";
import { attributeSubmissionMarket } from "@/lib/marketAttribution";
import type { CityGeographyLookup } from "@/lib/geo/venueGeographyResolver";

export type DashboardMarketScope =
  | { kind: "all" }
  | { kind: "market"; marketId: string }
  | { kind: "unassigned" };

export const ALL_MARKETS_SCOPE: DashboardMarketScope = { kind: "all" };

/** Scope for a parsed ?market= selection (parseMarketFilter() already rejected unknown slugs). */
export function scopeFromSelection(
  selection: MarketFilterSelection,
  options: readonly MarketFilterOption[]
): DashboardMarketScope {
  if (selection === MARKET_FILTER_ALL) return ALL_MARKETS_SCOPE;
  if (selection === MARKET_FILTER_UNASSIGNED) return { kind: "unassigned" };
  const option = options.find((o) => o.slug === selection);
  return option ? { kind: "market", marketId: option.id } : ALL_MARKETS_SCOPE;
}

/** Does a record attributed to `marketId` (null = unassigned) belong to the scope? */
export function inDashboardScope(marketId: string | null, scope: DashboardMarketScope): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "unassigned") return marketId === null;
  return marketId === scope.marketId;
}

/** An operator is in scope when ANY owned venue is (Unassigned: none has a market). */
export function operatorInDashboardScope(
  ownedVenueMarketIds: readonly (string | null)[],
  scope: DashboardMarketScope
): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "unassigned") return ownedVenueMarketIds.every((m) => m === null);
  return ownedVenueMarketIds.some((m) => m === scope.marketId);
}

export type OperatorActivityBuckets = { active: number; inactive: number; neverLoggedIn: number };

/**
 * The dashboard's three mutually exclusive operator buckets, for the
 * operators in scope, each operator counted once:
 *   active = last_seen_at within the window; inactive = older;
 *   neverLoggedIn = last_seen_at null.
 */
export function countOperatorBuckets(
  operators: readonly { id: string; last_seen_at: string | null }[],
  ownedVenueMarketIdsByOperator: ReadonlyMap<string, readonly (string | null)[]>,
  scope: DashboardMarketScope,
  sinceMs: number
): OperatorActivityBuckets {
  const out: OperatorActivityBuckets = { active: 0, inactive: 0, neverLoggedIn: 0 };
  for (const op of operators) {
    if (!operatorInDashboardScope(ownedVenueMarketIdsByOperator.get(op.id) ?? [], scope)) continue;
    if (op.last_seen_at === null) out.neverLoggedIn++;
    else if (new Date(op.last_seen_at).getTime() >= sinceMs) out.active++;
    else out.inactive++;
  }
  return out;
}

export type SubmissionForScope = {
  submitted_at: string;
  venue_id: string | null;
  venue_market_id: string | null;
  city: string | null;
  province: string | null;
};

/** All-time and in-window submission counts for the scope (Phase 2 attribution). */
export function countSubmissionsInScope(
  submissions: readonly SubmissionForScope[],
  lookup: CityGeographyLookup,
  scope: DashboardMarketScope,
  sinceMs: number
): { total: number; inWindow: number } {
  let total = 0;
  let inWindow = 0;
  for (const s of submissions) {
    const { marketId } = attributeSubmissionMarket(
      { venueId: s.venue_id, venueMarketId: s.venue_market_id, city: s.city, province: s.province },
      lookup
    );
    if (!inDashboardScope(marketId, scope)) continue;
    total++;
    if (new Date(s.submitted_at).getTime() >= sinceMs) inWindow++;
  }
  return { total, inWindow };
}

/**
 * Applies the scope to a Supabase query on `venues` (or any table whose
 * `column` holds a venue market id): the identity for All markets, `= id`
 * for a market, `IS NULL` for Unassigned. Shared by Platform Analytics and
 * the Action Center so both scope venue queries identically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeVenueQuery<Q extends { eq: any; is: any }>(
  q: Q,
  scope: DashboardMarketScope,
  column = "market_id"
): Q {
  if (scope.kind === "market") return q.eq(column, scope.marketId);
  if (scope.kind === "unassigned") return q.is(column, null);
  return q;
}
