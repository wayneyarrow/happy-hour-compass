import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHhSchedule,
  computeHhStatus,
  computeHhStatusForDay,
  computeHhTodayText,
  formatHhDay,
  getActiveHappyHourDay,
  getVenueLocalDayName,
  hasHappyHourOnDay,
  hasHappyHourOverlap,
  isHappyHourActive,
  type HhSchedule,
} from "../../../src/lib/happyHourStatus";
import { parseHhAllDayDays, parseHhTimes } from "../../../src/lib/data/venues";

// Fixtures only — no Production data. All instants carry an explicit offset.
// Oct 2026: Pacific Daylight Time (UTC-7); 2026-10-23 is a Friday.

const CLOSED_WEEK: Record<string, string> = {
  Sunday: "CLOSED", Monday: "CLOSED", Tuesday: "CLOSED", Wednesday: "CLOSED",
  Thursday: "CLOSED", Friday: "CLOSED", Saturday: "CLOSED",
};

function schedule(
  hhTimes: string,
  opts: { hours?: Record<string, string>; market?: string | null } = {}
): HhSchedule {
  return buildHhSchedule({
    happyHourWeekly: parseHhTimes(hhTimes),
    happyHourAllDayDays: parseHhAllDayDays(hhTimes),
    hoursWeekly: { ...CLOSED_WEEK, ...(opts.hours ?? {}) },
    marketSlug: opts.market === undefined ? "central-okanagan" : opts.market,
  });
}

const at = (iso: string) => new Date(iso);

// ─── Parsing ─────────────────────────────────────────────────────────────────

test("parser keeps overnight windows as stored (end before start)", () => {
  const weekly = parseHhTimes("Friday: 9 PM – 1 AM\nSaturday: 10 PM – 12 AM");
  assert.deepEqual(weekly.Friday, [{ start: "21:00", end: "01:00" }]);
  assert.deepEqual(weekly.Saturday, [{ start: "22:00", end: "00:00" }]);
});

test('parser recognizes "All Day" without changing happyHourWeekly', () => {
  const text = "Monday: All Day\nTuesday – Wednesday: All day\nThursday: 4 PM – 6 PM";
  assert.deepEqual(parseHhAllDayDays(text), ["Monday", "Tuesday", "Wednesday"]);
  const weekly = parseHhTimes(text);
  assert.deepEqual(weekly.Monday, []);
  assert.deepEqual(weekly.Thursday, [{ start: "16:00", end: "18:00" }]);
  assert.deepEqual(parseHhAllDayDays("Daily: All Day").length, 7);
});

test('an explicit schedule wins over "All Day" for the same day', () => {
  assert.deepEqual(parseHhAllDayDays("Daily: All Day\nMonday: 4 PM – 6 PM").includes("Monday"), false);
});

// ─── Ordinary boundaries ─────────────────────────────────────────────────────

test("start is inclusive, end is exclusive", () => {
  const s = schedule("Friday: 4 PM – 6 PM");
  assert.equal(isHappyHourActive(s, at("2026-10-23T15:59:00-07:00")), false);
  assert.equal(isHappyHourActive(s, at("2026-10-23T16:00:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-10-23T17:59:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-10-23T18:00:00-07:00")), false);
  assert.deepEqual(computeHhStatus(s, at("2026-10-23T16:00:00-07:00")), {
    type: "active", endsIn: "Ends in 2 hr", until: "6 PM",
  });
});

// ─── Overnight ───────────────────────────────────────────────────────────────

test("Friday 9 PM–1 AM stays active until Saturday 1 AM", () => {
  const s = schedule("Friday: 9 PM – 1 AM");
  assert.equal(isHappyHourActive(s, at("2026-10-23T20:59:00-07:00")), false);
  assert.equal(isHappyHourActive(s, at("2026-10-23T21:00:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-10-23T23:59:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-10-24T00:00:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-10-24T00:59:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-10-24T01:00:00-07:00")), false);
  assert.deepEqual(computeHhStatus(s, at("2026-10-24T00:30:00-07:00")), {
    type: "active", endsIn: "Ends in 30 min", until: "1 AM",
  });
  assert.deepEqual(computeHhTodayText(s, at("2026-10-23T23:00:00-07:00")), {
    text: "On now · until 1 AM", isActive: true,
  });
});

