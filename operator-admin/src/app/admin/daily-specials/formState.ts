/**
 * Daily Special form state — pure hydration (DB row -> form state) and
 * payload-building (form state -> save payload) logic, extracted from the
 * form component so it is directly unit-testable without a DOM/React
 * renderer (this repo's test runner is plain node:test — no React Testing
 * Library/jsdom is wired up). EventForm.tsx keeps this logic inline and
 * untested; Daily Specials extracts it instead, the same reasoning
 * src/lib/dailySpecialAuthorization.ts's header gives for extracting the
 * save-authorization decision.
 */

import {
  isEndMode,
  isScheduleType,
  isTimeMode,
  isWeekday,
  type DailySpecialDbRow,
  type EndMode,
  type ScheduleType,
  type TimeMode,
  type Weekday,
} from "@/lib/dailySpecialTypes";
import type { DailySpecialSavePayload } from "./actions";

// ── Row shape (as read by the manager/page) ─────────────────────────────────
//
// Reuses Phase 1's DailySpecialDbRow verbatim (id, venue_id, offer_type,
// schedule_type, is_seeded_special, source_url, last_verified_at, etc.)
// rather than declaring a second, near-duplicate row type — this also lets
// the manager/list reuse coerceDailySpecialRow() directly for schedule/time
// summary labels. source_url/last_verified_at are present on the row (the
// server query selects every column) but are never rendered or made
// editable anywhere in this route — see DailySpecialSavePayload's own doc
// comment for why they're absent from the save payload entirely.
export type DailySpecialRow = DailySpecialDbRow;

// ── Form state ────────────────────────────────────────────────────────────────

export type DailySpecialFormState = {
  title: string;
  /** OfferType or "" (not yet chosen). */
  offerType: string;
  shortSummary: string;
  description: string;
  conditions: string;
  scheduleType: ScheduleType;
  /** ISO "YYYY-MM-DD" or "". */
  oneTimeDate: string;
  daysOfWeek: Weekday[];
  recurrenceStartDate: string;
  recurrenceEndDate: string;
  timeMode: TimeMode;
  /** "HH:MM" (native <input type="time"> value shape) or "". */
  startTime: string;
  endMode: EndMode;
  endTime: string;
  isPublished: boolean;
};

export const EMPTY_FORM_STATE: DailySpecialFormState = {
  title: "",
  offerType: "",
  shortSummary: "",
  description: "",
  conditions: "",
  scheduleType: "one_time",
  oneTimeDate: "",
  daysOfWeek: [],
  recurrenceStartDate: "",
  recurrenceEndDate: "",
  timeMode: "unspecified",
  startTime: "",
  endMode: "unspecified",
  endTime: "",
  isPublished: false,
};

/** "16:00:00" (Postgres TIME serialization) or "16:00" -> "16:00" (native time input value). */
function normalizeTimeInputValue(dbTime: string): string {
  const m = /^(\d{2}:\d{2})/.exec(dbTime);
  return m ? m[1] : dbTime;
}

/** Toggles one weekday in/out of a selection, keeping the array sorted ascending. */
export function toggleWeekday(daysOfWeek: Weekday[], day: Weekday): Weekday[] {
  return daysOfWeek.includes(day)
    ? daysOfWeek.filter((d) => d !== day)
    : [...daysOfWeek, day].sort((a, b) => a - b);
}

/**
 * Transitions form state into "Specific hours" (timeMode = "timed") with
 * End defaulted to "No end time" (endMode = "unspecified", endTime = "").
 * Used by the time-mode radio's onChange handler — passed directly as a
 * React functional state updater (`setFormState(enterSpecificHours)`).
 *
 * This only ever resets an IN-SESSION, unsaved End/end-time choice (e.g.
 * the operator picked "Close" a moment ago, switched to "All day", then
 * back to "Specific hours"). It is never invoked during edit hydration —
 * hydrateFormState() is a separate code path called once on mount — so an
 * existing saved Special's actual stored end_mode is never altered by
 * this; only the in-memory form state of a not-yet-saved change is.
 */
export function enterSpecificHours(prev: DailySpecialFormState): DailySpecialFormState {
  return { ...prev, timeMode: "timed", endMode: "unspecified", endTime: "" };
}

/**
 * Hydrates form state from a persisted row. Every field round-trips
 * losslessly: one-time/weekly, single/multi-weekday, seasonal validity
 * dates, and every time_mode/end_mode combination (including Close) are
 * all preserved exactly as stored.
 */
export function hydrateFormState(row: DailySpecialRow): DailySpecialFormState {
  const scheduleType: ScheduleType = isScheduleType(row.schedule_type) ? row.schedule_type : "one_time";
  const timeMode: TimeMode = isTimeMode(row.time_mode) ? row.time_mode : "unspecified";
  const endMode: EndMode = isEndMode(row.end_mode) ? row.end_mode : "unspecified";

  return {
    title: row.title ?? "",
    offerType: row.offer_type ?? "",
    shortSummary: row.short_summary ?? "",
    description: row.description ?? "",
    conditions: row.conditions ?? "",
    scheduleType,
    oneTimeDate: row.one_time_date ?? "",
    daysOfWeek: (row.days_of_week ?? []).filter(isWeekday) as Weekday[],
    recurrenceStartDate: row.recurrence_start_date ?? "",
    recurrenceEndDate: row.recurrence_end_date ?? "",
    timeMode,
    startTime: row.start_time ? normalizeTimeInputValue(row.start_time) : "",
    endMode,
    endTime: row.end_time ? normalizeTimeInputValue(row.end_time) : "",
    isPublished: row.is_published ?? false,
  };
}

/**
 * Builds the save payload from form state. Mirrors saveDailySpecialAction's
 * own field-derivation exactly (isOneTime/isTimed branches null out the
 * fields that don't apply to the selected schedule_type/time_mode) so the
 * client and server never disagree about what a given form state means.
 *
 * Never includes is_seeded_special / source_url / last_verified_at — those
 * are HHC provenance fields, not part of the operator-editable payload at
 * all (see DailySpecialSavePayload's own doc comment).
 */
export function buildSavePayload(
  formState: DailySpecialFormState,
  venueId: string
): DailySpecialSavePayload {
  const isOneTime = formState.scheduleType === "one_time";
  const isTimed = formState.timeMode === "timed";

  return {
    venueId,
    title: formState.title.trim(),
    offerType: formState.offerType,
    shortSummary: formState.shortSummary.trim() || null,
    description: formState.description.trim() || null,
    conditions: formState.conditions.trim() || null,
    scheduleType: formState.scheduleType,
    oneTimeDate: isOneTime ? (formState.oneTimeDate || null) : null,
    daysOfWeek: isOneTime ? null : formState.daysOfWeek,
    recurrenceStartDate: isOneTime ? null : (formState.recurrenceStartDate || null),
    recurrenceEndDate: isOneTime ? null : (formState.recurrenceEndDate || null),
    timeMode: formState.timeMode,
    startTime: isTimed ? (formState.startTime || null) : null,
    endMode: isTimed ? formState.endMode : "unspecified",
    endTime: isTimed && formState.endMode === "time" ? (formState.endTime || null) : null,
    isPublished: formState.isPublished,
  };
}
