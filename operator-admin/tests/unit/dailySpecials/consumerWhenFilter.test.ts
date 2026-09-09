import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailySpecialMatchesSearch,
  dailySpecialMatchesWhenFilter,
  nextDateForWeekday,
} from "../../../src/lib/dailySpecialSchedule";
import type {
  DailySpecialOneTimeSchedule,
  DailySpecialWeeklySchedule,
} from "../../../src/lib/dailySpecialTypes";

/**
 * Phase 3 consumer discovery — WHEN filter (Today + 7 weekdays) and text
 * search matching. These are the exact functions the website Daily
 * Specials search results page filters against.
 */

// 2026-09-16 is a Wednesday; 2026-09-13 is a Sunday; 2026-09-19 is a Saturday.
const WEDNESDAY = "2026-09-16";

// ─────────────────────────────────────────────────────────────────────────
// nextDateForWeekday
// ─────────────────────────────────────────────────────────────────────────

test("nextDateForWeekday: today's own weekday resolves to today (inclusive)", () => {
  // Wednesday (3), asking for Wednesday (3).
  assert.equal(nextDateForWeekday(WEDNESDAY, 3), WEDNESDAY);
});

test("nextDateForWeekday: resolves forward within the same week", () => {
  // Wednesday -> Friday (2 days later).
  assert.equal(nextDateForWeekday(WEDNESDAY, 5), "2026-09-18");
});

test("nextDateForWeekday: wraps to the following week when the target weekday already passed", () => {
  // Wednesday -> Monday (5 days later, wraps past Sunday).
  assert.equal(nextDateForWeekday(WEDNESDAY, 1), "2026-09-21");
});

// ─────────────────────────────────────────────────────────────────────────
// dailySpecialMatchesWhenFilter — null (no filter)
// ─────────────────────────────────────────────────────────────────────────

test("when filter: null always matches, regardless of schedule", () => {
  const oneTime: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2020-01-01" };
  assert.equal(dailySpecialMatchesWhenFilter(oneTime, null, WEDNESDAY), true);
});

// ─────────────────────────────────────────────────────────────────────────
// dailySpecialMatchesWhenFilter — "today"
// ─────────────────────────────────────────────────────────────────────────

test("today: includes a valid weekly Special whose weekday is today", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3], // Wednesday
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, "today", WEDNESDAY), true);
});

test("today: includes today's one-time Special", () => {
  const schedule: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: WEDNESDAY };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, "today", WEDNESDAY), true);
});

test("today: excludes an expired (past-dated) one-time Special", () => {
  const schedule: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-09-01" };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, "today", WEDNESDAY), false);
});

test("today: excludes a future-dated one-time Special", () => {
  const schedule: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-12-25" };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, "today", WEDNESDAY), false);
});

test("today: respects recurrence start date (not yet started)", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: "2026-10-01",
    recurrenceEndDate: null,
  };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, "today", WEDNESDAY), false);
});

test("today: respects recurrence end date (already ended)", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: "2026-09-01",
  };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, "today", WEDNESDAY), false);
});

test("today: excludes a weekly Special whose weekday isn't today", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [1], // Monday
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, "today", WEDNESDAY), false);
});

test("today: multi-weekday Special matches when today is one of its selected days", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, "today", WEDNESDAY), true);
});

// ─────────────────────────────────────────────────────────────────────────
// dailySpecialMatchesWhenFilter — specific weekday browsing (not "today")
// ─────────────────────────────────────────────────────────────────────────

test("weekday browse: weekly Special matches when the selected weekday is in its days_of_week", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [5], // Friday
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  // Browsing from a Wednesday, asking about Friday (5).
  assert.equal(dailySpecialMatchesWhenFilter(schedule, 5, WEDNESDAY), true);
});

