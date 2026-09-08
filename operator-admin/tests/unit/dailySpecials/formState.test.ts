import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_FORM_STATE,
  buildSavePayload,
  enterSpecificHours,
  hydrateFormState,
  toggleWeekday,
  type DailySpecialRow,
} from "../../../src/app/admin/daily-specials/formState";
import type { Weekday } from "../../../src/lib/dailySpecialTypes";

/**
 * Pure form-state hydration/payload logic for the Daily Special form —
 * covers "initial form state", "edit hydration/round-trip", "weekday
 * conversion", "time-mode conversion", and "Close conversion" from the
 * Phase 2 task brief.
 */

function baseRow(overrides: Partial<DailySpecialRow> = {}): DailySpecialRow {
  return {
    id: "special-1",
    venue_id: "venue-1",
    created_by_operator_id: null,
    updated_by_operator_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    title: "Wing Wednesday",
    offer_type: "food",
    short_summary: "$12 wings",
    description: null,
    conditions: null,
    image_url: null,
    schedule_type: "weekly",
    one_time_date: null,
    days_of_week: [3],
    recurrence_start_date: null,
    recurrence_end_date: null,
    time_mode: "unspecified",
    start_time: null,
    end_mode: "unspecified",
    end_time: null,
    is_published: true,
    is_seeded_special: false,
    source_url: null,
    last_verified_at: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Initial form state
// ─────────────────────────────────────────────────────────────────────────

test("initial form state: empty, one-time, unspecified time, unpublished", () => {
  assert.equal(EMPTY_FORM_STATE.title, "");
  assert.equal(EMPTY_FORM_STATE.offerType, "");
  assert.equal(EMPTY_FORM_STATE.scheduleType, "one_time");
  assert.deepEqual(EMPTY_FORM_STATE.daysOfWeek, []);
  assert.equal(EMPTY_FORM_STATE.timeMode, "unspecified");
  assert.equal(EMPTY_FORM_STATE.endMode, "unspecified");
  assert.equal(EMPTY_FORM_STATE.isPublished, false);
});

// ─────────────────────────────────────────────────────────────────────────
// Edit hydration / round-trip
// ─────────────────────────────────────────────────────────────────────────

test("hydration: one-time special", () => {
  const state = hydrateFormState(
    baseRow({ schedule_type: "one_time", one_time_date: "2026-09-18", days_of_week: null })
  );
  assert.equal(state.scheduleType, "one_time");
  assert.equal(state.oneTimeDate, "2026-09-18");
  assert.deepEqual(state.daysOfWeek, []);
});

test("hydration: weekly single-day", () => {
  const state = hydrateFormState(baseRow({ days_of_week: [3] }));
  assert.equal(state.scheduleType, "weekly");
  assert.deepEqual(state.daysOfWeek, [3]);
});

test("hydration: weekly multi-day", () => {
  const state = hydrateFormState(baseRow({ days_of_week: [1, 2, 3, 4, 5] }));
  assert.deepEqual(state.daysOfWeek, [1, 2, 3, 4, 5]);
});

test("hydration: seasonal recurrence dates", () => {
  const state = hydrateFormState(
    baseRow({ recurrence_start_date: "2026-06-01", recurrence_end_date: "2026-09-30" })
  );
  assert.equal(state.recurrenceStartDate, "2026-06-01");
  assert.equal(state.recurrenceEndDate, "2026-09-30");
});

test("hydration: unspecified time", () => {
  const state = hydrateFormState(baseRow({ time_mode: "unspecified" }));
  assert.equal(state.timeMode, "unspecified");
  assert.equal(state.startTime, "");
  assert.equal(state.endMode, "unspecified");
});

test("hydration: all-day", () => {
  const state = hydrateFormState(baseRow({ time_mode: "all_day" }));
  assert.equal(state.timeMode, "all_day");
});

test("hydration: start-only, normalizes Postgres TIME (\"HH:MM:SS\") to native time-input value (\"HH:MM\")", () => {
  const state = hydrateFormState(
    baseRow({ time_mode: "timed", start_time: "16:00:00", end_mode: "unspecified" })
  );
  assert.equal(state.startTime, "16:00");
  assert.equal(state.endMode, "unspecified");
});

test("hydration: end-only", () => {
  const state = hydrateFormState(
    baseRow({ time_mode: "timed", start_time: null, end_mode: "time", end_time: "13:00:00" })
  );
  assert.equal(state.startTime, "");
  assert.equal(state.endMode, "time");
  assert.equal(state.endTime, "13:00");
});

test("hydration: fixed start + end", () => {
  const state = hydrateFormState(
    baseRow({ time_mode: "timed", start_time: "16:00:00", end_mode: "time", end_time: "21:00:00" })
  );
  assert.equal(state.startTime, "16:00");
  assert.equal(state.endTime, "21:00");
  assert.equal(state.endMode, "time");
});

test("hydration: Close conversion — start + Close, no end_time carried into the form", () => {
  const state = hydrateFormState(
    baseRow({ time_mode: "timed", start_time: "16:00:00", end_mode: "close", end_time: null })
  );
  assert.equal(state.startTime, "16:00");
  assert.equal(state.endMode, "close");
  assert.equal(state.endTime, "");
});

test("hydration: unknown/legacy values degrade to safe defaults rather than throwing", () => {
  const state = hydrateFormState(
    baseRow({ schedule_type: "monthly", time_mode: "sometimes", end_mode: "unknown" })
  );
  assert.equal(state.scheduleType, "one_time");
  assert.equal(state.timeMode, "unspecified");
  assert.equal(state.endMode, "unspecified");
});

// ─────────────────────────────────────────────────────────────────────────
// enterSpecificHours — Phase 2 correction: entering "Specific hours"
// defaults End to "No end time", but must never affect edit hydration.
// ─────────────────────────────────────────────────────────────────────────

test("enterSpecificHours: sets timeMode to timed and defaults End to \"No end time\" from the empty initial state", () => {
  const next = enterSpecificHours(EMPTY_FORM_STATE);
  assert.equal(next.timeMode, "timed");
  assert.equal(next.endMode, "unspecified");
  assert.equal(next.endTime, "");
});

test("enterSpecificHours: resets an in-session, unsaved End choice back to \"No end time\"", () => {
  // Simulates: operator picked Close a moment ago, switched to All Day,
  // then back to Specific Hours — the abandoned Close choice must not
  // reappear as the default.
  const midSession = { ...EMPTY_FORM_STATE, timeMode: "all_day" as const, endMode: "close" as const, endTime: "" };
  const next = enterSpecificHours(midSession);
  assert.equal(next.endMode, "unspecified");
});

test("enterSpecificHours: clears any stale end time value", () => {
  const midSession = { ...EMPTY_FORM_STATE, endMode: "time" as const, endTime: "21:00" };
  const next = enterSpecificHours(midSession);
  assert.equal(next.endTime, "");
});

test("enterSpecificHours: does not touch startTime — only End is reset, per the task's explicit scope", () => {
  const midSession = { ...EMPTY_FORM_STATE, startTime: "16:00" };
  const next = enterSpecificHours(midSession);
  assert.equal(next.startTime, "16:00");
});

// ─────────────────────────────────────────────────────────────────────────
// Edit hydration is a SEPARATE code path from enterSpecificHours() — never
// invoked by it — so an existing saved Special's actual stored end_mode
// must continue to hydrate exactly as stored, regardless of the new
// Specific-Hours-entry default. (These pin the same guarantee the
// pre-existing hydration tests above already establish; grouped here to
// make the "did the correction alter hydration?" answer explicit.)
// ─────────────────────────────────────────────────────────────────────────

test("edit hydration still preserves a fixed end time after the Phase 2 correction", () => {
  const state = hydrateFormState(
    baseRow({ time_mode: "timed", start_time: "16:00:00", end_mode: "time", end_time: "21:00:00" })
  );
  assert.equal(state.endMode, "time");
  assert.equal(state.endTime, "21:00");
});

test("edit hydration still preserves Close after the Phase 2 correction", () => {
  const state = hydrateFormState(
    baseRow({ time_mode: "timed", start_time: "16:00:00", end_mode: "close", end_time: null })
  );
  assert.equal(state.endMode, "close");
  assert.equal(state.endTime, "");
});

test("edit hydration still preserves \"no end time\" (endMode unspecified with a start time) after the Phase 2 correction", () => {
  const state = hydrateFormState(
    baseRow({ time_mode: "timed", start_time: "16:00:00", end_mode: "unspecified", end_time: null })
  );
  assert.equal(state.endMode, "unspecified");
  assert.equal(state.startTime, "16:00");
});

test("round-trip: hydrate then build payload reproduces the same schedule/time shape", () => {
  const row = baseRow({
    schedule_type: "weekly",
    days_of_week: [0, 6],
    recurrence_start_date: "2026-06-01",
    recurrence_end_date: "2026-09-30",
    time_mode: "timed",
    start_time: "16:00:00",
    end_mode: "close",
    end_time: null,
  });
  const state = hydrateFormState(row);
  const payload = buildSavePayload(state, "venue-1");

  assert.equal(payload.scheduleType, "weekly");
  assert.deepEqual(payload.daysOfWeek, [0, 6]);
  assert.equal(payload.recurrenceStartDate, "2026-06-01");
  assert.equal(payload.recurrenceEndDate, "2026-09-30");
  assert.equal(payload.timeMode, "timed");
  assert.equal(payload.startTime, "16:00");
  assert.equal(payload.endMode, "close");
  assert.equal(payload.endTime, null);
  assert.equal(payload.oneTimeDate, null); // never carried for a weekly special
});

// ─────────────────────────────────────────────────────────────────────────
// Weekday conversion (toggleWeekday)
// ─────────────────────────────────────────────────────────────────────────

test("toggleWeekday: adds a day and keeps the array sorted", () => {
  assert.deepEqual(toggleWeekday([1, 5], 3), [1, 3, 5]);
  assert.deepEqual(toggleWeekday([], 3), [3]);
});

test("toggleWeekday: removes an already-selected day", () => {
  assert.deepEqual(toggleWeekday([1, 3, 5], 3), [1, 5]);
});

test("toggleWeekday: Monday-Friday selection built via repeated toggles", () => {
  let days: Weekday[] = [];
  for (const d of [1, 2, 3, 4, 5] as const) days = toggleWeekday(days, d);
  assert.deepEqual(days, [1, 2, 3, 4, 5]);
});

// ─────────────────────────────────────────────────────────────────────────
// buildSavePayload — null-out rules per schedule_type/time_mode
// ─────────────────────────────────────────────────────────────────────────

test("payload: one-time special never carries weekday/recurrence-date fields", () => {
  const state = { ...EMPTY_FORM_STATE, scheduleType: "one_time" as const, oneTimeDate: "2026-09-18" };
  const payload = buildSavePayload(state, "venue-1");
  assert.equal(payload.oneTimeDate, "2026-09-18");
  assert.equal(payload.daysOfWeek, null);
  assert.equal(payload.recurrenceStartDate, null);
  assert.equal(payload.recurrenceEndDate, null);
});

test("payload: weekly special never carries a one-time date", () => {
  const state = { ...EMPTY_FORM_STATE, scheduleType: "weekly" as const, daysOfWeek: [3 as Weekday] };
  const payload = buildSavePayload(state, "venue-1");
  assert.equal(payload.oneTimeDate, null);
  assert.deepEqual(payload.daysOfWeek, [3]);
});

test("payload: unspecified/all_day time never carries start/end fields even if stale form state has them", () => {
  const state = {
    ...EMPTY_FORM_STATE,
    timeMode: "all_day" as const,
    startTime: "16:00", // stale — should be dropped since timeMode isn't "timed"
    endMode: "time" as const,
    endTime: "21:00",
  };
  const payload = buildSavePayload(state, "venue-1");
  assert.equal(payload.startTime, null);
  assert.equal(payload.endMode, "unspecified");
  assert.equal(payload.endTime, null);
});

test("payload: never includes provenance fields (is_seeded_special / source_url / last_verified_at)", () => {
  const payload = buildSavePayload(EMPTY_FORM_STATE, "venue-1");
  assert.equal("isSeededSpecial" in payload, false);
  assert.equal("sourceUrl" in payload, false);
  assert.equal("lastVerifiedAt" in payload, false);
});