test("a window ending at midnight ends exactly at midnight", () => {
  const s = schedule("Saturday: 10 PM – 12 AM");
  assert.equal(isHappyHourActive(s, at("2026-10-24T23:59:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-10-25T00:00:00-07:00")), false);
  assert.equal(formatHhDay(s, "Saturday"), "10 PM–12 AM");
});

test("previous-day carryover rolls over the week: Saturday → Sunday and Sunday → Monday", () => {
  const s = schedule("Saturday: 9 PM – 2 AM\nSunday: 10 PM – 2 AM");
  assert.equal(isHappyHourActive(s, at("2026-10-25T01:30:00-07:00")), true); // Sun 1:30 (Sat window)
  assert.equal(isHappyHourActive(s, at("2026-10-25T02:00:00-07:00")), false);
  assert.equal(isHappyHourActive(s, at("2026-10-26T01:30:00-07:00")), true); // Mon 1:30 (Sun window)
  assert.equal(isHappyHourActive(s, at("2026-10-26T02:00:00-07:00")), false);
});

test("carryover never applies to the day after a closed day", () => {
  const s = schedule("Thursday: 9 PM – 1 AM");
  assert.equal(isHappyHourActive(s, at("2026-10-24T00:30:00-07:00")), false); // Sat 12:30 AM
  assert.equal(isHappyHourActive(s, at("2026-10-23T00:30:00-07:00")), true); // Fri 12:30 AM
});

test("after a carryover ends, the status moves on to today's own windows", () => {
  const s = schedule("Friday: 9 PM – 1 AM\nSaturday: 3 PM – 5 PM");
  assert.deepEqual(computeHhStatus(s, at("2026-10-24T01:30:00-07:00")), {
    type: "upcoming", day: "Today", startsAt: "3 PM", endsAt: "5 PM",
  });
});

// ─── Multiple windows / closed days ──────────────────────────────────────────

test("multiple daily windows, including a late one past midnight", () => {
  const s = schedule("Friday: 3 PM – 6 PM, 9 PM – 1 AM");
  assert.equal(isHappyHourActive(s, at("2026-10-23T17:00:00-07:00")), true);
  assert.deepEqual(computeHhStatus(s, at("2026-10-23T19:00:00-07:00")), {
    type: "upcoming", day: "Today", startsAt: "9 PM", endsAt: "1 AM",
  });
  assert.equal(isHappyHourActive(s, at("2026-10-24T00:15:00-07:00")), true);
  assert.equal(formatHhDay(s, "Friday"), "3 PM–6 PM, 9 PM–1 AM");
  assert.deepEqual(computeHhTodayText(s, at("2026-10-23T19:00:00-07:00")), {
    text: "Starts at 9 PM", isActive: false,
  });
});

test("closed days point to the next Happy Hour day", () => {
  const s = schedule("Monday: 4 PM – 6 PM");
  assert.deepEqual(computeHhStatus(s, at("2026-10-24T12:00:00-07:00")), {
    type: "upcoming", day: "Monday", startsAt: "4 PM", endsAt: "6 PM",
  });
  assert.deepEqual(computeHhStatus(s, at("2026-10-25T12:00:00-07:00")).type, "upcoming");
  assert.equal(computeHhTodayText(s, at("2026-10-25T12:00:00-07:00")).text, "No happy hour today · Next: Tomorrow");
  assert.deepEqual(computeHhStatus(schedule(""), at("2026-10-25T12:00:00-07:00")), { type: "none" });
});

// ─── Timezones ───────────────────────────────────────────────────────────────

test("status is identical at the same instant regardless of the visitor's timezone", () => {
  const s = schedule("Friday: 9 PM – 1 AM\nSaturday: 3 PM – 5 PM");
  const instants = [
    "2026-10-23T20:59:00-07:00", "2026-10-23T21:00:00-07:00",
    "2026-10-24T00:30:00-07:00", "2026-10-24T01:00:00-07:00",
    "2026-10-24T15:30:00-07:00",
  ].map(at);
  const original = process.env.TZ;
  try {
    const results = ["America/Vancouver", "UTC", "Asia/Tokyo", "America/Toronto", "Pacific/Kiritimati"].map((tz) => {
      process.env.TZ = tz;
      return instants.map((i) => [computeHhStatus(s, i), computeHhTodayText(s, i), getVenueLocalDayName(s.timeZone, i)]);
    });
    for (const r of results) assert.deepEqual(r, results[0]);
  } finally {
    process.env.TZ = original;
  }
});

