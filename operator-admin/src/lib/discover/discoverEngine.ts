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
 * Phase 2A pipeline (current):
 *   Geography → Eligibility → [neutral weighting] → Results
 *
 * Phase 2B will add:
 *   Boost factors (recency, completeness, Google rating, founder placement)
 *   Suppression flags (exclude_from_discover, plan-gated visibility)
 *   A configurable MarketConfig record replacing the V1 hardcoded constants
 */

import type { ConsumerVenue } from "@/lib/data/venues";

// ─── Market config (V1 — Central Okanagan) ────────────────────────────────────
// Single source of truth for all geo-dependent filtering.
// Previously duplicated in app/(consumer)/page.tsx and [collection]/page.tsx.
// Phase 2B: replace with a dynamic MarketConfig record from the database.

export const MARKET_CONFIG = {
  lat: 49.888,      // Kelowna, BC
  lng: -119.496,
  radiusKm: 50,
} as const;

/** Human-readable market label rendered in the homepage location chip. */
export const MARKET_LABEL = "Central Okanagan";

// ─── Rail display limits ──────────────────────────────────────────────────────
// Applied by callers after calling a rail function (slice to rail vs. full set).
// Collection pages skip the slice to show all matching venues.

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

// ─── Rail functions ───────────────────────────────────────────────────────────
// All functions accept the full published-venue array and return a filtered set.
// Rail pages apply RAIL_MAX / NEARBY_POOL slices; collection pages use the full
// set so users see all matching venues, not just the rail preview.

/**
 * Spotlight Venues — verified venues only.
 *
 * Phase 2A: isVerified flag (claim-approved or operator-submission-approved).
 * Phase 2B: add boost for completeness score, Google rating, recency.
 */
export function getSpotlightVenues(venues: ConsumerVenue[]): ConsumerVenue[] {
  return venues.filter((v) => v.isVerified);
}

/**
 * Patio Picks — venues tagged "Patio" via seeded or operator-selected tags.
 *
 * Phase 2A: tag match only (no market cap — patio tag is local by construction).
 * Phase 2B: consider applying isNearMarket once multi-market rollout begins.
 */
export function getPatioPicks(venues: ConsumerVenue[]): ConsumerVenue[] {
  return venues.filter(
    (v) => v.seededTags.includes("Patio") || v.searchTags.includes("Patio")
  );
}

/**
 * Featured Nearby — all venues within the market radius.
 * The full pool is passed to the client, which geo-sorts to the nearest N
 * after the user grants geolocation permission.
 *
 * Phase 2B: weight by completeness / rating within the geo pool.
 */
export function getFeaturedNearby(venues: ConsumerVenue[]): ConsumerVenue[] {
  return venues.filter((v) => isNearMarket(v.latitude, v.longitude));
}

/**
 * New This Week — venues created within the last 30 days, newest first.
 *
 * Phase 2B: extend window or make it configurable; add minimum-completeness gate.
 */
export function getNewThisWeek(venues: ConsumerVenue[]): ConsumerVenue[] {
  const cutoff = new Date(Date.now() - NEW_WINDOW_MS).toISOString();
  return [...venues]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((v) => v.createdAt >= cutoff);
}

/**
 * Featured Events — events flattened from all venues with venue context.
 * Rail pages slice to RAIL_MAX; the featured-events collection uses the full list.
 */
export function getFeaturedEvents(venues: ConsumerVenue[]): DiscoverEventItem[] {
  return venues.flatMap((v) =>
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
 * Tagged venues — local venues (within market radius) that carry a specific
 * search tag or seeded tag.  Used by all browse category collections
 * (e.g. /home/collections/pizza, /home/collections/patio).
 *
 * The market cap prevents out-of-market results from appearing in browse.
 */
export function getTaggedVenues(
  venues: ConsumerVenue[],
  tag: string
): ConsumerVenue[] {
  return venues.filter(
    (v) =>
      isNearMarket(v.latitude, v.longitude) &&
      (v.seededTags.includes(tag) || v.searchTags.includes(tag))
  );
}

// ─── Browse category threshold ────────────────────────────────────────────────

/**
 * Filters a category list to entries that have at least `minLocalCount` local
 * matching venues.  Generic over any object with a `tag` string field — no
 * dependency on the BrowseCategory type from the app layer.
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
          isNearMarket(v.latitude, v.longitude) &&
          (v.seededTags.includes(c.tag) || v.searchTags.includes(c.tag))
      ).length >= minLocalCount
  );
}
