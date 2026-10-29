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
 * Today/Tomorrow filter chip match for one market-local calendar date. A
 * one-off event matches only its own first_date; a daily event always; any
 * other recurring event (weekly/biweekly/monthly) its first_date's weekday,
 * as before. Undated events stay permissive. (This Weekend uses the stricter
 * getTargetWeekendDates() + eventHasOccurrenceOn() instead.)
 */
export function eventOccursOnDate(
  e: { firstDate: string | null; recurrence: string | null },
  iso: string
): boolean {
  if (e.recurrence === "daily") return true;
  if (!e.firstDate) return true; // permissive for undated
  const isRecurring = e.recurrence && e.recurrence !== "none";
  if (!isRecurring) return e.firstDate === iso;
  return weekdayOfIso(e.firstDate) === weekdayOfIso(iso);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = isoParts(fromIso);
  const [ty, tm, td] = isoParts(toIso);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Whether an event has an occurrence on `iso`: never before its first_date,
 * then daily every day, weekly on first_date's weekday, biweekly every 14
 * days from first_date, monthly on first_date's day of month (as the operator
 * form describes it), and a one-off only on first_date. An unrecognised
 * recurrence falls back to the weekly rule. Events have no end date, so none
 * is applied. Undated events stay permissive, like the other date filters.
 */
export function eventHasOccurrenceOn(
  e: { firstDate: string | null; recurrence: string | null },
  iso: string
): boolean {
  if (!e.firstDate) return true; // permissive for undated
  if (iso < e.firstDate) return false;
  switch (e.recurrence) {
    case null:
    case "none":
      return iso === e.firstDate;
    case "daily":
      return true;
    case "biweekly":
      return daysBetweenIso(e.firstDate, iso) % 14 === 0;
    case "monthly":
      return isoParts(iso)[2] === isoParts(e.firstDate)[2];
    default:
      return weekdayOfIso(iso) === weekdayOfIso(e.firstDate);
  }
}

/**
 * The This Weekend filter's target dates for a market-local `todayIso`:
 * Monday–Friday the coming Saturday and Sunday; Saturday–Sunday the current
 * weekend. Only dates from today on are returned (on Sunday, just Sunday),
 * matching the server-side rule that already drops yesterday's one-offs.
 */
export function getTargetWeekendDates(todayIso: string): string[] {
  const dow = weekdayOfIso(todayIso);
  const saturdayIso = dow === 0 ? addDaysToIso(todayIso, -1) : addDaysToIso(todayIso, 6 - dow);
  return [saturdayIso, addDaysToIso(saturdayIso, 1)].filter((d) => d >= todayIso);
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
