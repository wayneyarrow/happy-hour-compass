import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addDaysToIso,
  buildEventDateBadge,
  eventHasOccurrenceOn,
  eventOccursOnDate,
  getMarketTodayAndTomorrow,
  getTargetWeekendDates,
  weekdayOfIso,
} from "../../../src/app/(website)/website-events/eventCalendarDates";

/**
 * Events page TODAY/TOMORROW badges and Today/Tomorrow filter chips use the
 * selected market's calendar date — never the server's UTC date (SSR) or the
 * visitor's browser timezone (hydration). Each boundary is checked under
 * several process timezones to prove the runtime's own zone never matters.
 */

// Wed 2026-10-28, 6 PM PDT — UTC is already Thursday the 29th.
const PDT_6PM = new Date("2026-10-29T01:00:00.000Z");
// Thu 2026-10-29, 00:00 PDT.
const PDT_MIDNIGHT = new Date("2026-10-29T07:00:00.000Z");
// Fri 2026-12-04, 6 PM PST — UTC is already Saturday the 5th.
const PST_6PM = new Date("2026-12-05T02:00:00.000Z");
// Sat 2026-12-05, 00:00 PST.
const PST_MIDNIGHT = new Date("2026-12-05T08:00:00.000Z");

const PROCESS_ZONES = ["UTC", "Asia/Tokyo", "America/New_York"];

function inEachProcessZone(fn: () => void) {
  const original = process.env.TZ;
  try {
    for (const tz of PROCESS_ZONES) {
      process.env.TZ = tz;
      fn();
    }
  } finally {
    process.env.TZ = original;
  }
}

const badge = (firstDate: string | null, recurrence: string, now: Date, marketId = "central-okanagan") =>
  buildEventDateBadge(firstDate, recurrence, "7:00 PM", getMarketTodayAndTomorrow(marketId, now).todayIso);

