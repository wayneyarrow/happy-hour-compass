import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveAnalyticsEnvironment } from "@/lib/analyticsEnvironment";
import { insertTrackingRow } from "@/lib/trackingInsert";
import { parseWebsiteSearchPayload } from "@/lib/discoveryTracking/websiteSearchPayload";

/**
 * First-party tracking of consumer free-text searches on the public website
 * (migrations 089 + 110, website_search_events).
 *
 * Two known surfaces — new ones must be added deliberately in
 * parseWebsiteSearchPayload(), not inferred from client input:
 *   homepage_hero — HeroDiscoverySearch.tsx (mode = the hero's selected mode)
 *   listing_page  — the Happy Hours, Daily Specials and Events listing pages
 *                   (mode tells them apart)
 *
 * environment is always resolved server-side (src/lib/analyticsEnvironment.ts);
 * payload validation lives in src/lib/discoveryTracking/websiteSearchPayload.ts.
 *
 * Not Turnstile-gated: matches every other /api/track/* endpoint in this
 * repo (see the Bot Protection section of CLAUDE.md — analytics endpoints
 * are unauthenticated but not a submission/lead-capture surface).
 */

/** Columns added by migration 110 — dropped on the deploy-order fallback (see insertTrackingRow). */
const MIGRATION_110_COLUMNS = [
  "environment",
  "mode",
  "origin",
  "capture_trigger",
  "result_count_capped",
  "other_filters_active",
  "search_id",
] as const;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseWebsiteSearchPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const row = { ...parsed.row, environment: resolveAnalyticsEnvironment() };

  try {
    const supabase = createAdminClient();
    // A retried POST for the same captured search is a no-op (unique search_id).
    await insertTrackingRow(
      supabase,
      "website_search_events",
      row,
      MIGRATION_110_COLUMNS,
      row.search_id ? { onConflict: "search_id" } : undefined
    );
  } catch {
    // Intentionally swallowed — tracking failures must never affect search
    // or navigation for the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
