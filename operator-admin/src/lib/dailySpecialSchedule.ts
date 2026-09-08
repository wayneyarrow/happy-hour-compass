/**
 * Pure, framework-agnostic Daily Specials scheduling/occurrence helpers.
 *
 * No "use client"/"use server" directive — importable from Operator Admin,
 * consumer/website, and Control Panel code alike once those phases build on
 * it (see src/lib/dailySpecialTypes.ts's header for the file-split
 * rationale). No I/O, no Supabase — every function here is a straight unit
 * of date/day-of-week logic, directly unit-testable without mocking
 * anything (same rationale src/lib/venueSubscriptions.ts's header gives for
 * extracting resolvePlanCodeFromVenueSubscription()/highestPlan()).
 *
 * Scope (Phase 1, per the task brief):
 *   - Date/day occurrence logic only.
 *   - NO current-time / "Available Now" calculations — every function here
 *     takes an explicit reference date, never reads the real clock itself.
 *   - NO resolution of end_mode = 'close' against a venue's actual business
 *     hours — "Close" stays semantic; nothing here touches venues.business_hours.
 */

import {
  isEndMode,
  isScheduleType,
  isTimeMode,
  isWeekday,
  WEEKDAY_LABELS_LONG,
  WEEKDAY_LABELS_SHORT,
  type DailySpecialSchedule,
  type DailySpecialWeeklySchedule,
  type EndMode,
  type ScheduleType,
  type TimeMode,
  type Weekday,
} from "./dailySpecialTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a "YYYY-MM-DD" string into its weekday (0=Sunday..6=Saturday) using
 * UTC, so the result is identical regardless of the server's local
 * timezone — same technique and same rationale as parseIsoDate() in
 * src/lib/data/events.ts. Returns null for a malformed date string.
 */
export function getWeekdayFromIsoDate(isoDate: string): Weekday | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow as Weekday;
}

// ─────────────────────────────────────────────────────────────────────────────
// Occurrence helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Does the given weekday appear in this weekly special's selected days? */
export function weeklyIncludesWeekday(daysOfWeek: Weekday[], weekday: Weekday): boolean {
  return daysOfWeek.includes(weekday);
}

/**
 * Is `isoDate` inside the recurrence validity window? NULL start = already
 * active / no start boundary; NULL end = continues indefinitely — matches
 * daily_specials_recurrence_date_order_check's semantics exactly. ISO
 * "YYYY-MM-DD" strings compare correctly as plain strings, so no Date
 * object (and no timezone ambiguity) is needed here.
 */
export function isWithinRecurrenceValidity(
  schedule: Pick<DailySpecialWeeklySchedule, "recurrenceStartDate" | "recurrenceEndDate">,
  isoDate: string
): boolean {
  if (schedule.recurrenceStartDate && isoDate < schedule.recurrenceStartDate) return false;
  if (schedule.recurrenceEndDate && isoDate > schedule.recurrenceEndDate) return false;
  return true;
}

/**
 * Is this recurring (weekly) special currently active BY DATE — i.e. is
 * `todayIsoDate` inside its validity window? This does not check weekday —
 * a special can be "currently active" on a date it doesn't actually run on
 * (e.g. a Wednesday special is still "active" on a Thursday within its
 * validity window; it just doesn't occur that day). Thin, explicitly-named
 * wrapper over isWithinRecurrenceValidity() for callers that want the
 * "is this special live right now" question specifically (e.g. an
 * Operator Admin list badge), matching the task brief's own naming.
 */
export function isRecurringSpecialCurrentlyActive(
  schedule: Pick<DailySpecialWeeklySchedule, "recurrenceStartDate" | "recurrenceEndDate">,
  todayIsoDate: string
): boolean {
  return isWithinRecurrenceValidity(schedule, todayIsoDate);
}

/** Is a one-time special's date in the past relative to `todayIsoDate`? */
export function isOneTimeSpecialExpired(oneTimeDate: string, todayIsoDate: string): boolean {
  return oneTimeDate < todayIsoDate;
}

/**
 * Does this special occur on the given calendar date?
 *   one_time — exact date match.
 *   weekly   — the date's weekday is selected AND the date falls inside
 *              the recurrence validity window (if any).
 */
