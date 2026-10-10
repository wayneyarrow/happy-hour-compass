import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { isNearMarket } from "@/lib/discover/discoverEngine";
import { rankVenuesByTextSearch } from "@/lib/data/venueSearch";
import { toMarketConfig, type Market } from "@/lib/markets";
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
 * Searches published, in-market venues via the shared venue text-search
 * helper. `market` scopes results with the same isNearMarket radius gate
 * used throughout the public site — venues outside the given market are
 * never returned, regardless of how well their name matches.
 */
export async function searchVenueSuggestions(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<VenueSuggestion[]> {
  return (await searchVenueSuggestionsWithTotal(market, rawQuery, limit)).suggestions;
}

/**
 * Same search, plus `total`: every in-market venue the query matched (with a
 * canonical URL), before the `limit` display cap — website_search_events
 * records this full total for the hero (migration 110).
 */
export async function searchVenueSuggestionsWithTotal(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<{ suggestions: VenueSuggestion[]; total: number }> {
  if (!rawQuery.trim()) return { suggestions: [], total: 0 };

  const marketConfig = toMarketConfig(market);
  const allVenues = await getPublishedVenuesForConsumer();
  const inMarket = allVenues.filter((v) =>
    isNearMarket(v.latitude, v.longitude, marketConfig)
  );

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
