/**
 * Discover Engine — centralized rail selection for the Consumer Home.
 *
 * Architecture:
 *   Data layer  (src/lib/data/venues.ts)
 *       ↓
 *   Discover Engine  (src/lib/discover/discoverEngine.ts)  ← you are here
 *       ↓
 *   Page orchestrators  (app/(consumer)/page.tsx, [collection]/page.tsx)
 *       ↓
 *   UI components  (ConsumerHome, CollectionVenueView, …)
 *
 * Each rail function accepts a pre-fetched ConsumerVenue[] and an optional
 * RailOverride[] and returns a filtered / sorted set.  Pages call
 * getPublishedVenuesForConsumer() once and getAllRailOverrides() once, then
 * distribute to whichever rail functions they need.
 *
 * Pipeline (enforced in every venue rail):
 *   1. Geography   — isNearMarket
 *   2. Eligibility — isDiscoverEligible  (exclude_from_discover flag)
 *   3. Rail filter — tag / flag / recency / spotlight check
 *   4. Overrides   — rail-level include / exclude from discover_rail_overrides
 *   5. Dedupe      — dedupeById
 *   6. Weighting   — scoreVenueForDiscover sort
 *
 * Override semantics:
 *   action = 'include' — injects a venue into the rail candidate pool even if
 *                        the algorithm would not select it.  Geography and
 *                        isDiscoverEligible still apply.  An out-of-market venue
 *                        or a globally-excluded venue cannot be force-included.
 *   action = 'exclude' — removes a venue from this specific rail regardless of
 *                        algorithmic output.  Rail-scoped only; use
 *                        venues.exclude_from_discover for venue-wide suppression.
 *
 * Spotlight fallback behavior:
 *   Primary pool = spotlight_eligible venues.
 *   If primary.length < RAIL_MAX, remaining slots are filled with isVerified
 *   venues (Phase 2A behavior).  Rail overrides are applied to both pools.
 *
 * Featured Events override semantics (V1):
 *   action = 'exclude' — removes a venue's events from Featured Events even if
 *                        the venue is otherwise discover-eligible.
 *   action = 'include' — for V1 has no algorithmic effect beyond geography +
 *                        eligibility, since all eligible local venues with events
 *                        already appear.  Stored for future use.
 *
 * Phase 3B will add:
 *   Dynamic MarketConfig record from database
 *   Context-aware scoring (distance weight for nearby, recency weight for new)
 */

import type { ConsumerVenue } from "@/lib/data/venues";

// ─── Market config (V1 — Central Okanagan) ────────────────────────────────────

export const MARKET_CONFIG = {
  lat: 49.888,
  lng: -119.496,
  radiusKm: 50,
} as const;

export const MARKET_LABEL = "Central Okanagan";

// ─── Rail display limits ──────────────────────────────────────────────────────

export const RAIL_MAX = 12;
export const NEARBY_POOL = 30;
export const BROWSE_MIN_LOCAL = 4;

// ─── Internal constants ────────────────────────────────────────────────────────

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Minimum Google rating to enter the Highly Rated primary pool.
// Fallback pool accepts venues rated at or above RATED_THRESHOLD.
const HIGH_RATING_THRESHOLD = 4.0;
const RATED_THRESHOLD = 3.5;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiscoverEventItem = {
  id: string;
  title: string;
  venueName: string;
  venueSlug: string;
  nextOccurrenceLabel: string;
};

export type DiscoverContext = "spotlight" | "patio" | "nearby" | "new" | "tagged";

/**
 * A single internal curation override for a specific rail.
 * Sourced from discover_rail_overrides via getAllRailOverrides() or
 * getRailOverridesForKey(), then stripped to the minimal shape the engine needs.
 */
export type RailOverride = {
  venueUuid: string;
  action: "include" | "exclude";
};

// ─── Geo utilities ────────────────────────────────────────────────────────────

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns true when a venue is within the market radius.
 * Venues without coordinates are included permissively (assumed local).
 */
export function isNearMarket(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return true;
  return (
    haversineKm(MARKET_CONFIG.lat, MARKET_CONFIG.lng, lat, lng) <=
    MARKET_CONFIG.radiusKm
  );
}

// ─── Eligibility ──────────────────────────────────────────────────────────────

