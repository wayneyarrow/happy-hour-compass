/**
 * Search & Discovery reporting (Founder Control Panel) — shared controls.
 *
 * Pure and client-safe: data sources, date presets in America/Vancouver, and
 * the one place release-QA traffic is excluded. Definitions of the metrics
 * themselves live in docs/analytics/SEARCH_DISCOVERY_TRACKING.md.
 */

export const REPORT_TIME_ZONE = "America/Vancouver";

// ── Data sources ────────────────────────────────────────────────────────────

/**
 * production — the new tracking system (migration 110), environment = 'production'. Default.
 * staging    — the same tables, environment = 'staging' (for staging QA of this report).
 * legacy     — pre-migration-110 data only: website_search_events rows with
 *              environment NULL, and venue_discover_events (LOAD-based
 *              impressions). Never combined with the new visible impressions.
 */
export type ReportSource = "production" | "staging" | "legacy";
export const REPORT_SOURCES: ReportSource[] = ["production", "staging", "legacy"];
export const DEFAULT_SOURCE: ReportSource = "production";

export function parseSource(v: string | undefined): ReportSource {
  return (REPORT_SOURCES as string[]).includes(v ?? "") ? (v as ReportSource) : DEFAULT_SOURCE;
}

// ── Release-QA exclusion ────────────────────────────────────────────────────

/**
 * Sessions created deliberately during the migration-110/111 release QA
 * (2026-10-10/11). Every one is identified in the release reports; their rows
 * are kept in the database on purpose and excluded from every report query
 * here — in SQL and again in memory.
 *
 * Exact ids only. Never a prefix or a heuristic: an unusual-looking session
 * (e.g. the repeated "boston pizza" ?q= landings in legacy search data) is
 * NOT assumed to be QA. Add a new id here only when a QA session is
 * deliberately created and documented.
 */
export const RELEASE_QA_SESSION_IDS: readonly string[] = [
  // Staging QA (environment = 'staging')
  "qa-110-dup",
  "qa-110-envspoof",
  "qa-110-staging-browser",
  "qa-110-staging-hero",
  // Production verification (environment = 'production', or NULL for the pre-release check)
  "qa-110-prod-check",
  "qa-110-prod-verify",
  "qa-110-prod-venueview",
  "qa-110-prod-legacy",
];

const QA_SET: ReadonlySet<string> = new Set(RELEASE_QA_SESSION_IDS);

export function isReleaseQaSession(sessionId: string | null | undefined): boolean {
  return !!sessionId && QA_SET.has(sessionId);
}

/** PostgREST `.not("session_id", "in", …)` value for the exclusion list. */
export function qaSessionNotInFilter(): string {
  return `(${RELEASE_QA_SESSION_IDS.join(",")})`;
}

// ── Date ranges ─────────────────────────────────────────────────────────────

export type RangePreset = "7d" | "30d" | "all";
export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All available" },
];

export function parseRange(v: string | undefined): RangePreset {
  return v === "7d" || v === "30d" || v === "all" ? v : "30d";
}

/** Offset (minutes) of `timeZone` from UTC at instant `d`. */
function tzOffsetMinutes(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** Vancouver calendar date (YYYY-MM-DD) of an instant. */
export function vancouverDateKey(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    typeof d === "string" ? new Date(d) : d
  );
}

/** UTC instant of 00:00 Vancouver time on the Vancouver calendar day `daysAgo` days before `now`'s. */
export function vancouverMidnight(now: Date, daysAgo: number): Date {
  const [y, m, d] = vancouverDateKey(now).split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d - daysAgo, 0, 0, 0));
  // Correct for the zone offset (and a DST change between the guess and the target).
  let t = guess.getTime() - tzOffsetMinutes(guess, REPORT_TIME_ZONE) * 60000;
  t = guess.getTime() - tzOffsetMinutes(new Date(t), REPORT_TIME_ZONE) * 60000;
  return new Date(t);
}

/**
 * Report window. `until` is fixed 30s in the past so rows still being
 * written can't shift paginated reads. 7d/30d are whole Vancouver calendar
 * days ending today (today counts as day 1). `all` starts at `collectionStart`.
 */
export function resolveRange(preset: RangePreset, now: Date, collectionStart: string | null): { since: string | null; until: string } {
  const until = new Date(now.getTime() - 30_000).toISOString();
  if (preset === "all") return { since: collectionStart, until };
  const days = preset === "7d" ? 7 : 30;
  const since = vancouverMidnight(now, days - 1).toISOString();
  // Never earlier than the collection start (nothing clean exists before it).
  if (collectionStart && since < collectionStart) return { since: collectionStart, until };
  return { since, until };
}

export function formatVancouverDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatVancouverDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/** Percentage with one decimal, or "—" for an empty denominator (never 0%). */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}
