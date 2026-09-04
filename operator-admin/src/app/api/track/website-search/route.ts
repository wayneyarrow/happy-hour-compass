import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Phase 4B — first-party tracking of consumer free-text searches on the
 * public website (see supabase/migrations/089_website_search_events.sql).
 *
 * Two known surfaces today — new ones must be added here deliberately, not
 * inferred from client input:
 *   homepage_hero — HeroVenueSearch.tsx
 *   listing_page  — website-happy-hours/HappyHoursSearchClient.tsx
 *
 * Not Turnstile-gated: matches every other /api/track/* endpoint in this
 * repo (see the Bot Protection section of CLAUDE.md — analytics endpoints
 * are unauthenticated but not a submission/lead-capture surface).
 */

const VALID_SURFACES = new Set(["homepage_hero", "listing_page"]);

// Defensive cap only — Postgres TEXT has no real size limit. Free-text
// search queries this long are never a legitimate consumer search; this
// just keeps a malformed/abusive payload from writing an unbounded row.
const MAX_SEARCH_TERM_LENGTH = 300;

/** Trims and collapses internal whitespace runs to a single space. Casing is preserved — see the table's column comment for why. */
function normalizeSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { searchTerm, surface, resultCount, sessionId, marketId } =
    body as Record<string, unknown>;

  if (typeof searchTerm !== "string") {
    return NextResponse.json({ error: "Invalid searchTerm" }, { status: 400 });
  }
  const normalizedTerm = normalizeSearchTerm(searchTerm).slice(0, MAX_SEARCH_TERM_LENGTH);
  // Ignore empty/whitespace-only queries — these are typing noise, not a
  // meaningful search (see CLAUDE.md Phase 4B spec, section 4).
  if (normalizedTerm.length === 0) {
    return NextResponse.json({ error: "Empty searchTerm" }, { status: 400 });
  }

  if (typeof surface !== "string" || !VALID_SURFACES.has(surface)) {
    return NextResponse.json({ error: "Invalid surface" }, { status: 400 });
  }
  if (
    typeof resultCount !== "number" ||
    !Number.isInteger(resultCount) ||
    resultCount < 0
  ) {
    return NextResponse.json({ error: "Invalid resultCount" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }
  if (marketId !== undefined && typeof marketId !== "string") {
    return NextResponse.json({ error: "Invalid marketId" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    await supabase.from("website_search_events").insert({
      search_term: normalizedTerm,
      surface,
      result_count: resultCount,
      session_id: sessionId,
      market_id: marketId ?? null,
    });
  } catch {
    // Intentionally swallowed — tracking failures must never affect search
    // or navigation for the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
