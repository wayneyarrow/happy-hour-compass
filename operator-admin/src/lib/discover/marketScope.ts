import { isNearMarket } from "@/lib/discover/discoverEngine";
import { getMarketById, toMarketConfig, type Market } from "@/lib/markets";

/**
 * Splits published venues around the visitor's selected market for the
 * public website's browse + search surfaces.
 *
 *   - inMarket:    the selected market's venues — the same isNearMarket()
 *                  radius gate every website browse surface already uses
 *                  (venues without coordinates count as local, as before).
 *                  General browsing only ever shows these.
 *   - otherMarket: venues outside that radius that belong to another
 *                  *active* market (MARKETS status "active"), so they have a
 *                  live public page. Reachable only by searching for them by
 *                  name or by panning the map to them — never mixed into the
 *                  selected market's browsing. Venues in coming-soon markets,
 *                  or with no assigned market, are never included.
 */
export function partitionVenuesByMarket<
  T extends { latitude: number | null; longitude: number | null; marketSlug: string | null }
>(venues: T[], market: Market): { inMarket: T[]; otherMarket: T[] } {
  const config = toMarketConfig(market);
  const inMarket: T[] = [];
  const otherMarket: T[] = [];
  for (const v of venues) {
    if (isNearMarket(v.latitude, v.longitude, config)) {
      inMarket.push(v);
    } else if (v.marketSlug && v.marketSlug !== market.id && getMarketById(v.marketSlug)?.status === "active") {
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
