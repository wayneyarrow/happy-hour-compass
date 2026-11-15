import { getMarketById, type Market } from "@/lib/markets";
import { haversineKm } from "@/lib/geo";

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
 *                  Reachable only by panning the map to them while no search
 *                  query is active — never search results, and never mixed
 *                  into the selected market's browsing. Venues in coming-soon
 *                  markets are never included.
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
 * True when a record's assigned market (its venue's venues.market_id →
 * slug, or an explicit market assignment of its own) is `market`. The
 * single membership rule for website search: a record with no assigned
 * market belongs to no market and never matches — never "local to
 * everywhere", and never decided by distance from the market centre.
 */
export function isAssignedToMarket(marketSlug: string | null | undefined, market: Market): boolean {
  return !!marketSlug && marketSlug === market.id;
}

/**
 * How a website Daily Specials / Events loader decides market membership.
 *   - "assigned_market": the venue's assigned market (isAssignedToMarket).
 *     Required for every website SEARCH surface — the hero dropdown and the
 *     listing pages it hands off to ("See all") — so results never include
 *     another market's records.
 *   - "radius" (the loaders' default): the venue's distance from the market
 *     centre, coordinate-less venues included. The pre-existing rule, kept
 *     for the homepage rails/Collections callers until their own scope is
 *     decided; identical to "assigned_market" for today's data.
 */
export type WebsiteContentMarketScope = "assigned_market" | "radius";

/**
 * Whether one Daily Special / Event (described by its venue) belongs to
 * `market` under `scope` — the single per-record rule both website loaders
 * apply before any sorting, matching or limiting.
 *   - "assigned_market": isAssignedToMarket(marketSlug); coordinates ignored.
 *   - "radius": within market.radiusKm of the market centre; a venue with no
 *     real coordinates ((0, 0) counts as none) passes, as it always has.
 */
export function isInWebsiteContentMarket(
  venue: { marketSlug: string | null; lat: number | null; lng: number | null },
  market: Market,
  scope: WebsiteContentMarketScope
): boolean {
  if (scope === "assigned_market") return isAssignedToMarket(venue.marketSlug, market);
  const { lat, lng } = venue;
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return true;
  return haversineKm(market.center.lat, market.center.lng, lat, lng) <= market.radiusKm;
}

/**
 * The market a website search runs in, from a market id the page resolved
 * with getWebsiteActiveMarket(). Only active markets search; an unknown or
 * coming-soon id returns null, so callers return no results instead of
 * searching a market the visitor can't browse.
 */
export function resolveSearchMarket(marketId: string): Market | null {
  const market = getMarketById(marketId);
  return market?.status === "active" ? market : null;
}
