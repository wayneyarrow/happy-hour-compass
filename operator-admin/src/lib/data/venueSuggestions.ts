import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { rankVenuesByTextSearch } from "@/lib/data/venueSearch";
import type { Market } from "@/lib/markets";
import { partitionVenuesByMarket } from "@/lib/discover/marketScope";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";

/**
 * Homepage venue-suggestion search — powers the autocomplete dropdown under
 * the Hero's search pill. Reuses the same data source and geography gate as
 * the Happy Hours listing (getPublishedVenuesForConsumer +
 * partitionVenuesByMarket's assigned-market scoping, per
 * website-happy-hours/page.tsx) rather than a new query shape.
 *
 * All text matching and ranking is delegated to rankVenuesByTextSearch()
 * (src/lib/data/venueSearch.ts) — the shared, authoritative consumer venue
 * text-search implementation — rather than reimplementing match logic here.
 * This module only adds what's specific to the suggestion dropdown: the
 * market geography gate and building each result's canonical href.
 *
 * Market scope: only venues assigned to the selected market
 * (venues.market_id) are searched — scoped before ranking and the display
 * cap. Venues in other markets are never suggested, even for an exact name
 * match; the visitor switches market to find them. (Until Nov 2026 other
 * markets' name matches were appended here.)
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
};

const DEFAULT_SUGGESTION_LIMIT = 8;

/**
 * Searches published venues in `market` (by assigned market, exactly as the
 * Happy Hours listing does — partitionVenuesByMarket) via the shared venue
 * text-search helper.
 */
export async function searchVenueSuggestions(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<VenueSuggestion[]> {
  return (await searchVenueSuggestionsWithTotal(market, rawQuery, limit)).suggestions;
}

/**
 * Same search, plus `total`: every in-market venue the query matched (with
 * a canonical URL), before the `limit` display cap — website_search_events
 * records this full total for the hero (migration 110).
 */
export async function searchVenueSuggestionsWithTotal(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<{ suggestions: VenueSuggestion[]; total: number }> {
  if (!rawQuery.trim()) return { suggestions: [], total: 0 };

  const allVenues = await getPublishedVenuesForConsumer();
  const { inMarket } = partitionVenuesByMarket(allVenues, market);

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
    }];
  };

  const ranked = rankVenuesByTextSearch(inMarket, rawQuery);
  // Venues with no assigned market/city yet (see buildVenuePublicPath) have
  // no canonical URL and are omitted rather than linked with a fabricated href.
  // Display selection is unchanged: cap first, then drop unlinkable venues.
  const suggestions = ranked.slice(0, limit).flatMap(toSuggestion);
  const total = ranked.filter((r) => toSuggestion(r).length > 0).length;
  return { suggestions, total };
}
