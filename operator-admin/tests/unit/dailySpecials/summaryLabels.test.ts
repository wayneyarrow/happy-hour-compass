import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatClockTime,
  formatDateLong,
  scheduleSummary,
  timeSummary,
  validitySummary,
} from "../../../src/app/admin/daily-specials/summaryLabels";
import type {
  DailySpecialOneTimeSchedule,
  DailySpecialTimedTime,
  DailySpecialWeeklySchedule,
} from "../../../src/lib/dailySpecialTypes";

// ── Date/time formatting ────────────────────────────────────────────────────

test("formatDateLong: \"2026-09-18\" -> \"Sep 18, 2026\"", () => {
  assert.equal(formatDateLong("2026-09-18"), "Sep 18, 2026");
});

test("formatClockTime: on-the-hour value drops minutes", () => {
  assert.equal(formatClockTime("16:00"), "4 PM");
  assert.equal(formatClockTime("16:00:00"), "4 PM");
});

test("formatClockTime: non-zero minutes are kept", () => {
  assert.equal(formatClockTime("16:30"), "4:30 PM");
});

test("formatClockTime: midnight/noon edge cases", () => {
  assert.equal(formatClockTime("00:00"), "12 AM");
  assert.equal(formatClockTime("12:00"), "12 PM");
});

// ── Schedule summary ─────────────────────────────────────────────────────────

test("scheduleSummary: one-time", () => {
  const schedule: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-09-18" };
  assert.equal(scheduleSummary(schedule), "Sep 18, 2026");
});

test("scheduleSummary: weekly single day -> \"Every Wednesday\"", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(scheduleSummary(schedule), "Every Wednesday");
});

test("scheduleSummary: weekly consecutive run -> \"Monday-Friday\"", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [1, 2, 3, 4, 5],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(scheduleSummary(schedule), "Monday-Friday");
});

test("scheduleSummary: weekly irregular days", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [2, 4],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(scheduleSummary(schedule), "Tuesday & Thursday");
});

test("scheduleSummary: all 7 days -> \"Every day\"", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(scheduleSummary(schedule), "Every day");
});

// ── Validity summary ─────────────────────────────────────────────────────────

test("validitySummary: null for one-time schedules", () => {
  const schedule: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-09-18" };
  assert.equal(validitySummary(schedule), null);
});

test("validitySummary: null when no start/end boundary is set (open-ended weekly)", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(validitySummary(schedule), null);
});

test("validitySummary: seasonal range with both bounds", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: "2026-06-01",
    recurrenceEndDate: "2026-09-30",
  };
  assert.equal(validitySummary(schedule), "Jun 1, 2026 – Sep 30, 2026");
});

test("validitySummary: start only", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: "2026-06-01",
    recurrenceEndDate: null,
  };
  assert.equal(validitySummary(schedule), "Starting Jun 1, 2026");
});

test("validitySummary: end only", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: "2026-09-30",
  };
  assert.equal(validitySummary(schedule), "Through Sep 30, 2026");
});

// ── Time summary ─────────────────────────────────────────────────────────────

test("timeSummary: unspecified", () => {
  assert.equal(timeSummary({ timeMode: "unspecified" }), "No specific time");
});

test("timeSummary: all day", () => {
  assert.equal(timeSummary({ timeMode: "all_day" }), "All Day");
});

test("timeSummary: start only -> \"From 4 PM\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: "16:00", endMode: "unspecified", endTime: null };
  assert.equal(timeSummary(time), "From 4 PM");
});

test("timeSummary: end only -> \"Until 1 PM\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: null, endMode: "time", endTime: "13:00" };
  assert.equal(timeSummary(time), "Until 1 PM");
});

test("timeSummary: fixed start + end -> \"4 PM-9 PM\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: "16:00", endMode: "time", endTime: "21:00" };
  assert.equal(timeSummary(time), "4 PM-9 PM");
});

test("timeSummary: start + Close -> \"4 PM-Close\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: "16:00", endMode: "close", endTime: null };
  assert.equal(timeSummary(time), "4 PM-Close");
});

test("timeSummary: Close with no start -> \"Until Close\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: null, endMode: "close", endTime: null };
  assert.equal(timeSummary(time), "Until Close");
});

test("timeSummary: Close never resolves to a clock time, regardless of input", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: "16:00", endMode: "close", endTime: null };
  const summary = timeSummary(time);
  assert.match(summary, /Close/);
  // Exactly one clock time (the start) — never a second AM/PM value
  // standing in for "Close".
  const clockTimeCount = (summary.match(/AM|PM/gi) ?? []).length;
  assert.equal(clockTimeCount, 1);
});
