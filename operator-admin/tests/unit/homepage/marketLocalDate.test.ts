import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getMarketTimeZone,
  getMarketLocalIsoDate,
  getMarketLocalWeekday,
  getMarketLocalWeekdayLabel,
} from "../../../src/lib/marketLocalDate";

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
