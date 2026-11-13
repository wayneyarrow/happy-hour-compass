/**
 * How a venue's hours read for the person looking at them — pure, server +
 * client safe.
 *
 * Venues enter their happy hour and business hours in their own local time,
 * and every status (Open Now, Happy Hour Now, "today") is decided in that
 * venue-local time by src/lib/happyHourStatus.ts. This module only decides
 * which clock the resulting times are *shown* in:
 *
 *   - "same"    the visitor's clock matches the venue's this week → venue
 *               times as entered, no label (unchanged for local visitors).
 *   - "visitor" the visitor is in another timezone → times converted to the
 *               visitor's clock, labelled with their zone, on the visitor's
 *               own day when the conversion crosses midnight.
 *   - "venue"   the visitor's timezone is unknown → venue times as entered,
 *               explicitly labelled as the venue's local time.
 *
 * Labels come from timeZoneLabel() (src/lib/timeZones.ts), deterministic
 * across runtimes.
 */

import {
  formatHhTime,
  weeklyWindowInstants,
  type HhSlot,
  type WindowInstant,
} from "@/lib/happyHourStatus";
import { intlTimeZoneFor, offsetMinutes, timeZoneLabel } from "@/lib/timeZones";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type TimeDisplay =
  | { mode: "same"; timeZone: string; venueTimeZone: string }
  | { mode: "visitor"; timeZone: string; venueTimeZone: string }
  | { mode: "venue"; timeZone: string; venueTimeZone: string };

/**
 * Picks the display clock for a venue in `venueTimeZone` and a visitor in
 * `visitorTimeZone` (null = unknown). "Same" requires matching offsets both
 * now and a week out, so a daylight-saving change mid-week still converts.
 */
export function resolveTimeDisplay(
  venueTimeZone: string,
  visitorTimeZone: string | null,
  now: Date = new Date()
): TimeDisplay {
  if (!visitorTimeZone) return { mode: "venue", timeZone: venueTimeZone, venueTimeZone };
  try {
    const t = now.getTime();
    const week = t + 7 * 86_400_000;
    const same =
      visitorTimeZone === venueTimeZone ||
      (offsetMinutes(visitorTimeZone, t) === offsetMinutes(venueTimeZone, t) &&
        offsetMinutes(visitorTimeZone, week) === offsetMinutes(venueTimeZone, week));
    return same
      ? { mode: "same", timeZone: venueTimeZone, venueTimeZone }
      : { mode: "visitor", timeZone: visitorTimeZone, venueTimeZone };
  } catch {
    return { mode: "venue", timeZone: venueTimeZone, venueTimeZone };
  }
}

/** Short zone label for the display clock at `now`, e.g. "PDT". */
export function displayZoneLabel(display: TimeDisplay, now: Date = new Date()): string {
  return timeZoneLabel(display.timeZone, now.getTime());
}

/**
 * One caption line explaining which clock is shown, or null when none is
 * needed (local visitor). E.g. "Times shown in your time (PDT) · Venue local
 * time: PST" / "Times shown in local time at the venue (PST)".
 */
export function displayCaption(display: TimeDisplay, now: Date = new Date()): string | null {
  const t = now.getTime();
  if (display.mode === "visitor") {
    return `Times shown in your time (${timeZoneLabel(display.timeZone, t)}) · Venue local time: ${timeZoneLabel(display.venueTimeZone, t)}`;
  }
  if (display.mode === "venue") {
    return `Times shown in local time at the venue (${timeZoneLabel(display.venueTimeZone, t)})`;
  }
  return null;
}

