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

  const { venueId, sessionId, city } = body as Record<string, unknown>;

  if (typeof venueId !== "string" || !UUID_RE.test(venueId)) {
    return NextResponse.json({ error: "Invalid venueId" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    await supabase.from("venue_view_events").insert({
      venue_id:   venueId,
      session_id: sessionId,
      city:       typeof city === "string" && city.length > 0 ? city : null,
    });
  } catch {
    // Intentionally swallowed — tracking failures must not affect the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
