/**
 * Runtime-independent IANA timezone handling for the public website.
 *
 * Pure, server + client safe. Every consumer-facing wall-clock calculation
 * (Happy Hour Now, Open Now, market-local "today", converted hours) resolves
 * its timezone through intlTimeZoneFor() before handing it to Intl, so the
 * server and every browser agree on the same instant regardless of how old
 * their bundled timezone data is.
 *
 * Why: tzdata 2026b — "British Columbia moved to permanent -07 on
 * 2026-03-09, so it will not fall back from -07 to -08 on 2026-11-01."
 * Runtimes that bundle older data (Node 20.19.x ships tz 2024b; older
 * browsers and devices likewise) still put America/Vancouver on UTC−8 every
 * winter from 2026-11-01, an hour behind the real clock in Kelowna,
 * Vancouver and Victoria. A current runtime (Node 22.23.x / 24.22.x ship tz
 * 2026e) is already correct and is left alone.
 *
 * Correction: when — and only when — this runtime's data still shows
 * America/Vancouver at UTC−8 for an instant after BC's change, instants
 * from the change onward are evaluated in America/Phoenix, which has been
 * fixed UTC−7 year-round since 1968 and is therefore identical to BC's new
 * rule. Earlier instants keep America/Vancouver (correct historical data in
 * every runtime). Remove this once no supported runtime predates tz 2026b.
 */

const VANCOUVER = "America/Vancouver";
const FIXED_UTC_MINUS_7 = "America/Phoenix";

/** 2026-03-09 02:00 PST — the instant BC moved to permanent UTC−7. */
export const BC_PERMANENT_UTC_MINUS_7_FROM_MS = Date.UTC(2026, 2, 9, 10, 0, 0);

/** A winter instant after BC's change — UTC−7 in current data, UTC−8 in stale data. */
const BC_PROBE_MS = Date.UTC(2026, 11, 15, 12, 0, 0);

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = offsetFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    offsetFormatterCache.set(timeZone, f);
  }
  return f;
}

/** UTC offset in minutes of `timeZone` at `instantMs`, exactly as this runtime's Intl data reports it (no correction). */
export function rawOffsetMinutes(timeZone: string, instantMs: number): number {
  const parts = offsetFormatter(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - Math.floor(instantMs / 1000) * 1000) / 60000);
}

let staleBcRules: boolean | null = null;

/** True when this runtime's timezone data predates BC's permanent UTC−7 (tzdata < 2026b). Computed once. */
export function runtimeHasStaleBcRules(): boolean {
  if (staleBcRules === null) {
    try {
      staleBcRules = rawOffsetMinutes(VANCOUVER, BC_PROBE_MS) === -480;
    } catch {
      staleBcRules = false;
    }
  }
  return staleBcRules;
}

/** Test seam: forces the stale-data detection result (null re-detects). */
export function __setStaleBcRulesForTest(value: boolean | null): void {
  staleBcRules = value;
}

/**
 * The IANA name to hand to Intl for `timeZone` at `instant` in this runtime.
 * Identity for every zone except America/Vancouver on a runtime with stale
 * BC rules, for instants on or after BC's change (see module comment).
 */
export function intlTimeZoneFor(timeZone: string, instant: Date | number): string {
  if (timeZone !== VANCOUVER) return timeZone;
  const ms = typeof instant === "number" ? instant : instant.getTime();
  if (ms >= BC_PERMANENT_UTC_MINUS_7_FROM_MS && runtimeHasStaleBcRules()) return FIXED_UTC_MINUS_7;
  return timeZone;
}

/** Corrected UTC offset in minutes of `timeZone` at `instantMs` (e.g. −480 for PST). */
export function offsetMinutes(timeZone: string, instantMs: number): number {
  return rawOffsetMinutes(intlTimeZoneFor(timeZone, instantMs), instantMs);
}

/**
 * Deterministic short label for `timeZone` at `instantMs` — the same text on
 * every runtime, so the server render and every browser agree.
 *
 * North American zones get their familiar abbreviation from the corrected
 * offset (BC's permanent UTC−7 reads "PDT", matching current CLDR data);
 * anything else gets a plain "GMT±H[:MM]".
 */
export function timeZoneLabel(timeZone: string, instantMs: number): string {
  const offset = offsetMinutes(timeZone, instantMs);
  const named = NORTH_AMERICAN_LABELS[timeZone]?.[offset];
  if (named) return named;
  return formatGmtOffset(offset);
}

function formatGmtOffset(offset: number): string {
  if (offset === 0) return "GMT";
  const sign = offset > 0 ? "+" : "−";
  const abs = Math.abs(offset);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

const PACIFIC = { [-480]: "PST", [-420]: "PDT" } as Record<number, string>;
const MOUNTAIN = { [-420]: "MST", [-360]: "MDT" } as Record<number, string>;
const CENTRAL = { [-360]: "CST", [-300]: "CDT" } as Record<number, string>;
const EASTERN = { [-300]: "EST", [-240]: "EDT" } as Record<number, string>;
const ATLANTIC = { [-240]: "AST", [-180]: "ADT" } as Record<number, string>;

const NORTH_AMERICAN_LABELS: Record<string, Record<number, string>> = {
  "America/Los_Angeles": PACIFIC,
  "America/Vancouver": PACIFIC,
  "America/Tijuana": PACIFIC,
  "America/Edmonton": MOUNTAIN,
  "America/Denver": MOUNTAIN,
  "America/Boise": MOUNTAIN,
  "America/Phoenix": { [-420]: "MST" },
  "America/Regina": { [-360]: "CST" },
  "America/Chicago": CENTRAL,
  "America/Winnipeg": CENTRAL,
  "America/New_York": EASTERN,
  "America/Toronto": EASTERN,
  "America/Halifax": ATLANTIC,
  "America/Anchorage": { [-540]: "AKST", [-480]: "AKDT" },
  "Pacific/Honolulu": { [-600]: "HST" },
};

/**
 * The visitor's IANA timezone from this browser, or null when unavailable
 * (server render, or an environment that reports none). Client-side only in
 * practice — the server has no visitor timezone.
 */
export function getVisitorTimeZone(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return null;
    // Validate — an unknown name throws here rather than at display time.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}
