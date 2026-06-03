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
 * Each rail function accepts a pre-fetched ConsumerVenue[] and returns a
 * filtered / sorted set.  Pages call getPublishedVenuesForConsumer() once,
 * then pass the result to whichever rail functions they need.
 *
 * Phase 2B pipeline (current):
 *   Geography → Eligibility (exclude_from_discover) → Weighting → Results
 *
 * Weighting factors (additive, scored via scoreVenueForDiscover):
 *   • internal_boost   (0–100 → 0.0–0.50 additive)   — internal curation lift
 *   • operator plan    (free=0, pro=+0.05, premium/enterprise=+0.15)
 *   • Google rating    (0–5 → 0.0–0.30 additive)      — quality signal
 *
 * Spotlight fallback behavior:
 *   Primary pool = spotlight_eligible venues.
 *   If primary.length < RAIL_MAX, remaining slots are filled with isVerified
 *   venues (the Phase 2A behavior) sorted by score.  This ensures the rail
 *   never disappears during the rollout period when few venues carry
 *   spotlight_eligible = true.
 *
 * Phase 2C will add:
 *   Founder / internal Controls UI in /control-panel
 *   Dynamic MarketConfig record from database
 */

import type { ConsumerVenue } from "@/lib/data/venues";

// ─── Market config (V1 — Central Okanagan) ────────────────────────────────────
// Single source of truth for all geo-dependent filtering.
// Phase 2C: replace with a dynamic MarketConfig record from the database.

export const MARKET_CONFIG = {
  lat: 49.888,      // Kelowna, BC
  lng: -119.496,
  radiusKm: 50,
} as const;

/** Human-readable market label rendered in the homepage location chip. */
export const MARKET_LABEL = "Central Okanagan";

// ─── Rail display limits ──────────────────────────────────────────────────────

/** Maximum venues/events shown in a homepage rail. */
export const RAIL_MAX = 12;

/** Pool size passed to the client for client-side geo-sorting (Featured Nearby). */
export const NEARBY_POOL = 30;

// ─── Browse threshold ─────────────────────────────────────────────────────────

/** Minimum local-venue count for a browse category to appear on the homepage. */
export const BROWSE_MIN_LOCAL = 4;

// ─── Internal constants ────────────────────────────────────────────────────────

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30-day window

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Flattened event shape returned by getFeaturedEvents().
 * Re-exported as HomeEventItem by EventRailCard for UI components.
 */
export type DiscoverEventItem = {
  id: string;
  title: string;
  venueName: string;
  venueSlug: string;
  nextOccurrenceLabel: string;
};

/** Rail context passed to scoreVenueForDiscover for future context-aware tuning. */
export type DiscoverContext =
  | "spotlight"
  | "patio"
  | "nearby"
  | "new"
  | "tagged";

// ─── Geo utilities ────────────────────────────────────────────────────────────

/** Haversine great-circle distance in kilometres. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
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

/**
 * Returns true when a venue is eligible to appear in Consumer Home discovery
 * rails and browse collections.
 *
 * A venue is ineligible when its internal exclude_from_discover flag is set.
 * Published/active status is enforced upstream by the data layer (is_published
 * filter in getPublishedVenuesForConsumer), so this helper only checks the
 * discover-specific suppression flag.
 */
