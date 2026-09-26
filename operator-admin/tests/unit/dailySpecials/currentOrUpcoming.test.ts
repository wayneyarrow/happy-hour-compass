import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterCurrentOrUpcoming,
  hasCurrentOrUpcomingOccurrence,
} from "../../../src/lib/dailySpecialSchedule";
import { getMarketLocalIsoDate } from "../../../src/lib/marketLocalDate";
import type { DailySpecialSchedule } from "../../../src/lib/dailySpecialTypes";

/**
 * Expired Daily Specials must never be shown to consumers (2026-09 fix —
 * The Placery's Sep 15/22 one-time Specials were still visible on Sep 26).
 * hasCurrentOrUpcomingOccurrence() is the single shared rule.
 */

const oneTime = (date: string): DailySpecialSchedule => ({ scheduleType: "one_time", oneTimeDate: date });
const weekly = (
  days: number[],
  start: string | null = null,
  end: string | null = null
): DailySpecialSchedule =>
  ({ scheduleType: "weekly", daysOfWeek: days, recurrenceStartDate: start, recurrenceEndDate: end }) as DailySpecialSchedule;

// 2026-09-26 is a Saturday.
const TODAY = "2026-09-26";

test("one-time: expired (yesterday) is hidden, today and future are shown", () => {
  assert.equal(hasCurrentOrUpcomingOccurrence(oneTime("2026-09-25"), TODAY), false);
  assert.equal(hasCurrentOrUpcomingOccurrence(oneTime("2026-09-26"), TODAY), true);
  assert.equal(hasCurrentOrUpcomingOccurrence(oneTime("2026-09-29"), TODAY), true);
});

test("The Placery: Sep 15/22 disappear, Sep 29 onward remain (as of Sep 26)", () => {
  const dates = ["2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"];
  const specials = dates.map((d) => ({ id: d, schedule: oneTime(d) }));
  const visible = filterCurrentOrUpcoming(specials, TODAY).map((s) => s.id);
  assert.deepEqual(visible, ["2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]);
});

test("date boundary is the venue's market-local day, not UTC", () => {
  // 2026-09-27T06:30Z is still Sep 26 (23:30 PDT) in Kelowna.
  const lateEvening = new Date("2026-09-27T06:30:00Z");
  const local = getMarketLocalIsoDate("central-okanagan", lateEvening);
  assert.equal(local, "2026-09-26");
  assert.equal(hasCurrentOrUpcomingOccurrence(oneTime("2026-09-26"), local), true);
  // A UTC date would already have hidden it.
  assert.equal(hasCurrentOrUpcomingOccurrence(oneTime("2026-09-26"), lateEvening.toISOString().slice(0, 10)), false);

  // After local midnight it is gone.
  const afterMidnight = getMarketLocalIsoDate("central-okanagan", new Date("2026-09-27T07:30:00Z"));
  assert.equal(afterMidnight, "2026-09-27");
  assert.equal(hasCurrentOrUpcomingOccurrence(oneTime("2026-09-26"), afterMidnight), false);
});

test("weekly: open-ended recurring stays current", () => {
  assert.equal(hasCurrentOrUpcomingOccurrence(weekly([2]), TODAY), true);
});

test("weekly: end date in the past is expired", () => {
  assert.equal(hasCurrentOrUpcomingOccurrence(weekly([2], "2026-08-01", "2026-09-22"), TODAY), false);
});

test("weekly: end date today counts only if today's weekday is selected", () => {
  assert.equal(hasCurrentOrUpcomingOccurrence(weekly([6], null, TODAY), TODAY), true); // Saturday
  assert.equal(hasCurrentOrUpcomingOccurrence(weekly([2], null, TODAY), TODAY), false); // Tuesday
});

test("weekly: remaining window with no selected weekday is expired", () => {
  // Ends Mon Sep 28; only Tuesdays selected — no occurrence left.
  assert.equal(hasCurrentOrUpcomingOccurrence(weekly([2], null, "2026-09-28"), TODAY), false);
  // Ends Tue Sep 29 — one Tuesday left.
  assert.equal(hasCurrentOrUpcomingOccurrence(weekly([2], null, "2026-09-29"), TODAY), true);
});

test("weekly: future start date is upcoming", () => {
  assert.equal(hasCurrentOrUpcomingOccurrence(weekly([3], "2026-11-01"), TODAY), true);
  assert.equal(hasCurrentOrUpcomingOccurrence(weekly([3], "2026-11-01", "2026-11-03"), TODAY), false); // Sun-Tue, no Wed
});

// ── Consumer-surface wiring ──────────────────────────────────────────────────

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

test("venue page filters Daily Specials with the shared rule and market-local date", () => {
  const page = read("app/(website)/[market]/[city]/[slug]/page.tsx");
  assert.match(page, /filterCurrentOrUpcoming\(\s*venue\.dailySpecials,\s*getMarketLocalIsoDate\(/);
  assert.match(page, /<DailySpecialsSection specials=\{dailySpecials\}/);
  assert.doesNotMatch(page, /specials=\{venue\.dailySpecials\}/);
});

test("market-wide website query (search page, suggestions, homepage) excludes expired Specials", () => {
  const data = read("lib/data/dailySpecials.ts");
  assert.match(data, /hasCurrentOrUpcomingOccurrence\(schedule, marketToday\)/);
  assert.match(data, /getMarketLocalIsoDate\(market\.id, new Date\(\)\)/);
});
