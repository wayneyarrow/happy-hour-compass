/**
 * Plain (non-"use client") Day/Time filter helpers shared between the Happy
 * Hours search page's server component (page.tsx) and its client component
 * (HappyHoursSearchClient.tsx). Exports from a "use client" module can only
 * be rendered as components/props from a Server Component — they can't be
 * invoked as plain functions — so the pure URL-state helpers live in this
 * ordinary module instead, importable from both sides.
 */

// ─── Time options ──────────────────────────────────────────────────────────

function minutesToTimeString(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTimeDisplay(hhMm: string): string {
  const [h, m] = hhMm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${String(m).padStart(2, "0")} ${period}`;
}

// Real Happy Hour schedule data (venues.beta.csv / venues.working.csv) shows
// slot starts from 2:00 PM–10:00 PM and non-"close" ends up to 6:00 PM, plus
// many "close" (midnight) ends. 11:00 AM–11:30 PM comfortably covers that
// with margin for earlier lunch-style specials, without an unusably long
// list.
const TIME_OPTIONS_START_MIN = 11 * 60; // 11:00 AM
const TIME_OPTIONS_END_MIN = 23 * 60 + 30; // 11:30 PM
const TIME_OPTIONS_STEP_MIN = 30;

export const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const opts: Array<{ value: string; label: string }> = [];
  for (
    let min = TIME_OPTIONS_START_MIN;
    min <= TIME_OPTIONS_END_MIN;
    min += TIME_OPTIONS_STEP_MIN
  ) {
    const value = minutesToTimeString(min);
    opts.push({ value, label: formatTimeDisplay(value) });
  }
  return opts;
})();

// End-of-day sentinel for the To selector only. "24:00" (not "00:00") so it
// parses to 1440 — end of the current day, matching how "close" is
// normalized elsewhere — rather than midnight at the *start* of the day.
export const MIDNIGHT_VALUE = "24:00";
const MIDNIGHT_OPTION = { value: MIDNIGHT_VALUE, label: "Midnight" };
export const TO_TIME_OPTIONS: Array<{ value: string; label: string }> = [
  ...TIME_OPTIONS,
  MIDNIGHT_OPTION,
];

// ─── Day filter ─────────────────────────────────────────────────────────────
// An independent filter (a venue must have a valid Happy Hour slot on the
// effective day to pass), which a complete From/To time-range filter then
// further narrows by overlap. "today" is a sentinel — not a happyHourWeekly
// key — resolved at evaluation time via the viewer's current local weekday
// (todayName / getCurrentDayName()), the same convention On Now already uses.
// "all" is a second sentinel meaning "no day filter" — it is the default so a
// fresh visit shows every qualifying venue regardless of which weekday they
// run Happy Hour on, rather than silently hiding venues with no Happy Hour on
// today's weekday (see resolveDayName, which resolves "all" to null).

/** Compact, URL-stable Day filter values. "all" ("All Days") is the default and is never written to the URL. */
export type DayFilterValue = "all" | "today" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAY_FILTER_OPTIONS: Array<{
  value: DayFilterValue;
  label: string;
  dayName?: string;
}> = [
  { value: "all", label: "All Days" },
  { value: "today", label: "Today" },
  { value: "mon", label: "Monday", dayName: "Monday" },
  { value: "tue", label: "Tuesday", dayName: "Tuesday" },
  { value: "wed", label: "Wednesday", dayName: "Wednesday" },
  { value: "thu", label: "Thursday", dayName: "Thursday" },
  { value: "fri", label: "Friday", dayName: "Friday" },
  { value: "sat", label: "Saturday", dayName: "Saturday" },
  { value: "sun", label: "Sunday", dayName: "Sunday" },
];

/**
 * Resolves a Day filter value to the actual happyHourWeekly day-name key
 * ("Sunday".."Saturday") to evaluate, or null for "all" (no day filter — every
 * venue passes the day check regardless of its schedule).
 */
export function resolveDayName(value: DayFilterValue, todayName: string): string | null {
  if (value === "all") return null;
  if (value === "today") return todayName;
  return DAY_FILTER_OPTIONS.find((o) => o.value === value)?.dayName ?? todayName;
}

/**
 * Normalizes a raw `?day=` URL value against `?now=` precedence: On Now
 * always wins, so a non-Today day value alongside an active On Now resolves
 * to "today" — mirroring the disabled-Day-control-shows-Today behavior the
 * live On Now toggle itself produces. An unrecognized/missing day code falls
 * back to "all" (the default, unfiltered state) rather than "today", so a
 * fresh visit or an unrecognized ?day= never silently hides venues.
 */
export function resolveInitialDayFilter(
  rawDay: string | undefined,
  onNow: boolean
): DayFilterValue {
  if (onNow) return "today";
  return DAY_FILTER_OPTIONS.some((o) => o.value === rawDay)
    ? (rawDay as DayFilterValue)
    : "all";
}

/**
 * Validates raw `?from=`/`?to=` URL values against the selectable time
 * options, enforcing the same From < To invariant the From selector's
 * onChange already enforces — an invalid or out-of-order pair resolves to
 * "Any" (empty) for the affected bound rather than silently accepting a
 * state the UI itself could never produce.
 */
export function resolveInitialTimeRange(
  rawFrom: string | undefined,
  rawTo: string | undefined
): { from: string; to: string } {
  const from = TIME_OPTIONS.some((o) => o.value === rawFrom) ? (rawFrom as string) : "";
  const to = TO_TIME_OPTIONS.some((o) => o.value === rawTo) ? (rawTo as string) : "";
  if (from && to && to <= from) return { from, to: "" };
  return { from, to };
}
