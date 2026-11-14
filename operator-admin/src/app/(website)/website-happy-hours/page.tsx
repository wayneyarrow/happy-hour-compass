import type { Metadata } from "next";
import { getWebsiteActiveMarket } from "@/lib/activeMarket";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { partitionVenuesByMarket, venueLocationLabel } from "@/lib/discover/marketScope";
import type { ConsumerVenue } from "@/lib/data/venues";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { getVenueImageSrc } from "@/lib/venuePlaceholderImage";
import { buildPageMetadata } from "@/lib/seo/metadata";
import {
  HappyHoursSearchClient,
  type WebsiteVenueCard,
} from "./HappyHoursSearchClient";
import { resolveInitialDayFilter, resolveInitialTimeRange } from "./searchFilters";
import { buildHhSchedule } from "@/lib/happyHourStatus";

// A primary consumer discovery/search page (linked from the homepage,
// collections, and 404/coming-soon fallbacks — see homepageDiscoveryModes.ts
// and CollectionTypeContent.tsx) — indexable in production like any other
// public page, via the same environment-aware buildPageMetadata()/
// shouldNoIndex() every other public route uses. Previously hardcoded
// robots: { index: false } unconditionally (in every environment, including
// production), which is what Google Search Console flagged as the cause of
// this route being unindexable in production.
export const metadata: Metadata = buildPageMetadata({
  title: "Happy Hours",
  description:
    "Find happy hour deals near you — real-time drink and food specials at local bars and restaurants, filterable by day and time.",
  path: "/website-happy-hours",
});

// force-dynamic ensures the market cookie and venue data are always fresh.
export const dynamic = "force-dynamic";

export default async function HappyHoursSearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    day?: string | string[];
    now?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}) {
  const { market } = await getWebsiteActiveMarket();
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
  // other active markets come along separately — reachable only by a name
  // search or by panning the map there, never mixed into this market's
  // browsing.
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
