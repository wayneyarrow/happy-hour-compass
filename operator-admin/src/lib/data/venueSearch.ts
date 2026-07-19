import { scoreVenueForDiscover } from "@/lib/discover/discoverEngine";
import type { ConsumerVenue } from "@/lib/data/venues";

/**
 * Shared consumer venue text-search matcher — the authoritative implementation
 * for matching a free-text query against a venue's organic data. Every field
 * checked here is already selected by getPublishedVenuesForConsumer(), so
 * callers never need an additional DB query to use it.
 *
 * Substring matching only (case-insensitive) — no fuzzy matching, typo
 * correction, or AI search. See docs/website/CONSUMER_EXPERIENCE_PRD.md
 * ("Decision: Search Experience", Status: Locked).
 *
 * Tag matching unions seededTags (free, platform-generated) and searchTags
 * (paid, operator-selected) — Premium Search Tags add *additional* searchable
 * terms on top of organic discovery, never gate it. See
 * docs/website/WEBSITE_PRODUCT_PLAYBOOK.md ("Search Tags Caution").
 *
 * Intentionally excluded: event content, venue descriptions, and
 * neighbourhood/area (unpopulated for every market today) — see the search
 * architecture audit this implements.
 */

/** Lower tier = stronger/better match. */
export type VenueSearchTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type VenueSearchMatch = {
  venue: ConsumerVenue;
  tier: VenueSearchTier;
};

function includesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

function anyIncludesQuery(values: string[], query: string): boolean {
  return values.some((v) => includesQuery(v, query));
}

/**
 * Returns the best (lowest) match tier for `rawQuery` against `venue`, or
 * null if nothing matches.
 *
 * Tier order:
 *   0. Venue name starts with query
 *   1. Venue name contains query
 *   2. City
 *   3. Establishment type
 *   4. Seeded tags / Premium search tags (unioned — see module doc)
 *   5. Happy hour food specials
 *   6. Happy hour drink specials
 */
export function matchVenueSearchTier(
  rawQuery: string,
  venue: ConsumerVenue
): VenueSearchTier | null {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return null;

  const name = venue.name.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;

  if (includesQuery(venue.city, query)) return 2;
  if (includesQuery(venue.establishmentType, query)) return 3;

  if (
    anyIncludesQuery(venue.seededTags, query) ||
    anyIncludesQuery(venue.searchTags, query)
  )
    return 4;

  if (anyIncludesQuery(venue.specialsFood, query)) return 5;
  if (anyIncludesQuery(venue.specialsDrinks, query)) return 6;

  return null;
}

/**
 * Matches and ranks `venues` against `rawQuery`. Ranking: match tier first
 * (see matchVenueSearchTier), then scoreVenueForDiscover() — the existing
 * Discover Engine quality/plan score — as the tie-breaker, then alphabetical.
 * Venues with no match are omitted.
 */
export function rankVenuesByTextSearch(
  venues: ConsumerVenue[],
  rawQuery: string
): VenueSearchMatch[] {
  if (!rawQuery.trim()) return [];

  return venues
    .map((venue) => ({ venue, tier: matchVenueSearchTier(rawQuery, venue) }))
    .filter((r): r is VenueSearchMatch => r.tier !== null)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const scoreDiff = scoreVenueForDiscover(b.venue) - scoreVenueForDiscover(a.venue);
      if (scoreDiff !== 0) return scoreDiff;
      return a.venue.name.localeCompare(b.venue.name);
    });
}
