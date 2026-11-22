import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMarketFilterOptions,
  marketDisplayName,
  matchesAnyMarketFilter,
  matchesMarketFilter,
  readMarketFilterParam,
  resolveMarketAssignment,
  writeMarketFilterParam,
} from "../../../src/lib/marketFilter";
import { attributeSubmissionMarket } from "../../../src/lib/marketAttribution";
import { buildCityGeographyLookup } from "../../../src/lib/geo/venueGeographyResolver";
import { countActivationAttention } from "../../../src/lib/activation/activationAttention";

/**
 * Phase 2 Market filters: Claims, Submissions, Operators, Venue Funnel and
 * Content Engine Guides reuse the DB-backed options and ?market= behaviour.
 * Fixtures only — no database access.
 */

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const OPTIONS = buildMarketFilterOptions([
  { id: "m-co", slug: "central-okanagan", name: "Central Okanagan", status: "active", displayOrder: 1 },
  { id: "m-gv", slug: "greater-vancouver", name: "Greater Vancouver", status: "coming_soon", displayOrder: 2 },
  { id: "m-gsd", slug: "greater-san-diego", name: "Greater San Diego", status: "active", displayOrder: 5 },
]);
const co = resolveMarketAssignment("m-co", OPTIONS);
const gsd = resolveMarketAssignment("m-gsd", OPTIONS);
const none = resolveMarketAssignment(null, OPTIONS);

// ── Operators: any-of matching ───────────────────────────────────────────────

test("operators: an operator matches every market it owns a venue in, and appears once under All", () => {
  const multi = [co, gsd];
  assert.equal(matchesAnyMarketFilter(multi, "all"), true);
  assert.equal(matchesAnyMarketFilter(multi, "central-okanagan"), true);
  assert.equal(matchesAnyMarketFilter(multi, "greater-san-diego"), true);
  assert.equal(matchesAnyMarketFilter(multi, "greater-vancouver"), false);
  assert.equal(matchesAnyMarketFilter(multi, "unassigned"), false);
  // Counted once under All: the row is one row whatever its venue count.
  const rows = [{ v: multi }, { v: [co] }, { v: [] }];
  assert.equal(rows.filter((r) => matchesAnyMarketFilter(r.v, "all")).length, 3);
});

test("operators: Unassigned = owns no venue, or none of its venues has a market", () => {
  assert.equal(matchesAnyMarketFilter([], "unassigned"), true);
  assert.equal(matchesAnyMarketFilter([none, none], "unassigned"), true);
  assert.equal(matchesAnyMarketFilter([none, co], "unassigned"), false);
  assert.equal(matchesAnyMarketFilter([], "central-okanagan"), false);
});

// ── Submissions: linked venue, else inferred, else Unassigned ───────────────

const LOOKUP = buildCityGeographyLookup(
  [
    { id: "c-kel", slug: "kelowna", name: "Kelowna", market_id: "m-co" },
    { id: "c-wk", slug: "west-kelowna", name: "West Kelowna", market_id: "m-co" },
    { id: "c-van", slug: "vancouver", name: "Vancouver", market_id: "m-gv" },
    { id: "c-sd", slug: "san-diego", name: "San Diego", market_id: "m-gsd" },
  ],
  [
    { id: "m-co", province: "BC", slug: "central-okanagan" },
    { id: "m-gv", province: "BC", slug: "greater-vancouver" },
    { id: "m-gsd", province: "CA", slug: "greater-san-diego" },
  ]
);

test("submissions: a linked venue's market wins — and is never overridden by the submitted text", () => {
  assert.deepEqual(
    attributeSubmissionMarket({ venueId: "v1", venueMarketId: "m-gsd", city: "Kelowna", province: "BC" }, LOOKUP),
    { marketId: "m-gsd", inferred: false }
  );
  // Linked venue with no market → Unassigned (venue is the source of truth).
  assert.deepEqual(
    attributeSubmissionMarket({ venueId: "v1", venueMarketId: null, city: "Kelowna", province: "BC" }, LOOKUP),
    { marketId: null, inferred: false }
  );
});