test("the venue's market timezone is used (Calgary is Mountain Time)", () => {
  const vancouver = schedule("Friday: 4 PM – 6 PM", { market: "central-okanagan" });
  const calgary = schedule("Friday: 4 PM – 6 PM", { market: "calgary" });
  assert.equal(calgary.timeZone, "America/Edmonton");
  const instant = at("2026-10-23T16:30:00-06:00"); // 4:30 PM Calgary = 3:30 PM Vancouver
  assert.equal(isHappyHourActive(calgary, instant), true);
  assert.equal(isHappyHourActive(vancouver, instant), false);
});

// ─── Daylight saving ─────────────────────────────────────────────────────────

test("spring forward: an overnight window through 2 AM counts one hour less", () => {
  // Sun 2026-03-08 02:00 PST → 03:00 PDT.
  const s = schedule("Saturday: 9 PM – 3 AM");
  const instant = at("2026-03-08T01:00:00-08:00");
  assert.equal(isHappyHourActive(s, instant), true);
  assert.equal((computeHhStatus(s, instant) as { endsIn: string }).endsIn, "Ends in 1 hr");
  assert.equal(isHappyHourActive(s, at("2026-03-08T03:00:00-07:00")), false);
});

test("fall back: an overnight window through 2 AM counts one hour more, both 1 AMs active", () => {
  // Sun 2026-11-01 02:00 PDT → 01:00 PST.
  const s = schedule("Saturday: 9 PM – 3 AM");
  const first = at("2026-11-01T01:00:00-07:00");
  const second = at("2026-11-01T01:30:00-08:00");
  assert.equal((computeHhStatus(s, first) as { endsIn: string }).endsIn, "Ends in 3 hr");
  assert.equal(isHappyHourActive(s, second), true);
  assert.equal(isHappyHourActive(s, at("2026-11-01T03:00:00-08:00")), false);
});

test("ordinary windows on DST-change days follow local wall-clock time", () => {
  const s = schedule("Sunday: 4 PM – 6 PM");
  assert.equal(isHappyHourActive(s, at("2026-03-08T16:00:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-11-01T16:00:00-08:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-11-01T15:59:00-08:00")), false);
});

// ─── All Day ─────────────────────────────────────────────────────────────────

test('"All Day" uses that day\'s business hours, including closes after midnight', () => {
  const s = schedule("Monday: All Day\nFriday: All Day", {
    hours: { Monday: "11:00 AM - 10:00 PM", Friday: "11:00 AM - 1:00 AM" },
  });
  assert.equal(isHappyHourActive(s, at("2026-10-26T10:59:00-07:00")), false);
  assert.equal(isHappyHourActive(s, at("2026-10-26T11:00:00-07:00")), true);
  assert.equal(isHappyHourActive(s, at("2026-10-26T22:00:00-07:00")), false);
  assert.equal(isHappyHourActive(s, at("2026-10-24T00:30:00-07:00")), true); // Fri close 1 AM
  assert.equal(formatHhDay(s, "Monday"), "All Day (11 AM–10 PM)");
  assert.deepEqual(s.allDayWithoutHours, []);
});

test('"All Day" without usable business hours is shown but never "on now"', () => {
  const s = schedule("Monday: All Day", { hours: { Monday: "CLOSED" } });
  assert.deepEqual(s.allDayWithoutHours, ["Monday"]);
  assert.equal(isHappyHourActive(s, at("2026-10-26T15:00:00-07:00")), false);
  assert.deepEqual(computeHhStatus(s, at("2026-10-26T15:00:00-07:00")), { type: "allDay", day: "Today" });
  assert.deepEqual(computeHhStatus(s, at("2026-10-25T15:00:00-07:00")), { type: "allDay", day: "Tomorrow" });
  assert.deepEqual(computeHhStatusForDay(s, "Monday", at("2026-10-23T15:00:00-07:00")), { type: "allDay", day: "Monday" });
  assert.equal(computeHhTodayText(s, at("2026-10-26T15:00:00-07:00")).text, "All Day");
  assert.equal(formatHhDay(s, "Monday"), "All Day");
  assert.equal(hasHappyHourOnDay(s, "Monday"), true);
  assert.equal(hasHappyHourOverlap(s, ["Monday"], 15 * 60, 18 * 60), false);
});

