import { test } from "node:test";
import assert from "node:assert/strict";
import { trackGA4Event } from "../../../src/lib/ga4";

/**
 * Homepage Hero discovery-mode GA4 events. trackGA4Event() itself guards on
 * `typeof window === "undefined"` (see ga4.ts) — this Node test environment
 * has no `window`, so these calls exercise exactly that guard, the same
 * production-only safety net that makes staging/local a no-op without a
 * GA measurement ID ever needing to be read here. This is a smoke test for
 * "never throws", not a network/DOM assertion.
 */

test("homepage_discovery_mode_selected never throws when window is undefined (server/test context)", () => {
  assert.doesNotThrow(() => {
    trackGA4Event("homepage_discovery_mode_selected", {
      surface: "homepage_hero",
      mode: "daily_specials",
      previous_mode: "happy_hours",
      market: "central-okanagan",
    });
  });
});

test("homepage_discovery_browse_clicked never throws when window is undefined (server/test context)", () => {
  assert.doesNotThrow(() => {
    trackGA4Event("homepage_discovery_browse_clicked", {
      surface: "homepage_hero",
      mode: "events",
      market: "central-okanagan",
    });
  });
});
