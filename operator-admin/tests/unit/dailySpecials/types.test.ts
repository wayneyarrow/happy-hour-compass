import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceDailySpecialRow, type DailySpecialDbRow } from "../../../src/lib/dailySpecialTypes";

/**
 * coerceDailySpecialRow() — maps a raw Supabase row (snake_case, untyped
 * strings) into the closed-union DailySpecial application shape. Pure, no
 * I/O — direct unit tests.
 */

function baseRow(overrides: Partial<DailySpecialDbRow> = {}): DailySpecialDbRow {
  return {
    id: "special-1",
    venue_id: "venue-1",
    created_by_operator_id: null,
    updated_by_operator_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    title: "Wing Wednesday",
    offer_type: "food",
    short_summary: "$12 wings",
    description: null,
    conditions: null,
    image_url: null,
    schedule_type: "weekly",
    one_time_date: null,
    days_of_week: [3],
    recurrence_start_date: null,
    recurrence_end_date: null,
    time_mode: "unspecified",
    start_time: null,
    end_mode: "unspecified",
    end_time: null,
    is_published: true,
    is_seeded_special: false,
    source_url: null,
    last_verified_at: null,
    ...overrides,
  };
}

test("coerces a valid weekly row into a discriminated 'weekly' schedule", () => {
  const result = coerceDailySpecialRow(baseRow());
  assert.ok(result);
  assert.equal(result?.schedule.scheduleType, "weekly");
  if (result?.schedule.scheduleType === "weekly") {
    assert.deepEqual(result.schedule.daysOfWeek, [3]);
  }
  assert.equal(result?.time.timeMode, "unspecified");
  assert.equal(result?.offerType, "food");
});

test("coerces a valid one-time row into a discriminated 'one_time' schedule", () => {
  const result = coerceDailySpecialRow(
    baseRow({
      schedule_type: "one_time",
      one_time_date: "2026-09-18",
      days_of_week: null,
    })
  );
  assert.ok(result);
  assert.equal(result?.schedule.scheduleType, "one_time");
  if (result?.schedule.scheduleType === "one_time") {
    assert.equal(result.schedule.oneTimeDate, "2026-09-18");
  }
});

test("coerces a 'timed' row with start + Close into the correct discriminated shape", () => {
  const result = coerceDailySpecialRow(
    baseRow({ time_mode: "timed", start_time: "16:00:00", end_mode: "close", end_time: null })
  );
  assert.ok(result);
  assert.equal(result?.time.timeMode, "timed");
  if (result?.time.timeMode === "timed") {
    assert.equal(result.time.startTime, "16:00:00");
    assert.equal(result.time.endMode, "close");
    assert.equal(result.time.endTime, null);
  }
});

test("sorts days_of_week ascending regardless of stored order", () => {
  const result = coerceDailySpecialRow(baseRow({ days_of_week: [5, 1, 3] }));
  assert.ok(result);
  if (result?.schedule.scheduleType === "weekly") {
    assert.deepEqual(result.schedule.daysOfWeek, [1, 3, 5]);
  }
});

test("returns null for an unrecognized offer_type", () => {
  const result = coerceDailySpecialRow(baseRow({ offer_type: "beverage" }));
  assert.equal(result, null);
});

test("returns null for a weekly row with no days_of_week (should never happen given the DB CHECK constraint, but read paths degrade rather than throw)", () => {
  const result = coerceDailySpecialRow(baseRow({ days_of_week: null }));
  assert.equal(result, null);
});

test("returns null for a one_time row missing one_time_date", () => {
  const result = coerceDailySpecialRow(
    baseRow({ schedule_type: "one_time", one_time_date: null, days_of_week: null })
  );
  assert.equal(result, null);
});

test("returns null for an unrecognized schedule_type", () => {
  const result = coerceDailySpecialRow(baseRow({ schedule_type: "monthly" }));
  assert.equal(result, null);
});

test("returns null for an unrecognized time_mode", () => {
  const result = coerceDailySpecialRow(baseRow({ time_mode: "sometimes" }));
  assert.equal(result, null);
});

test("preserves seeded/provenance fields verbatim", () => {
  const result = coerceDailySpecialRow(
    baseRow({
      is_seeded_special: true,
      source_url: "https://example.com/menu",
      last_verified_at: "2026-08-01T00:00:00.000Z",
    })
  );
  assert.equal(result?.isSeededSpecial, true);
  assert.equal(result?.sourceUrl, "https://example.com/menu");
  assert.equal(result?.lastVerifiedAt, "2026-08-01T00:00:00.000Z");
});
