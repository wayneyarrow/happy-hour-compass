import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_EVENT_TYPES = new Set(["impression", "click"]);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { venueId, eventType, railName, position, sessionId } =
    body as Record<string, unknown>;

  if (typeof venueId !== "string" || !UUID_RE.test(venueId)) {
    return NextResponse.json({ error: "Invalid venueId" }, { status: 400 });
  }
  if (typeof eventType !== "string" || !VALID_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
  }
  if (typeof railName !== "string" || railName.length === 0) {
    return NextResponse.json({ error: "Invalid railName" }, { status: 400 });
  }
  if (
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0
  ) {
    return NextResponse.json({ error: "Invalid position" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    await supabase.from("venue_discover_events").insert({
      venue_id:   venueId,
      event_type: eventType,
      rail_name:  railName,
      position:   position,
      session_id: sessionId,
    });
  } catch {
    // Intentionally swallowed — tracking failures must not affect the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
