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
  if (!rawQuery.trim()) return [];

  const marketConfig = toMarketConfig(market);
  const allVenues = await getPublishedVenuesForConsumer();
  const inMarket = allVenues.filter((v) =>
    isNearMarket(v.latitude, v.longitude, marketConfig)
  );

  const ranked = rankVenuesByTextSearch(inMarket, rawQuery).slice(0, limit);

  // Venues with no assigned market/city yet (see buildVenuePublicPath) have
  // no canonical URL and are omitted rather than linked with a fabricated href.
  return ranked.flatMap(({ venue }) => {
    const href = buildVenuePublicPath({
      marketSlug: venue.marketSlug,
      citySlug: venue.citySlug,
      slug: venue.id,
    });
    if (!href) return [];
    return [{
      id: venue.id,
      name: venue.name,
      city: venue.city,
      area: venue.area,
      address: venue.address,
      href,
    }];
  });
}
