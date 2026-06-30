import { NextRequest, NextResponse } from "next/server";
import { getVenuePreviewsByIds } from "@/lib/data/venues";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const venueIds: unknown = body?.venueIds;

    if (!Array.isArray(venueIds) || venueIds.length === 0) {
      return NextResponse.json([]);
    }

    // Guard against oversized requests.
    const ids = (venueIds as unknown[])
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 50);

    const previews = await getVenuePreviewsByIds(ids);
    return NextResponse.json(previews);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