test("submissions: unlinked ones use the city/province resolver and are flagged inferred", () => {
  assert.deepEqual(
    attributeSubmissionMarket({ venueId: null, venueMarketId: null, city: "kelowna", province: "BC" }, LOOKUP),
    { marketId: "m-co", inferred: true }
  );
  assert.deepEqual(
    attributeSubmissionMarket({ venueId: null, venueMarketId: null, city: "West Kelowna", province: null }, LOOKUP),
    { marketId: "m-co", inferred: true }
  );
  assert.deepEqual(
    attributeSubmissionMarket({ venueId: null, venueMarketId: null, city: "Vancouver", province: "British Columbia" }, LOOKUP),
    { marketId: "m-gv", inferred: true }
  );
});

test("submissions: unresolved text (unknown city, province veto, blank) is Unassigned, never guessed", () => {
  for (const input of [
    { city: "Toronto", province: "ON" },
    { city: "San Diego", province: "BC" }, // province disagrees with the only candidate
    { city: "", province: "BC" },
    { city: null, province: null },
  ]) {
    assert.deepEqual(
      attributeSubmissionMarket({ venueId: null, venueMarketId: null, ...input }, LOOKUP),
      { marketId: null, inferred: false },
      JSON.stringify(input)
    );
  }
  const unassigned = resolveMarketAssignment(null, OPTIONS);
  assert.equal(matchesMarketFilter(unassigned, "unassigned"), true);
});

// ── Attention counts follow the filtered rows ───────────────────────────────

test("attention strip counts only the rows passed in (the filtered records)", () => {
  const rows = [
    { m: co, s: "release_required" }, { m: co, s: "expiring_soon" }, { m: co, s: "awaiting_setup" },
    { m: gsd, s: "awaiting_setup" }, { m: gsd, s: "active" }, { m: none, s: "not_tracked" },
  ] as const;
  const forMarket = (sel: string) =>
    countActivationAttention(rows.filter((r) => matchesMarketFilter(r.m, sel)).map((r) => r.s));
  assert.deepEqual(forMarket("all"), { releaseRequired: 1, expiringSoon: 1, awaitingSetup: 2 });
  assert.deepEqual(forMarket("central-okanagan"), { releaseRequired: 1, expiringSoon: 1, awaitingSetup: 1 });
  assert.deepEqual(forMarket("greater-san-diego"), { releaseRequired: 0, expiringSoon: 0, awaitingSetup: 1 });
  assert.deepEqual(forMarket("unassigned"), { releaseRequired: 0, expiringSoon: 0, awaitingSetup: 0 });
});

// ── URL helpers ─────────────────────────────────────────────────────────────

test("?market= read/write: keeps other params, removes it for All, flags unknown values", () => {
  assert.deepEqual(readMarketFilterParam("?tab=all&market=greater-san-diego", OPTIONS), { selection: "greater-san-diego", rejected: false });
  assert.deepEqual(readMarketFilterParam("?market=bogus", OPTIONS), { selection: "all", rejected: true });
  assert.deepEqual(readMarketFilterParam("?tab=all", OPTIONS), { selection: "all", rejected: false });
  assert.equal(writeMarketFilterParam(new URLSearchParams("tab=all&q=x"), "unassigned").toString(), "tab=all&q=x&market=unassigned");
  assert.equal(writeMarketFilterParam(new URLSearchParams("tab=all&market=x"), "all").toString(), "tab=all");
  assert.equal(marketDisplayName("m-gsd", OPTIONS), "Greater San Diego");
  assert.equal(marketDisplayName(null, OPTIONS), null);
  assert.equal(marketDisplayName("m-missing", OPTIONS), "Unknown market");
});

// ── Wiring: complete reads, filtered counts, scope ──────────────────────────

