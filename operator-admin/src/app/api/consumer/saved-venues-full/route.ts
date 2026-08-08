import { NextRequest, NextResponse } from "next/server";
import { getPublishedVenuesByUuids } from "@/lib/data/venues";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { getVenueImageSrc } from "@/lib/venuePlaceholderImage";
import type { WebsiteVenueCard } from "@/app/(website)/website-happy-hours/HappyHoursSearchClient";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { venueIds, marketId } = body ?? {};

    if (
      !Array.isArray(venueIds) ||
      venueIds.length === 0 ||
      typeof marketId !== "string"
    ) {
      return NextResponse.json([]);
    }

    const ids = (venueIds as unknown[])
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 100);

    const venues = await getPublishedVenuesByUuids(ids);

    // Venues with no assigned market/city have no canonical public URL yet
    // (see buildVenuePublicPath) — omit them rather than fabricate a broken
    // href for the Saved page to link to.
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
        image: getVenueImageSrc(venue),
        isVerified: venue.isVerified,
        googleRating: venue.googleRating,
        distanceKm: null,
        establishmentType: venue.establishmentType,
        foodSpecial: venue.specialsFood[0] ?? undefined,
        drinkSpecial: venue.specialsDrinks[0] ?? undefined,
        latitude: venue.latitude,
        longitude: venue.longitude,
        happyHourWeekly: venue.happyHourWeekly,
      }];
    });

    return NextResponse.json(cards);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