test('missing business hours entirely keeps "All Day" without inventing times', () => {
  const s = buildHhSchedule({
    happyHourWeekly: parseHhTimes("Monday: All Day"),
    happyHourAllDayDays: ["Monday"],
    hoursWeekly: {},
    marketSlug: null,
  });
  assert.equal(s.timeZone, "America/Vancouver");
  assert.deepEqual(s.weekly.Monday, []);
  assert.deepEqual(s.allDayWithoutHours, ["Monday"]);
});

// ─── Day / Time filter helpers ───────────────────────────────────────────────

test("time-range overlap compares overnight windows on their full span", () => {
  const s = schedule("Friday: 9 PM – 1 AM");
  assert.equal(hasHappyHourOverlap(s, ["Friday"], 22 * 60, 24 * 60), true);
  assert.equal(hasHappyHourOverlap(s, ["Friday"], 11 * 60, 21 * 60), false);
  assert.equal(hasHappyHourOverlap(s, ["Saturday"], 22 * 60, 24 * 60), false);
  assert.equal(hasHappyHourOverlap(s, null, 22 * 60, 24 * 60), true);
  assert.equal(hasHappyHourOnDay(s, "Friday"), true);
  assert.equal(hasHappyHourOnDay(s, "Saturday"), false);
});

test("Day-filtered card status: other days show that day's window, today is live", () => {
  const s = schedule("Friday: 9 PM – 1 AM\nSaturday: 3 PM – 5 PM");
  const friLate = at("2026-10-23T22:00:00-07:00");
  assert.equal(computeHhStatusForDay(s, "Friday", friLate).type, "active");
  assert.deepEqual(computeHhStatusForDay(s, "Saturday", friLate), {
    type: "upcoming", day: "Saturday", startsAt: "3 PM", endsAt: "5 PM",
  });
});

test("On Now + Day/Time during a carryover evaluate the day the window started", () => {
  const s = schedule("Friday: 9 PM – 1 AM");
  const satEarly = at("2026-10-24T00:30:00-07:00");
  assert.equal(getActiveHappyHourDay(s, satEarly), "Friday");
  assert.equal(getVenueLocalDayName(s.timeZone, satEarly), "Saturday");
  // What HappyHoursSearchClient checks with On Now + "Today" + 10 PM–Midnight:
  const day = getActiveHappyHourDay(s, satEarly)!;
  assert.equal(hasHappyHourOnDay(s, day), true);
  assert.equal(hasHappyHourOverlap(s, [day], 22 * 60, 24 * 60), true);
  assert.equal(getActiveHappyHourDay(s, at("2026-10-24T01:00:00-07:00")), null);
});

// ─── Agreement ───────────────────────────────────────────────────────────────

test("venue status, schedule card, and On Now agree at every 15 minutes for two weeks", () => {
  const fixtures = [
    schedule("Friday: 9 PM – 1 AM\nSaturday: 10 PM – 12 AM\nSunday: 10 PM – 2 AM"),
    schedule("Monday – Friday: 3 PM – 6 PM, 9 PM – 11 PM"),
    schedule("Daily: All Day", { hours: { Monday: "11:00 AM - 10:00 PM", Saturday: "4:00 PM - 2:00 AM" } }),
    schedule("Saturday: 9 PM – 3 AM", { market: "calgary" }),
  ];
  // Spans the fall-back transition (2026-11-01).
  const start = at("2026-10-25T00:00:00-07:00").getTime();
  for (const s of fixtures) {
    for (let t = start; t < start + 14 * 24 * 3600_000; t += 15 * 60_000) {
      const now = new Date(t);
      const onNow = isHappyHourActive(s, now);
      const activeDay = getActiveHappyHourDay(s, now);
      assert.equal(activeDay !== null, onNow, now.toISOString());
      if (activeDay) assert.equal(hasHappyHourOnDay(s, activeDay), true, now.toISOString());
      assert.equal(computeHhStatus(s, now).type === "active", onNow, now.toISOString());
      assert.equal(computeHhTodayText(s, now).isActive, onNow, now.toISOString());
      const today = getVenueLocalDayName(s.timeZone, now);
      assert.equal(computeHhStatusForDay(s, today, now).type === "active", onNow, now.toISOString());
    }
  }
});
