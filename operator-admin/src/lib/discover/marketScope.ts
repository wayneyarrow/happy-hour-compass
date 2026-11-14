import { getMarketById, type Market } from "@/lib/markets";

/**
 * Splits published venues around the visitor's selected market for the
 * public website's browse + search surfaces, by each venue's ASSIGNED market
 * (venues.market_id → marketSlug) — never by distance from the market centre.
 *
 *   - inMarket:    venues assigned to the selected market, wherever they are
 *                  — so an assigned venue beyond the old radius (Borrego
 *                  Springs, Campo, north Fallbrook in Greater San Diego) is
 *                  still part of the market. General browsing only ever
 *                  shows these.
 *   - otherMarket: venues assigned to another *active* market (MARKETS
 *                  status "active"), so they have a live public page.
 *                  Reachable only by searching for them by name or by panning
 *                  the map to them — never mixed into the selected market's
 *                  browsing. Venues in coming-soon markets are never included.
 *
 * Venues with no assigned market are in neither list: they have no canonical
 * public URL (every caller already drops them for that reason), and a
 * radius test would wrongly count one with missing coordinates as local to
 * every market. Previously the in-market rule was the isNearMarket() radius
 * gate, which also admitted coordinate-less venues everywhere — e.g. a
 * San Diego venue without lat/lng would have appeared in Central Okanagan.
 */
export function partitionVenuesByMarket<T extends { marketSlug: string | null }>(
  venues: T[],
  market: Market
): { inMarket: T[]; otherMarket: T[] } {
  const inMarket: T[] = [];
  const otherMarket: T[] = [];
  for (const v of venues) {
    if (!v.marketSlug) continue;
    if (v.marketSlug === market.id) {
      inMarket.push(v);
    } else if (getMarketById(v.marketSlug)?.status === "active") {
      otherMarket.push(v);
    }
  }
  return { inMarket, otherMarket };
}

/** "Solana Beach, CA" for a venue in another market (city text + its market's province/state). */
export function venueLocationLabel(venue: { city: string; marketSlug: string | null }): string {
  const regionCode = venue.marketSlug ? getMarketById(venue.marketSlug)?.regionCode : undefined;
  const city = venue.city.trim();
  if (!city) return regionCode ?? "";
  return regionCode ? `${city}, ${regionCode}` : city;
}

/**
 * True for a text-search match tier that targets a specific venue by name
 * (matchVenueSearchTier tiers 0–1). Only these reach across markets — a
 * topical search ("wings", "patio") stays in the selected market.
 */
export function isVenueNameMatchTier(tier: number | null): boolean {
  return tier === 0 || tier === 1;
}
