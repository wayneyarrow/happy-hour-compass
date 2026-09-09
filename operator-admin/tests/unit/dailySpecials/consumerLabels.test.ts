import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatClockTime,
  formatDailySpecialSchedule,
  formatDailySpecialTime,
  formatOneTimeDateShort,
  scheduleSummaryForContext,
} from "../../../src/app/(website)/dailySpecialConsumerLabels";
import type {
  DailySpecialOneTimeSchedule,
  DailySpecialTimedTime,
  DailySpecialWeeklySchedule,
} from "../../../src/lib/dailySpecialTypes";

/**
 * Consumer-facing (website) Daily Special schedule/time label formatting —
 * deliberately a separate module from Operator Admin's summaryLabels.ts
 * (see this file's own header comment), tested independently here.
 */

// ── Date / time formatting ──────────────────────────────────────────────────

test("formatOneTimeDateShort: no year, matching consumer card brevity", () => {
  assert.equal(formatOneTimeDateShort("2026-09-18"), "Sep 18");
});

test("formatClockTime: on-the-hour drops minutes", () => {
  assert.equal(formatClockTime("16:00"), "4 PM");
});

test("formatClockTime: non-zero minutes kept", () => {
  assert.equal(formatClockTime("16:30"), "4:30 PM");
});

// ── Schedule formatting ──────────────────────────────────────────────────────

test("schedule: one-time -> short date", () => {
  const schedule: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-09-18" };
  assert.equal(formatDailySpecialSchedule(schedule), "Sep 18");
});

test("schedule: weekly single day -> \"Every Wednesday\"", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null,
  };
  assert.equal(formatDailySpecialSchedule(schedule), "Every Wednesday");
});

test("schedule: contiguous multi-day -> \"Monday-Friday\"", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly", daysOfWeek: [1, 2, 3, 4, 5], recurrenceStartDate: null, recurrenceEndDate: null,
  };
  assert.equal(formatDailySpecialSchedule(schedule), "Monday-Friday");
});

test("schedule: non-contiguous multi-day -> \"Tuesday & Thursday\"", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly", daysOfWeek: [2, 4], recurrenceStartDate: null, recurrenceEndDate: null,
  };
  assert.equal(formatDailySpecialSchedule(schedule), "Tuesday & Thursday");
});

test("schedule: all seven days -> \"Every day\"", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], recurrenceStartDate: null, recurrenceEndDate: null,
  };
  assert.equal(formatDailySpecialSchedule(schedule), "Every day");
});

// ── Time formatting ───────────────────────────────────────────────────────────

test("time: unspecified renders as empty (omitted, not a verbose label)", () => {
  assert.equal(formatDailySpecialTime({ timeMode: "unspecified" }), "");
});

test("time: all day", () => {
  assert.equal(formatDailySpecialTime({ timeMode: "all_day" }), "All Day");
});

test("time: start only -> \"From 4 PM\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: "16:00", endMode: "unspecified", endTime: null };
  assert.equal(formatDailySpecialTime(time), "From 4 PM");
});

test("time: end only -> \"Until 1 PM\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: null, endMode: "time", endTime: "13:00" };
  assert.equal(formatDailySpecialTime(time), "Until 1 PM");
});

test("time: fixed range -> \"4-9 PM\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: "16:00", endMode: "time", endTime: "21:00" };
  assert.equal(formatDailySpecialTime(time), "4-9 PM");
});

test("time: Close with a start -> \"4 PM-Close\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: "16:00", endMode: "close", endTime: null };
  assert.equal(formatDailySpecialTime(time), "4 PM-Close");
});

test("time: Close with no start -> \"Until Close\"", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: null, endMode: "close", endTime: null };
  assert.equal(formatDailySpecialTime(time), "Until Close");
});

test("time: Close never resolves to a clock time regardless of input", () => {
  const time: DailySpecialTimedTime = { timeMode: "timed", startTime: "16:00", endMode: "close", endTime: null };
  const label = formatDailySpecialTime(time);
  const clockCount = (label.match(/AM|PM/gi) ?? []).length;
  assert.equal(clockCount, 1); // only the start time, never a resolved close time
});

// ── Today-context redundancy avoidance ───────────────────────────────────────

test("scheduleSummaryForContext: today-context single-day weekly collapses to \"Today\" (avoids \"Today · Every Wednesday\")", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null,
  };
  assert.equal(scheduleSummaryForContext(schedule, "today"), "Today");
});

test("scheduleSummaryForContext: today-context multi-day weekly still shows its full label (communicates it also runs other days)", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly", daysOfWeek: [1, 2, 3, 4, 5], recurrenceStartDate: null, recurrenceEndDate: null,
  };
  assert.equal(scheduleSummaryForContext(schedule, "today"), "Monday-Friday");
});

test("scheduleSummaryForContext: browse-context always shows the full label", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null,
  };
  assert.equal(scheduleSummaryForContext(schedule, "browse"), "Every Wednesday");
});

test("scheduleSummaryForContext: one-time special always shows its date regardless of context", () => {
  const schedule: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-09-18" };
  assert.equal(scheduleSummaryForContext(schedule, "today"), "Sep 18");
  assert.equal(scheduleSummaryForContext(schedule, "browse"), "Sep 18");
});
