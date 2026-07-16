import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { isNearMarket, scoreVenueForDiscover } from "@/lib/discover/discoverEngine";
import { toMarketConfig, type Market } from "@/lib/markets";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";

/**
 * Homepage venue-suggestion search — powers the autocomplete dropdown under
 * the Hero's search pill. Reuses the same data source and geography gate as
 * the rest of the public website (getPublishedVenuesForConsumer +
 * isNearMarket, per website-happy-hours/page.tsx and the Explore page)
 * rather than a new query shape, and reuses the Discover Engine's own
 * scoreVenueForDiscover() as the relevance tie-breaker instead of inventing
 * a second ranking system.
 *
 * Not a full-text search: match is a case-insensitive substring test against
 * name, city, and area (neighbourhood). `area` is always "" today — see its
 * definition in venues.ts — so neighbourhood matching is wired up but has no
 * data to match against until neighbourhoods are attached to venues.
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

type MatchTier = 0 | 1 | 2 | 3 | 4;

/**
 * Lower tier = better match. Name matches outrank city matches, which
 * outrank neighbourhood matches — mirrors the tiering approach in
 * searchVenueCandidates() (Content Engine attachment search), adapted from
 * geography proximity to text-match strength since this search has no
 * per-request geography tiers of its own (its one gate is the market itself).
 */
function matchTier(query: string, name: string, city: string, area: string): MatchTier | null {
  const n = name.toLowerCase();
  const c = city.toLowerCase();
  const a = area.toLowerCase();

  if (n.startsWith(query)) return 0;
  if (n.includes(query)) return 1;
  if (c.startsWith(query)) return 2;
  if (c.includes(query)) return 3;
  if (a && a.includes(query)) return 4;
  return null;
}

/**
 * Searches published, in-market venues by name, city, or neighbourhood.
 * `market` scopes results with the same isNearMarket radius gate used
 * throughout the public site — venues outside the given market are never
 * returned, regardless of how well their name matches.
 */
export async function searchVenueSuggestions(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<VenueSuggestion[]> {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const marketConfig = toMarketConfig(market);
  const allVenues = await getPublishedVenuesForConsumer();

  const ranked = allVenues
    .filter((v) => isNearMarket(v.latitude, v.longitude, marketConfig))
    .map((v) => ({ venue: v, tier: matchTier(query, v.name, v.city, v.area) }))
    .filter((r): r is { venue: (typeof allVenues)[number]; tier: MatchTier } => r.tier !== null)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const scoreDiff = scoreVenueForDiscover(b.venue) - scoreVenueForDiscover(a.venue);
      if (scoreDiff !== 0) return scoreDiff;
      return a.venue.name.localeCompare(b.venue.name);
    })
    .slice(0, limit);

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
