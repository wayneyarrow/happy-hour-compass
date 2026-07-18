import type { DayOfWeek } from "./types";

/** Ordered array of every day of the week (Mon → Sun). */
export const DAYS_OF_WEEK: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Human-readable label for each day. */
export const DAY_LABELS: Record<DayOfWeek, string> = {
  monday:    "Monday",
  tuesday:   "Tuesday",
  wednesday: "Wednesday",
  thursday:  "Thursday",
  friday:    "Friday",
  saturday:  "Saturday",
  sunday:    "Sunday",
};

/**
 * Time-entry step (minutes) for the native <input type="time"> controls in
 * BusinessHoursForm — matches the previous hour/minute/period select trio's
 * granularity (minute options were "00" | "15" | "30" | "45") exactly, so
 * this UI change doesn't silently narrow what operators can already select.
 * Deliberately not shared with the Happy Hours time editor (HhTimesForm.tsx)
 * even though it happens to use the same value today — these are two
 * independent business rules that could diverge, not one shared constant.
 */
export const HOURS_STEP_MINUTES = 15;
export const HOURS_STEP_SECONDS = HOURS_STEP_MINUTES * 60;

/** Matches a valid 24-hour "HH:MM" string, e.g. "09:00" or "22:30". */
export const TIME_24H_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
