import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_EVENT_TYPES = new Set(["impression", "click"]);

type EventRow = {
  venue_id: string;
  event_type: string;
  rail_name: string;
  position: number;
  session_id: string;
};

function validateRow(item: Record<string, unknown>): EventRow | null {
  const { venueId, eventType, railName, position, sessionId } = item;
  if (typeof venueId !== "string" || !UUID_RE.test(venueId)) return null;
  if (typeof eventType !== "string" || !VALID_EVENT_TYPES.has(eventType)) return null;
  if (typeof railName !== "string" || railName.length === 0) return null;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) return null;
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  return {
    venue_id: venueId,
    event_type: eventType,
    rail_name: railName,
    position,
    session_id: sessionId,
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  let rows: EventRow[];

  // Batch mode: { events: [...] }
  if (Array.isArray(payload.events)) {
    rows = (payload.events as Record<string, unknown>[])
      .map(validateRow)
      .filter((r): r is EventRow => r !== null);
    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid events" }, { status: 400 });
    }
  } else {
    // Single-event mode: { venueId, eventType, railName, position, sessionId }
    const row = validateRow(payload);
    if (!row) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    rows = [row];
  }

  try {
    const supabase = createAdminClient();
    await supabase.from("venue_discover_events").insert(rows);
  } catch {
    // Intentionally swallowed — tracking failures must not affect the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
