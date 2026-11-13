import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  getMarketTimeZone,
  getMarketLocalIsoDate,
  getMarketLocalWeekday,
  getMarketLocalWeekdayLabel,
} from "../../../src/lib/marketLocalDate";
import { getMarketTodayAndTomorrow } from "../../../src/app/(website)/website-events/eventCalendarDates";

/**
 * Market-local calendar date — Today's Specials (and anything else that
 * needs "today" in the market's own timezone) must never key off the
 * server's raw UTC clock. September 2026 is within Pacific Daylight Time
 * (UTC-7), so a UTC instant just after midnight UTC is still the PREVIOUS
 * calendar day in Pacific time — exactly the boundary case a naive
 * `new Date().toISOString().slice(0, 10)` would get wrong.
 */

test("BC markets resolve to America/Vancouver", () => {
  assert.equal(getMarketTimeZone("central-okanagan"), "America/Vancouver");
  assert.equal(getMarketTimeZone("greater-vancouver"), "America/Vancouver");
  assert.equal(getMarketTimeZone("victoria"), "America/Vancouver");
});

test("Calgary resolves to America/Edmonton, not the Pacific default", () => {
  assert.equal(getMarketTimeZone("calgary"), "America/Edmonton");
});

test("an unmapped/future market id falls back to the default timezone rather than throwing", () => {
  assert.equal(getMarketTimeZone("some-future-market"), "America/Vancouver");
});

test("getMarketLocalIsoDate does not regress to the raw UTC day at the UTC midnight boundary", () => {
  // 2026-09-17T03:00:00Z is 2026-09-16T20:00:00-07:00 in Pacific time —
  // still Wednesday the 16th locally, even though the raw UTC date is
  // already the 17th.
  const instant = new Date("2026-09-17T03:00:00.000Z");
  assert.equal(getMarketLocalIsoDate("central-okanagan", instant), "2026-09-16");
});

test("getMarketLocalIsoDate matches the UTC date well away from any boundary", () => {
  const instant = new Date("2026-09-16T20:00:00.000Z"); // 1pm Pacific, same calendar day both ways
  assert.equal(getMarketLocalIsoDate("central-okanagan", instant), "2026-09-16");
});

test("getMarketLocalWeekday returns the Pacific-local weekday (3 = Wednesday)", () => {
  const instant = new Date("2026-09-17T03:00:00.000Z"); // Pacific-local Wed Sep 16
  assert.equal(getMarketLocalWeekday("central-okanagan", instant), 3);
});

test("getMarketLocalWeekdayLabel returns the human weekday name", () => {
  const instant = new Date("2026-09-17T03:00:00.000Z");
  assert.equal(getMarketLocalWeekdayLabel("central-okanagan", instant), "Wednesday");
});

// ── Calgary (Mountain Time) vs. the BC markets (Pacific Time) ──────────────
// Alberta is one hour ahead of BC even during Daylight Saving (MDT = UTC-6,
// PDT = UTC-7) — a market-specific timezone bug (e.g. mapping every market
// to Vancouver) would make these two assertions collide on the same date.

test("Calgary and Central Okanagan can resolve to different local calendar dates for the same instant", () => {
  // 2026-09-17T06:30:00Z is 2026-09-17T00:30:00-06:00 in Edmonton (already
  // past midnight -> Thursday the 17th) but only 2026-09-16T23:30:00-07:00
  // in Vancouver (still Wednesday the 16th).
  const instant = new Date("2026-09-17T06:30:00.000Z");
  assert.equal(getMarketLocalIsoDate("calgary", instant), "2026-09-17");
  assert.equal(getMarketLocalIsoDate("central-okanagan", instant), "2026-09-16");
});

test("Calgary's local weekday reflects Mountain Time, not Pacific Time, at that same boundary", () => {
  const instant = new Date("2026-09-17T06:30:00.000Z");
  assert.equal(getMarketLocalWeekdayLabel("calgary", instant), "Thursday");
  assert.equal(getMarketLocalWeekdayLabel("central-okanagan", instant), "Wednesday");
});

