import { test } from "node:test";
import assert from "node:assert/strict";
import { filterVenues, normalizeVenueName } from "../../../src/lib/searchDiscoveryReporting/venueSearch";
import { aggregateLegacyRailDetail } from "../../../src/lib/searchDiscoveryReporting/placementMetrics";
import { LEGACY_RAIL_RE, hrefFor, parseParams } from "../../../src/app/control-panel/analytics/search-discovery/context";
import { sectionTitle } from "../../../src/app/control-panel/analytics/search-discovery/labels";
import type { NameMaps } from "../../../src/lib/data/searchDiscoveryReport";

// ── Searchable venue picker ─────────────────────────────────────────────────

const V = [
  { id: "1", name: "Erica Jane", active: true },
  { id: "2", name: "Kelly & Carlos O'Bryan's – Kelowna", active: false },
  { id: "3", name: "BNA Brewing Co. & Eatery", active: true },
  { id: "4", name: "Café Amici", active: false },
  { id: "5", name: "American Grill", active: false },
];

test("matching is case-, accent- and punctuation-insensitive and works on part of a name", () => {
  assert.equal(normalizeVenueName("Café O'Bryan’s"), "cafe o bryan s");
  // "erica" also occurs inside "American Grill"; the name-prefix match ranks first.
  assert.deepEqual(filterVenues("erica", V).map((v) => v.id), ["1", "5"]);
  assert.deepEqual(filterVenues("JANE", V).map((v) => v.id), ["1"]);
  assert.deepEqual(filterVenues("obryans", V).map((v) => v.id), ["2"]);
  assert.deepEqual(filterVenues("cafe", V).map((v) => v.id), ["4"]);
  assert.deepEqual(filterVenues("brew", V).map((v) => v.id), ["3"]);
});

test("ranking: name prefix → word prefix → anywhere; activity first within a tier", () => {
  // "am": "American Grill" starts with it; "Café Amici" has a word starting with it.
  assert.deepEqual(filterVenues("am", V).map((v) => v.id), ["5", "4"]);
  // Empty query lists everything, active venues first.
  assert.deepEqual(filterVenues("", V).map((v) => v.id), ["3", "1", "5", "4", "2"]);
  assert.equal(filterVenues("", V, 2).length, 2);
  assert.deepEqual(filterVenues("zzz", V), []);
});

test("changing compatible controls keeps the selected venue; drill-downs are cleared by tab/source changes", () => {
  const p = parseParams({ tab: "venues", venue: "6efb2d99-50d0-487a-85e0-01faa3e0c9b1", range: "7d", source: "legacy", rail: "homepage_rail:todays-specials" });
  const href = (o: Parameters<typeof hrefFor>[1]) => hrefFor(p, o);
  assert.match(href({ range: "all" }), /venue=6efb2d99/);
  assert.match(href({ source: "production", rail: null }), /venue=6efb2d99/);
  assert.match(href({ tab: "placements", section: null, guide: null, rail: null }), /venue=6efb2d99/);
  assert.doesNotMatch(href({ tab: "placements", section: null, guide: null, rail: null }), /rail=/);
  assert.doesNotMatch(href({ venue: null }), /venue=/);
});

// ── Legacy rail drill-down ──────────────────────────────────────────────────

test("legacy rail parameter accepts real rail names and rejects anything else", () => {
  for (const ok of ["homepage_rail:e49bf4ea-045b-4e8e-af8e-c4c2dd0ece1e", "homepage_feature:c8a810db-eb2e-44e8-af89-b22105eb5edf", "homepage_rail:todays-specials", "guide:downtown-kelowna-happy-hour-guide", "spotlight"]) {
    assert.ok(LEGACY_RAIL_RE.test(ok), ok);
  }
  for (const bad of ["", "guide:", "a:b:c", "x),or(id.neq.0", "homepage_rail:<script>", "Guide:Upper"]) {
    assert.equal(LEGACY_RAIL_RE.test(bad), false, bad);
  }
  assert.equal(parseParams({ rail: "x),or(1" }).rail, null);
});

test("legacy rail detail: venues and recorded positions with load rows and clicks — QA excluded, no CTR", () => {
  const loads = [
    { venue_id: "A", position: 0 }, { venue_id: "A", position: 0 }, { venue_id: "A", position: 2 },
    { venue_id: "B", position: 1 },
    { venue_id: "B", position: 1, session_id: "qa-110-prod-legacy" },
  ];
  const clicks = [
    { venue_id: "A", rail_name: "r", position: 0, session_id: "s1", occurred_at: "x" },
    { venue_id: "A", rail_name: "r", position: 0, session_id: "s1", occurred_at: "x" },
    { venue_id: "C", rail_name: "r", position: 4, session_id: "s2", occurred_at: "x" }, // clicked, never in a load row
    { venue_id: "B", rail_name: "r", position: 1, session_id: "qa-110-prod-verify", occurred_at: "x" },
  ];
  const d = aggregateLegacyRailDetail(loads, clicks);
  assert.deepEqual(d.byVenue, [
    { venueId: "A", loadRows: 3, clicks: 2, clickSessions: 1, positions: [0, 2] },
    { venueId: "C", loadRows: 0, clicks: 1, clickSessions: 1, positions: [4] },
    { venueId: "B", loadRows: 1, clicks: 0, clickSessions: 0, positions: [1] },
  ]);
  assert.deepEqual(d.byPosition, [
    { position: 0, loadRows: 2, clicks: 2 },
    { position: 1, loadRows: 1, clicks: 0 },
    { position: 2, loadRows: 1, clicks: 0 },
    { position: 4, loadRows: 0, clicks: 1 },
  ]);
  for (const r of [...d.byVenue, ...d.byPosition]) assert.equal("ctr" in r, false);
});

// ── Historical section names ────────────────────────────────────────────────

test("section names: current title, removed sections from the audit log, unknown ids with a short id", () => {
  const names = {
    sections: new Map([["s-live", { title: "Patio Picks", kind: "venue_collection", homepage: "Kelowna", enabled: true, homepagePublished: true }]]),
    removedSections: new Map([["s-gone", { title: "Summer Patios", at: "2026-07-11T00:00:00Z" }]]),
  } as unknown as NameMaps;
  assert.deepEqual(sectionTitle(names, "s-live"), { title: "Patio Picks", flags: [] });
  assert.deepEqual(sectionTitle(names, "s-gone"), { title: "Summer Patios", flags: ["removed section"] });
  assert.deepEqual(sectionTitle(names, "abcdef12-0000-4000-8000-000000000000"), { title: "Deleted section · abcdef12", flags: ["deleted"] });
});
