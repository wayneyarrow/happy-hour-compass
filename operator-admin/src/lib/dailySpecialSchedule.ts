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
  DESCRIPTION_MAX_LENGTH,
  SHORT_SUMMARY_MAX_LENGTH,
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

// ─────────────────────────────────────────────────────────────────────────────
// Content length validation (Phase 2 correction)
//
// Application-layer only — no DB CHECK constraint backs these limits (no
// migration was made for this; see SHORT_SUMMARY_MAX_LENGTH/
// DESCRIPTION_MAX_LENGTH's own comment in dailySpecialTypes.ts). Shared by
// both the Operator Admin form (client-side pre-check) and
// saveDailySpecialAction (authoritative). Conditions has no limit here —
// not requested, existing behavior preserved.
// ─────────────────────────────────────────────────────────────────────────────

export type DailySpecialContentInput = {
  shortSummary: string | null;
  description: string | null;
};

export function validateDailySpecialContent(
  input: DailySpecialContentInput
): ScheduleValidationResult {
  const errors: string[] = [];

  if (input.shortSummary && input.shortSummary.length > SHORT_SUMMARY_MAX_LENGTH) {
    errors.push(`Short summary must be ${SHORT_SUMMARY_MAX_LENGTH} characters or fewer.`);
  }
  if (input.description && input.description.length > DESCRIPTION_MAX_LENGTH) {
    // DESCRIPTION_MAX_LENGTH is fixed at 1000 — the comma is written
    // literally here rather than derived via locale-dependent formatting
    // (Intl.NumberFormat/toLocaleString can vary by environment), so this
    // message is guaranteed to read exactly "1,000 characters or fewer."
    errors.push("Description must be 1,000 characters or fewer.");
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumer discovery — WHEN filter matching (Phase 3)
//
// Shared, framework-agnostic date/day logic used by the website Daily
// Specials search results page. Presentation (labels/copy) stays in
// src/app/(website)/dailySpecialConsumerLabels.ts — this is filtering
// behavior only.
// ─────────────────────────────────────────────────────────────────────────────

export type WhenFilter = "today" | Weekday | null;

/**
 * The ISO "YYYY-MM-DD" date of the next occurrence of `weekday` on or after
 * `todayIsoDate` — returns `todayIsoDate` itself when today already falls
 * on that weekday (i.e. "next occurrence, inclusive of today").
 */
export function nextDateForWeekday(todayIsoDate: string, weekday: Weekday): string {
  const todayDow = getWeekdayFromIsoDate(todayIsoDate);
  if (todayDow === null) return todayIsoDate;

  const diffDays = (weekday - todayDow + 7) % 7;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayIsoDate);
  if (!m) return todayIsoDate;

  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  date.setUTCDate(date.getUTCDate() + diffDays);

  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/**
 * Does this schedule match the consumer WHEN filter?
 *
 * filter = null    -> always true (no day filter applied — "browse all").
 * filter = "today"  -> delegates entirely to occursOnDate() against
 *                      todayIsoDate — a one-time Special matches only on
 *                      its exact date; a weekly Special matches when
 *                      today's weekday is selected AND today falls inside
 *                      its recurrence validity window.
 * filter = a Weekday (browsing e.g. "Wednesday", not necessarily today) ->
 *   Resolved against the UPCOMING concrete calendar date for that weekday
 *   (nextDateForWeekday) — this is "the selected consumer context's actual
 *   date" the product rule requires recurrence validity to be checked
 *   against, since a bare weekday name alone has no date of its own:
 *     - Weekly: weekday must be selected AND that upcoming date must fall
 *       inside the optional recurrence validity window.
 *     - One-time: matches ONLY if its stored one_time_date is EXACTLY that
 *       upcoming date — never merely "any one-time Special whose date
 *       happens to fall on this weekday", which would incorrectly resurrect
 *       an old or far-future one-time Special every time its weekday comes
 *       up in browsing (the exact failure mode the product rule warns
 *       against). This is stricter than Events' eventOccursOnDow(), which
 *       has no equivalent "arbitrary weekday browse" filter to begin with
 *       (Events only offers Today/Tomorrow/Weekend chips, not a full
 *       weekday picker) — there is no existing Events convention to
 *       directly copy for this case, so this rule was authored fresh
 *       against the product brief's explicit guidance.
 */
export function dailySpecialMatchesWhenFilter(
  schedule: DailySpecialSchedule,
  filter: WhenFilter,
  todayIsoDate: string
): boolean {
  if (filter === null) return true;
  if (filter === "today") return occursOnDate(schedule, todayIsoDate);

  const targetDate = nextDateForWeekday(todayIsoDate, filter);

  if (schedule.scheduleType === "one_time") {
    return schedule.oneTimeDate === targetDate;
  }

  if (!weeklyIncludesWeekday(schedule.daysOfWeek, filter)) return false;
  return isWithinRecurrenceValidity(schedule, targetDate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumer discovery — text search matching (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export type DailySpecialSearchableContent = {
  title: string;
  shortSummary: string | null;
  description: string | null;
};

/**
 * Case-insensitive substring match across title, short summary, and
 * description — exactly the three fields the product brief names, nothing
 * more (no conditions, no structured offer-item data to search since none
 * exists). An empty/whitespace-only query always matches (no search
 * applied), matching the Happy Hours/Events search pages' own convention
 * of treating a blank query as "no filter".
 */
export function dailySpecialMatchesSearch(
  content: DailySpecialSearchableContent,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  return (
    content.title.toLowerCase().includes(q) ||
    (content.shortSummary?.toLowerCase().includes(q) ?? false) ||
    (content.description?.toLowerCase().includes(q) ?? false)
  );
}