// ── Output shape ───────────────────────────────────────────────────────────

test("getMarketLocalIsoDate returns zero-padded YYYY-MM-DD", () => {
  const instant = new Date("2026-01-05T20:00:00.000Z"); // single-digit month and day
  const result = getMarketLocalIsoDate("central-okanagan", instant);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result, "2026-01-05");
});

// ── Midnight in Pacific time ───────────────────────────────────────────────
// Each pair is the last millisecond of a Pacific calendar day and the first
// millisecond of the next one. US Pacific time (Greater San Diego) still
// observes daylight saving. These cases used to run against Greater
// Vancouver, but since tzdata 2026b British Columbia is permanent UTC−7
// (from 2026-03-09), so its winter midnights moved — see BC_MIDNIGHTS.

const PACIFIC_MIDNIGHTS = [
  { label: "PST (UTC-8)", before: "2026-11-09T07:59:59.999Z", beforeDate: "2026-11-08", after: "2026-11-09T08:00:00.000Z", afterDate: "2026-11-09" },
  { label: "PDT (UTC-7)", before: "2026-07-15T06:59:59.999Z", beforeDate: "2026-07-14", after: "2026-07-15T07:00:00.000Z", afterDate: "2026-07-15" },
  { label: "the day clocks spring forward", before: "2026-03-09T06:59:59.999Z", beforeDate: "2026-03-08", after: "2026-03-09T07:00:00.000Z", afterDate: "2026-03-09" },
  { label: "the day clocks fall back", before: "2026-11-02T07:59:59.999Z", beforeDate: "2026-11-01", after: "2026-11-02T08:00:00.000Z", afterDate: "2026-11-02" },
  { label: "the new year", before: "2027-01-01T07:59:59.999Z", beforeDate: "2026-12-31", after: "2027-01-01T08:00:00.000Z", afterDate: "2027-01-01" },
];

for (const { label, before, beforeDate, after, afterDate } of PACIFIC_MIDNIGHTS) {
  test(`getMarketLocalIsoDate rolls over at Pacific midnight: ${label}`, () => {
    assert.equal(getMarketLocalIsoDate("greater-san-diego", new Date(before)), beforeDate);
    assert.equal(getMarketLocalIsoDate("greater-san-diego", new Date(after)), afterDate);
  });
}

// British Columbia: PST until 2026-03-09, permanent UTC−7 after — so a
// winter midnight is 07:00 UTC from November 2026 (no fall back on Nov 1),
// on every runtime (src/lib/timeZones.ts corrects stale timezone data).
const BC_MIDNIGHTS = [
  { label: "winter 2025–26, still PST", before: "2026-01-15T07:59:59.999Z", beforeDate: "2026-01-14", after: "2026-01-15T08:00:00.000Z", afterDate: "2026-01-15" },
  { label: "the day BC stopped changing clocks", before: "2026-03-09T06:59:59.999Z", beforeDate: "2026-03-08", after: "2026-03-09T07:00:00.000Z", afterDate: "2026-03-09" },
  { label: "summer, UTC−7", before: "2026-07-15T06:59:59.999Z", beforeDate: "2026-07-14", after: "2026-07-15T07:00:00.000Z", afterDate: "2026-07-15" },
  { label: "no fall back on 2026-11-01", before: "2026-11-02T06:59:59.999Z", beforeDate: "2026-11-01", after: "2026-11-02T07:00:00.000Z", afterDate: "2026-11-02" },
  { label: "winter 2026–27, permanent UTC−7", before: "2026-11-09T06:59:59.999Z", beforeDate: "2026-11-08", after: "2026-11-09T07:00:00.000Z", afterDate: "2026-11-09" },
  { label: "the new year", before: "2027-01-01T06:59:59.999Z", beforeDate: "2026-12-31", after: "2027-01-01T07:00:00.000Z", afterDate: "2027-01-01" },
];

for (const { label, before, beforeDate, after, afterDate } of BC_MIDNIGHTS) {
  test(`getMarketLocalIsoDate rolls over at BC midnight: ${label}`, () => {
    for (const market of ["central-okanagan", "greater-vancouver", "victoria"]) {
      assert.equal(getMarketLocalIsoDate(market, new Date(before)), beforeDate, market);
      assert.equal(getMarketLocalIsoDate(market, new Date(after)), afterDate, market);
    }
  });
}

