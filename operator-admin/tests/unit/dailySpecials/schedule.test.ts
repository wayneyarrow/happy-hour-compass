import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDaysOfWeek,
  getWeekdayFromIsoDate,
  isOneTimeSpecialExpired,
  isRecurringSpecialCurrentlyActive,
  isWithinRecurrenceValidity,
  occursOnDate,
  validateDailySpecialContent,
  validateDailySpecialSchedule,
  validateDailySpecialTime,
  weeklyIncludesWeekday,
} from "../../../src/lib/dailySpecialSchedule";
import { DESCRIPTION_MAX_LENGTH, SHORT_SUMMARY_MAX_LENGTH } from "../../../src/lib/dailySpecialTypes";
import type {
  DailySpecialOneTimeSchedule,
  DailySpecialWeeklySchedule,
} from "../../../src/lib/dailySpecialTypes";

/**
 * Phase 1 Daily Specials — pure scheduling/occurrence + validation logic.
 * No Supabase, no I/O — direct unit tests, same rationale
 * tests/unit/subscriptions/venuePlanResolution.test.ts gives for testing
 * resolvePlanCodeFromVenueSubscription() directly.
 *
 * These functions are also, deliberately, application-code mirrors of the
 * CHECK constraints in supabase/migrations/091_daily_specials_foundation.sql
 * — every "invalid" case here has a matching "expect_fail" case that was
 * separately verified against the live database during implementation (see
 * the Phase 1 implementation report's Database Validation section). This
 * file pins the TypeScript half of that same rule set.
 */

// ─────────────────────────────────────────────────────────────────────────
// SCHEDULE validation
// ─────────────────────────────────────────────────────────────────────────

test("schedule: valid one-time special", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "one_time",
    oneTimeDate: "2026-09-18",
    daysOfWeek: null,
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(result.valid, true);
});

test("schedule: one-time special requires a date", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "one_time",
    oneTimeDate: null,
    daysOfWeek: null,
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.errors.join(" "), /requires a date/i);
});

test("schedule: valid weekly single-day (Wing Wednesday)", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(result.valid, true);
});

test("schedule: valid weekly multi-day (Monday-Friday lunch)", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [1, 2, 3, 4, 5],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(result.valid, true);
});

test("schedule: valid weekly multi-day (Saturday + Sunday brunch)", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [0, 6],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(result.valid, true);
});

test("schedule: weekly requires at least one weekday", () => {
  const nullDays = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: null,
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(nullDays.valid, false);

  const emptyDays = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(emptyDays.valid, false);
});

test("schedule: invalid weekday value rejected (out of 0-6 range)", () => {
  const tooHigh = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [7],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(tooHigh.valid, false);

  const negative = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [-1],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(negative.valid, false);
});

test("schedule: duplicate weekday values rejected", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [3, 3],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(result.valid, false);
});

test("schedule: optional recurrence start/end — both null is valid (already active, open-ended)", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(result.valid, true);
});

test("schedule: optional recurrence start/end — seasonal range is valid", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [3],
    recurrenceStartDate: "2026-06-01",
    recurrenceEndDate: "2026-09-30",
  });
  assert.equal(result.valid, true);
});

test("schedule: end before start rejected", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "weekly",
    oneTimeDate: null,
    daysOfWeek: [3],
    recurrenceStartDate: "2026-09-30",
    recurrenceEndDate: "2026-06-01",
  });
  assert.equal(result.valid, false);
});

test("schedule: one-time carrying weekdays is rejected (contradictory)", () => {
  const result = validateDailySpecialSchedule({
    scheduleType: "one_time",
    oneTimeDate: "2026-09-18",
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  });
  assert.equal(result.valid, false);
});

// ─────────────────────────────────────────────────────────────────────────
// TIME validation
// ─────────────────────────────────────────────────────────────────────────

test("time: unspecified", () => {
  const result = validateDailySpecialTime({
    timeMode: "unspecified",
    startTime: null,
    endMode: "unspecified",
    endTime: null,
  });
  assert.equal(result.valid, true);
});

test("time: all day", () => {
  const result = validateDailySpecialTime({
    timeMode: "all_day",
    startTime: null,
    endMode: "unspecified",
    endTime: null,
  });
  assert.equal(result.valid, true);
});

test("time: start only (\"From 4 PM\")", () => {
  const result = validateDailySpecialTime({
    timeMode: "timed",
    startTime: "16:00",
    endMode: "unspecified",
    endTime: null,
  });
  assert.equal(result.valid, true);
});

test("time: end only (\"Until 1 PM\")", () => {
  const result = validateDailySpecialTime({
    timeMode: "timed",
    startTime: null,
    endMode: "time",
    endTime: "13:00",
  });
  assert.equal(result.valid, true);
});

test("time: start + fixed end (\"4 PM-9 PM\")", () => {
  const result = validateDailySpecialTime({
    timeMode: "timed",
    startTime: "16:00",
    endMode: "time",
    endTime: "21:00",
  });
  assert.equal(result.valid, true);
});

