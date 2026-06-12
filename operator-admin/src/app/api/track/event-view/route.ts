import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, sessionId } = body as Record<string, unknown>;

  if (typeof eventId !== "string" || !UUID_RE.test(eventId)) {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    await supabase.from("event_view_events").insert({
      event_id:   eventId,
      session_id: sessionId,
    });
  } catch {
    // Intentionally swallowed — tracking failures must not affect the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
