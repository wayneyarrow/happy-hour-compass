import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMarketFilterOptions, resolveMarketAssignment } from "../../../src/lib/marketFilter";
import {
  DEFAULT_VENUES_TABLE_STATE,
  deriveVenuesView,
  nextSort,
  nextVenuesState,
  PAGE_SIZE,
  parseVenuesUrlState,
  venuesUrlSearch,
  type VenueRow,
  type VenuesTableState,
} from "../../../src/app/control-panel/venues/venuesTableView";

/**
 * Control Panel Venues table: Market combines with search, the existing
 * filters, sorting and pagination (filter → sort → paginate), and the
 * selection round-trips through a page-specific ?market= param.
 */

const OPTIONS = buildMarketFilterOptions([
  { id: "m-co", slug: "central-okanagan", name: "Central Okanagan", status: "active", displayOrder: 1 },
  { id: "m-gv", slug: "greater-vancouver", name: "Greater Vancouver", status: "active", displayOrder: 2 },
  { id: "m-gsd", slug: "greater-san-diego", name: "Greater San Diego", status: "active", displayOrder: 5 },
]);
const NAME_BY_ID = new Map(OPTIONS.map((o) => [o.id, o.name]));

// 90 venues: 40 CO, 30 GSD, 20 unassigned. Every 3rd published, every 4th
// claimed (with an operator), every 5th verified; "Taco" in some names.
const MARKET_CYCLE: (string | null)[] = [];
for (let i = 0; i < 40; i++) MARKET_CYCLE.push("m-co");
for (let i = 0; i < 30; i++) MARKET_CYCLE.push("m-gsd");
for (let i = 0; i < 20; i++) MARKET_CYCLE.push(null);
const ROWS: VenueRow[] = MARKET_CYCLE.map((marketId, i) => ({
  id: `v${String(i).padStart(3, "0")}`,
  slug: `venue-${i}`,
  name: `${i % 7 === 0 ? "Taco" : "Bar"} ${String(i).padStart(3, "0")}`,
  city: i % 2 ? "Kelowna" : null,
  is_published: i % 3 === 0,
  is_verified: i % 5 === 0,
  claimed_at: i % 4 === 0 ? `2026-0${(i % 9) + 1}-01T00:00:00Z` : null,
  updated_at: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
  operatorEmail: i % 4 === 0 ? `owner${i}@example.com` : null,
  ...resolveMarketAssignment(marketId, OPTIONS),
}));

const S = (over: Partial<VenuesTableState> = {}): VenuesTableState => ({ ...DEFAULT_VENUES_TABLE_STATE, ...over });
const count = (over: Partial<VenuesTableState>) => deriveVenuesView(ROWS, S(over), NAME_BY_ID).filtered.length;
const expected = (pred: (r: VenueRow) => boolean) => ROWS.filter(pred).length;

test("All markets shows every venue, including unassigned ones", () => {
  assert.equal(count({}), 90);
});

test("a market / Unassigned narrows to exactly those rows", () => {
  assert.equal(count({ market: "central-okanagan" }), 40);
  assert.equal(count({ market: "greater-san-diego" }), 30);
  assert.equal(count({ market: "unassigned" }), 20);
  assert.equal(count({ market: "greater-vancouver" }), 0);
  assert.equal(count({ market: "central-okanagan" }) + count({ market: "greater-san-diego" }) + count({ market: "unassigned" }), count({}));
});

test("Market combines with search and the Published / Claimed / Verified filters", () => {
  const co = (r: VenueRow) => r.marketSlug === "central-okanagan";
  assert.equal(count({ market: "central-okanagan", pub: "published" }), expected((r) => co(r) && r.is_published));
  assert.equal(count({ market: "central-okanagan", pub: "draft", claimed: "claimed" }), expected((r) => co(r) && !r.is_published && !!r.claimed_at));
  assert.equal(count({ market: "unassigned", verified: "verified" }), expected((r) => r.marketId === null && r.is_verified));
  assert.equal(count({ market: "greater-san-diego", q: "taco" }), expected((r) => r.marketSlug === "greater-san-diego" && r.name.startsWith("Taco")));
  // Search also matches operator email, within the market.
  assert.equal(count({ market: "central-okanagan", q: "owner8@" }), 1);
  assert.equal(count({ market: "greater-san-diego", q: "owner8@" }), 0);
});