test("calendar arithmetic crosses month/year ends and is independent of the process timezone", () => {
  inEachProcessZone(() => {
    assert.equal(addDaysToIso("2026-10-31", 1), "2026-11-01");
    assert.equal(addDaysToIso("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysToIso("2026-11-01", 1), "2026-11-02"); // PDT→PST changeover day
    assert.equal(weekdayOfIso("2026-10-28"), 3); // Wednesday
    assert.equal(weekdayOfIso("2026-11-01"), 0); // Sunday
  });
});

test("6 PM PDT: today/tomorrow (Today/Tomorrow chips) are the Pacific Wednesday/Thursday although UTC is Thursday", () => {
  inEachProcessZone(() => {
    const { todayIso, tomorrowIso } = getMarketTodayAndTomorrow("central-okanagan", PDT_6PM);
    assert.equal(todayIso, "2026-10-28");
    assert.equal(tomorrowIso, "2026-10-29");
    assert.equal(weekdayOfIso(todayIso), 3);
    assert.equal(weekdayOfIso(tomorrowIso), 4);
  });
});

test("Pacific midnight: today/tomorrow advance to Thursday/Friday", () => {
  inEachProcessZone(() => {
    assert.deepEqual(getMarketTodayAndTomorrow("central-okanagan", PDT_MIDNIGHT), {
      todayIso: "2026-10-29",
      tomorrowIso: "2026-10-30",
    });
  });
});

test("standard time (PST): 6 PM and midnight boundaries", () => {
  inEachProcessZone(() => {
    assert.deepEqual(getMarketTodayAndTomorrow("central-okanagan", PST_6PM), {
      todayIso: "2026-12-04",
      tomorrowIso: "2026-12-05",
    });
    assert.deepEqual(getMarketTodayAndTomorrow("central-okanagan", PST_MIDNIGHT), {
      todayIso: "2026-12-05",
      tomorrowIso: "2026-12-06",
    });
  });
});

test("a second market timezone: Calgary (Mountain) rolls over an hour before Central Okanagan", () => {
  const instant = new Date("2026-10-29T06:30:00.000Z"); // 00:30 MDT Oct 29 / 23:30 PDT Oct 28
  inEachProcessZone(() => {
    assert.equal(getMarketTodayAndTomorrow("calgary", instant).todayIso, "2026-10-29");
    assert.equal(getMarketTodayAndTomorrow("central-okanagan", instant).todayIso, "2026-10-28");
    assert.equal(badge("2026-10-29", "none", instant, "calgary").top, "TODAY");
    assert.equal(badge("2026-10-29", "none", instant, "central-okanagan").top, "TOMORROW");
  });
});

test("one-off badges at 6 PM PDT: today's event is TODAY, tomorrow's TOMORROW, others show weekday + date", () => {
  inEachProcessZone(() => {
    assert.deepEqual(badge("2026-10-28", "none", PDT_6PM), { top: "TODAY", bottom: "7:00 PM" });
    assert.deepEqual(badge("2026-10-29", "none", PDT_6PM), { top: "TOMORROW", bottom: "7:00 PM" });
    assert.deepEqual(badge("2026-10-30", "none", PDT_6PM), { top: "FRI", bottom: "OCT 30" });
    assert.deepEqual(badge(null, "none", PDT_6PM), { top: "DATE TBD", bottom: "7:00 PM" });
  });
});

test("one-off badges after Pacific midnight: the Thursday event becomes TODAY", () => {
  inEachProcessZone(() => {
    assert.equal(badge("2026-10-29", "none", PDT_MIDNIGHT).top, "TODAY");
    assert.equal(badge("2026-10-30", "none", PDT_MIDNIGHT).top, "TOMORROW");
  });
});

test("weekly badges follow the market weekday; daily/monthly/biweekly labels are unchanged", () => {
  inEachProcessZone(() => {
    // A Wednesday-weekly event (first_date 2026-03-11 was a Wednesday).
    assert.equal(badge("2026-03-11", "weekly", PDT_6PM).top, "TODAY");
    assert.equal(badge("2026-03-11", "weekly", PDT_MIDNIGHT).top, "WEDNESDAYS");
    // A Thursday-weekly event.
    assert.equal(badge("2026-03-12", "weekly", PDT_6PM).top, "TOMORROW");
    assert.equal(badge("2026-03-12", "weekly", PDT_MIDNIGHT).top, "TODAY");
    assert.deepEqual(badge("2026-03-09", "biweekly", PDT_6PM), { top: "MONDAYS", bottom: "BIWEEKLY" });
    assert.deepEqual(badge("2026-03-09", "daily", PDT_6PM), { top: "DAILY", bottom: "7:00 PM" });
    assert.deepEqual(badge("2026-03-09", "monthly", PDT_6PM), { top: "MONTHLY", bottom: "7:00 PM" });
    assert.deepEqual(badge(null, "weekly", PDT_6PM), { top: "RECURRING", bottom: "7:00 PM" });
  });
});

// ── Today/Tomorrow chip matching ─────────────────────────────────────────────

const ev = (firstDate: string | null, recurrence: string | null) => ({ firstDate, recurrence });

test("Today on Thu Oct 29: a one-off matches only its own date — the Thu Nov 19 market does not", () => {
  inEachProcessZone(() => {
    const { todayIso, tomorrowIso } = getMarketTodayAndTomorrow("central-okanagan", new Date("2026-10-29T18:00:00Z"));
    assert.equal(todayIso, "2026-10-29");
    assert.equal(eventOccursOnDate(ev("2026-10-29", "none"), todayIso), true);
    assert.equal(eventOccursOnDate(ev("2026-11-19", "none"), todayIso), false, "First Frost Family Market (Thu Nov 19)");
    assert.equal(eventOccursOnDate(ev("2026-11-19", null), todayIso), false, "null recurrence is one-off");
    assert.equal(eventOccursOnDate(ev("2026-10-30", "none"), tomorrowIso), true);
    assert.equal(eventOccursOnDate(ev("2026-11-06", "none"), tomorrowIso), false, "a later Friday is not Tomorrow");
  });
});

test("Today/Tomorrow at 6 PM PDT use the Pacific date, not the UTC date", () => {
  inEachProcessZone(() => {
    const { todayIso, tomorrowIso } = getMarketTodayAndTomorrow("central-okanagan", PDT_6PM); // Wed Oct 28
    assert.equal(eventOccursOnDate(ev("2026-10-28", "none"), todayIso), true);
    assert.equal(eventOccursOnDate(ev("2026-10-29", "none"), todayIso), false);
    assert.equal(eventOccursOnDate(ev("2026-10-29", "none"), tomorrowIso), true);
  });
});

test("recurring matching is unchanged: weekly/biweekly/monthly by weekday, daily always, undated permissive", () => {
  const thu = "2026-10-29";
  assert.equal(eventOccursOnDate(ev("2026-03-12", "weekly"), thu), true); // a Thursday-weekly event
  assert.equal(eventOccursOnDate(ev("2026-03-11", "weekly"), thu), false); // a Wednesday-weekly event
  assert.equal(eventOccursOnDate(ev("2026-03-12", "biweekly"), thu), true);
  assert.equal(eventOccursOnDate(ev("2026-03-12", "monthly"), thu), true);
  assert.equal(eventOccursOnDate(ev("2026-03-09", "daily"), thu), true);
  assert.equal(eventOccursOnDate(ev(null, "none"), thu), true);
  assert.equal(eventOccursOnDate(ev(null, "weekly"), thu), true);
});

// ── This Weekend ─────────────────────────────────────────────────────────────

const weekendFor = (marketId: string, now: Date) =>
  getTargetWeekendDates(getMarketTodayAndTomorrow(marketId, now).todayIso);

test("target weekend: Monday–Friday use the coming weekend, Saturday the current one, Sunday its remaining day", () => {
  inEachProcessZone(() => {
    assert.deepEqual(getTargetWeekendDates("2026-10-26"), ["2026-10-31", "2026-11-01"]); // Mon, month boundary
    assert.deepEqual(getTargetWeekendDates("2026-10-29"), ["2026-10-31", "2026-11-01"]); // Thu
    assert.deepEqual(getTargetWeekendDates("2026-10-30"), ["2026-10-31", "2026-11-01"]); // Fri
    assert.deepEqual(getTargetWeekendDates("2026-10-31"), ["2026-10-31", "2026-11-01"]); // Sat: current weekend
    assert.deepEqual(getTargetWeekendDates("2026-11-01"), ["2026-11-01"]); // Sun: current weekend, Saturday has passed
    assert.deepEqual(getTargetWeekendDates("2026-11-02"), ["2026-11-07", "2026-11-08"]); // Mon advances
    assert.deepEqual(getTargetWeekendDates("2026-12-30"), ["2027-01-02", "2027-01-03"]); // Wed, year boundary
    assert.deepEqual(getTargetWeekendDates("2027-01-02"), ["2027-01-02", "2027-01-03"]); // Sat after New Year
  });
});

test("target weekend follows the market's local date, not UTC or the process timezone", () => {
  inEachProcessZone(() => {
    // Sun Nov 1, 6 PM PST (DST has just ended) — UTC is already Monday.
    const sundayEvening = new Date("2026-11-02T02:00:00.000Z");
    assert.deepEqual(weekendFor("central-okanagan", sundayEvening), ["2026-11-01"]);
    // Fri Oct 30, 6 PM PDT — UTC is already Saturday; still the coming weekend.
    assert.deepEqual(weekendFor("central-okanagan", new Date("2026-10-31T01:00:00.000Z")), ["2026-10-31", "2026-11-01"]);
    // 00:30 MST Mon Nov 2 in Calgary is 23:30 PST Sun Nov 1 in Central Okanagan.
    const instant = new Date("2026-11-02T07:30:00.000Z");
    assert.deepEqual(weekendFor("calgary", instant), ["2026-11-07", "2026-11-08"]);
    assert.deepEqual(weekendFor("central-okanagan", instant), ["2026-11-01"]);
  });
});

const inWeekend = (todayIso: string, firstDate: string | null, recurrence: string | null) =>
  getTargetWeekendDates(todayIso).some((d) => eventHasOccurrenceOn({ firstDate, recurrence }, d));

test("one-off events: only this weekend's exact dates match — later weekends do not", () => {
  const thu = "2026-10-29";
  assert.equal(inWeekend(thu, "2026-10-31", "none"), true, "Sat Oct 31 (Halloween party)");
  assert.equal(inWeekend(thu, "2026-11-01", "none"), true, "Sun Nov 1");
  assert.equal(inWeekend(thu, "2026-11-07", "none"), false, "Sat Nov 7 — a later weekend");
  assert.equal(inWeekend(thu, "2026-12-12", "none"), false, "Sat Dec 12");
  assert.equal(inWeekend(thu, "2026-11-19", "none"), false, "Thu Nov 19 (First Frost)");
  assert.equal(inWeekend(thu, "2026-10-30", "none"), false, "Fri Oct 30");
  assert.equal(inWeekend(thu, "2026-11-08", null), false);
  assert.equal(inWeekend("2026-11-01", "2026-10-31", "none"), false, "on Sunday, Saturday's one-off has passed");
});

test("recurring events need a real occurrence on the target weekend, on or after their start date", () => {
  const thu = "2026-10-29"; // weekend Oct 31 / Nov 1
  // weekly
  assert.equal(inWeekend(thu, "2026-03-08", "weekly"), true, "Sunday-weekly (Sunday Funday)");
  assert.equal(inWeekend(thu, "2026-03-14", "weekly"), true, "Saturday-weekly");
  assert.equal(inWeekend(thu, "2026-03-13", "weekly"), false, "Friday-weekly");
  assert.equal(inWeekend(thu, "2026-11-07", "weekly"), false, "Saturday-weekly that starts next weekend");
  assert.equal(inWeekend(thu, "2026-11-01", "weekly"), true, "Sunday-weekly starting this Sunday");
  // biweekly (legacy value)
  assert.equal(inWeekend(thu, "2026-10-17", "biweekly"), true, "Oct 17 + 14 days = Oct 31");
  assert.equal(inWeekend(thu, "2026-10-24", "biweekly"), false, "Oct 24 + 14 days = Nov 7");
  // monthly (day of month)
  assert.equal(inWeekend(thu, "2026-09-01", "monthly"), true, "the 1st — Sun Nov 1");
  assert.equal(inWeekend(thu, "2026-09-15", "monthly"), false, "the 15th");
  assert.equal(inWeekend(thu, "2026-12-01", "monthly"), false, "monthly starting in December");
  // daily
  assert.equal(inWeekend(thu, "2026-10-01", "daily"), true);
  assert.equal(inWeekend(thu, "2026-12-01", "daily"), false, "daily starting in December");
  // undated stays permissive, like the other date filters
  assert.equal(inWeekend(thu, null, "none"), true);
  assert.equal(inWeekend(thu, null, "weekly"), true);
});

test("on Sunday only Sunday occurrences count; Saturday browsing includes both days", () => {
  assert.equal(inWeekend("2026-11-01", "2026-03-14", "weekly"), false, "Saturday-weekly on Sunday");
  assert.equal(inWeekend("2026-11-01", "2026-03-08", "weekly"), true, "Sunday-weekly on Sunday");
  assert.equal(inWeekend("2026-10-31", "2026-03-14", "weekly"), true, "Saturday-weekly on Saturday");
  assert.equal(inWeekend("2026-10-31", "2026-03-08", "weekly"), true, "Sunday-weekly on Saturday");
});

test("wiring: the Events page derives today/tomorrow and card badges from the selected market", () => {
  const dir = path.join(process.cwd(), "src/app/(website)/website-events");
  const results = readFileSync(path.join(dir, "EventSearchResults.tsx"), "utf8");
  const card = readFileSync(path.join(dir, "EventSearchCard.tsx"), "utf8");

  assert.match(results, /getMarketTodayAndTomorrow\(market\.id, new Date\(\)\)/);
  assert.match(results, /dateFilter === "today"\) return eventOccursOnDate\(e, todayIso\)/);
  assert.match(results, /dateFilter === "tomorrow"\) return eventOccursOnDate\(e, tomorrowIso\)/);
  assert.doesNotMatch(results, /todayLocal|tomorrowLocal/);
  assert.equal((results.match(/<EventSearchCard [^>]*marketId=\{market\.id\}/g) ?? []).length, 2);
  assert.match(results, /const weekendDates = getTargetWeekendDates\(todayIso\);/);
  assert.match(results, /dateFilter === "weekend"\) \{\s+return weekendDates\.some\(\(d\) => eventHasOccurrenceOn\(e, d\)\);/);
  assert.doesNotMatch(results, /eventOccursOnDow/);

  assert.match(card, /getMarketTodayAndTomorrow\(marketId, new Date\(\)\)/);
  assert.match(card, /marketId=\{marketId \?\? event\.marketSlug \?\? ""\}/);
  assert.doesNotMatch(card, /useEffect|getFullYear|getDay\(\)/);
});