// ─── Instant formatting ──────────────────────────────────────────────────────

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsIn(instantMs: number, timeZone: string) {
  const tz = intlTimeZoneFor(timeZone, instantMs);
  let f = timeFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
    });
    timeFormatterCache.set(tz, f);
  }
  const parts = f.formatToParts(new Date(instantMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

/** "4 PM" / "4:30 PM" for `instantMs` on the `timeZone` clock — same style as formatHhTime(). */
export function formatClockTime(instantMs: number, timeZone: string): string {
  const { minutes } = partsIn(instantMs, timeZone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return formatHhTime(`${hh}:${mm}`);
}

/** "Today" | "Tomorrow" | weekday for `instantMs`, relative to `now`, on the `timeZone` clock. */
export function relativeDayLabel(instantMs: number, timeZone: string, now: Date = new Date()): string {
  const target = partsIn(instantMs, timeZone);
  if (target.dateKey === partsIn(now.getTime(), timeZone).dateKey) return "Today";
  if (target.dateKey === partsIn(now.getTime() + 86_400_000, timeZone).dateKey) return "Tomorrow";
  return target.weekday;
}

/**
 * Formatter for computeHhTodayText()'s `formatAt`: venue text as entered
 * unless converting, then the visitor's clock time + zone, with the
 * visitor's day when it isn't their today ("12:30 AM PST tomorrow").
 */
export function instantFormatterFor(display: TimeDisplay, now: Date = new Date()) {
  return (instantMs: number, venueText: string): string => {
    if (display.mode !== "visitor") return venueText;
    const time = `${formatClockTime(instantMs, display.timeZone)} ${timeZoneLabel(display.timeZone, instantMs)}`;
    const day = relativeDayLabel(instantMs, display.timeZone, now);
    return day === "Today" ? time : `${time} ${day === "Tomorrow" ? "tomorrow" : `on ${day}`}`;
  };
}

/**
 * The day + time an upcoming instant reads as in the display clock. Venue
 * values are returned unchanged unless converting.
 */
export function displayDayAndTime(
  display: TimeDisplay,
  instantMs: number,
  venue: { day: string; time: string },
  now: Date = new Date()
): { day: string; time: string } {
  if (display.mode !== "visitor") return venue;
  return {
    day: relativeDayLabel(instantMs, display.timeZone, now),
    time: `${formatClockTime(instantMs, display.timeZone)} ${timeZoneLabel(display.timeZone, instantMs)}`,
  };
}

// ─── Weekly timetables ───────────────────────────────────────────────────────

/** One row of a displayed weekly timetable. */
export type DisplayedDay = { day: string; ranges: string[] };

/**
 * A venue's weekly windows as Sunday→Saturday rows on the display clock.
 * Converting moves each window onto the visitor's own weekday — a venue's
 * Tuesday 11 PM opening is Wednesday for a visitor three hours ahead.
 * `emptyText` fills days with nothing; `extra` adds untimed per-venue-day
 * text (e.g. "All Day" without business hours) on the matching day.
 */
export function buildDisplayedWeek(
  weekly: Record<string, HhSlot[]>,
  display: TimeDisplay,
  options: {
    now?: Date;
    emptyText: string;
    formatRange?: (range: string, w: WindowInstant) => string;
    extraByVenueDay?: Record<string, string>;
  }
): DisplayedDay[] {
  const now = options.now ?? new Date();
  const formatRange = options.formatRange ?? ((range) => range);
  const byDay = new Map<string, Array<{ sortKey: number; text: string }>>();
  const push = (day: string, sortKey: number, text: string) => {
    const list = byDay.get(day) ?? [];
    list.push({ sortKey, text });
    byDay.set(day, list);
  };

  for (const w of weeklyWindowInstants(weekly, display.venueTimeZone, now)) {
    const start = partsIn(w.startMs, display.timeZone);
    const range = `${formatClockTime(w.startMs, display.timeZone)}–${formatClockTime(w.endMs, display.timeZone)}`;
    push(display.mode === "visitor" ? start.weekday : w.venueDay, start.minutes, formatRange(range, w));
  }
  for (const [venueDay, text] of Object.entries(options.extraByVenueDay ?? {})) {
    push(venueDay, -1, text);
  }

  return DAY_NAMES.map((day) => {
    const list = (byDay.get(day) ?? []).sort((a, b) => a.sortKey - b.sortKey);
    return { day, ranges: list.length > 0 ? list.map((x) => x.text) : [options.emptyText] };
  });
}
