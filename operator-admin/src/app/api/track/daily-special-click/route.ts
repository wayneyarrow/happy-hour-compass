import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_SOURCES = new Set(["search_results"]);

/**
 * Records a click on a Daily Special result card (which opens the
 * Special's venue page at its anchor). See migration
 * 101_daily_special_click_events.sql. Same shape as /api/track/event-view.
 *
 * venue_id is resolved server-side from the Special itself — any
 * client-supplied venueId is ignored, so a stale or crafted request cannot
 * attribute a click to the wrong venue. Unknown or unpublished Specials are ignored (no row), like any
 * other tracking failure: always 204 once the payload shape is valid.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dailySpecialId, source, sessionId } = body as Record<string, unknown>;

  if (typeof dailySpecialId !== "string" || !UUID_RE.test(dailySpecialId)) {
    return NextResponse.json({ error: "Invalid dailySpecialId" }, { status: 400 });
  }
  if (typeof source !== "string" || !VALID_SOURCES.has(source)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data: special } = await supabase
      .from("daily_specials")
      .select("venue_id")
      .eq("id", dailySpecialId)
      .eq("is_published", true)
      .maybeSingle();

    if (special?.venue_id) {
      await supabase.from("daily_special_click_events").insert({
        daily_special_id: dailySpecialId,
        venue_id:         special.venue_id,
        source,
        session_id:       sessionId,
      });
    }
  } catch {
    // Intentionally swallowed — tracking failures must not affect the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