test("each screen's list read is complete (fetchAllRows, ordered by id) and carries market data", () => {
  const claims = read("lib/data/claims.ts");
  assert.match(claims, /fetchAllRows\(\s*supabase,\s*"venue_claims",[\s\S]*?venues \( name, market_id \)[\s\S]*?\["id"\]/);
  const subs = read("lib/data/operatorSubmissions.ts");
  assert.match(subs, /fetchAllRows\(\s*supabase,\s*"operator_submissions",[\s\S]*?venues!venue_id \( market_id \)`,\s*tabFilter,\s*\["id"\]/);
  const guides = read("lib/data/contentGuides.ts");
  assert.match(guides, /fetchAllRows\(\s*supabase,\s*"content_guides",[\s\S]*?market_id[\s\S]*?\["id"\]/);
  const ops = read("app/control-panel/operators/page.tsx");
  assert.match(ops, /fetchAllRows<OperatorDbRow>\(supabase, "operators"/);
  assert.match(ops, /fetchAllRows<VenueDbRow>\(\s*supabase,\s*"venues",\s*"id, name, slug, created_by_operator_id, market_id"/);
  const funnel = read("lib/data/venueFunnel.ts");
  for (const table of ["venue_claims", "operator_submissions", "venues"]) {
    assert.match(funnel, new RegExp(`fetchAllRows<[^>]+>\\(\\s*supabase,\\s*"${table}"`), table);
  }
});

test("Claims and Submissions: the attention strip is computed from the filtered rows, not on the server", () => {
  for (const [page, table] of [
    ["app/control-panel/claims/page.tsx", "app/control-panel/claims/ClaimsTable.tsx"],
    ["app/control-panel/operator-submissions/page.tsx", "app/control-panel/operator-submissions/SubmissionsTable.tsx"],
  ]) {
    assert.doesNotMatch(read(page), /awaitingSetupCount|releaseRequiredCount|expiringSoonCount/, page);
    const t = read(table);
    assert.match(t, /countActivationAttention\(filtered\.map\(\(r\) => r\.activationState\)\)/, table);
    assert.match(t, /<ActivationAttentionStrip counts=\{attention\} \/>/, table);
    assert.match(t, /matchesMarketFilter\(r, market\)/, table);
  }
});

test("Submissions: tabs keep the market selection; Market column labels inferred matches", () => {
  const page = read("app/control-panel/operator-submissions/page.tsx");
  assert.match(page, /href=\{tabHref\(tab\.key\)\}/);
  assert.match(page, /attributeSubmissionMarket\(/);
  assert.match(page, /marketInferred: attributed\.inferred/);
  assert.match(read("app/control-panel/operator-submissions/SubmissionsTable.tsx"), /Inferred from city/);
});

test("Operators: scope stays operator accounts only (no team memberships); filter is any-owned-venue", () => {
  const page = read("app/control-panel/operators/page.tsx");
  assert.doesNotMatch(page, /from\("operator_memberships"\)/);
  assert.match(read("app/control-panel/operators/OperatorsTable.tsx"), /matchesAnyMarketFilter\(op\.ownedVenues, market\)/);
});

test("Venue Funnel: market is filtered before lanes are counted; submissions use the shared attribution", () => {
  const board = read("app/control-panel/venue-funnel/VenueFunnelBoard.tsx");
  assert.match(board, /cards: lane\.cards\.filter\(\(c\) => \{\s*\n\s*if \(!matchesMarketFilter\(resolveMarketAssignment\(c\.marketId, marketOptions\), market\)\) return false;/);
  assert.match(board, /filteredLanes\.reduce\(\(sum, l\) => sum \+ l\.cards\.length, 0\)/);
  assert.match(read("lib/data/venueFunnel.ts"), /attributeSubmissionMarket\(/);
});

test("Guides: server-side filter on the stored market, with no Unassigned option", () => {
  const page = read("app/control-panel/content-engine/page.tsx");
  assert.match(page, /resolveMarketAssignment\(g\.marketId, marketOptions\)/);
  assert.match(page, /includeUnassigned=\{false\}/);
  assert.match(page, /parsedSelection === MARKET_FILTER_UNASSIGNED \? MARKET_FILTER_ALL/);
});
