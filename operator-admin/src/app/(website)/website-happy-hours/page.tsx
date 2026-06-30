import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { isNearMarket } from "@/lib/discover/discoverEngine";
import { toMarketConfig } from "@/lib/markets";
import { computeHhStatus } from "@/lib/happyHourStatus";
import {
  HappyHoursSearchClient,
  type WebsiteVenueCard,
} from "./HappyHoursSearchClient";

export const metadata: Metadata = {
  title: "Happy Hours — Happy Hour Compass",
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

export default async function HappyHoursSearchPage() {
  const { market } = await getActiveMarket();
  const marketConfig = toMarketConfig(market);

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
  const cards: WebsiteVenueCard[] = venues.map((venue) => ({
    id: venue.id,
    venueUuid: venue.venueUuid,
    // Website venue URL: /[market]/venue/[slug] — matches the agreed Phase 1D routing.
    href: `/${market.id}/venue/${venue.id}`,
    name: venue.name,
    image: venue.images[0]?.url ?? fallbackImage(venue.establishmentType),
    isVerified: venue.isVerified,
    googleRating: venue.googleRating,
    hhStatus: computeHhStatus(venue.happyHourWeekly),
    distanceKm: null,
    establishmentType: venue.establishmentType,
    foodSpecial: venue.specialsFood[0] ?? undefined,
    drinkSpecial: venue.specialsDrinks[0] ?? undefined,
    // Client-side filter / distance data
    latitude: venue.latitude,
    longitude: venue.longitude,
    happyHourWeekly: venue.happyHourWeekly,
  }));

  return <HappyHoursSearchClient cards={cards} market={market} />;
}