export function occursOnDate(schedule: DailySpecialSchedule, isoDate: string): boolean {
  if (schedule.scheduleType === "one_time") {
    return schedule.oneTimeDate === isoDate;
  }

  const weekday = getWeekdayFromIsoDate(isoDate);
  if (weekday === null) return false;
  if (!weeklyIncludesWeekday(schedule.daysOfWeek, weekday)) return false;
  return isWithinRecurrenceValidity(schedule, isoDate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable weekday formatting
//
// Modest, general-purpose formatter (collapses consecutive runs) — not
// tuned to any one specific phrase from the product brief ("Saturday and
// Sunday" etc.). Presentation copy is a later phase's concern; this exists
// because "Human-readable weekday handling where useful" was named
// explicitly in the Phase 1 task brief as a helper worth having now.
// ─────────────────────────────────────────────────────────────────────────────

export function formatDaysOfWeek(
  daysOfWeek: Weekday[],
  style: "short" | "long" = "short"
): string {
  if (daysOfWeek.length === 0) return "";

  const labels = style === "short" ? WEEKDAY_LABELS_SHORT : WEEKDAY_LABELS_LONG;
  const sorted = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  if (sorted.length === 1) return labels[sorted[0]];

  // Group into consecutive runs, e.g. [1,2,3,4,5] -> one run [1..5].
  const runs: Weekday[][] = [];
  for (const day of sorted) {
    const lastRun = runs[runs.length - 1];
    if (lastRun && lastRun[lastRun.length - 1] === day - 1) {
      lastRun.push(day);
    } else {
      runs.push([day]);
    }
  }

  const parts = runs.map((run) =>
    run.length >= 3
      ? `${labels[run[0]]}-${labels[run[run.length - 1]]}`
      : run.map((d) => labels[d]).join(" & ")
  );

  if (parts.length === 1) return parts[0];

  // Exactly two single-day groups reads better joined with "&" (e.g. "Sun & Sat")
  // than a comma list.
  const allSingleDayRuns = runs.length === 2 && runs.every((r) => r.length === 1);
  return parts.join(allSingleDayRuns ? " & " : ", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side validation (mirrors the DB CHECK constraints)
//
// The database (091_daily_specials_foundation.sql) is the authoritative,
// final enforcement point — these functions exist so a future server
// action can return clean, field-level errors BEFORE touching the
// database, the same "cheap validation first" shape every other protected
// server action in this codebase already follows (see CLAUDE.md's Bot
// Protection section). Kept in exact lockstep with the CHECK constraints —
// if the schema changes, update both.
// ─────────────────────────────────────────────────────────────────────────────

export type DailySpecialScheduleInput = {
  scheduleType: ScheduleType | string;
  oneTimeDate: string | null;
  daysOfWeek: number[] | null;
  recurrenceStartDate: string | null;
  recurrenceEndDate: string | null;
};

export type DailySpecialTimeInput = {
  timeMode: TimeMode | string;
  startTime: string | null;
  endMode: EndMode | string;
  endTime: string | null;
};

export type ScheduleValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

/** Validates a proposed schedule against daily_specials_schedule_fields_check et al. */
export function validateDailySpecialSchedule(
  input: DailySpecialScheduleInput
): ScheduleValidationResult {
  const errors: string[] = [];

  if (!isScheduleType(input.scheduleType)) {
    return { valid: false, errors: ["scheduleType must be 'one_time' or 'weekly'."] };
  }

  if (input.scheduleType === "one_time") {
    if (!input.oneTimeDate) errors.push("A one-time special requires a date.");
    if (input.daysOfWeek && input.daysOfWeek.length > 0) {
      errors.push("A one-time special cannot have weekdays selected.");
    }
    if (input.recurrenceStartDate || input.recurrenceEndDate) {
      errors.push("A one-time special cannot have a recurrence date range.");
    }
  } else {
    if (input.oneTimeDate) errors.push("A weekly special cannot have a one-time date.");

    if (!input.daysOfWeek || input.daysOfWeek.length === 0) {
      errors.push("A weekly special requires at least one weekday.");
    } else {
      const invalid = input.daysOfWeek.filter((d) => !isWeekday(d));
      if (invalid.length > 0) {
        errors.push(`Invalid weekday value(s): ${invalid.join(", ")}. Must be 0-6.`);
      }
      if (new Set(input.daysOfWeek).size !== input.daysOfWeek.length) {
        errors.push("Duplicate weekday values are not allowed.");
      }
    }

    if (
      input.recurrenceStartDate &&
      input.recurrenceEndDate &&
      input.recurrenceEndDate < input.recurrenceStartDate
    ) {
      errors.push("Recurrence end date cannot be earlier than the start date.");
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/** Validates a proposed time shape against daily_specials_end_mode_check et al. */
export function validateDailySpecialTime(
  input: DailySpecialTimeInput
): ScheduleValidationResult {
  const errors: string[] = [];

  if (!isTimeMode(input.timeMode)) {
    return { valid: false, errors: ["timeMode must be 'unspecified', 'all_day', or 'timed'."] };
  }
  if (!isEndMode(input.endMode)) {
    return { valid: false, errors: ["endMode must be 'unspecified', 'time', or 'close'."] };
  }

  // end_mode <-> end_time consistency (independent of time_mode).
  if (input.endMode === "time" && !input.endTime) {
    errors.push("An end time is required when the end is set to a specific time.");
  }
  if (input.endMode === "close" && input.endTime) {
    errors.push("End time must be empty when the end is set to Close — Close is semantic, not a clock time.");
  }
  if (input.endMode === "unspecified" && input.endTime) {
    errors.push("End time must be empty when no end is specified.");
  }

  if (input.timeMode === "all_day" || input.timeMode === "unspecified") {
    if (input.startTime) {
      errors.push(`Start time must be empty when the time is ${input.timeMode === "all_day" ? "All Day" : "unspecified"}.`);
    }
    if (input.endMode !== "unspecified") {
      errors.push(`End must be unspecified when the time is ${input.timeMode === "all_day" ? "All Day" : "unspecified"}.`);
    }
  }

  if (input.timeMode === "timed") {
    if (!input.startTime && input.endMode === "unspecified") {
      errors.push("A timed special needs a start time, an end time, or Close.");
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
