import { NextRequest, NextResponse } from "next/server";
import { getPublishedVenuesByUuids } from "@/lib/data/venues";
import { computeHhStatus } from "@/lib/happyHourStatus";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import type { WebsiteVenueCard } from "@/app/(website)/website-happy-hours/HappyHoursSearchClient";

function fallbackImage(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar")) return "/images/sports-bar-1.jpg";
  if (t.includes("brewery") || t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

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
        image: venue.images[0]?.url ?? fallbackImage(venue.establishmentType),
        isVerified: venue.isVerified,
        googleRating: venue.googleRating,
        hhStatus: computeHhStatus(venue.happyHourWeekly),
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
