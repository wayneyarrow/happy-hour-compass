import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveAnalyticsEnvironment } from "@/lib/analyticsEnvironment";
import { insertTrackingRow } from "@/lib/trackingInsert";

/**
 * First-party tracking of consumer free-text searches on the public website
 * (migrations 089 + 110, website_search_events).
 *
 * Two known surfaces — new ones must be added here deliberately, not
 * inferred from client input:
 *   homepage_hero — HeroDiscoverySearch.tsx (mode = the hero's selected mode)
 *   listing_page  — the Happy Hours, Daily Specials and Events listing pages
 *                   (mode tells them apart)
 *
 * environment is always resolved server-side (src/lib/analyticsEnvironment.ts).
 * mode/origin/captureTrigger/resultCountCapped/otherFiltersActive/searchId
 * are optional so a browser still running a pre-110 bundle keeps working
 * (those columns are then NULL, exactly like legacy rows).
 *
 * Not Turnstile-gated: matches every other /api/track/* endpoint in this
 * repo (see the Bot Protection section of CLAUDE.md — analytics endpoints
 * are unauthenticated but not a submission/lead-capture surface).
 */

const VALID_SURFACES = new Set(["homepage_hero", "listing_page"]);
const VALID_MODES = new Set(["happy_hours", "daily_specials", "events"]);
const VALID_ORIGINS = new Set(["typed", "url", "history", "hero_see_all"]);
const VALID_TRIGGERS = new Set(["pause", "enter", "selection", "see_all"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Defensive cap only — Postgres TEXT has no real size limit. Free-text
// search queries this long are never a legitimate consumer search; this
// just keeps a malformed/abusive payload from writing an unbounded row.
const MAX_SEARCH_TERM_LENGTH = 300;

/** Trims and collapses internal whitespace runs to a single space. Casing is preserved — see the table's column comment for why. */
function normalizeSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Optional enum field: undefined/null → null; a known value → itself; anything else → invalid. */
function optionalEnum(value: unknown, allowed: Set<string>): string | null | false {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && allowed.has(value) ? value : false;
}

function optionalBoolean(value: unknown): boolean | null | false {
  if (value === undefined || value === null) return null;
  return typeof value === "boolean" ? value : false;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    searchTerm,
    surface,
    resultCount,
    sessionId,
    marketId,
    mode,
    origin,
    captureTrigger,
    resultCountCapped,
    otherFiltersActive,
    searchId,
  } = body as Record<string, unknown>;

  if (typeof searchTerm !== "string") {
    return NextResponse.json({ error: "Invalid searchTerm" }, { status: 400 });
  }
  const normalizedTerm = normalizeSearchTerm(searchTerm).slice(0, MAX_SEARCH_TERM_LENGTH);
  // Ignore empty/whitespace-only queries — these are typing noise, not a
  // meaningful search.
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
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }
  if (marketId !== undefined && typeof marketId !== "string") {
    return NextResponse.json({ error: "Invalid marketId" }, { status: 400 });
  }

  const modeValue = optionalEnum(mode, VALID_MODES);
  const originValue = optionalEnum(origin, VALID_ORIGINS);
  const triggerValue = optionalEnum(captureTrigger, VALID_TRIGGERS);
  const cappedValue = optionalBoolean(resultCountCapped);
  const filtersValue = optionalBoolean(otherFiltersActive);
  if (modeValue === false || originValue === false || triggerValue === false || cappedValue === false || filtersValue === false) {
    return NextResponse.json({ error: "Invalid search metadata" }, { status: 400 });
  }
  if (searchId !== undefined && searchId !== null && (typeof searchId !== "string" || !UUID_RE.test(searchId))) {
    return NextResponse.json({ error: "Invalid searchId" }, { status: 400 });
  }

  const row = {
    search_term: normalizedTerm,
    surface,
    result_count: resultCount,
    session_id: sessionId,
    market_id: marketId ?? null,
    environment: resolveAnalyticsEnvironment(),
    mode: modeValue,
    origin: originValue,
    capture_trigger: triggerValue,
    result_count_capped: cappedValue,
    other_filters_active: filtersValue,
    search_id: typeof searchId === "string" ? searchId.toLowerCase() : null,
  };

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
