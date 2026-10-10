/**
 * Validation for /api/track/website-search payloads (website_search_events,
 * migrations 089 + 110). Pure, so the exact rules the route applies are
 * unit-testable without a database.
 *
 * mode/origin/captureTrigger/resultCountCapped/otherFiltersActive/searchId
 * are optional so a browser still running a pre-110 bundle keeps working
 * (those columns are then NULL, exactly like legacy rows). environment is
 * never read from the payload — the route adds it server-side.
 */

const VALID_SURFACES = new Set(["homepage_hero", "listing_page"]);
const VALID_MODES = new Set(["happy_hours", "daily_specials", "events"]);
const VALID_ORIGINS = new Set(["typed", "url", "history", "hero_see_all"]);
const VALID_TRIGGERS = new Set(["pause", "enter", "selection", "see_all"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Defensive cap only — Postgres TEXT has no real size limit. Free-text
// search queries this long are never a legitimate consumer search; this
// just keeps a malformed/abusive payload from writing an unbounded row.
const MAX_SEARCH_TERM_LENGTH = 300;

/**
 * Marks an invalid optional field. A dedicated symbol, never `false` —
 * `false` is a legitimate value for the boolean fields, and every current
 * client search sends resultCountCapped: false (caught in migration-110
 * staging QA, when using `false` as the marker rejected every search).
 */
const INVALID = Symbol("invalid");

function optionalEnum(value: unknown, allowed: Set<string>): string | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && allowed.has(value) ? value : INVALID;
}

function optionalBoolean(value: unknown): boolean | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  return typeof value === "boolean" ? value : INVALID;
}

/** Trims and collapses internal whitespace runs to a single space. Casing is preserved — see the table's column comment for why. */
function normalizeSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export type WebsiteSearchRow = {
  search_term: string;
  surface: string;
  result_count: number;
  session_id: string;
  market_id: string | null;
  mode: string | null;
  origin: string | null;
  capture_trigger: string | null;
  result_count_capped: boolean | null;
  other_filters_active: boolean | null;
  search_id: string | null;
};

export function parseWebsiteSearchPayload(body: unknown): { ok: true; row: WebsiteSearchRow } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid payload" };
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

  if (typeof searchTerm !== "string") return { ok: false, error: "Invalid searchTerm" };
  const normalizedTerm = normalizeSearchTerm(searchTerm).slice(0, MAX_SEARCH_TERM_LENGTH);
  // Empty/whitespace-only queries are typing noise, not a meaningful search.
  if (normalizedTerm.length === 0) return { ok: false, error: "Empty searchTerm" };

  if (typeof surface !== "string" || !VALID_SURFACES.has(surface)) return { ok: false, error: "Invalid surface" };
  if (typeof resultCount !== "number" || !Number.isInteger(resultCount) || resultCount < 0) {
    return { ok: false, error: "Invalid resultCount" };
  }
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128) {
    return { ok: false, error: "Invalid sessionId" };
  }
  if (marketId !== undefined && marketId !== null && typeof marketId !== "string") {
    return { ok: false, error: "Invalid marketId" };
  }

  const modeValue = optionalEnum(mode, VALID_MODES);
  const originValue = optionalEnum(origin, VALID_ORIGINS);
  const triggerValue = optionalEnum(captureTrigger, VALID_TRIGGERS);
  const cappedValue = optionalBoolean(resultCountCapped);
  const filtersValue = optionalBoolean(otherFiltersActive);
  if (
    modeValue === INVALID ||
    originValue === INVALID ||
    triggerValue === INVALID ||
    cappedValue === INVALID ||
    filtersValue === INVALID
  ) {
    return { ok: false, error: "Invalid search metadata" };
  }
  if (searchId !== undefined && searchId !== null && (typeof searchId !== "string" || !UUID_RE.test(searchId))) {
    return { ok: false, error: "Invalid searchId" };
  }

  return {
    ok: true,
    row: {
      search_term: normalizedTerm,
      surface,
      result_count: resultCount,
      session_id: sessionId,
      market_id: typeof marketId === "string" ? marketId : null,
      mode: modeValue,
      origin: originValue,
      capture_trigger: triggerValue,
      result_count_capped: cappedValue,
      other_filters_active: filtersValue,
      search_id: typeof searchId === "string" ? searchId.toLowerCase() : null,
    },
  };
}
