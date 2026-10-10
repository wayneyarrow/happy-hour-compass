import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveAnalyticsEnvironment } from "@/lib/analyticsEnvironment";
import {
  MAX_DISCOVERY_EVENTS_PER_REQUEST,
  validateDiscoveryEvent,
  type DiscoveryEventRow,
} from "@/lib/discoveryTracking/discoveryEvents";

/**
 * Website discovery tracking (migration 110, website_discovery_events) —
 * impressions, section exposures, item clicks, View all, hero Browse and
 * hero suggestion selections. Sent by (website)/tracking/discoveryClient.ts.
 *
 * Body: { events: DiscoveryEventPayload[] } (max 50). Each event is
 * validated independently (validateDiscoveryEvent); invalid ones are
 * dropped, never repaired. environment is resolved server-side only.
 * Impressions/exposures carry a server-built dedupe_key, so re-sending one
 * is a no-op (ON CONFLICT DO NOTHING) — a page view can never count the
 * same placement + item twice.
 *
 * Not Turnstile-gated, like every other /api/track/* endpoint.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = (body as Record<string, unknown> | null)?.events;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_DISCOVERY_EVENTS_PER_REQUEST) {
    return NextResponse.json({ error: "Invalid events" }, { status: 400 });
  }

  const rows = events.map(validateDiscoveryEvent).filter((r): r is DiscoveryEventRow => r !== null);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid events" }, { status: 400 });
  }

  const environment = resolveAnalyticsEnvironment();
  const withEnvironment = rows.map((r) => ({ ...r, environment }));

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("website_discovery_events")
      .upsert(withEnvironment, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (error) {
      // Logged, never surfaced: tracking failures must not affect the consumer.
      console.error("[track/discovery] insert failed", { code: error.code, message: error.message, rows: withEnvironment.length });
    }
  } catch (err) {
    console.error("[track/discovery] insert threw", { message: err instanceof Error ? err.message : String(err) });
  }

  return new NextResponse(null, { status: 204 });
}
