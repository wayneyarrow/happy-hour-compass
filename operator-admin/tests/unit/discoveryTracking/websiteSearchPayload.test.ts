import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWebsiteSearchPayload } from "../../../src/lib/discoveryTracking/websiteSearchPayload";
import type { CapturedSearch } from "../../../src/lib/discoveryTracking/searchCapture";

/**
 * The exact payload the browser sends (searchTracking.ts) must be accepted.
 * Regression: staging QA for migration 110 found every real search rejected,
 * because `false` (resultCountCapped: false) was also the "invalid" marker.
 */
function clientPayload(search: Partial<CapturedSearch> = {}) {
  const s: CapturedSearch = {
    searchId: "11011011-0000-4000-8000-0000000000aa",
    searchTerm: "wine",
    mode: "happy_hours",
    origin: "typed",
    trigger: "pause",
    resultCount: 12,
    resultCountCapped: false,
    otherFiltersActive: false,
    ...search,
  };
  // Mirrors fireWebsiteSearch()'s body exactly.
  return {
    searchId: s.searchId,
    searchTerm: s.searchTerm,
    surface: "listing_page",
    mode: s.mode,
    origin: s.origin,
    captureTrigger: s.trigger,
    resultCount: s.resultCount,
    resultCountCapped: s.resultCountCapped,
    otherFiltersActive: s.otherFiltersActive,
    sessionId: "sess",
    marketId: "central-okanagan",
  };
}

test("accepts the real client payload with false booleans and keeps them as false (not NULL)", () => {
  const r = parseWebsiteSearchPayload(clientPayload());
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.row.result_count_capped, false);
    assert.equal(r.row.other_filters_active, false);
    assert.equal(r.row.mode, "happy_hours");
    assert.equal(r.row.search_id, "11011011-0000-4000-8000-0000000000aa");
  }
});

test("accepts true booleans, the hero's null otherFiltersActive, and a pre-110 payload with no new fields", () => {
  assert.ok(parseWebsiteSearchPayload(clientPayload({ resultCountCapped: true, otherFiltersActive: true })).ok);
  assert.ok(parseWebsiteSearchPayload({ ...clientPayload(), surface: "homepage_hero", otherFiltersActive: null }).ok);
  const legacy = parseWebsiteSearchPayload({ searchTerm: "wine", surface: "listing_page", resultCount: 3, sessionId: "s", marketId: "central-okanagan" });
  assert.ok(legacy.ok);
  if (legacy.ok) assert.deepEqual([legacy.row.mode, legacy.row.result_count_capped, legacy.row.search_id], [null, null, null]);
});

test("rejects wrong types and unknown values", () => {
  for (const bad of [
    { resultCountCapped: "false" },
    { otherFiltersActive: 0 },
    { mode: "venues" },
    { origin: "external" },
    { captureTrigger: "blur" },
    { searchId: "not-a-uuid" },
    { surface: "map" },
    { resultCount: -1 },
    { searchTerm: "   " },
  ]) {
    assert.equal(parseWebsiteSearchPayload({ ...clientPayload(), ...bad }).ok, false, JSON.stringify(bad));
  }
});

test("a client-supplied environment is ignored", () => {
  const r = parseWebsiteSearchPayload({ ...clientPayload(), environment: "production" });
  assert.ok(r.ok);
  if (r.ok) assert.equal("environment" in r.row, false);
});
