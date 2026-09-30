import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { recordVenueClick } from "@/lib/venueClickTracking";

/**
 * Records an Operator Admin "Intent" action (website/menu click, happy hour
 * schedule or business hours expand) in venue_click_events.
 *
 * Accepts either the venue UUID or its slug — see
 * src/lib/venueClickTracking.ts for why. Responses: 204 stored,
 * 400 malformed payload, 404 unknown venue, 500 lookup/insert failure.
 * Callers are fire-and-forget, so a non-2xx never affects the consumer.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (err) {
    console.error("[track/venue-click] admin client unavailable", err);
    return NextResponse.json({ error: "Tracking unavailable" }, { status: 500 });
  }

  const result = await recordVenueClick(body, {
    findVenueId: async (identifier) => {
      const { data, error } = await supabase
        .from("venues")
        .select("id")
        .eq(identifier.kind === "uuid" ? "id" : "slug", identifier.value)
        .maybeSingle();
      return { venueId: (data?.id as string | undefined) ?? null, error };
    },
    insertClick: async (row) => {
      const { error } = await supabase.from("venue_click_events").insert(row);
      return { error };
    },
    logError: (message, detail) => {
      console.error(`[track/venue-click] ${message}`, detail);
    },
  });

  if (result.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