test("time: start + Close (\"4 PM-Close\")", () => {
  const result = validateDailySpecialTime({
    timeMode: "timed",
    startTime: "16:00",
    endMode: "close",
    endTime: null,
  });
  assert.equal(result.valid, true);
});

test("time: contradictory state rejected — all_day with a start time set", () => {
  const result = validateDailySpecialTime({
    timeMode: "all_day",
    startTime: "16:00",
    endMode: "unspecified",
    endTime: null,
  });
  assert.equal(result.valid, false);
});

test("time: contradictory state rejected — unspecified with end_mode=time", () => {
  const result = validateDailySpecialTime({
    timeMode: "unspecified",
    startTime: null,
    endMode: "time",
    endTime: "13:00",
  });
  assert.equal(result.valid, false);
});

test("time: contradictory state rejected — timed with no start and no end (meaningless)", () => {
  const result = validateDailySpecialTime({
    timeMode: "timed",
    startTime: null,
    endMode: "unspecified",
    endTime: null,
  });
  assert.equal(result.valid, false);
});

test("time: contradictory state rejected — end_mode=time but no end_time", () => {
  const result = validateDailySpecialTime({
    timeMode: "timed",
    startTime: "16:00",
    endMode: "time",
    endTime: null,
  });
  assert.equal(result.valid, false);
});

test("time: contradictory state rejected — end_mode=close but end_time set (Close must stay semantic)", () => {
  const result = validateDailySpecialTime({
    timeMode: "timed",
    startTime: "16:00",
    endMode: "close",
    endTime: "21:00",
  });
  assert.equal(result.valid, false);
});

// ─────────────────────────────────────────────────────────────────────────
// OCCURRENCE HELPERS
// ─────────────────────────────────────────────────────────────────────────

test("occurrence: getWeekdayFromIsoDate matches JS Date.getDay() convention (0=Sunday..6=Saturday)", () => {
  // 2026-09-16 is a Wednesday.
  assert.equal(getWeekdayFromIsoDate("2026-09-16"), 3);
  // 2026-09-13 is a Sunday.
  assert.equal(getWeekdayFromIsoDate("2026-09-13"), 0);
  // 2026-09-19 is a Saturday.
  assert.equal(getWeekdayFromIsoDate("2026-09-19"), 6);
});

test("occurrence: weeklyIncludesWeekday — single weekday match", () => {
  assert.equal(weeklyIncludesWeekday([3], 3), true);
  assert.equal(weeklyIncludesWeekday([3], 2), false);
});

test("occurrence: weeklyIncludesWeekday — multiple weekday match (Mon-Fri)", () => {
  const mondayToFriday = [1, 2, 3, 4, 5] as const;
  for (const day of mondayToFriday) {
    assert.equal(weeklyIncludesWeekday([...mondayToFriday], day), true);
  }
  assert.equal(weeklyIncludesWeekday([...mondayToFriday], 0), false); // Sunday
  assert.equal(weeklyIncludesWeekday([...mondayToFriday], 6), false); // Saturday
});

test("occurrence: weeklyIncludesWeekday — weekend brunch [0,6]", () => {
  assert.equal(weeklyIncludesWeekday([0, 6], 0), true);
  assert.equal(weeklyIncludesWeekday([0, 6], 6), true);
  assert.equal(weeklyIncludesWeekday([0, 6], 3), false);
});

test("occurrence: recurrence start validity boundary", () => {
  const schedule = { recurrenceStartDate: "2026-06-01", recurrenceEndDate: null };
  assert.equal(isWithinRecurrenceValidity(schedule, "2026-05-31"), false); // before start
  assert.equal(isWithinRecurrenceValidity(schedule, "2026-06-01"), true); // on start
  assert.equal(isWithinRecurrenceValidity(schedule, "2026-06-02"), true); // after start
});

test("occurrence: recurrence end validity boundary", () => {
  const schedule = { recurrenceStartDate: null, recurrenceEndDate: "2026-09-30" };
  assert.equal(isWithinRecurrenceValidity(schedule, "2026-09-30"), true); // on end
  assert.equal(isWithinRecurrenceValidity(schedule, "2026-10-01"), false); // after end
});

test("occurrence: no start/end boundary — always within validity", () => {
  const schedule = { recurrenceStartDate: null, recurrenceEndDate: null };
  assert.equal(isWithinRecurrenceValidity(schedule, "2020-01-01"), true);
  assert.equal(isWithinRecurrenceValidity(schedule, "2099-01-01"), true);
});

test("occurrence: isRecurringSpecialCurrentlyActive mirrors isWithinRecurrenceValidity", () => {
  const schedule = { recurrenceStartDate: "2026-06-01", recurrenceEndDate: "2026-09-30" };
  assert.equal(isRecurringSpecialCurrentlyActive(schedule, "2026-07-15"), true);
  assert.equal(isRecurringSpecialCurrentlyActive(schedule, "2026-10-01"), false);
});

