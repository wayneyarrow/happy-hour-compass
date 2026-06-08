/**
 * Server-only Featured Events rail engine.
 *
 * This file is intentionally separate from discoverEngine.ts because it imports
 * from events.ts and discoverEventOverrides.ts, which pull in the Supabase
 * server client.  discoverEngine.ts is imported by ConsumerHome.tsx (a client
 * component) and must remain free of server-only imports.
 *
 * Architecture:
 *   Server page fetches  getCPFeaturedEventCandidates()
 *                      + getEventOverridesForRail("featured-events")
 *                      + allOverrides["featured-events"]  (venue-level)
 *       ↓
 *   computeFeaturedEventRail()  ← you are here
 *       ↓
 *   CPFeaturedEventItem[]  →  sliced to RAIL_MAX  →  mapped to DiscoverEventItem[]
 *
 * Eligibility pipeline:
 *   1. Geo             — isNearMarket  (applied to algorithm pool AND include overrides)
 *   2. Venue           — !venueExcludeFromDiscover
 *   3. Event           — !excludeFromDiscover
 *   4. Venue override  — !venue nixed from this rail (discover_rail_overrides)
 *   5. Event override  — !event nixed from this rail (discover_event_overrides)
 *   6. Score + sort    — event internal_boost + operator plan lift
 *
 * Include override semantics (consumer-safe):
 *   An event with action='include' in discover_event_overrides is added to the
 *   rail even when it is not in the algorithm pool — but geo and eligibility
 *   gates (steps 1-3) still apply.  This mirrors the venue-rail include logic
 *   in buildIncludePool() and deliberately avoids showing out-of-market events
 *   to consumers.
 *
 *   Exclude always wins over include.
 */

import type { CPFeaturedEventItem } from "@/lib/data/events";
import type { EventRailOverride } from "@/lib/data/discoverOverridesShared";
import type { RailOverride } from "@/lib/discover/discoverEngine";
import { isNearMarket } from "@/lib/discover/discoverEngine";

// ─── Scoring ──────────────────────────────────────────────────────────────────

function planLift(plan: CPFeaturedEventItem["operatorPlan"]): number {
  switch (plan) {
    case "premium":
    case "enterprise": return 0.15;
    case "pro":        return 0.05;
    default:           return 0;
  }
}

/**
 * Score an event for Featured Events ordering.
 *
 * Additive components (base 1.0, max 1.65):
 *   events.internal_boost  0–100 → 0.00–0.50   (event-level curation signal)
 *   operator plan          free=0, pro=+0.05, premium/enterprise=+0.15
 *
 * No venue-level boost or Google rating — those signals apply to venue rails.
 * Event boost is the primary curation lever in the Featured Events rail.
 */
function scoreEvent(event: CPFeaturedEventItem): number {
  let score = 1.0;
  score += (event.internalBoost / 100) * 0.5;
  score += planLift(event.operatorPlan);
  return score;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Filters and sorts CPFeaturedEventItem[] for the consumer Featured Events rail.
 *
 * @param candidates  All upcoming published events with venue context.
 *                    Produced by getCPFeaturedEventCandidates().
 * @param eventOverrides  Event-level rail overrides for 'featured-events'.
 *                        Produced by getEventOverridesForRail("featured-events").
 * @param venueOverrides  Venue-level rail overrides for 'featured-events'.
 *                        From allOverrides["featured-events"] (RailOverrideRow[])
 *                        or getRailOverridesForKey("featured-events").
 *                        Only the venueUuid + action fields are used.
 *
 * @returns Filtered and scored CPFeaturedEventItem[] ready to be sliced to
 *          RAIL_MAX and mapped to DiscoverEventItem[] for the consumer UI.
 */
export function computeFeaturedEventRail(
  candidates: CPFeaturedEventItem[],
  eventOverrides: EventRailOverride[],
  venueOverrides: RailOverride[]
): CPFeaturedEventItem[] {
  // Build O(1) lookup sets
  const nixedEventUuids = new Set(
    eventOverrides.filter((o) => o.action === "exclude").map((o) => o.eventUuid)
  );
  const includedEventUuids = new Set(
    eventOverrides.filter((o) => o.action === "include").map((o) => o.eventUuid)
  );
  const nixedVenueUuids = new Set(
    venueOverrides.filter((o) => o.action === "exclude").map((o) => o.venueUuid)
  );

  // ── Algorithm pool ────────────────────────────────────────────────────────
  // Events that naturally qualify: geo-local, eligible venues, eligible events,
  // no active nix override at either the venue or event level.
  const algorithm = candidates.filter(
    (e) =>
      isNearMarket(e.venueLat, e.venueLng) &&
      !e.venueExcludeFromDiscover &&
      !e.excludeFromDiscover &&
      !nixedVenueUuids.has(e.venueUuid) &&
      !nixedEventUuids.has(e.eventUuid)
  );

  // ── Include-override pool ──────────────────────────────────────────────────
  // Events explicitly added by an admin.  Geo + eligibility gates still apply
  // (no out-of-market events on the consumer rail).  Exclude wins over include.
  const algorithmUuids = new Set(algorithm.map((e) => e.eventUuid));

  const includePool = candidates.filter(
    (e) =>
      includedEventUuids.has(e.eventUuid) &&
      !nixedEventUuids.has(e.eventUuid) &&     // exclude wins
      !algorithmUuids.has(e.eventUuid) &&      // no duplicates
      isNearMarket(e.venueLat, e.venueLng) &&  // geo gate (consumer-safe)
      !e.venueExcludeFromDiscover &&
      !e.excludeFromDiscover
  );

  // ── Merge and sort ─────────────────────────────────────────────────────────
  // Include-override events appear first (they were explicitly added), then
  // algorithm events, all sorted by score DESC within each group.
  // Note: both groups are independently sorted so override events appear at the
  // top even when their score is lower than the best algorithm event.
  const sorted = (arr: CPFeaturedEventItem[]) =>
    [...arr].sort((a, b) => scoreEvent(b) - scoreEvent(a));

  return [...sorted(includePool), ...sorted(algorithm)];
}
