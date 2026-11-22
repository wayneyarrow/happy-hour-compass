import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMarketFilterOptions } from "../../../src/lib/marketFilter";
import { buildCityGeographyLookup } from "../../../src/lib/geo/venueGeographyResolver";
import {
  ALL_MARKETS_SCOPE,
  countOperatorBuckets,
  countSubmissionsInScope,
  inDashboardScope,
  operatorInDashboardScope,
  scopeFromSelection,
} from "../../../src/lib/dashboardMarketScope";

/**
 * Platform Analytics market scope (/control-panel/analytics?market=).
 * Fixtures only — no database access.
 */

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const OPTIONS = buildMarketFilterOptions([
  { id: "m-co", slug: "central-okanagan", name: "Central Okanagan", status: "active", displayOrder: 1 },
  { id: "m-gsd", slug: "greater-san-diego", name: "Greater San Diego", status: "active", displayOrder: 5 },
]);
const CO = { kind: "market", marketId: "m-co" } as const;
const UNASSIGNED = { kind: "unassigned" } as const;

test("scopeFromSelection: All / a configured slug / Unassigned; anything else is All", () => {
  assert.deepEqual(scopeFromSelection("all", OPTIONS), ALL_MARKETS_SCOPE);
  assert.deepEqual(scopeFromSelection("central-okanagan", OPTIONS), CO);
  assert.deepEqual(scopeFromSelection("unassigned", OPTIONS), UNASSIGNED);
  assert.deepEqual(scopeFromSelection("bogus", OPTIONS), ALL_MARKETS_SCOPE);
});

test("records follow their (current) market; Unassigned = no market; All includes everything", () => {
  assert.equal(inDashboardScope("m-co", CO), true);
  assert.equal(inDashboardScope("m-gsd", CO), false);
  assert.equal(inDashboardScope(null, CO), false);
  assert.equal(inDashboardScope(null, UNASSIGNED), true);
  assert.equal(inDashboardScope("m-co", UNASSIGNED), false);
  assert.equal(inDashboardScope(null, ALL_MARKETS_SCOPE), true);
});

test("operators: in every market where they own a venue; Unassigned = no owned venue with a market", () => {
  assert.equal(operatorInDashboardScope(["m-co", "m-gsd"], CO), true);
  assert.equal(operatorInDashboardScope(["m-gsd"], CO), false);
  assert.equal(operatorInDashboardScope([], UNASSIGNED), true);
  assert.equal(operatorInDashboardScope([null], UNASSIGNED), true);
  assert.equal(operatorInDashboardScope([null, "m-co"], UNASSIGNED), false);
});

test("operator buckets: mutually exclusive, each operator counted once, scoped by owned venues", () => {
  const since = Date.parse("2026-10-23T00:00:00Z");
  const ops = [
    { id: "a", last_seen_at: "2026-11-20T10:00:00+00:00" }, // active, owns CO + GSD
    { id: "b", last_seen_at: "2026-09-01 10:00:00+00" },    // inactive (DB timestamp shape), CO
    { id: "c", last_seen_at: null },                         // never, GSD
    { id: "d", last_seen_at: "2026-11-01T00:00:00Z" },       // active, no venue
  ];
  const owned = new Map<string, (string | null)[]>([["a", ["m-co", "m-gsd"]], ["b", ["m-co"]], ["c", ["m-gsd"]]]);
  assert.deepEqual(countOperatorBuckets(ops, owned, ALL_MARKETS_SCOPE, since), { active: 2, inactive: 1, neverLoggedIn: 1 });
  assert.deepEqual(countOperatorBuckets(ops, owned, CO, since), { active: 1, inactive: 1, neverLoggedIn: 0 });
  assert.deepEqual(countOperatorBuckets(ops, owned, { kind: "market", marketId: "m-gsd" }, since), { active: 1, inactive: 0, neverLoggedIn: 1 });
  assert.deepEqual(countOperatorBuckets(ops, owned, UNASSIGNED, since), { active: 1, inactive: 0, neverLoggedIn: 0 });
});

