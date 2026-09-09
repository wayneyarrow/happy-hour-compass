import { test } from "node:test";
import assert from "node:assert/strict";
import { sortDailySpecialsForVenueDetail } from "../../../src/app/(website)/[market]/[city]/[slug]/dailySpecialsOrder";
import type { DailySpecial } from "../../../src/lib/dailySpecialTypes";

const WEDNESDAY = "2026-09-16"; // a Wednesday

function special(overrides: Partial<DailySpecial> & Pick<DailySpecial, "id" | "title" | "schedule">): DailySpecial {
  return {
    venueId: "venue-1",
    createdByOperatorId: null,
    updatedByOperatorId: null,
    createdAt: "",
    updatedAt: "",
    offerType: "food",
    shortSummary: null,
    description: null,
    conditions: null,
    imageUrl: null,
    time: { timeMode: "unspecified" },
    isPublished: true,
    isSeededSpecial: false,
    sourceUrl: null,
    lastVerifiedAt: null,
    ...overrides,
  };
}

test("today-valid Specials sort before everything else", () => {
  const todaySpecial = special({
    id: "today", title: "Wing Wednesday",
    schedule: { scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null },
  });
  const notTodaySpecial = special({
    id: "not-today", title: "Burger Monday",
    schedule: { scheduleType: "weekly", daysOfWeek: [1], recurrenceStartDate: null, recurrenceEndDate: null },
  });

  const ordered = sortDailySpecialsForVenueDetail([notTodaySpecial, todaySpecial], WEDNESDAY);
  assert.equal(ordered[0].id, "today");
});

test("remaining one-time Specials sort by soonest date", () => {
  const later = special({ id: "later", title: "Later", schedule: { scheduleType: "one_time", oneTimeDate: "2026-12-25" } });
  const sooner = special({ id: "sooner", title: "Sooner", schedule: { scheduleType: "one_time", oneTimeDate: "2026-10-01" } });

  const ordered = sortDailySpecialsForVenueDetail([later, sooner], WEDNESDAY);
  assert.deepEqual(ordered.map((s) => s.id), ["sooner", "later"]);
});

test("remaining weekly Specials sort by earliest selected weekday", () => {
  const fridaySpecial = special({
    id: "friday", title: "Friday",
    schedule: { scheduleType: "weekly", daysOfWeek: [5], recurrenceStartDate: null, recurrenceEndDate: null },
  });
  const mondaySpecial = special({
    id: "monday", title: "Monday",
    schedule: { scheduleType: "weekly", daysOfWeek: [1], recurrenceStartDate: null, recurrenceEndDate: null },
  });

  const ordered = sortDailySpecialsForVenueDetail([fridaySpecial, mondaySpecial], WEDNESDAY);
  assert.deepEqual(ordered.map((s) => s.id), ["monday", "friday"]);
});

test("one-time Specials sort before weekly Specials (within the non-today bucket)", () => {
  const oneTime = special({ id: "one-time", title: "One Time", schedule: { scheduleType: "one_time", oneTimeDate: "2026-12-25" } });
  const weekly = special({
    id: "weekly", title: "Weekly",
    schedule: { scheduleType: "weekly", daysOfWeek: [1], recurrenceStartDate: null, recurrenceEndDate: null },
  });

  const ordered = sortDailySpecialsForVenueDetail([weekly, oneTime], WEDNESDAY);
  assert.deepEqual(ordered.map((s) => s.id), ["one-time", "weekly"]);
});

test("deterministic fallback: identical bucket/key ties break by title, alphabetically", () => {
  const b = special({
    id: "b", title: "Burger Monday",
    schedule: { scheduleType: "weekly", daysOfWeek: [1], recurrenceStartDate: null, recurrenceEndDate: null },
  });
  const a = special({
    id: "a", title: "Awesome Monday",
    schedule: { scheduleType: "weekly", daysOfWeek: [1], recurrenceStartDate: null, recurrenceEndDate: null },
  });

  const ordered = sortDailySpecialsForVenueDetail([b, a], WEDNESDAY);
  assert.deepEqual(ordered.map((s) => s.id), ["a", "b"]);
});

test("multiple today-valid Specials preserve title tie-break among themselves", () => {
  const z = special({
    id: "z", title: "Zebra Wednesday",
    schedule: { scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null },
  });
  const a = special({
    id: "a", title: "Apple Wednesday",
    schedule: { scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null },
  });

  const ordered = sortDailySpecialsForVenueDetail([z, a], WEDNESDAY);
  assert.deepEqual(ordered.map((s) => s.id), ["a", "z"]);
});

test("does not mutate the input array", () => {
  const list = [
    special({ id: "1", title: "B", schedule: { scheduleType: "one_time", oneTimeDate: "2026-12-25" } }),
    special({ id: "2", title: "A", schedule: { scheduleType: "one_time", oneTimeDate: "2026-10-01" } }),
  ];
  const original = [...list];
  sortDailySpecialsForVenueDetail(list, WEDNESDAY);
  assert.deepEqual(list, original);
});
