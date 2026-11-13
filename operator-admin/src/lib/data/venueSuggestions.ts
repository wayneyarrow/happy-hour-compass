import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { rankVenuesByTextSearch } from "@/lib/data/venueSearch";
import type { Market } from "@/lib/markets";
import {
  isVenueNameMatchTier,
  partitionVenuesByMarket,
  venueLocationLabel,
} from "@/lib/discover/marketScope";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";

/**
 * Homepage venue-suggestion search — powers the autocomplete dropdown under
 * the Hero's search pill. Reuses the same data source and geography gate as
 * the rest of the public website (getPublishedVenuesForConsumer +
 * isNearMarket, per website-happy-hours/page.tsx and the Explore page)
 * rather than a new query shape.
 *
 * All text matching and ranking is delegated to rankVenuesByTextSearch()
 * (src/lib/data/venueSearch.ts) — the shared, authoritative consumer venue
 * text-search implementation — rather than reimplementing match logic here.
 * This module only adds what's specific to the suggestion dropdown: the
 * market geography gate and building each result's canonical href.
 *
 * Cross-market venue lookup: after every in-market match, venues in other
 * active markets are included when — and only when — the query matches
 * their *name* (partitionVenuesByMarket / isVenueNameMatchTier), labelled
 * with `locationLabel` ("Solana Beach, CA"). Searching "Encore Sushi" from
 * Central Okanagan finds it; a topical search stays in the selected market.
 */

export type VenueSuggestion = {
  id: string;
  /** The venue's database UUID (`id` is the public slug) — used by discovery tracking. */
  venueUuid: string;
  name: string;
  city: string;
  area: string;
  address: string;
  href: string;
  /** "Solana Beach, CA" — only for a venue outside the selected market. */
  locationLabel?: string;
};

const DEFAULT_SUGGESTION_LIMIT = 8;

/**
 * Searches published venues via the shared venue text-search helper.
 * `market` scopes results with the same isNearMarket radius gate used
 * throughout the public site; venues in other active markets are appended
 * only for name matches (see the module comment).
 */
export async function searchVenueSuggestions(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<VenueSuggestion[]> {
  return (await searchVenueSuggestionsWithTotal(market, rawQuery, limit)).suggestions;
}

/**
 * Same search, plus `total`: every venue the query matched (with a
 * canonical URL — in-market, plus other-market name matches), before the
 * `limit` display cap — website_search_events records this full total for
 * the hero (migration 110).
 */
export async function searchVenueSuggestionsWithTotal(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<{ suggestions: VenueSuggestion[]; total: number }> {
  if (!rawQuery.trim()) return { suggestions: [], total: 0 };

  const allVenues = await getPublishedVenuesForConsumer();
  const { inMarket, otherMarket } = partitionVenuesByMarket(allVenues, market);

  const toSuggestion = ({ venue }: ReturnType<typeof rankVenuesByTextSearch>[number]): VenueSuggestion[] => {
    const href = buildVenuePublicPath({
      marketSlug: venue.marketSlug,
      citySlug: venue.citySlug,
      slug: venue.id,
    });
    if (!href) return [];
    return [{
      id: venue.id,
      venueUuid: venue.venueUuid,
      name: venue.name,
      city: venue.city,
      area: venue.area,
      address: venue.address,
      href,
      ...(otherMarketIds.has(venue.venueUuid) ? { locationLabel: venueLocationLabel(venue) } : {}),
    }];
  };

  // In-market matches first (unchanged ranking), then other-market venues
  // whose name matches.
  const otherMarketIds = new Set(otherMarket.map((v) => v.venueUuid));
  const ranked = [
    ...rankVenuesByTextSearch(inMarket, rawQuery),
    ...rankVenuesByTextSearch(otherMarket, rawQuery).filter((r) => isVenueNameMatchTier(r.tier)),
  ];
  // Venues with no assigned market/city yet (see buildVenuePublicPath) have
  // no canonical URL and are omitted rather than linked with a fabricated href.
  // Display selection is unchanged: cap first, then drop unlinkable venues.
  const suggestions = ranked.slice(0, limit).flatMap(toSuggestion);
  const total = ranked.filter((r) => toSuggestion(r).length > 0).length;
  return { suggestions, total };
}