test("weekday browse: multi-weekday Special matches on any of its selected days", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [1, 2, 3, 4, 5],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
  };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, 1, WEDNESDAY), true); // Monday
  assert.equal(dailySpecialMatchesWhenFilter(schedule, 5, WEDNESDAY), true); // Friday
  assert.equal(dailySpecialMatchesWhenFilter(schedule, 0, WEDNESDAY), false); // Sunday not selected
});

test("weekday browse: respects recurrence validity against the UPCOMING concrete date for that weekday", () => {
  // Seasonal Wednesday special ending Sep 1 2026 — browsing from Sep 16
  // (a Wednesday), the upcoming Wednesday IS today (Sep 16), which is
  // already past the Sep 1 end date.
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [3],
    recurrenceStartDate: null,
    recurrenceEndDate: "2026-09-01",
  };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, 3, WEDNESDAY), false);
});

test("weekday browse: a valid seasonal weekly Special matches within its window", () => {
  const schedule: DailySpecialWeeklySchedule = {
    scheduleType: "weekly",
    daysOfWeek: [5], // Friday
    recurrenceStartDate: "2026-06-01",
    recurrenceEndDate: "2026-09-30",
  };
  assert.equal(dailySpecialMatchesWhenFilter(schedule, 5, WEDNESDAY), true);
});

test("weekday browse: one-time Special matches ONLY when its date is exactly the upcoming occurrence of that weekday", () => {
  // Browsing from Wednesday Sep 16; the upcoming Friday is Sep 18.
  const matching: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-09-18" };
  assert.equal(dailySpecialMatchesWhenFilter(matching, 5, WEDNESDAY), true);
});

test("weekday browse: does NOT resurrect an old one-time Special merely because its stored date fell on the browsed weekday", () => {
  // A one-time Special from months ago that happened to be a Friday must
  // NOT reappear every time a visitor browses "Friday" — this is the exact
  // failure mode the product brief calls out.
  const oldFriday: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2026-03-06" }; // a Friday, long past
  assert.equal(dailySpecialMatchesWhenFilter(oldFriday, 5, WEDNESDAY), false);
});

test("weekday browse: does NOT include a far-future one-time Special merely because its date falls on the browsed weekday", () => {
  const farFutureFriday: DailySpecialOneTimeSchedule = { scheduleType: "one_time", oneTimeDate: "2027-01-01" };
  assert.equal(dailySpecialMatchesWhenFilter(farFutureFriday, 5, WEDNESDAY), false);
});

// ─────────────────────────────────────────────────────────────────────────
// dailySpecialMatchesSearch
// ─────────────────────────────────────────────────────────────────────────

test("search: matches by title", () => {
  assert.equal(
    dailySpecialMatchesSearch({ title: "Wing Wednesday", shortSummary: null, description: null }, "wing"),
    true
  );
});

test("search: matches by short summary", () => {
  assert.equal(
    dailySpecialMatchesSearch({ title: "Taco Night", shortSummary: "$3 tacos all night", description: null }, "tacos"),
    true
  );
});

test("search: matches by description", () => {
  assert.equal(
    dailySpecialMatchesSearch({ title: "Special", shortSummary: null, description: "Prime rib $22" }, "prime rib"),
    true
  );
});

test("search: is case-insensitive", () => {
  assert.equal(
    dailySpecialMatchesSearch({ title: "Wine Wednesday", shortSummary: null, description: null }, "WINE"),
    true
  );
  assert.equal(
    dailySpecialMatchesSearch({ title: "wine wednesday", shortSummary: null, description: null }, "Wine"),
    true
  );
});

test("search: no match returns false", () => {
  assert.equal(
    dailySpecialMatchesSearch({ title: "Wing Wednesday", shortSummary: "$12 wings", description: null }, "pizza"),
    false
  );
});

test("search: blank/whitespace query matches everything (no filter applied)", () => {
  assert.equal(dailySpecialMatchesSearch({ title: "Anything", shortSummary: null, description: null }, "   "), true);
  assert.equal(dailySpecialMatchesSearch({ title: "Anything", shortSummary: null, description: null }, ""), true);
});
