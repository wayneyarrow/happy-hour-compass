/**
 * Public visibility rule for the legacy consumer-app venue route
 * (/venue/[id], reached by UUID or slug from the consumer app, Saved and
 * shared links).
 *
 * The route must show exactly what the rest of Happy Hour Compass shows
 * publicly. A venue is visible only when it is:
 *   1. published — getVenueWithEventsForConsumerById() already returns null
 *      for unpublished venues; and
 *   2. assigned to a live market — the same MARKETS-config check the
 *      website's canonical venue page ((website)/[market]/[city]/[slug],
 *      which renders MarketComingSoon otherwise) and sitemap.ts use:
 *      getMarketById(slug)?.status === "active".
 *
 * So a published venue in an unlaunched (coming-soon) market, or one with
 * no or an unknown market assignment, is a 404 here, the same as an
 * unpublished one. Before this rule the route checked is_published only,
 * which exposed full listings for markets that had not launched.
 */

import { getMarketById } from "@/lib/markets";
import { getVenueWithEventsForConsumerById } from "@/lib/data/venues";

/** True only for a venue whose assigned market is live on the public site. */
export function isVenueInLiveMarket(marketSlug: string | null | undefined): boolean {
  if (!marketSlug) return false;
  return getMarketById(marketSlug)?.status === "active";
}

type PublicVenue = NonNullable<Awaited<ReturnType<typeof getVenueWithEventsForConsumerById>>>;

/**
 * Loads a venue for the legacy route, or null when it must 404 (not found,
 * unpublished, or not in a live market). Both the page and its metadata
 * go through this, so a hidden venue never leaks its name in the title.
 */
export async function getPublicLegacyVenue(
  routeParam: string,
  load: (id: string) => Promise<PublicVenue | null> = getVenueWithEventsForConsumerById
): Promise<PublicVenue | null> {
  const venue = await load(routeParam);
  if (!venue || !isVenueInLiveMarket(venue.marketSlug)) return null;
  return venue;
}
