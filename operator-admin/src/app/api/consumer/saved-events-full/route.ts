import { NextRequest, NextResponse } from "next/server";
import { getPublishedEventsByIds } from "@/lib/data/events";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventIds: unknown = body?.eventIds;

    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return NextResponse.json([]);
    }

    const ids = (eventIds as unknown[])
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 100);

    const events = await getPublishedEventsByIds(ids);
    return NextResponse.json(events);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
