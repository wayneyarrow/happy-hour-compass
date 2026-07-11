import { NextRequest, NextResponse } from "next/server";
import { getSavedGuideCardsByIds } from "@/lib/data/contentGuides";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const guideIds: unknown = body?.guideIds;

    if (!Array.isArray(guideIds) || guideIds.length === 0) {
      return NextResponse.json([]);
    }

    const ids = (guideIds as unknown[])
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 100);

    const cards = await getSavedGuideCardsByIds(ids);
    return NextResponse.json(cards);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