test("submissions: linked venue first, else city/province matcher, else Unassigned; window counted on the same set", () => {
  const lookup = buildCityGeographyLookup(
    [{ id: "c-kel", slug: "kelowna", name: "Kelowna", market_id: "m-co" }],
    [{ id: "m-co", province: "BC", slug: "central-okanagan" }, { id: "m-gsd", province: "CA", slug: "greater-san-diego" }]
  );
  const since = Date.parse("2026-10-23T00:00:00Z");
  const subs = [
    { submitted_at: "2026-11-20T00:00:00Z", venue_id: "v1", venue_market_id: "m-gsd", city: "Kelowna", province: "BC" }, // linked → GSD
    { submitted_at: "2026-11-20T00:00:00Z", venue_id: null, venue_market_id: null, city: "Kelowna", province: "BC" },   // inferred → CO
    { submitted_at: "2026-05-01T00:00:00Z", venue_id: null, venue_market_id: null, city: "kelowna", province: null },   // inferred → CO (old)
    { submitted_at: "2026-11-20T00:00:00Z", venue_id: null, venue_market_id: null, city: "Toronto", province: "ON" },   // Unassigned
  ];
  assert.deepEqual(countSubmissionsInScope(subs, lookup, CO, since), { total: 2, inWindow: 1 });
  assert.deepEqual(countSubmissionsInScope(subs, lookup, { kind: "market", marketId: "m-gsd" }, since), { total: 1, inWindow: 1 });
  assert.deepEqual(countSubmissionsInScope(subs, lookup, UNASSIGNED, since), { total: 1, inWindow: 1 });
  assert.deepEqual(countSubmissionsInScope(subs, lookup, ALL_MARKETS_SCOPE, since), { total: 4, inWindow: 3 });
});

test("dashboard wiring: venue queries scoped, views get explicit id lists, suggestions All-only", () => {
  const src = read("lib/data/founderDashboard.ts");
  // Default is All markets, with no extra loads.
  assert.match(src, /scope: DashboardMarketScope = ALL_MARKETS_SCOPE/);
  assert.match(src, /const scoped = scope\.kind === "all" \? null : await loadScopedSources/);
  // Every venues head count / row read is wrapped in sv().
  const venueReads = src.match(/supabase\.from\("venues"\)/g) ?? [];
  const wrapped = src.match(/sv\(supabase\.from\("venues"\)/g) ?? [];
  // Batch 2's leaderboard-name lookup (`.in("id", topVenue…)`) is the one unwrapped read: it names ids already scoped.
  assert.equal(wrapped.length, venueReads.length - 1);
  // View RPCs receive the scoped id lists (undefined only for All markets).
  assert.match(src, /getVenueViewCounts\(t30, scoped\?\.venueIds\)/);
  assert.match(src, /getEventViewCounts\(t30, scoped\?\.eventIds\)/);
  assert.match(src, /getVenueViewCounts\(null, scoped\?\.venueIds\)/);
  assert.match(src, /getEventViewCounts\(null, scoped\?\.eventIds\)/);
  // Suggestions are never queried for a scoped view.
  assert.match(src, /scoped \? Promise\.resolve\(\{ count: null \}\) : supabase\.from\("venue_suggestions"\)/);
  assert.match(src, /getDailySpecialClickSummary\(t30, scope\)/);
  // Submissions embed is disambiguated (venues.source_submission_id is a second relationship).
  assert.match(src, /venues!venue_id\(market_id\)/);
});

test("an empty scoped id list yields zero views, never the platform totals", () => {
  const vc = read("lib/data/viewCounts.ts");
  assert.match(vc, /if \(venueIds && venueIds\.length === 0\) return new Map\(\);/);
  assert.match(vc, /if \(eventIds && eventIds\.length === 0\) return new Map\(\);/);
});

test("Daily Special clicks: scoped by the clicked venue's market via an inner join, exact counts", () => {
  const src = read("lib/data/dailySpecialClicks.ts");
  assert.match(src, /select\("venue_id, venues!inner\(market_id\)", \{ count: "exact", head: true \}\)/);
  assert.match(src, /q\.eq\("venues\.market_id", scope\.marketId\) : q\.is\("venues\.market_id", null\)/);
});

test("page: admin check first, ?market= via the shared filter, empty state, All-only suggestions label", () => {
  const page = read("app/control-panel/analytics/page.tsx");
  const body = page.slice(page.indexOf("export default async function PlatformAnalyticsPage"));
  assert.ok(body.indexOf("await requireControlPanelAdmin()") < body.indexOf("getControlPanelMarketOptions()"));
  assert.match(page, /<UrlMarketFilter/);
  assert.match(page, /parseMarketFilter\(marketParam, marketOptions\)/);
  assert.match(page, /!d\.hasActivity/);
  assert.match(page, /All markets only — suggestions have a free-text city/);
});
