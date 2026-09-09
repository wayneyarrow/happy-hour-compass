import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_SPECIALS_NEW_UNTIL, isFeatureNewBadgeVisible } from "../../../src/lib/newBadge";

/**
 * Homepage Hero — Daily Specials selector "NEW" badge self-expiry. Pure,
 * deterministic date comparison (no clock/storage reads) so it's testable
 * without mocking anything global.
 */

test("DAILY_SPECIALS_NEW_UNTIL is the agreed 2026-10-09 expiry date", () => {
  assert.equal(DAILY_SPECIALS_NEW_UNTIL, "2026-10-09");
});

test("badge is visible well before the expiry date", () => {
  assert.equal(isFeatureNewBadgeVisible(new Date("2026-09-09T00:00:00.000Z"), DAILY_SPECIALS_NEW_UNTIL), true);
});

test("badge is visible up to (but not including) the expiry boundary", () => {
  assert.equal(
    isFeatureNewBadgeVisible(new Date("2026-10-08T23:59:59.999Z"), DAILY_SPECIALS_NEW_UNTIL),
    true
  );
});

test("badge is not visible exactly at the expiry boundary", () => {
  assert.equal(isFeatureNewBadgeVisible(new Date("2026-10-09T00:00:00.000Z"), DAILY_SPECIALS_NEW_UNTIL), false);
});

test("badge is not visible after the expiry date", () => {
  assert.equal(isFeatureNewBadgeVisible(new Date("2026-11-01T00:00:00.000Z"), DAILY_SPECIALS_NEW_UNTIL), false);
});

test("an unparseable expiry string is treated as already expired (fails closed)", () => {
  assert.equal(isFeatureNewBadgeVisible(new Date("2026-09-09T00:00:00.000Z"), "not-a-date"), false);
});
