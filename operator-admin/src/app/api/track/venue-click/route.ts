import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_CLICK_TYPES = new Set([
  "website",
  "menu",
  "hh_schedule_expand",
  "business_hours_expand",
]);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { venueId, clickType, sessionId } = body as Record<string, unknown>;

  if (typeof venueId !== "string" || !UUID_RE.test(venueId)) {
    return NextResponse.json({ error: "Invalid venueId" }, { status: 400 });
  }
  if (typeof clickType !== "string" || !VALID_CLICK_TYPES.has(clickType)) {
    return NextResponse.json({ error: "Invalid clickType" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    await supabase.from("venue_click_events").insert({
      venue_id:   venueId,
      click_type: clickType,
      session_id: sessionId,
    });
  } catch {
    // Intentionally swallowed — tracking failures must not affect the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