test("filtered count is taken before pagination; pages cover the filtered rows exactly once", () => {
  const view = deriveVenuesView(ROWS, S({ market: "central-okanagan" }), NAME_BY_ID);
  assert.equal(view.filtered.length, 40);
  assert.equal(view.totalPages, Math.ceil(40 / PAGE_SIZE));
  const seen: string[] = [];
  for (let p = 1; p <= view.totalPages; p++) {
    seen.push(...deriveVenuesView(ROWS, S({ market: "central-okanagan", page: p }), NAME_BY_ID).pageRows.map((r) => r.id));
  }
  assert.equal(seen.length, 40);
  assert.equal(new Set(seen).size, 40);
  assert.ok(seen.every((id) => ROWS.find((r) => r.id === id)!.marketSlug === "central-okanagan"));
  // A stale page beyond the filtered range clamps to the last page.
  assert.equal(deriveVenuesView(ROWS, S({ market: "unassigned", page: 4 }), NAME_BY_ID).safePage, 1);
});

test("sorting applies within the selected market, and the Market column sorts with Unassigned last", () => {
  const byName = deriveVenuesView(ROWS, S({ market: "greater-san-diego", sortCol: "name", sortDir: "asc" }), NAME_BY_ID).sorted;
  assert.deepEqual(byName.map((r) => r.name), [...byName.map((r) => r.name)].sort((a, b) => a.localeCompare(b)));
  assert.ok(byName.every((r) => r.marketSlug === "greater-san-diego"));

  const byMarket = deriveVenuesView(ROWS, S({ sortCol: "market", sortDir: "asc" }), NAME_BY_ID).sorted;
  const labels = byMarket.map((r) => (r.marketId ? NAME_BY_ID.get(r.marketId) : null));
  assert.equal(labels[0], "Central Okanagan");
  assert.equal(labels[40], "Greater San Diego");
  assert.equal(labels[89], null);
});

test("changing the market (or any filter/sort) resets to page 1; paging keeps the filters", () => {
  const onPage2 = S({ market: "central-okanagan", q: "bar", pub: "published", sortCol: "name", sortDir: "asc", page: 2 });
  const switched = nextVenuesState(onPage2, { market: "greater-san-diego" });
  assert.deepEqual(switched, { ...onPage2, market: "greater-san-diego", page: 1 });
  assert.equal(nextVenuesState(onPage2, { q: "taco" }).page, 1);
  assert.equal(nextVenuesState(onPage2, nextSort(onPage2, "city")).page, 1);
  assert.deepEqual(nextVenuesState(onPage2, { page: 3 }), { ...onPage2, page: 3 });
});

test("URL round-trip restores market together with search, filters, sort and page", () => {
  const state = S({ q: "taco", market: "greater-san-diego", pub: "published", claimed: "unclaimed", verified: "verified", sortCol: "market", sortDir: "asc", page: 2 });
  const qs = venuesUrlSearch(state);
  assert.equal(new URLSearchParams(qs).get("market"), "greater-san-diego");
  assert.deepEqual(parseVenuesUrlState(`?${qs}`, OPTIONS), { state, marketRejected: false });

  const unassigned = S({ market: "unassigned" });
  assert.equal(venuesUrlSearch(unassigned), "market=unassigned");
  assert.deepEqual(parseVenuesUrlState("?market=unassigned", OPTIONS).state, unassigned);
});

test("All markets writes no market param; an unknown value falls back to All and is flagged for removal", () => {
  assert.equal(venuesUrlSearch(S()), "");
  const bad = parseVenuesUrlState("?market=seattle&pub=published&sort=name", OPTIONS);
  assert.equal(bad.state.market, "all");
  assert.equal(bad.marketRejected, true);
  // Other params survive the fallback, and the rewritten URL drops only market.
  assert.equal(bad.state.pub, "published");
  assert.equal(venuesUrlSearch(bad.state), "pub=published&sort=name");
  assert.equal(parseVenuesUrlState("?pub=draft", OPTIONS).marketRejected, false);
  assert.equal(parseVenuesUrlState("?page=abc", OPTIONS).state.page, 1);
});

test("the Market param is page-specific: no cookie or storage is used to share it", () => {
  const src = readFileSync(join(__dirname, "../../../src/app/control-panel/venues/VenuesTable.tsx"), "utf8");
  assert.ok(!/document\.cookie|localStorage|sessionStorage/.test(src));
});
