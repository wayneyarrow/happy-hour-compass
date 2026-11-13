import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BC_PERMANENT_UTC_MINUS_7_FROM_MS,
  intlTimeZoneFor,
  offsetMinutes,
  runtimeHasStaleBcRules,
  timeZoneLabel,
} from "../../../src/lib/timeZones";
import { getMarketLocalIsoDate, getMarketTimeZone } from "../../../src/lib/marketLocalDate";
import {
  buildHhSchedule,
  computeBusinessHoursStatus,
  computeHhStatus,
  computeHhTodayText,
  getVenueLocalDayName,
  isHappyHourActive,
} from "../../../src/lib/happyHourStatus";
import {
  buildDisplayedWeek,
  displayCaption,
  displayDayAndTime,
  instantFormatterFor,
  resolveTimeDisplay,
} from "../../../src/lib/venueTimeDisplay";
import { parseHhAllDayDays, parseHhTimes } from "../../../src/lib/data/venues";

/**
 * Greater San Diego vs Central Okanagan local time, winter 2026.
 *
 * tzdata 2026b: British Columbia is permanent UTC−7 from 2026-03-09, so in
 * winter Kelowna (UTC−7) is an hour ahead of Solana Beach (PST, UTC−8).
 * These assertions must hold on every runtime — run this file under a
 * stale-data Node (20.19.x, tz 2024b) and a current one (22.23.x, tz 2026e);
 * the result is identical. Fixtures only — Encore Sushi's schedule mirrors
 * its public listing (happy hour Tue–Sun 3–5:30 PM).
 */

// Tuesday 2026-12-15 23:30 UTC = 3:30 PM Solana Beach = 4:30 PM Kelowna.
const WINTER = new Date("2026-12-15T23:30:00Z");

const ENCORE_HH = [
  "Sunday: 3 PM–5:30 PM",
  "Monday: No happy hour",
  "Tuesday: 3 PM–5:30 PM",
  "Wednesday: 3 PM–5:30 PM",
  "Thursday: 3 PM–5:30 PM",
  "Friday: 3 PM–5:30 PM",
  "Saturday: 3 PM–5:30 PM",
].join("\r\n");

// venues.ts mapBusinessHours() shape for Encore's business_hours.
const ENCORE_HOURS: Record<string, string> = {
  Sunday: "12:00 PM - 9:00 PM",
  Monday: "CLOSED",
  Tuesday: "3:00 PM - 9:00 PM",
  Wednesday: "3:00 PM - 9:00 PM",
  Thursday: "3:00 PM - 9:00 PM",
  Friday: "12:00 PM - 10:00 PM",
  Saturday: "12:00 PM - 10:00 PM",
};

function encore() {
  return buildHhSchedule({
    happyHourWeekly: parseHhTimes(ENCORE_HH),
    happyHourAllDayDays: parseHhAllDayDays(ENCORE_HH),
    hoursWeekly: ENCORE_HOURS,
    marketSlug: "greater-san-diego",
  });
}

function kelownaVenue(hhTimes: string) {
  return buildHhSchedule({
    happyHourWeekly: parseHhTimes(hhTimes),
    happyHourAllDayDays: parseHhAllDayDays(hhTimes),
    hoursWeekly: {},
    marketSlug: "central-okanagan",
  });
}

// ─── Effective offsets ───────────────────────────────────────────────────────

test("Greater San Diego uses America/Los_Angeles", () => {
  assert.equal(getMarketTimeZone("greater-san-diego"), "America/Los_Angeles");
  assert.equal(getMarketTimeZone("central-okanagan"), "America/Vancouver");
});

test("winter offsets: Solana Beach UTC−8 (PST), Kelowna UTC−7 — on any runtime", () => {
  assert.equal(offsetMinutes("America/Los_Angeles", WINTER.getTime()), -480);
  assert.equal(offsetMinutes("America/Vancouver", WINTER.getTime()), -420);
  assert.equal(timeZoneLabel("America/Los_Angeles", WINTER.getTime()), "PST");
  assert.equal(timeZoneLabel("America/Vancouver", WINTER.getTime()), "PDT");
});

test("summer offsets: both UTC−7", () => {
  const july = Date.UTC(2027, 6, 15, 20);
  assert.equal(offsetMinutes("America/Los_Angeles", july), -420);
  assert.equal(offsetMinutes("America/Vancouver", july), -420);
});

test("BC correction only applies from 2026-03-09 and only on stale runtimes", () => {
  // Winter 2025–26 was still PST in BC — never rewritten.
  const jan2026 = Date.UTC(2026, 0, 15, 20);
  assert.equal(offsetMinutes("America/Vancouver", jan2026), -480);
  assert.equal(intlTimeZoneFor("America/Vancouver", BC_PERMANENT_UTC_MINUS_7_FROM_MS - 1), "America/Vancouver");
  assert.equal(
    intlTimeZoneFor("America/Vancouver", WINTER),
    runtimeHasStaleBcRules() ? "America/Phoenix" : "America/Vancouver"
  );
  assert.equal(intlTimeZoneFor("America/Los_Angeles", WINTER), "America/Los_Angeles");
});

test("market-local date: day boundary differs between Solana Beach and Kelowna", () => {
  // 07:30 UTC Wed = 11:30 PM Tue in Solana Beach, 12:30 AM Wed in Kelowna.
  const t = new Date("2026-12-16T07:30:00Z");
  assert.equal(getMarketLocalIsoDate("greater-san-diego", t), "2026-12-15");
  assert.equal(getMarketLocalIsoDate("central-okanagan", t), "2026-12-16");
  assert.equal(getVenueLocalDayName("America/Los_Angeles", t), "Tuesday");
  assert.equal(getVenueLocalDayName("America/Vancouver", t), "Wednesday");
  // 08:00 UTC = midnight Wednesday in Solana Beach.
  assert.equal(getMarketLocalIsoDate("greater-san-diego", new Date("2026-12-16T08:00:00Z")), "2026-12-16");
});

