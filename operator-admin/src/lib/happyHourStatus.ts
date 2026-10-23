/**
 * Happy Hour schedule + status engine for the public website — pure,
 * server + client safe.
 *
 * Every website surface that shows Happy Hour status (venue page pills,
 * action card, schedule card, search/rail cards, map markers, and the
 * "On Now" filter) goes through this one module so they can never disagree.
 *
 * Rules:
 *   - Venue-local time. "Now" is always read in the venue's market timezone
 *     (getMarketTimeZone), never the visitor's or the server's clock, so the
 *     same instant gives the same answer everywhere.
 *   - Start inclusive, end exclusive.
 *   - Overnight windows: an end at or before the start ends on the next day
 *     ("21:00"–"01:00" runs Friday 9 PM → Saturday 1 AM; "22:00"–"00:00"
 *     ends at midnight). A window belongs to the day it starts on; its
 *     after-midnight portion is checked as the previous day's carryover,
 *     including Saturday → Sunday rollover.
 *   - "All Day" days (ConsumerVenue.happyHourAllDayDays) use that day's
 *     business hours. Without usable business hours the day is shown as
 *     "All Day" but never reported as on now and never matched by time.
 */

import { getMarketTimeZone } from "@/lib/marketLocalDate";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MINUTES_PER_DAY = 1440;

export type HhSlot = {
  /** "HH:MM" 24-hour. */
  start: string;
  /** "HH:MM" 24-hour, or the legacy literal "close" (midnight). */
  end: string;
  /** True when this window comes from an "All Day" entry + business hours. */
  allDay?: boolean;
};

/**
 * Everything needed to evaluate a venue's Happy Hour at any instant. Plain
 * JSON so it can be built server-side and passed to client components.
 */
export type HhSchedule = {
  weekly: Record<string, HhSlot[]>;
  /** IANA timezone of the venue's market. */
  timeZone: string;
  /** "All Day" days with no usable business hours — shown, never "on now". */
  allDayWithoutHours: string[];
};

/**
 * Builds the website schedule for a venue: explicit slots as stored, plus
 * "All Day" days resolved against that day's business hours.
 */
export function buildHhSchedule(venue: {
  happyHourWeekly: Record<string, Array<{ start: string; end: string }>>;
  happyHourAllDayDays?: string[];
  hoursWeekly: Record<string, string>;
  marketSlug: string | null;
}): HhSchedule {
  const weekly: Record<string, HhSlot[]> = {};
  const allDayWithoutHours: string[] = [];
  for (const day of DAY_NAMES) {
    weekly[day] = [...(venue.happyHourWeekly[day] ?? [])];
    if (weekly[day].length > 0 || !venue.happyHourAllDayDays?.includes(day)) continue;
    const hours = parseBusinessHoursEntry(venue.hoursWeekly[day]);
    if (hours) weekly[day].push({ ...hours, allDay: true });
    else allDayWithoutHours.push(day);
  }
  return {
    weekly,
    timeZone: getMarketTimeZone(venue.marketSlug ?? ""),
    allDayWithoutHours,
  };
}

/** True when the schedule has anything to show (slots or unresolved "All Day"). */
export function hasAnyHappyHour(schedule: HhSchedule): boolean {
  return (
    schedule.allDayWithoutHours.length > 0 ||
    Object.values(schedule.weekly).some((slots) => slots.length > 0)
  );
}

/** True when `dayName` has a valid window or an "All Day" entry. */
export function hasHappyHourOnDay(schedule: HhSchedule, dayName: string): boolean {
  return (
    schedule.allDayWithoutHours.includes(dayName) ||
    (schedule.weekly[dayName] ?? []).some((slot) => slotMinutes(slot) !== null)
  );
}

// ─── Time helpers ────────────────────────────────────────────────────────────

