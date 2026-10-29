import { getMarketLocalIsoDate } from "@/lib/marketLocalDate";

/**
 * Market-local "today"/"tomorrow" for the Events page's TODAY/TOMORROW card
 * badges and Today/Tomorrow filter chips. Pure calendar-date arithmetic on
 * "YYYY-MM-DD" strings (UTC-based, so the server's and the browser's own
 * timezones never enter into it): "today" always comes from the market's
 * IANA timezone via getMarketLocalIsoDate(), so server rendering (UTC on the
 * deployment host) and browser hydration produce the same badge and filter
 * result for the same instant. Previously both used the runtime's local
 * clock — UTC during SSR, the visitor's browser timezone after hydration.
 */

const DAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAYS_PLURAL = [
  "SUNDAYS", "MONDAYS", "TUESDAYS", "WEDNESDAYS",
  "THURSDAYS", "FRIDAYS", "SATURDAYS",
];
const MONTHS_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function isoParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

/** Weekday (0=Sunday..6=Saturday) of a calendar date. */
export function weekdayOfIso(iso: string): number {
  const [y, m, d] = isoParts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The calendar date `days` after `iso`. */
export function addDaysToIso(iso: string, days: number): string {
  const [y, m, d] = isoParts(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today's and tomorrow's calendar dates in the market's timezone. */
export function getMarketTodayAndTomorrow(
  marketId: string,
  now: Date
): { todayIso: string; tomorrowIso: string } {
  const todayIso = getMarketLocalIsoDate(marketId, now);
  return { todayIso, tomorrowIso: addDaysToIso(todayIso, 1) };
}

/**
 * The two-line date badge shown on event cards, relative to `todayIso`.
 * Top line: day label (TODAY / TOMORROW / FRI / FRIDAYS / etc.)
 * Bottom line: date or time context
 */
export function buildEventDateBadge(
  firstDate: string | null,
  recurrence: string | null,
  startTime: string | null,
  todayIso: string
): { top: string; bottom: string | null } {
  // start_time is stored as human-readable "7:00 PM" (not HH:MM); use directly.
  const timeLabel = startTime ?? null;
  const tomorrowIso = addDaysToIso(todayIso, 1);

  const isRecurring = recurrence && recurrence !== "none";

  if (!isRecurring) {
    // One-off event
    if (!firstDate) return { top: "DATE TBD", bottom: timeLabel };
    if (firstDate === todayIso) return { top: "TODAY", bottom: timeLabel };
    if (firstDate === tomorrowIso) return { top: "TOMORROW", bottom: timeLabel };

    const [, mo, d] = isoParts(firstDate);
    return { top: DAYS_SHORT[weekdayOfIso(firstDate)], bottom: `${MONTHS_SHORT[mo - 1]} ${d}` };
  }

  // Recurring event
  if (recurrence === "daily") return { top: "DAILY", bottom: timeLabel };
  if (recurrence === "monthly") return { top: "MONTHLY", bottom: timeLabel };

  // Weekly / biweekly — derive day from firstDate
  if (firstDate) {
    const dow = weekdayOfIso(firstDate);
    if (dow === weekdayOfIso(todayIso)) return { top: "TODAY", bottom: timeLabel };
    if (dow === weekdayOfIso(tomorrowIso)) return { top: "TOMORROW", bottom: timeLabel };

    return {
      top: DAYS_PLURAL[dow],
      bottom: recurrence === "biweekly" ? "BIWEEKLY" : timeLabel,
    };
  }

  return { top: "RECURRING", bottom: timeLabel };
}
