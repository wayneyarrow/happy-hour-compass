import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMarketFilterOptions,
  MARKET_FILTER_ALL,
  MARKET_FILTER_UNASSIGNED,
  marketFilterOptionLabel,
  marketFilterParamValue,
  matchesMarketFilter,
  parseMarketFilter,
  resolveMarketAssignment,
} from "../../../src/lib/marketFilter";

/**
 * Control Panel Market filter: options come from the DB markets list (any
 * market, any status, configured order and names), and the selection is
 * All / a configured slug / Unassigned, with unknown values meaning All.
 */

// A fixture market list, deliberately out of display order and including a
// market no code names ("test-harbour") — it must appear like any other.
const DB_MARKETS = [
  { id: "m-gsd", slug: "greater-san-diego", name: "Greater San Diego", status: "active", displayOrder: 5 },
  { id: "m-co", slug: "central-okanagan", name: "Central Okanagan", status: "active", displayOrder: 1 },
  { id: "m-th", slug: "test-harbour", name: "Test Harbour", status: "coming_soon", displayOrder: 3 },
  { id: "m-vic", slug: "victoria", name: "Victoria", status: "coming_soon", displayOrder: 3 },
];
const OPTIONS = buildMarketFilterOptions(DB_MARKETS);

test("options keep every configured market, in display_order with a name tiebreak", () => {
  assert.deepEqual(
    OPTIONS.map((o) => o.slug),
    ["central-okanagan", "test-harbour", "victoria", "greater-san-diego"]
  );
  assert.equal(OPTIONS.length, DB_MARKETS.length, "no market is dropped by status");
});

test("coming-soon markets are labelled from their DB status; names are the configured names", () => {
  const label = (slug: string) => marketFilterOptionLabel(OPTIONS.find((o) => o.slug === slug)!);
  assert.equal(label("central-okanagan"), "Central Okanagan");
  assert.equal(label("victoria"), "Victoria (coming soon)");
  assert.equal(label("test-harbour"), "Test Harbour (coming soon)");
});

test("parse: missing, empty and unknown values mean All markets", () => {
  assert.equal(parseMarketFilter(null, OPTIONS), MARKET_FILTER_ALL);
  assert.equal(parseMarketFilter(undefined, OPTIONS), MARKET_FILTER_ALL);
  assert.equal(parseMarketFilter("", OPTIONS), MARKET_FILTER_ALL);
  assert.equal(parseMarketFilter("seattle", OPTIONS), MARKET_FILTER_ALL);
  assert.equal(parseMarketFilter("Central-Okanagan", OPTIONS), MARKET_FILTER_ALL, "slugs are exact");
  assert.equal(parseMarketFilter("all", OPTIONS), MARKET_FILTER_ALL);
});

test("parse: a configured slug (including one no code names) and Unassigned are kept", () => {
  assert.equal(parseMarketFilter("greater-san-diego", OPTIONS), "greater-san-diego");
  assert.equal(parseMarketFilter("test-harbour", OPTIONS), "test-harbour");
  assert.equal(parseMarketFilter("unassigned", OPTIONS), MARKET_FILTER_UNASSIGNED);
});

test("URL value: All omits the param; others are written as-is", () => {
  assert.equal(marketFilterParamValue(MARKET_FILTER_ALL), null);
  assert.equal(marketFilterParamValue("victoria"), "victoria");
  assert.equal(marketFilterParamValue(MARKET_FILTER_UNASSIGNED), "unassigned");
});

test("matching: All includes unassigned rows; Unassigned means market_id IS NULL", () => {
  const co = resolveMarketAssignment("m-co", OPTIONS);
  const none = resolveMarketAssignment(null, OPTIONS);
  const orphan = resolveMarketAssignment("m-not-loaded", OPTIONS);
  assert.deepEqual(co, { marketId: "m-co", marketSlug: "central-okanagan" });

  assert.equal(matchesMarketFilter(co, MARKET_FILTER_ALL), true);
  assert.equal(matchesMarketFilter(none, MARKET_FILTER_ALL), true);
  assert.equal(matchesMarketFilter(co, "central-okanagan"), true);
  assert.equal(matchesMarketFilter(co, "greater-san-diego"), false);
  assert.equal(matchesMarketFilter(none, "central-okanagan"), false);
  assert.equal(matchesMarketFilter(none, MARKET_FILTER_UNASSIGNED), true);
  assert.equal(matchesMarketFilter(co, MARKET_FILTER_UNASSIGNED), false);
  // An FK the list didn't contain is never passed off as Unassigned.
  assert.equal(matchesMarketFilter(orphan, MARKET_FILTER_UNASSIGNED), false);
  assert.equal(matchesMarketFilter(orphan, MARKET_FILTER_ALL), true);
});

test("no market options are hard-coded in the shared filter code", () => {
  const root = join(__dirname, "../../../src");
  for (const file of ["lib/marketFilter.ts", "lib/data/controlPanelMarketOptions.ts", "components/MarketFilterSelect.tsx"]) {
    const src = readFileSync(join(root, file), "utf8");
    for (const slug of ["central-okanagan", "greater-san-diego", "greater-vancouver", "victoria", "calgary"]) {
      assert.ok(!src.includes(slug), `${file} must not name market "${slug}"`);
    }
    assert.ok(!/from ["']@\/lib\/markets["']/.test(src), `${file} must not read the MARKETS config`);
  }
  const loader = readFileSync(join(root, "lib/data/controlPanelMarketOptions.ts"), "utf8");
  assert.match(loader, /getAllMarkets\(\)/, "options come from the DB markets table");
});