// ── Non-ISO locale data ────────────────────────────────────────────────────
// Sentry a310b75e (RangeError: Invalid time value): en-CA's default date
// layout comes from the browser's locale data and isn't guaranteed to be
// YYYY-MM-DD. These simulate such a browser by changing the layout that both
// format() and formatToParts() produce, leaving the date values intact.

type PartsMock = TestContext["mock"];

const realFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;

function simulateDateLayout(
  mock: PartsMock,
  layout: (parts: { year: string; month: string; day: string }) => Intl.DateTimeFormatPart[]
) {
  const partsFor = (dtf: Intl.DateTimeFormat, date?: Date | number) => {
    const real = realFormatToParts.call(dtf, date);
    const value = (type: string) => real.find((p) => p.type === type)!.value;
    return layout({ year: value("year"), month: value("month"), day: value("day") });
  };
  mock.method(Intl.DateTimeFormat.prototype, "formatToParts", function (this: Intl.DateTimeFormat, date?: Date | number) {
    return partsFor(this, date);
  });
  mock.getter(Intl.DateTimeFormat.prototype, "format", function (this: Intl.DateTimeFormat) {
    return (date?: Date | number) => partsFor(this, date).map((p) => p.value).join("");
  });
}

const literal = (value: string): Intl.DateTimeFormatPart => ({ type: "literal", value });
const part = (type: "year" | "month" | "day", value: string): Intl.DateTimeFormatPart => ({ type, value });

const NON_ISO_LAYOUTS: { label: string; layout: Parameters<typeof simulateDateLayout>[1] }[] = [
  {
    label: "MM/DD/YYYY",
    layout: ({ year, month, day }) => [part("month", month), literal("/"), part("day", day), literal("/"), part("year", year)],
  },
  {
    label: "YYYY/MM/DD",
    layout: ({ year, month, day }) => [part("year", year), literal("/"), part("month", month), literal("/"), part("day", day)],
  },
  {
    label: "bidi marks around each field",
    layout: ({ year, month, day }) => [
      literal("‎"), part("year", year), literal("‎-‎"), part("month", month), literal("‎-‎"), part("day", day), literal("‎"),
    ],
  },
];

// 2026-11-09 15:33 UTC = 7:33 a.m. Pacific, the time of the reported error.
const REPORTED_INSTANT = new Date("2026-11-09T15:33:00.000Z");

for (const { label, layout } of NON_ISO_LAYOUTS) {
  test(`getMarketLocalIsoDate returns YYYY-MM-DD when the browser's en-CA layout is ${label}`, (t) => {
    simulateDateLayout(t.mock, layout);
    assert.equal(getMarketLocalIsoDate("central-okanagan", REPORTED_INSTANT), "2026-11-09");
  });

  test(`the event card date path doesn't throw when the browser's en-CA layout is ${label}`, (t) => {
    simulateDateLayout(t.mock, layout);
    assert.deepEqual(getMarketTodayAndTomorrow("central-okanagan", REPORTED_INSTANT), {
      todayIso: "2026-11-09",
      tomorrowIso: "2026-11-10",
    });
  });

  test(`the market-local weekday still resolves when the browser's en-CA layout is ${label}`, (t) => {
    simulateDateLayout(t.mock, layout);
    assert.equal(getMarketLocalWeekday("central-okanagan", REPORTED_INSTANT), 1); // Monday
  });
}

test("Pacific midnight still rolls over correctly under a non-ISO layout", (t) => {
  simulateDateLayout(t.mock, NON_ISO_LAYOUTS[0].layout);
  assert.equal(getMarketLocalIsoDate("greater-san-diego", new Date("2026-11-09T07:59:59.999Z")), "2026-11-08");
  assert.equal(getMarketLocalIsoDate("greater-san-diego", new Date("2026-11-09T08:00:00.000Z")), "2026-11-09");
});