function hhmmToMinutes(t: string): number | null {
  if (t === "close") return MINUTES_PER_DAY;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * A slot's [start, end) in minutes from the start of its own day. `end` may
 * exceed 1440 for an overnight window. Null for a malformed slot ("close" is
 * never a valid start).
 */
export function slotMinutes(slot: HhSlot): { start: number; end: number } | null {
  if (slot.start === "close") return null;
  const start = hhmmToMinutes(slot.start);
  let end = hhmmToMinutes(slot.end);
  if (start === null || end === null || start >= MINUTES_PER_DAY) return null;
  if (end <= start) end += MINUTES_PER_DAY;
  return { start, end };
}

/** Parses a hoursWeekly entry ("11:00 AM - 10:00 PM" | "CLOSED") to a slot. */
function parseBusinessHoursEntry(entry: string | undefined): { start: string; end: string } | null {
  if (!entry || entry === "CLOSED") return null;
  const parts = entry.split(" - ");
  if (parts.length !== 2) return null;
  const start = amPmToHhmm(parts[0]);
  const end = amPmToHhmm(parts[1]);
  if (!start || !end) return null;
  return { start, end };
}

function amPmToHhmm(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 1 || h > 12 || min > 59) return null;
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
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
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of `instant` in `timeZone`, reinterpreted as UTC ms. */
function wallClockAsUtcMs(instant: Date, timeZone: string): number {
  const parts = wallClockFormatter(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Venue-local weekday index (0 = Sunday) and minutes since local midnight. */
function localClock(now: Date, timeZone: string): { dayIndex: number; minutes: number } {
  const wall = new Date(wallClockAsUtcMs(now, timeZone));
  return {
    dayIndex: wall.getUTCDay(),
    minutes: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
  };
}

/** The venue-local weekday name ("Sunday".."Saturday") at `now`. */
export function getVenueLocalDayName(timeZone: string, now: Date = new Date()): string {
  return DAY_NAMES[localClock(now, timeZone).dayIndex];
}

/**
 * Real minutes until a venue-local wall time `wallMinutesAhead` minutes
 * ahead — corrects for a daylight-saving change in between, so a window
 * ending at 3 AM on a spring-forward night counts one hour less.
 */
function realMinutesUntil(now: Date, timeZone: string, wallMinutesAhead: number): number {
  const offsetAt = (d: Date) => (wallClockAsUtcMs(d, timeZone) - d.getTime()) / 60000;
  const estimate = new Date(now.getTime() + wallMinutesAhead * 60000);
  return Math.round(wallMinutesAhead - (offsetAt(estimate) - offsetAt(now)));
}

// ─── Active window ───────────────────────────────────────────────────────────

/**
 * The window active at `now`, with real minutes remaining — today's windows
 * first, then yesterday's overnight carryover. Null when none.
 */
function findActiveWindow(
  schedule: HhSchedule,
  now: Date
): { slot: HhSlot; day: string; minutesLeft: number } | null {
  const { dayIndex, minutes } = localClock(now, schedule.timeZone);
  const today = DAY_NAMES[dayIndex];
  const yesterday = DAY_NAMES[(dayIndex + 6) % 7];

  for (const slot of schedule.weekly[today] ?? []) {
    const r = slotMinutes(slot);
    if (r && minutes >= r.start && minutes < r.end) {
      return { slot, day: today, minutesLeft: realMinutesUntil(now, schedule.timeZone, r.end - minutes) };
    }
  }
  const sinceYesterday = minutes + MINUTES_PER_DAY;
  for (const slot of schedule.weekly[yesterday] ?? []) {
    const r = slotMinutes(slot);
    if (r && sinceYesterday >= r.start && sinceYesterday < r.end) {
      return { slot, day: yesterday, minutesLeft: realMinutesUntil(now, schedule.timeZone, r.end - sinceYesterday) };
    }
  }
  return null;
}

/** True when a Happy Hour window is running at `now` (venue-local). */
export function isHappyHourActive(schedule: HhSchedule, now: Date = new Date()): boolean {
  return findActiveWindow(schedule, now) !== null;
}

/**
 * The day the window active at `now` started on (yesterday for an overnight
 * carryover), or null when none is active. On Now evaluates the Day/Time
 * filters against this day, so a carryover window isn't dropped by them.
 */
export function getActiveHappyHourDay(schedule: HhSchedule, now: Date = new Date()): string | null {
  return findActiveWindow(schedule, now)?.day ?? null;
}

/**
 * True when any window on one of `days` (all days when null) overlaps the
 * venue-local range [fromMin, toMin) of that same day. Overnight windows
 * are compared on their full span, so a 9 PM–1 AM window matches 10 PM–Midnight.
 */
export function hasHappyHourOverlap(
  schedule: HhSchedule,
  days: string[] | null,
  fromMin: number,
  toMin: number
): boolean {
  return (days ?? [...DAY_NAMES]).some((day) =>
    (schedule.weekly[day] ?? []).some((slot) => {
      const r = slotMinutes(slot);
      return r !== null && r.start < toMin && r.end > fromMin;
    })
  );
}

// ─── Display ─────────────────────────────────────────────────────────────────

/** "HH:MM" → "4 PM" / "4:30 PM"; "close" or "24:00" → "Close" / "12 AM". */
export function formatHhTime(t: string): string {
  if (t === "close") return "Close";
  const total = hhmmToMinutes(t);
  if (total === null) return t;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const period = h >= 12 ? "PM" : "AM";
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}${m > 0 ? ":" + String(m).padStart(2, "0") : ""} ${period}`;
}

function formatEndsIn(diff: number): string {
  const d = Math.max(1, diff);
  const h = Math.floor(d / 60);
  const m = d % 60;
  if (h > 0 && m > 0) return `Ends in ${h} hr ${m} min`;
  if (h > 0) return `Ends in ${h} hr`;
  return `Ends in ${m} min`;
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Card/pill status.
 *   - active:   a window is running now (`until` = its end, e.g. "1 AM").
 *   - upcoming: next window on `day` ("Today" | "Tomorrow" | weekday).
 *   - allDay:   the next Happy Hour day is "All Day" with no usable
 *               business hours — no times are invented.
 *   - none:     nothing this week.
 */
export type HhStatus =
  | { type: "active"; endsIn: string; until: string }
  | { type: "upcoming"; day: string; startsAt: string; endsAt: string }
  | { type: "allDay"; day: string }
  | { type: "none" };

function dayLabel(offset: number, name: string): string {
  return offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : name;
}

function firstSlotStatus(slots: HhSlot[], day: string): HhStatus | null {
  const valid = slots
    .map((slot) => ({ slot, r: slotMinutes(slot) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r!.start - b.r!.start);
  if (valid.length === 0) return null;
  const { slot } = valid[0];
  return { type: "upcoming", day, startsAt: formatHhTime(slot.start), endsAt: formatHhTime(slot.end) };
}

/**
 * Status at `now` (venue-local):
 *   1. A window is active (today's, or yesterday's overnight carryover).
 *   2. A later window starts today.
 *   3. Today is an unresolved "All Day" day.
 *   4. The next day (up to a week ahead) with Happy Hour.
 */
export function computeHhStatus(schedule: HhSchedule, now: Date = new Date()): HhStatus {
  const active = findActiveWindow(schedule, now);
  if (active) {
    return {
      type: "active",
      endsIn: formatEndsIn(active.minutesLeft),
      until: formatHhTime(active.slot.end),
    };
  }

  const { dayIndex, minutes } = localClock(now, schedule.timeZone);
  const today = DAY_NAMES[dayIndex];
  const laterToday = (schedule.weekly[today] ?? []).filter((slot) => {
    const r = slotMinutes(slot);
    return r !== null && r.start > minutes;
  });
  const todayStatus = firstSlotStatus(laterToday, "Today");
  if (todayStatus) return todayStatus;
  if (schedule.allDayWithoutHours.includes(today)) return { type: "allDay", day: "Today" };

  for (let i = 1; i <= 7; i++) {
    const name = DAY_NAMES[(dayIndex + i) % 7];
    const status = firstSlotStatus(schedule.weekly[name] ?? [], dayLabel(i, name));
    if (status) return status;
    if (schedule.allDayWithoutHours.includes(name)) return { type: "allDay", day: dayLabel(i, name) };
  }
  return { type: "none" };
}

/**
 * Status for a Day-filtered card. When `targetDayName` is the venue's
 * current local day this is computeHhStatus(); for any other day the venue
 * can't be on now, so it shows that day's first window (or "All Day").
 */
export function computeHhStatusForDay(
  schedule: HhSchedule,
  targetDayName: string,
  now: Date = new Date()
): HhStatus {
  if (targetDayName === getVenueLocalDayName(schedule.timeZone, now)) {
    return computeHhStatus(schedule, now);
  }
  const status = firstSlotStatus(schedule.weekly[targetDayName] ?? [], targetDayName);
  if (status) return status;
  if (schedule.allDayWithoutHours.includes(targetDayName)) return { type: "allDay", day: targetDayName };
  return { type: "none" };
}

/**
 * Detail-page "Today:" line (the schedule card), venue-local.
 */
export function computeHhTodayText(
  schedule: HhSchedule,
  now: Date = new Date()
): { text: string; isActive: boolean } {
  const active = findActiveWindow(schedule, now);
  if (active) return { text: `On now · until ${formatHhTime(active.slot.end)}`, isActive: true };

  const { dayIndex, minutes } = localClock(now, schedule.timeZone);
  const today = DAY_NAMES[dayIndex];
  const todayRanges = (schedule.weekly[today] ?? [])
    .map((slot) => ({ slot, r: slotMinutes(slot) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r!.start - b.r!.start);

  const next = todayRanges.find((x) => x.r!.start > minutes);
  if (next) return { text: `Starts at ${formatHhTime(next.slot.start)}`, isActive: false };
  if (todayRanges.length > 0) {
    const last = todayRanges[todayRanges.length - 1];
    return { text: `Ended at ${formatHhTime(last.slot.end)}`, isActive: false };
  }
  if (schedule.allDayWithoutHours.includes(today)) return { text: "All Day", isActive: false };

  for (let i = 1; i <= 7; i++) {
    const name = DAY_NAMES[(dayIndex + i) % 7];
    if (hasHappyHourOnDay(schedule, name)) {
      return { text: `No happy hour today · Next: ${i === 1 ? "Tomorrow" : name}`, isActive: false };
    }
  }
  return { text: "No happy hour this week", isActive: false };
}

/** Weekly-timetable text for one day, e.g. "4 PM–6 PM, 9 PM–1 AM" or "All Day". */
export function formatHhDay(schedule: HhSchedule, dayName: string): string {
  const slots = (schedule.weekly[dayName] ?? []).filter((slot) => slotMinutes(slot) !== null);
  if (slots.length === 0) {
    return schedule.allDayWithoutHours.includes(dayName) ? "All Day" : "No happy hour";
  }
  return slots
    .map((slot) => {
      const range = `${formatHhTime(slot.start)}–${formatHhTime(slot.end)}`;
      return slot.allDay ? `All Day (${range})` : range;
    })
    .join(", ");
}
