import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { isNearMarket } from "@/lib/discover/discoverEngine";
import { toMarketConfig } from "@/lib/markets";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import {
  HappyHoursSearchClient,
  type WebsiteVenueCard,
} from "./HappyHoursSearchClient";
import { resolveInitialDayFilter, resolveInitialTimeRange } from "./searchFilters";

export const metadata: Metadata = {
  title: "Happy Hours",
  robots: { index: false },
};

// force-dynamic ensures the market cookie and venue data are always fresh.
export const dynamic = "force-dynamic";

/**
 * Maps an establishment type string to a local fallback image path.
 * Mirrors getVenueImageSrc() from app/(consumer)/VenueList.tsx.
 * Used only when a venue has no uploaded images.
 */
function fallbackImage(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar")) return "/images/sports-bar-1.jpg";
  if (t.includes("brewery") || t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

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
  const { market } = await getActiveMarket();
  const marketConfig = toMarketConfig(market);
  const { q, day, now, from, to } = await searchParams;
  const initialQuery = typeof q === "string" ? q : "";
  // On Now takes precedence over a conflicting ?day= — see resolveInitialDayFilter.
  const initialOnNow = now === "1";
  const initialDay = resolveInitialDayFilter(typeof day === "string" ? day : undefined, initialOnNow);
  const { from: initialTimeFrom, to: initialTimeTo } = resolveInitialTimeRange(
    typeof from === "string" ? from : undefined,
    typeof to === "string" ? to : undefined
  );

  // Fetch all published venues then gate to the active market.
  // isNearMarket() is the canonical geo filter used by the Discover Engine;
  // venues without coordinates are included permissively (assumed local).
  const allVenues = await getPublishedVenuesForConsumer();
  const venues = allVenues.filter((v) =>
    isNearMarket(v.latitude, v.longitude, marketConfig)
  );

  // Map ConsumerVenue → WebsiteVenueCard.
  // distanceKm starts null and is computed client-side once geolocation is granted.
  // latitude, longitude, and happyHourWeekly are passed through so the client
  // component can compute real distances and apply live filter logic.
  // Venues with no assigned market/city (nullable by design, see
  // ConsumerVenue.marketSlug/citySlug) have no canonical public URL yet and
  // are omitted rather than linked with a fabricated href.
  const cards: WebsiteVenueCard[] = venues.flatMap((venue) => {
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
      image: venue.images[0]?.url ?? fallbackImage(venue.establishmentType),
      isVerified: venue.isVerified,
      googleRating: venue.googleRating,
      distanceKm: null,
      establishmentType: venue.establishmentType,
      foodSpecial: venue.specialsFood[0] ?? undefined,
      drinkSpecial: venue.specialsDrinks[0] ?? undefined,
      // Client-side filter / distance data
      latitude: venue.latitude,
      longitude: venue.longitude,
      happyHourWeekly: venue.happyHourWeekly,
      // Client-side text search data (see matchVenueSearchTier) — already
      // loaded on `venue` by getPublishedVenuesForConsumer(), so forwarding
      // it here adds no additional query.
      city: venue.city,
      seededTags: venue.seededTags,
      searchTags: venue.searchTags,
      specialsFood: venue.specialsFood,
      specialsDrinks: venue.specialsDrinks,
    }];
  });

  return (
    <HappyHoursSearchClient
      cards={cards}
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