test("occurrence: one-time date matching", () => {
  const schedule: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-09-18" };
  assert.equal(occursOnDate(schedule, "2026-09-18"), true);
  assert.equal(occursOnDate(schedule, "2026-09-19"), false);
});

test("occurrence: one-time expiration", () => {
  assert.equal(isOneTimeSpecialExpired("2026-09-18", "2026-09-19"), true);
  assert.equal(isOneTimeSpecialExpired("2026-09-18", "2026-09-18"), false); // same day is not expired
  assert.equal(isOneTimeSpecialExpired("2026-09-18", "2026-09-17"), false);
});

test("occurrence: weekly special occurs on matching weekday within validity", () => {
  // Wing Wednesday, no date-range restriction.
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(occursOnDate(schedule, "2026-09-16"), true); // a Wednesday
  assert.equal(occursOnDate(schedule, "2026-09-17"), false); // a Thursday
});

test("occurrence: weekly special respects seasonal validity window even on a matching weekday", () => {
  // Summer Wing Wednesdays, June 1 - September 30 2026.
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: "2026-06-01",
    recurrenceEndDate: "2026-09-30",
  };
  assert.equal(occursOnDate(schedule, "2026-07-01"), true); // Wednesday, in-season
  assert.equal(occursOnDate(schedule, "2026-11-04"), false); // Wednesday, out of season
});

test("occurrence: weekly special with multiple weekdays (Monday-Friday lunch)", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [1, 2, 3, 4, 5],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(occursOnDate(schedule, "2026-09-14"), true); // Monday
  assert.equal(occursOnDate(schedule, "2026-09-18"), true); // Friday
  assert.equal(occursOnDate(schedule, "2026-09-13"), false); // Sunday
  assert.equal(occursOnDate(schedule, "2026-09-19"), false); // Saturday
});

// ─────────────────────────────────────────────────────────────────────────
// Human-readable weekday formatting
// ─────────────────────────────────────────────────────────────────────────

test("formatDaysOfWeek: single day", () => {
  assert.equal(formatDaysOfWeek([3]), "Wed");
});

test("formatDaysOfWeek: consecutive run collapses to a range", () => {
  assert.equal(formatDaysOfWeek([1, 2, 3, 4, 5]), "Mon-Fri");
});

test("formatDaysOfWeek: non-consecutive days join without a range dash", () => {
  assert.equal(formatDaysOfWeek([0, 6]), "Sun & Sat");
});

// ─────────────────────────────────────────────────────────────────────────
// validateDailySpecialContent — Phase 2 correction: Short Summary (120)
// and Description (1000) character limits. This is the SAME function
// saveDailySpecialAction calls — testing it directly here is a genuine
// test of the authoritative server-side enforcement, not a reimplementation.
// ─────────────────────────────────────────────────────────────────────────

test("content: null/empty short summary and description are always valid (both optional)", () => {
  const result = validateDailySpecialContent({ shortSummary: null, description: null });
  assert.equal(result.valid, true);
});

test("content: short summary at exactly 120 characters is accepted", () => {
  const result = validateDailySpecialContent({
    shortSummary: "a".repeat(SHORT_SUMMARY_MAX_LENGTH),
    description: null,
  });
  assert.equal(result.valid, true);
});

test("content: short summary at 121 characters is rejected with the exact expected message", () => {
  const result = validateDailySpecialContent({
    shortSummary: "a".repeat(SHORT_SUMMARY_MAX_LENGTH + 1),
    description: null,
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.errors[0], "Short summary must be 120 characters or fewer.");
  }
});

test("content: description at exactly 1000 characters is accepted", () => {
  const result = validateDailySpecialContent({
    shortSummary: null,
    description: "a".repeat(DESCRIPTION_MAX_LENGTH),
  });
  assert.equal(result.valid, true);
});

test("content: description at 1001 characters is rejected with the exact expected message", () => {
  const result = validateDailySpecialContent({
    shortSummary: null,
    description: "a".repeat(DESCRIPTION_MAX_LENGTH + 1),
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.errors[0], "Description must be 1,000 characters or fewer.");
  }
});

test("content: both fields can be rejected simultaneously, reporting both errors", () => {
  const result = validateDailySpecialContent({
    shortSummary: "a".repeat(SHORT_SUMMARY_MAX_LENGTH + 1),
    description: "a".repeat(DESCRIPTION_MAX_LENGTH + 1),
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.errors.length, 2);
  }
});

test("content: Conditions has no limit enforced by this function — not requested in this correction", () => {
  // validateDailySpecialContent() takes only shortSummary/description —
  // there is no conditions parameter at all, so a conditions field of any
  // length can never be rejected by this function.
  assert.equal(validateDailySpecialContent.length, 1);
});