export function isDiscoverEligible(venue: ConsumerVenue): boolean {
  return !venue.excludeFromDiscover;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/** Returns a plan-based additive score contribution. */
function planLift(plan: ConsumerVenue["operatorPlan"]): number {
  switch (plan) {
    case "premium":
    case "enterprise":
      return 0.15;
    case "pro":
      return 0.05;
    default:
      return 0;
  }
}

/**
 * Scores a venue for discover ordering.  Higher = better placement.
 *
 * Scoring is additive on top of a base of 1.0:
 *   base          1.00  (every eligible venue)
 *   internal_boost  0–0.50  (100-point field scaled to 0.5 max)
 *   operator plan   0–0.15  (free=0, pro=0.05, premium/enterprise=0.15)
 *   google rating   0–0.30  (5-star scale → 0.3 max)
 *
 * Maximum possible score: 1.95.  Minimum: 1.0 (no boost, free plan, no rating).
 *
 * Invariants:
 *   • internal_boost cannot raise a score above 1.5 alone — quality signals matter too.
 *   • Plan lift is additive and modest — free venues still appear when relevant.
 *   • A venue with no data (boost=0, free plan, no rating) scores 1.0 and remains discoverable.
 *
 * The _context parameter is reserved for future context-aware tuning
 * (e.g. distance weighting for "nearby", recency weighting for "new").
 */
export function scoreVenueForDiscover(
  venue: ConsumerVenue,
  _context?: DiscoverContext
): number {
  let score = 1.0;

  // Internal boost: 0–100 → 0.0–0.50 additive
  score += (venue.internalBoost / 100) * 0.5;

  // Plan-based lift
  score += planLift(venue.operatorPlan);

  // Google rating: 0–5 → 0.0–0.30 additive
  if (venue.googleRating !== null) {
    score += (venue.googleRating / 5) * 0.3;
  }

  return score;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Removes duplicate venues by id, preserving the first occurrence.
 * Applied defensively to any rail where the source data could contain a venue
 * more than once (e.g. a venue whose seededTags and searchTags both carry the
 * same tag, or a data-import artefact that duplicates a row).
 */
function dedupeById(venues: ConsumerVenue[]): ConsumerVenue[] {
  const seen = new Set<string>();
  return venues.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

// ─── Rail functions ───────────────────────────────────────────────────────────
// All functions accept the full published-venue array and return a filtered set.
// Rail pages apply RAIL_MAX / NEARBY_POOL slices; collection pages use the full
// set so users see all matching venues, not just the rail preview.
//
// Pipeline order (enforced in every rail):
//   1. Geography   — isNearMarket
//   2. Eligibility — isDiscoverEligible
//   3. Rail filter — tag / flag / recency check
//   4. Dedupe      — dedupeById
//   5. Weighting   — scoreVenueForDiscover sort

/**
 * Spotlight Venues — local, discover-eligible venues in the primary
 * spotlight_eligible pool, scored by internal boost, plan, and quality.
 *
 * Fallback behavior:
 *   When the spotlight_eligible pool has fewer than RAIL_MAX venues, remaining
 *   slots are filled with isVerified venues (Phase 2A behavior).  This ensures
 *   the rail never disappears during rollout before spotlight_eligible has been
 *   applied to enough venues.
 *
 *   Primary pool:  local + discover-eligible + spotlight_eligible, scored.
 *   Fallback pool: local + discover-eligible + isVerified, not in primary, scored.
 *
 * Once the spotlight_eligible pool consistently reaches RAIL_MAX the fallback
 * slots will naturally be pushed out.
 */
export function getSpotlightVenues(venues: ConsumerVenue[]): ConsumerVenue[] {
  // Geography + eligibility gate applied once; both pools draw from this base.
  const eligible = venues.filter(
    (v) => isNearMarket(v.latitude, v.longitude) && isDiscoverEligible(v)
  );

  const primary = dedupeById(eligible.filter((v) => v.spotlightEligible)).sort(
    (a, b) =>
      scoreVenueForDiscover(b, "spotlight") -
      scoreVenueForDiscover(a, "spotlight")
  );

  if (primary.length >= RAIL_MAX) return primary;

  // Fallback: supplement with local verified venues not already in the primary pool.
  const primaryIds = new Set(primary.map((v) => v.id));
  const fallback = dedupeById(
    eligible.filter((v) => v.isVerified && !primaryIds.has(v.id))
  ).sort(
    (a, b) =>
      scoreVenueForDiscover(b, "spotlight") -
      scoreVenueForDiscover(a, "spotlight")
  );

  return [...primary, ...fallback];
}

/**
 * Patio Picks — local, discover-eligible venues tagged "Patio" via seeded or
 * operator-selected tags, deduped and sorted by discover score.
 */
export function getPatioPicks(venues: ConsumerVenue[]): ConsumerVenue[] {
  return dedupeById(
    venues.filter(
      (v) =>
        isNearMarket(v.latitude, v.longitude) &&
        isDiscoverEligible(v) &&
        (v.seededTags.includes("Patio") || v.searchTags.includes("Patio"))
    )
  ).sort(
    (a, b) =>
      scoreVenueForDiscover(b, "patio") - scoreVenueForDiscover(a, "patio")
  );
}

/**
 * Featured Nearby — local, discover-eligible venues within the market radius.
 * The full pool is passed to the client, which geo-sorts to the nearest N
 * venues after geolocation permission is granted.
 *
 * Score ordering here only affects pool membership (which venues make the
 * NEARBY_POOL cut when >NEARBY_POOL local venues exist).  The client distance
 * sort always overrides server ordering, so distance remains the primary signal.
 */
export function getFeaturedNearby(venues: ConsumerVenue[]): ConsumerVenue[] {
  return venues
    .filter((v) => isNearMarket(v.latitude, v.longitude) && isDiscoverEligible(v))
    .sort(
      (a, b) =>
        scoreVenueForDiscover(b, "nearby") -
        scoreVenueForDiscover(a, "nearby")
    );
}

/**
 * New This Week — local, discover-eligible venues created within the last 30 days.
 * Primary sort: recency (newest first).
 * Secondary sort: discover score (within same creation date).
 *
 * isNearMarket applied here for pipeline consistency — prevents an out-of-market
 * venue added recently from surfacing on the Central Okanagan home page.
 */
export function getNewThisWeek(venues: ConsumerVenue[]): ConsumerVenue[] {
  const cutoff = new Date(Date.now() - NEW_WINDOW_MS).toISOString();
  return venues
    .filter(
      (v) =>
        isNearMarket(v.latitude, v.longitude) &&
        isDiscoverEligible(v) &&
        v.createdAt >= cutoff
    )
    .sort((a, b) => {
      const dateDiff = b.createdAt.localeCompare(a.createdAt);
      if (dateDiff !== 0) return dateDiff;
      return scoreVenueForDiscover(b, "new") - scoreVenueForDiscover(a, "new");
    });
}

/**
 * Featured Events — events flattened from all venues whose parent venue is
 * discover-eligible.  Events from an excluded venue do not appear here.
 *
 * Light plan/boost weighting is applied at the venue level: events belonging
 * to higher-scoring venues appear earlier in the list.
 */
export function getFeaturedEvents(venues: ConsumerVenue[]): DiscoverEventItem[] {
  return venues
    .filter((v) => isDiscoverEligible(v))
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
 * Tagged venues — discover-eligible local venues (within market radius) that
 * carry a specific search tag or seeded tag.  Used by all browse category
 * collections (e.g. /home/collections/pizza, /home/collections/patio).
 *
 * Tag match and market cap take precedence; score orders within the eligible pool.
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
      (a, b) =>
        scoreVenueForDiscover(b, "tagged") -
        scoreVenueForDiscover(a, "tagged")
    );
}

// ─── Browse category threshold ────────────────────────────────────────────────

/**
 * Filters a category list to entries that have at least `minLocalCount` local
 * discover-eligible matching venues.  Generic over any object with a `tag`
 * string field — no dependency on the BrowseCategory type from the app layer.
 *
 * Default threshold: BROWSE_MIN_LOCAL (4 venues).
 */
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
