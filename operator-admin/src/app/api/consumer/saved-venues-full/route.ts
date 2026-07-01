import { NextRequest, NextResponse } from "next/server";
import { getPublishedVenuesByUuids } from "@/lib/data/venues";
import { computeHhStatus } from "@/lib/happyHourStatus";
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

    const cards: WebsiteVenueCard[] = venues.map((venue) => ({
      id: venue.id,
      venueUuid: venue.venueUuid,
      href: `/${marketId}/venue/${venue.id}`,
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
    }));

    return NextResponse.json(cards);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