// ─── Happy Hour Now / Open Now from the venue's own schedule ────────────────

test("3:30 PM in Solana Beach is 4:30 PM in Kelowna — each venue judged on its own clock", () => {
  assert.equal(isHappyHourActive(encore(), WINTER), true);
  const status = computeHhStatus(encore(), WINTER);
  assert.equal(status.type, "active");
  if (status.type === "active") {
    assert.equal(status.until, "5:30 PM");
    assert.equal(status.endsIn, "Ends in 2 hr");
    assert.equal(status.untilMs, Date.parse("2026-12-16T01:30:00Z"));
  }
  // A Kelowna 4–6 PM happy hour is on at the same instant (4:30 PM there)…
  assert.equal(isHappyHourActive(kelownaVenue("Tuesday: 4 PM–6 PM"), WINTER), true);
  // …and a Kelowna 3–4 PM one has already ended (stale data would say on).
  assert.equal(isHappyHourActive(kelownaVenue("Tuesday: 3 PM–4 PM"), WINTER), false);
});

test("Encore Open Now uses its business hours in Pacific time", () => {
  const open = computeBusinessHoursStatus(ENCORE_HOURS, "America/Los_Angeles", WINTER);
  assert.deepEqual(open, { type: "open", closesAt: "9 PM", closesAtMs: Date.parse("2026-12-16T05:00:00Z") });
  // Monday 10 AM PST: closed, opens Tuesday 3 PM.
  const monday = computeBusinessHoursStatus(ENCORE_HOURS, "America/Los_Angeles", new Date("2026-12-14T18:00:00Z"));
  assert.equal(monday.type, "closed");
  if (monday.type === "closed") {
    assert.equal(monday.next?.day, "Tomorrow");
    assert.equal(monday.next?.opensAt, "3 PM");
    assert.equal(monday.next?.opensAtMs, Date.parse("2026-12-15T23:00:00Z"));
  }
});

test("overnight business hours stay open past midnight", () => {
  const hours = { ...ENCORE_HOURS, Friday: "6:00 PM - 2:00 AM" };
  // Sat 1 AM PST.
  const s = computeBusinessHoursStatus(hours, "America/Los_Angeles", new Date("2026-12-19T09:00:00Z"));
  assert.equal(s.type, "open");
});

// ─── Converted display ───────────────────────────────────────────────────────

test("Kelowna visitor sees Encore's hours converted and labelled", () => {
  const display = resolveTimeDisplay("America/Los_Angeles", "America/Vancouver", WINTER);
  assert.equal(display.mode, "visitor");
  assert.equal(
    displayCaption(display, WINTER),
    "Times shown in your time (PDT) · Venue local time: PST"
  );
  const fmt = instantFormatterFor(display, WINTER);
  assert.equal(computeHhTodayText(encore(), WINTER, fmt).text, "On now · until 6:30 PM PDT");
  const week = buildDisplayedWeek(encore().weekly, display, { now: WINTER, emptyText: "No happy hour" });
  assert.deepEqual(
    week.find((d) => d.day === "Tuesday")?.ranges,
    ["4 PM–6:30 PM"]
  );
  assert.deepEqual(week.find((d) => d.day === "Monday")?.ranges, ["No happy hour"]);
});

test("conversion that crosses midnight lands on the visitor's own day", () => {
  // Venue Tuesday 10 PM–11 PM Pacific seen from New York = Wednesday 1–2 AM.
  const late = buildHhSchedule({
    happyHourWeekly: parseHhTimes("Tuesday: 10 PM–11 PM"),
    happyHourAllDayDays: [],
    hoursWeekly: {},
    marketSlug: "greater-san-diego",
  });
  const display = resolveTimeDisplay("America/Los_Angeles", "America/New_York", WINTER);
  const week = buildDisplayedWeek(late.weekly, display, { now: WINTER, emptyText: "—" });
  assert.deepEqual(week.find((d) => d.day === "Tuesday")?.ranges, ["—"]);
  assert.deepEqual(week.find((d) => d.day === "Wednesday")?.ranges, ["1 AM–2 AM"]);
  // Upcoming status day follows the visitor's calendar too.
  const status = computeHhStatus(late, WINTER);
  assert.equal(status.type, "upcoming");
  if (status.type === "upcoming") {
    assert.equal(status.day, "Today");
    assert.deepEqual(displayDayAndTime(display, status.startsAtMs, { day: status.day, time: status.startsAt }, WINTER), {
      day: "Tomorrow",
      time: "1 AM EST",
    });
  }
});

test("same clock: no conversion and no label for a local visitor", () => {
  const display = resolveTimeDisplay("America/Los_Angeles", "America/Los_Angeles", WINTER);
  assert.equal(display.mode, "same");
  assert.equal(displayCaption(display, WINTER), null);
  assert.equal(computeHhTodayText(encore(), WINTER, instantFormatterFor(display, WINTER)).text, "On now · until 5:30 PM");
  // Tijuana shares Pacific time with San Diego.
  assert.equal(resolveTimeDisplay("America/Los_Angeles", "America/Tijuana", WINTER).mode, "same");
});

test("unknown visitor timezone: venue-local times, explicitly labelled", () => {
  const display = resolveTimeDisplay("America/Los_Angeles", null, WINTER);
  assert.equal(display.mode, "venue");
  assert.equal(displayCaption(display, WINTER), "Times shown in local time at the venue (PST)");
  assert.equal(computeHhTodayText(encore(), WINTER, instantFormatterFor(display, WINTER)).text, "On now · until 5:30 PM");
});
