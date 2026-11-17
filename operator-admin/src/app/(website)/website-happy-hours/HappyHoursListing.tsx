import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { partitionVenuesByMarket, venueLocationLabel } from "@/lib/discover/marketScope";
import type { ConsumerVenue } from "@/lib/data/venues";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { getVenueImageSrc } from "@/lib/venuePlaceholderImage";
import type { Market } from "@/lib/markets";
import {
  HappyHoursSearchClient,
  type WebsiteVenueCard,
} from "./HappyHoursSearchClient";
import { resolveInitialDayFilter, resolveInitialTimeRange } from "./searchFilters";
import { buildHhSchedule } from "@/lib/happyHourStatus";

export type HappyHoursSearchParams = Promise<{
  q?: string | string[];
  day?: string | string[];
  now?: string | string[];
  from?: string | string[];
  to?: string | string[];
}>;

/**
 * The Happy Hours listing for one market, shared by the market's own URL
 * (/{market}/happy-hours — [market]/happy-hours/page.tsx) and the legacy
 * market-less /website-happy-hours (the visitor's saved market, else
 * country). The caller decides the market; everything here (results, map,
 * filters) uses only that market.
 */
export async function HappyHoursListing({ market, searchParams }: { market: Market; searchParams: HappyHoursSearchParams }) {
  const { q, day, now, from, to } = await searchParams;
  const initialQuery = typeof q === "string" ? q : "";
  // On Now takes precedence over a conflicting ?day= — see resolveInitialDayFilter.
  const initialOnNow = now === "1";
  const initialDay = resolveInitialDayFilter(typeof day === "string" ? day : undefined, initialOnNow);
  const { from: initialTimeFrom, to: initialTimeTo } = resolveInitialTimeRange(
    typeof from === "string" ? from : undefined,
    typeof to === "string" ? to : undefined
  );

  // Fetch all published venues then gate to the active market by each
  // venue's assigned market (partitionVenuesByMarket — not a radius, so an
  // assigned venue far from the market centre still belongs, and one with
  // no coordinates can't leak into another market). Published venues in the
  // other active markets come along separately — reachable only by panning
  // the map there with no search query active, never mixed into this
  // market's browsing or search results (see HappyHoursSearchClient).
  const allVenues = await getPublishedVenuesForConsumer();
  const { inMarket: venues, otherMarket } = partitionVenuesByMarket(allVenues, market);

  // Map ConsumerVenue → WebsiteVenueCard.
  // distanceKm starts null and is computed client-side once geolocation is granted.
  // latitude, longitude, and hhSchedule are passed through so the client
  // component can compute real distances and apply live filter logic.
  // Venues with no assigned market/city (nullable by design, see
  // ConsumerVenue.marketSlug/citySlug) have no canonical public URL yet and
  // are omitted rather than linked with a fabricated href.
  const toCard = (venue: ConsumerVenue, locationLabel?: string): WebsiteVenueCard[] => {
    const href = buildVenuePublicPath({
      marketSlug: venue.marketSlug,
      citySlug: venue.citySlug,
      slug: venue.id,
    });
    if (!href) return [];
    return [{
      id: venue.id,
      venueUuid: venue.venueUuid,
      href,
      name: venue.name,
      image: getVenueImageSrc(venue),
      isVerified: venue.isVerified,
      googleRating: venue.googleRating,
      distanceKm: null,
      establishmentType: venue.establishmentType,
      foodSpecial: venue.specialsFood[0] ?? undefined,
      drinkSpecial: venue.specialsDrinks[0] ?? undefined,
      // Client-side filter / distance data
      latitude: venue.latitude,
      longitude: venue.longitude,
      hhSchedule: buildHhSchedule(venue),
      // Client-side text search data (see matchVenueSearchTier) — already
      // loaded on `venue` by getPublishedVenuesForConsumer(), so forwarding
      // it here adds no additional query.
      city: venue.city,
      seededTags: venue.seededTags,
      searchTags: venue.searchTags,
      specialsFood: venue.specialsFood,
      specialsDrinks: venue.specialsDrinks,
      ...(locationLabel ? { locationLabel } : {}),
    }];
  };
  const cards = venues.flatMap((venue) => toCard(venue));
  const otherMarketCards = otherMarket.flatMap((venue) => toCard(venue, venueLocationLabel(venue)));

  return (
    <HappyHoursSearchClient
      cards={cards}
      otherMarketCards={otherMarketCards}
      market={market}
      enableSearch
      initialQuery={initialQuery}
      initialDay={initialDay}
      initialOnNow={initialOnNow}
      initialTimeFrom={initialTimeFrom}
      initialTimeTo={initialTimeTo}
    />
  );
}
