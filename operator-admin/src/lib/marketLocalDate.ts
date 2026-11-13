/**
 * Market-local calendar date — for features (e.g. Today's Specials) that
 * must key off "today" in the market's own timezone rather than the
 * server's raw UTC clock.
 *
 * Known gap (see markets.ts's own header comment): MARKETS[] carries no
 * timezone field today, and neither does the DB `markets` table
 * (migration 048_geography_foundation_v1.sql), so MARKET_TIME_ZONES below
 * hardcodes each of MARKETS[]'s actual ids (src/lib/markets.ts) to its own
 * real IANA timezone rather than silently falling back to server-local/UTC
 * time, which the product rule explicitly forbids ("Use the active
 * market's LOCAL DATE. Do not use raw UTC date"). Most configured markets
 * are in British Columbia (Pacific Time) — Calgary is the one exception
 * (Alberta, Mountain Time), which does NOT observe Pacific Time and must
 * not be mapped to it. This is a deliberate, documented first-pass
 * simplification: once the DB `markets` table gains a real timezone
 * column, this map (and DEFAULT_TIME_ZONE) is the one place that needs to
 * start reading it instead.
 */

import { getWeekdayFromIsoDate } from "@/lib/dailySpecialSchedule";
import { intlTimeZoneFor } from "@/lib/timeZones";
import { WEEKDAY_LABELS_LONG, type Weekday } from "@/lib/dailySpecialTypes";

const DEFAULT_TIME_ZONE = "America/Vancouver";

const MARKET_TIME_ZONES: Record<string, string> = {
  "central-okanagan": "America/Vancouver",
  "greater-vancouver": "America/Vancouver",
  "victoria": "America/Vancouver",
  "calgary": "America/Edmonton",
  // Greater San Diego — California, Pacific Time with US daylight saving.
  // Must never fall back to DEFAULT_TIME_ZONE: since tzdata 2026b British
  // Columbia is permanent UTC−7, so America/Vancouver is an hour ahead of
  // San Diego every winter.
  "greater-san-diego": "America/Los_Angeles",
};

/** IANA timezone for a market id — falls back to DEFAULT_TIME_ZONE for an unmapped/future market rather than throwing. */
export function getMarketTimeZone(marketId: string): string {
  return MARKET_TIME_ZONES[marketId] ?? DEFAULT_TIME_ZONE;
}

/**
 * "YYYY-MM-DD" for `now` as observed in the market's local timezone.
 * `now` is always an explicit argument (never defaulted to `new Date()`
 * internally) so callers — and tests — control the instant directly,
 * same convention as isFeatureNewBadgeVisible() (newBadge.ts).
 */
export function getMarketLocalIsoDate(marketId: string, now: Date): string {
  // intlTimeZoneFor: corrects runtimes whose bundled data predates BC's
  // permanent UTC−7 (see src/lib/timeZones.ts).
  const timeZone = intlTimeZoneFor(getMarketTimeZone(marketId), now);
  // Built from parts because en-CA's default layout comes from the runtime's
  // locale data and isn't guaranteed to be "YYYY-MM-DD" in every browser.
  // Callers do calendar arithmetic on this string, so a different layout
  // throws on the client (Sentry a310b75e).
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The market-local weekday (0=Sunday..6=Saturday) for `now`, via getMarketLocalIsoDate(). */
export function getMarketLocalWeekday(marketId: string, now: Date): Weekday | null {
  return getWeekdayFromIsoDate(getMarketLocalIsoDate(marketId, now));
}

/** Human weekday label ("Wednesday") for `now` in the market's local timezone — "Today" as a fallback if the date is somehow unparseable. */
export function getMarketLocalWeekdayLabel(marketId: string, now: Date): string {
  const weekday = getMarketLocalWeekday(marketId, now);
  return weekday === null ? "Today" : WEEKDAY_LABELS_LONG[weekday];
}