export function isDiscoverEligible(venue: ConsumerVenue): boolean {
  return !venue.excludeFromDiscover;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function planLift(plan: ConsumerVenue["operatorPlan"]): number {
  switch (plan) {
    case "premium":
    case "enterprise": return 0.15;
    case "pro":        return 0.05;
    default:           return 0;
  }
}

/**
 * Scores a venue for discover ordering.  Higher = better placement.
 *
 * Additive components (base 1.0, max 1.95):
 *   internal_boost  0–100 → 0.00–0.50
 *   operator plan   free=0, pro=+0.05, premium/enterprise=+0.15
 *   google rating   0–5   → 0.00–0.30
 *
 * A venue with boost=0, free plan, and no rating scores 1.0 — always visible
 * when geo + eligibility pass.
 */
export function scoreVenueForDiscover(
  venue: ConsumerVenue,
  _context?: DiscoverContext
): number {
  let score = 1.0;
  score += (venue.internalBoost / 100) * 0.5;
  score += planLift(venue.operatorPlan);
  if (venue.googleRating !== null) {
    score += (venue.googleRating / 5) * 0.3;
  }
  return score;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function dedupeById(venues: ConsumerVenue[]): ConsumerVenue[] {
  const seen = new Set<string>();
  return venues.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

// ─── Override helpers ─────────────────────────────────────────────────────────

/** Builds exclude/include UUID sets from the overrides array for O(1) lookups. */
function splitOverrides(overrides: RailOverride[]): {
  excludedUuids: Set<string>;
  includedUuids: Set<string>;
} {
  const excludedUuids = new Set<string>();
  const includedUuids = new Set<string>();
  for (const o of overrides) {
    if (o.action === "exclude") excludedUuids.add(o.venueUuid);
    else includedUuids.add(o.venueUuid);
  }
  return { excludedUuids, includedUuids };
}

/**
 * Returns venues that have an 'include' override and are not in the system pool,
 * subject to geo + eligibility gates.
 *
 * Include overrides bypass the rail-specific filter (e.g. Patio tag, spotlight_eligible)
 * but never bypass geography or global discover eligibility.
 */
function buildIncludePool(
  venues: ConsumerVenue[],
  includedUuids: Set<string>,
  excludedUuids: Set<string>,
  systemUuids: Set<string>
): ConsumerVenue[] {
  return venues.filter(
    (v) =>
      includedUuids.has(v.venueUuid) &&
      !excludedUuids.has(v.venueUuid) &&   // exclude wins over include
      !systemUuids.has(v.venueUuid) &&     // don't duplicate what's already in pool
      isNearMarket(v.latitude, v.longitude) &&
      isDiscoverEligible(v)
  );
}

// ─── Rail functions ───────────────────────────────────────────────────────────

/**
 * Spotlight Venues — local, discover-eligible venues.
 *
 * Primary pool:  spotlight_eligible = true, scored.
 * Fallback pool: isVerified = true, not already in primary, scored.
 *   Fallback ensures the rail never disappears during the rollout period before
 *   enough venues carry spotlight_eligible = true.
 *
 * Override semantics:
 *   include — adds a local eligible venue to the pool (bypasses spotlight_eligible check).
 *   exclude — removes a venue from both primary and fallback pools.
 */
export function getSpotlightVenues(
  venues: ConsumerVenue[],
  overrides: RailOverride[] = []
): ConsumerVenue[] {
  const { excludedUuids, includedUuids } = splitOverrides(overrides);

  const eligible = venues.filter(
    (v) =>
      isNearMarket(v.latitude, v.longitude) &&
      isDiscoverEligible(v) &&
      !excludedUuids.has(v.venueUuid)
  );

  const primary = dedupeById(eligible.filter((v) => v.spotlightEligible)).sort(
    (a, b) => scoreVenueForDiscover(b, "spotlight") - scoreVenueForDiscover(a, "spotlight")
  );

  if (primary.length >= RAIL_MAX && includedUuids.size === 0) return primary;

  const primaryIds   = new Set(primary.map((v) => v.id));
  const primaryUuids = new Set(primary.map((v) => v.venueUuid));

  const fallback = dedupeById(
    eligible.filter((v) => v.isVerified && !primaryIds.has(v.id))
  ).sort(
    (a, b) => scoreVenueForDiscover(b, "spotlight") - scoreVenueForDiscover(a, "spotlight")
  );

  const systemUuids = new Set([...primaryUuids, ...fallback.map((v) => v.venueUuid)]);
  const includePool = buildIncludePool(venues, includedUuids, excludedUuids, systemUuids);

  return dedupeById([...includePool, ...primary, ...fallback]).sort(
    (a, b) => scoreVenueForDiscover(b, "spotlight") - scoreVenueForDiscover(a, "spotlight")
  );
}

/**
 * Patio Picks — local, discover-eligible venues tagged "Patio".
 *
 * Override semantics:
 *   include — adds a venue even if it doesn't carry the Patio tag.
 *   exclude — removes a Patio-tagged venue from this rail.
 */
export function getPatioPicks(
  venues: ConsumerVenue[],
  overrides: RailOverride[] = []
): ConsumerVenue[] {
  const { excludedUuids, includedUuids } = splitOverrides(overrides);

  const system = venues.filter(
    (v) =>
      !excludedUuids.has(v.venueUuid) &&
      isNearMarket(v.latitude, v.longitude) &&
      isDiscoverEligible(v) &&
      (v.seededTags.includes("Patio") || v.searchTags.includes("Patio"))
  );

  const systemUuids  = new Set(system.map((v) => v.venueUuid));
  const includePool  = buildIncludePool(venues, includedUuids, excludedUuids, systemUuids);

  return dedupeById([...includePool, ...system]).sort(
    (a, b) => scoreVenueForDiscover(b, "patio") - scoreVenueForDiscover(a, "patio")
  );
}

/**
 * Featured Nearby — local, discover-eligible venues within the market radius.
 *
 * The full pool is passed to the client for geo-sorting by distance.
 * Server ordering affects pool membership only (which venues make NEARBY_POOL
 * when >NEARBY_POOL local venues exist) — client distance sort overrides.
 */
export function getFeaturedNearby(
  venues: ConsumerVenue[],
  overrides: RailOverride[] = []
): ConsumerVenue[] {
  const { excludedUuids, includedUuids } = splitOverrides(overrides);

  const system = venues.filter(
    (v) =>
      !excludedUuids.has(v.venueUuid) &&
      isNearMarket(v.latitude, v.longitude) &&
      isDiscoverEligible(v)
  );

  const systemUuids = new Set(system.map((v) => v.venueUuid));
  const includePool = buildIncludePool(venues, includedUuids, excludedUuids, systemUuids);

  return dedupeById([...includePool, ...system]).sort(
    (a, b) => scoreVenueForDiscover(b, "nearby") - scoreVenueForDiscover(a, "nearby")
  );
}

/**
 * New This Week — local, discover-eligible venues created in the last 30 days.
 * Primary sort: recency. Secondary: discover score.
 */
export function getNewThisWeek(
  venues: ConsumerVenue[],
  overrides: RailOverride[] = []
): ConsumerVenue[] {
  const { excludedUuids, includedUuids } = splitOverrides(overrides);
  const cutoff = new Date(Date.now() - NEW_WINDOW_MS).toISOString();

  const system = venues.filter(
    (v) =>
      !excludedUuids.has(v.venueUuid) &&
      isNearMarket(v.latitude, v.longitude) &&
      isDiscoverEligible(v) &&
      v.createdAt >= cutoff
  );

  const systemUuids = new Set(system.map((v) => v.venueUuid));
  const includePool = buildIncludePool(venues, includedUuids, excludedUuids, systemUuids);

  return dedupeById([...includePool, ...system]).sort((a, b) => {
    const dateDiff = b.createdAt.localeCompare(a.createdAt);
    if (dateDiff !== 0) return dateDiff;
    return scoreVenueForDiscover(b, "new") - scoreVenueForDiscover(a, "new");
  });
}

/**
 * Highly Rated — local, discover-eligible venues with strong Google ratings.
 *
 * Primary pool: venues with googleRating >= 4.0.
 * Fallback pool: rated venues >= 3.5 (fills rail when primary pool is thin).
 * Sort: rating DESC, then discover score as tiebreaker.
 *
 * Override semantics:
 *   include — adds a venue even if it doesn't meet the rating threshold.
 *   exclude — removes a high-rated venue from this rail.
 */
export function getHighlyRated(
  venues: ConsumerVenue[],
  overrides: RailOverride[] = []
): ConsumerVenue[] {
  const { excludedUuids, includedUuids } = splitOverrides(overrides);

  const eligible = venues.filter(
    (v) =>
      !excludedUuids.has(v.venueUuid) &&
      isNearMarket(v.latitude, v.longitude) &&
      isDiscoverEligible(v) &&
      v.googleRating !== null
  );

  const primary = dedupeById(
    eligible.filter((v) => v.googleRating! >= HIGH_RATING_THRESHOLD)
  );

  const primaryUuids = new Set(primary.map((v) => v.venueUuid));

  const fallback = dedupeById(
    eligible.filter(
      (v) =>
        !primaryUuids.has(v.venueUuid) &&
        v.googleRating! >= RATED_THRESHOLD
    )
  );

  const systemUuids = new Set([...primaryUuids, ...fallback.map((v) => v.venueUuid)]);
  const includePool = buildIncludePool(venues, includedUuids, excludedUuids, systemUuids);

  return dedupeById([...includePool, ...primary, ...fallback]).sort((a, b) => {
    const rA = a.googleRating ?? 0;
    const rB = b.googleRating ?? 0;
    if (rB !== rA) return rB - rA;
    return scoreVenueForDiscover(b) - scoreVenueForDiscover(a);
  });
}

/**
 * Featured Events — events flattened from local, discover-eligible venues.
 *
 * Override semantics (V1):
 *   exclude — removes a venue's events from this rail even if the venue is
 *             otherwise discover-eligible and local.
 *   include — stored but has no additional algorithmic effect in V1, since all
 *             eligible local venues with events already appear automatically.
 *             Meaningful once a minimum-quality gate is added in Phase 3B.
 *
 * Note: global venues.exclude_from_discover still takes precedence over any
 * rail-level include override.
 */
export function getFeaturedEvents(
  venues: ConsumerVenue[],
  overrides: RailOverride[] = []
): DiscoverEventItem[] {
  const { excludedUuids } = splitOverrides(overrides);

  return venues
    .filter(
      (v) =>
        !excludedUuids.has(v.venueUuid) &&
        isNearMarket(v.latitude, v.longitude) &&
        isDiscoverEligible(v)
    )
    .sort((a, b) => scoreVenueForDiscover(b) - scoreVenueForDiscover(a))
    .flatMap((v) =>
      v.events.map((e) => ({
        id: e.id,
        title: e.title,
        venueName: v.name,
        venueSlug: v.id,
        nextOccurrenceLabel: e.nextOccurrenceLabel,
      }))
    );
}

/**
 * Tagged venues — local, discover-eligible venues matching a specific tag.
 * Used by browse category collections.
 */
export function getTaggedVenues(
  venues: ConsumerVenue[],
  tag: string
): ConsumerVenue[] {
  return venues
    .filter(
      (v) =>
        isDiscoverEligible(v) &&
        isNearMarket(v.latitude, v.longitude) &&
        (v.seededTags.includes(tag) || v.searchTags.includes(tag))
    )
    .sort(
      (a, b) => scoreVenueForDiscover(b, "tagged") - scoreVenueForDiscover(a, "tagged")
    );
}

// ─── Browse category threshold ────────────────────────────────────────────────

export function filterBrowseCategories<T extends { tag: string }>(
  venues: ConsumerVenue[],
  categories: T[],
  minLocalCount = BROWSE_MIN_LOCAL
): T[] {
  return categories.filter(
    (c) =>
      venues.filter(
        (v) =>
          isDiscoverEligible(v) &&
          isNearMarket(v.latitude, v.longitude) &&
          (v.seededTags.includes(c.tag) || v.searchTags.includes(c.tag))
      ).length >= minLocalCount
  );
}

// ─── Rail dispatch helper ─────────────────────────────────────────────────────

/**
 * Dispatches to the correct engine function by rail key.
 * Used by the Control Panel Discover Management page to preview each rail.
 * Returns ConsumerVenue[] for venue rails; Featured Events is handled separately.
 */
export function getRailVenuesByKey(
  railKey: string,
  venues: ConsumerVenue[],
  overrides: RailOverride[] = []
): ConsumerVenue[] {
  switch (railKey) {
    case "spotlight":       return getSpotlightVenues(venues, overrides);
    case "patio-picks":     return getPatioPicks(venues, overrides);
    case "featured-nearby": return getFeaturedNearby(venues, overrides);
    case "new-this-week":   return getNewThisWeek(venues, overrides);
    case "highly-rated":    return getHighlyRated(venues, overrides);
    default:                return [];
  }
}
