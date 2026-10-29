import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addDaysToIso,
  buildEventDateBadge,
  getMarketTodayAndTomorrow,
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

test("wiring: the Events page derives today/tomorrow and card badges from the selected market", () => {
  const dir = path.join(process.cwd(), "src/app/(website)/website-events");
  const results = readFileSync(path.join(dir, "EventSearchResults.tsx"), "utf8");
  const card = readFileSync(path.join(dir, "EventSearchCard.tsx"), "utf8");

  assert.match(results, /getMarketTodayAndTomorrow\(market\.id, new Date\(\)\)/);
  assert.doesNotMatch(results, /todayLocal|tomorrowLocal/);
  assert.equal((results.match(/<EventSearchCard [^>]*marketId=\{market\.id\}/g) ?? []).length, 2);
  // Weekend stays a fixed Saturday/Sunday rule.
  assert.match(results, /eventOccursOnDow\(e, 0\) \|\| \/\/ Sunday/);
  assert.match(results, /eventOccursOnDow\(e, 6\)/);

  assert.match(card, /getMarketTodayAndTomorrow\(marketId, new Date\(\)\)/);
  assert.match(card, /marketId=\{marketId \?\? event\.marketSlug \?\? ""\}/);
  assert.doesNotMatch(card, /useEffect|getFullYear|getDay\(\)/);
});
