import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateGuideOpensFromHomepage,
  aggregateGuidePages,
  aggregateHero,
  aggregateLegacyRails,
  aggregatePlacementItems,
  aggregatePlacementPositions,
  aggregateSections,
  aggregateVenueBreakdown,
  aggregateVenueOverview,
  itemPerformance,
  rate,
  type DiscoveryRow,
} from "../../../src/lib/searchDiscoveryReporting/placementMetrics";
import {
  aggregateLegacySearch,
  aggregateSearchDemand,
  collapseLegacyPrefixes,
  isZeroResult,
  type SearchRow,
} from "../../../src/lib/searchDiscoveryReporting/searchMetrics";
import {
  RELEASE_QA_SESSION_IDS,
  isReleaseQaSession,
  qaSessionNotInFilter,
  resolveRange,
  vancouverDateKey,
  vancouverMidnight,
  formatRate,
} from "../../../src/lib/searchDiscoveryReporting/config";

/**
 * Search & Discovery report metrics — the definitions in
 * docs/analytics/SEARCH_DISCOVERY_TRACKING.md, pinned against small fixtures.
 */

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const V1 = "aaaaaaaa-0000-4000-8000-000000000001";
const V2 = "aaaaaaaa-0000-4000-8000-000000000002";
const G1 = "99999999-0000-4000-8000-000000000001";

let t = 0;
function ev(p: Partial<DiscoveryRow> & Pick<DiscoveryRow, "event_type" | "page_view_id">): DiscoveryRow {
  t++;
  return {
    id: `row-${t}`,
    surface: "homepage_section",
    session_id: `sess-${p.page_view_id}`,
    section_id: S1,
    section_kind: "venue_collection",
    guide_id: null,
    guide_block: null,
    item_type: null,
    item_id: null,
    position: null,
    mode: null,
    occurred_at: new Date(Date.UTC(2026, 9, 12, 0, 0, t)).toISOString(),
    ...p,
  };
}
const imp = (pv: string, item: string, position: number, extra: Partial<DiscoveryRow> = {}) =>
  ev({ event_type: "item_impression", page_view_id: pv, item_type: "venue", item_id: item, position, ...extra });
const click = (pv: string, item: string, position: number, extra: Partial<DiscoveryRow> = {}) =>
  ev({ event_type: "item_click", page_view_id: pv, item_type: "venue", item_id: item, position, ...extra });
const exposure = (pv: string, extra: Partial<DiscoveryRow> = {}) => ev({ event_type: "section_exposure", page_view_id: pv, ...extra });

// ── CTR ─────────────────────────────────────────────────────────────────────

test("item CTR counts distinct impressed combos with ≥1 matched click; repeat clicks never push it past 100%", () => {
  const rows = [imp("pv1", V1, 0), click("pv1", V1, 0), click("pv1", V1, 0), click("pv1", V1, 0), imp("pv2", V1, 0)];
  const p = itemPerformance(rows, () => "all").get("all")!;
  assert.deepEqual(p, { impressions: 2, rawClicks: 3, matchedClicked: 1, unmatchedClicks: 0, ctr: 0.5 });
});

test("an impression that qualified AFTER the click in the same page view still matches", () => {
  const rows = [click("pv1", V1, 1), imp("pv1", V1, 1)]; // click row earlier in time
  assert.ok(rows[0].occurred_at < rows[1].occurred_at);
  const p = itemPerformance(rows, () => "all").get("all")!;
  assert.equal(p.matchedClicked, 1);
  assert.equal(p.unmatchedClicks, 0);
  assert.equal(p.ctr, 1);
});

test("a click with no impression in that page view is unmatched — counted as a raw click, never in CTR", () => {
  const rows = [imp("pv1", V1, 0), click("pv2", V1, 0)]; // clicked in a different page view
  const p = itemPerformance(rows, () => "all").get("all")!;
  assert.deepEqual(p, { impressions: 1, rawClicks: 1, matchedClicked: 0, unmatchedClicks: 1, ctr: 0 });
});

test("matching is per placement: the same venue clicked in another section doesn't match this section's impression", () => {
  const rows = [imp("pv1", V1, 0, { section_id: S1 }), click("pv1", V1, 0, { section_id: S2 })];
  const items1 = aggregatePlacementItems(rows, `s:${S1}`);
  const items2 = aggregatePlacementItems(rows, `s:${S2}`);
  assert.equal(items1[0].matchedClicked, 0);
  assert.equal(items2[0].unmatchedClicks, 1);
});

test("zero denominators give null (shown as —), never 0% or NaN", () => {
  assert.equal(rate(0, 0), null);
  assert.equal(formatRate(null), "—");
  const p = itemPerformance([click("pv1", V1, 0)], () => "all").get("all")!;
  assert.equal(p.ctr, null);
  const [s] = aggregateSections([click("pv9", V1, 0)]);
  assert.equal(s.engagementRate, null);
  assert.equal(s.exposedPageViews, 0);
});

// ── Sections ────────────────────────────────────────────────────────────────

test("section engagement = exposed page views with ≥1 section click ÷ exposed page views; clicks outside exposure reported separately", () => {
  const rows = [
    exposure("pv1"), imp("pv1", V1, 0), click("pv1", V1, 0), click("pv1", V2, 1), // one page view, two clicks
    exposure("pv2"), imp("pv2", V1, 0),
    ev({ event_type: "view_all_click", page_view_id: "pv3" }), // never exposed
  ];
  const [s] = aggregateSections(rows);
  assert.equal(s.exposedPageViews, 2);
  assert.equal(s.engagedExposedPageViews, 1);
  assert.equal(s.engagementRate, 0.5);
  assert.equal(s.clickingPageViews, 2);
  assert.equal(s.clicksOutsideExposure, 1);
  assert.equal(s.viewAllClicks, 1);
  assert.equal(s.rawClicks, 2);
  assert.equal(s.unmatchedClicks, 1); // V2 clicked but never impressed
});

test("positions: impressions by impression position, clicks by click position", () => {
  const rows = [imp("pv1", V1, 0), imp("pv2", V1, 2), click("pv2", V1, 2), imp("pv3", V2, 1)];
  const pos = aggregatePlacementPositions(rows, `s:${S1}`);
  assert.deepEqual(pos.map((p) => [p.position, p.impressions, p.matchedClicked, p.ctr]), [[0, 1, 0, 0], [1, 1, 0, 0], [2, 1, 1, 1]]);
  const items = aggregatePlacementItems(rows, `s:${S1}`);
  assert.deepEqual(items.find((i) => i.itemId === V1)!.positions, [0, 2]);
});

test("hero interactions are grouped by event type and mode with distinct sessions", () => {
  const rows = [
    ev({ event_type: "browse_click", page_view_id: "a", surface: "homepage_hero", section_id: null, mode: "events" }),
    ev({ event_type: "browse_click", page_view_id: "b", surface: "homepage_hero", section_id: null, mode: "events" }),
    ev({ event_type: "browse_click", page_view_id: "b", surface: "homepage_hero", section_id: null, mode: "events" }),
  ];
  assert.deepEqual(aggregateHero(rows), [{ eventType: "browse_click", mode: "events", events: 3, sessions: 2 }]);
});

// ── Guides ──────────────────────────────────────────────────────────────────

test("guide opens from the homepage are separate from venue clicks inside the guide", () => {
  const rows = [
    imp("pv1", G1, 0, { item_type: "guide", section_kind: "guide_collection" }),
    click("pv1", G1, 0, { item_type: "guide", section_kind: "guide_collection" }),
    // inside the guide page
    exposure("pv2", { surface: "guide", section_id: null, section_kind: null, guide_id: G1, guide_block: "venues" }),
    imp("pv2", V1, 0, { surface: "guide", section_id: null, section_kind: null, guide_id: G1, guide_block: "venues" }),
    click("pv2", V1, 0, { surface: "guide", section_id: null, section_kind: null, guide_id: G1, guide_block: "venues" }),
  ];
  const opens = aggregateGuideOpensFromHomepage(rows);
  assert.deepEqual([opens[0].guideId, opens[0].rawClicks, opens[0].ctr], [G1, 1, 1]);
  const [page] = aggregateGuidePages(rows);
  assert.equal(page.pageViews, 1);
  const venues = page.blocks.find((b) => b.block === "venues")!;
  assert.deepEqual([venues.exposedPageViews, venues.impressions, venues.rawClicks], [1, 1, 1]);
});

// ── Venues ──────────────────────────────────────────────────────────────────

test("venue discovery maps Daily Special and Event cards to their venue and splits by card type", () => {
  const SP = "bbbbbbbb-0000-4000-8000-000000000001";
  const itemVenue = new Map([[`daily_special:${SP}`, V1]]);
  const rows = [
    imp("pv1", V1, 0),
    click("pv1", V1, 0),
    imp("pv1", SP, 2, { item_type: "daily_special", section_id: S2, section_kind: "daily_special_collection" }),
    ev({ event_type: "suggestion_select", page_view_id: "pv1", surface: "homepage_hero", section_id: null, item_type: "venue", item_id: V1, position: 0 }),
  ];
  const [o] = aggregateVenueOverview(rows, itemVenue);
  assert.equal(o.venueId, V1);
  assert.deepEqual([o.venueCards.impressions, o.venueCards.rawClicks, o.specialCards.impressions, o.suggestionSelects], [1, 1, 1, 1]);
  const b = aggregateVenueBreakdown(rows, V1, itemVenue);
  assert.deepEqual(
    b.map((r) => [r.placementKey, r.itemType, r.position, r.impressions, r.rawClicks]),
    [
      ["hero", "suggestion", null, 0, 1],
      [`s:${S1}`, "venue", 0, 1, 1],
      [`s:${S2}`, "daily_special", 2, 1, 0],
    ]
  );
});

// ── QA exclusion ────────────────────────────────────────────────────────────

test("release-QA sessions are an explicit list — exact ids only, never a prefix match", () => {
  assert.equal(RELEASE_QA_SESSION_IDS.length, 8);
  for (const id of RELEASE_QA_SESSION_IDS) assert.equal(isReleaseQaSession(id), true);
  assert.equal(isReleaseQaSession("qa-110-something-else"), false);
  assert.equal(isReleaseQaSession("boston-pizza-like-session"), false);
  assert.equal(qaSessionNotInFilter(), `(${RELEASE_QA_SESSION_IDS.join(",")})`);
});

test("QA rows are excluded from search and legacy aggregation even if a query returned them", () => {
  const rows: SearchRow[] = [
    { id: "q1", search_term: "wine", surface: "listing_page", mode: "happy_hours", origin: "typed", result_count: 3, result_count_capped: false, other_filters_active: false, session_id: "qa-110-prod-verify", searched_at: "2026-10-11T01:00:00Z" },
    { id: "q2", search_term: "wine", surface: "listing_page", mode: "happy_hours", origin: "typed", result_count: 3, result_count_capped: false, other_filters_active: false, session_id: "real", searched_at: "2026-10-11T01:00:00Z" },
  ];
  assert.equal(aggregateSearchDemand(rows).rankedSessions, 1);
  assert.equal(aggregateLegacySearch(rows).sessions, 1);
  const legacy = aggregateLegacyRails(new Map(), [
    { venue_id: V1, rail_name: "r", position: 0, session_id: "qa-110-prod-legacy", occurred_at: "x" },
    { venue_id: V1, rail_name: "r", position: 0, session_id: "real", occurred_at: "x" },
  ]);
  assert.equal(legacy[0].clicks, 1);
});

// ── Search ──────────────────────────────────────────────────────────────────

let srN = 0;
const sr = (p: Partial<SearchRow>): SearchRow => ({
  id: `s-${++srN}`,
  search_term: "wine", surface: "listing_page", mode: "happy_hours", origin: "typed", result_count: 5,
  result_count_capped: false, other_filters_active: false, session_id: "s1", searched_at: "2026-10-11T18:00:00Z", ...p,
});

test("hero 'See all' hand-off is shown but not counted twice; back/forward and old-client rows are never ranked", () => {
  const rows = [
    sr({ surface: "homepage_hero", origin: "typed", session_id: "a" }),
    sr({ surface: "listing_page", origin: "hero_see_all", session_id: "a" }),
    sr({ origin: "history", session_id: "a" }),
    sr({ origin: null, mode: null, session_id: "b" }),
    sr({ origin: "url", session_id: "c" }),
  ];
  const r = aggregateSearchDemand(rows); // default ranking: typed
  const wine = r.terms[0];
  assert.deepEqual(
    [wine.rankedEvents, wine.rankedSessions, wine.typedEvents, wine.urlEvents, wine.heroHandoffEvents, wine.historyEvents, wine.unknownOriginEvents],
    [1, 1, 1, 1, 1, 1, 1]
  );
  assert.deepEqual(r.originCounts, { typed: 1, url: 1, history: 1, hero_see_all: 1, unknown: 1 });
});

test("terms rank by distinct searching sessions, case/whitespace-insensitively", () => {
  const rows = [
    sr({ search_term: "Wine", session_id: "a" }), sr({ search_term: "wine ", session_id: "a" }), sr({ search_term: "wine", session_id: "a" }),
    sr({ search_term: "tacos", session_id: "b" }), sr({ search_term: "tacos", session_id: "c" }),
  ];
  const r = aggregateSearchDemand(rows);
  assert.deepEqual(r.terms.map((t) => [t.term, t.rankedSessions, t.rankedEvents]), [["tacos", 2, 2], ["wine", 1, 3]]);
});

test("zero results respect other filters and capped counts", () => {
  assert.equal(isZeroResult({ result_count: 0, result_count_capped: false, other_filters_active: false }), true);
  assert.equal(isZeroResult({ result_count: 0, result_count_capped: false, other_filters_active: true }), false);
  assert.equal(isZeroResult({ result_count: 0, result_count_capped: true, other_filters_active: null }), false);
  const r = aggregateSearchDemand([sr({ result_count: 0 }), sr({ result_count: 0, other_filters_active: true, session_id: "s2" })]);
  assert.deepEqual([r.terms[0].zeroResultEvents, r.terms[0].zeroWithFiltersEvents, r.zeroResultTerms.length], [1, 1, 1]);
});

test("mode and surface filters", () => {
  const rows = [sr({ mode: "events", search_term: "trivia" }), sr({ mode: "happy_hours", surface: "homepage_hero" })];
  assert.deepEqual(aggregateSearchDemand(rows, { mode: "events" }).terms.map((t) => t.term), ["trivia"]);
  assert.deepEqual(aggregateSearchDemand(rows, { surface: "homepage_hero" }).terms.map((t) => t.term), ["wine"]);
});

test("daily buckets use America/Vancouver days", () => {
  // 2026-10-12 05:30 UTC = Oct 11, 22:30 in Vancouver (PDT).
  const r = aggregateSearchDemand([sr({ searched_at: "2026-10-12T05:30:00Z" })]);
  assert.deepEqual(r.daily, [{ day: "2026-10-11", events: 1 }]);
});

// ── Legacy ──────────────────────────────────────────────────────────────────

test("legacy prefix collapsing drops partial words typed within 30s in the same tab + surface", () => {
  const rows = ["b", "bo", "bos", "boston"].map((term, i) => sr({ search_term: term, origin: null, mode: null, searched_at: `2026-09-10T18:00:0${i}Z` }));
  rows.push(sr({ search_term: "boston pizza", origin: null, mode: null, searched_at: "2026-09-10T18:05:00Z" })); // 5 min later: kept
  assert.deepEqual(collapseLegacyPrefixes(rows).map((r) => r.search_term).sort(), ["boston", "boston pizza"]);
});

test("legacy report keeps unusual repeated-link patterns visible (single-search sessions) instead of removing them", () => {
  const rows = ["x1", "x2", "x3"].map((s) => sr({ search_term: "boston pizza", result_count: 0, origin: null, mode: null, session_id: s }));
  const r = aggregateLegacySearch(rows);
  assert.deepEqual([r.terms[0].term, r.terms[0].sessions, r.terms[0].singleSearchSessions, r.terms[0].zeroResultEvents], ["boston pizza", 3, 3, 3]);
});

test("legacy rails report load rows and clicks only — no CTR field exists", () => {
  const rails = aggregateLegacyRails(new Map([["homepage_rail:x", 100]]), [{ venue_id: V1, rail_name: "homepage_rail:x", position: 0, session_id: "s", occurred_at: "x" }]);
  assert.deepEqual(rails, [{ railName: "homepage_rail:x", loadRows: 100, clicks: 1, clickSessions: 1 }]);
  assert.equal("ctr" in rails[0], false);
});

// ── Dates ───────────────────────────────────────────────────────────────────

test("7-day range starts at Vancouver midnight six days before today, and never before the collection start", () => {
  const now = new Date("2026-10-12T05:30:00Z"); // Oct 11, 22:30 PDT
  assert.equal(vancouverDateKey(now), "2026-10-11");
  assert.equal(vancouverMidnight(now, 0).toISOString(), "2026-10-11T07:00:00.000Z");
  const r = resolveRange("7d", now, "2026-10-01T00:00:00Z");
  assert.equal(r.since, "2026-10-05T07:00:00.000Z");
  assert.equal(resolveRange("30d", now, "2026-10-10T23:51:00Z").since, "2026-10-10T23:51:00Z");
  assert.equal(resolveRange("all", now, "2026-10-10T23:51:00Z").since, "2026-10-10T23:51:00Z");
  assert.equal(new Date(r.until).getTime(), now.getTime() - 30_000);
});

test("Vancouver midnight is correct across the DST change (Nov 1, 2026)", () => {
  const now = new Date("2026-11-03T20:00:00Z"); // Nov 3, 12:00 PST
  assert.equal(vancouverMidnight(now, 0).toISOString(), "2026-11-03T08:00:00.000Z"); // PST
  assert.equal(vancouverMidnight(now, 3).toISOString(), "2026-10-31T07:00:00.000Z"); // PDT
});

// ── Origin-separated rankings ───────────────────────────────────────────────

test("typed is the default ranking; URL landings are ranked separately and session totals are never combined", () => {
  const rows = [
    sr({ search_term: "wine", origin: "typed", session_id: "a" }),
    sr({ search_term: "wine", origin: "url", session_id: "a" }), // same tab did both
    sr({ search_term: "boston pizza", origin: "url", session_id: "b" }),
    sr({ search_term: "boston pizza", origin: "url", session_id: "c" }),
    sr({ search_term: "boston pizza", origin: "url", session_id: "d" }),
  ];
  const typed = aggregateSearchDemand(rows);
  assert.equal(typed.rankedOrigin, "typed");
  assert.deepEqual(typed.terms.map((t) => [t.term, t.rankedSessions]), [["wine", 1]]); // URL-only terms aren't in the typed ranking
  assert.deepEqual([typed.rankedEvents, typed.rankedSessions], [1, 1]);

  const url = aggregateSearchDemand(rows, { rankedOrigin: "url" });
  assert.deepEqual(url.terms.map((t) => [t.term, t.rankedSessions]), [["boston pizza", 3], ["wine", 1]]);
  assert.deepEqual([url.rankedEvents, url.rankedSessions], [4, 4]);

  // No combined figure exists: "wine" is 1 typed session and 1 URL session, never 2.
  const wineTyped = typed.terms.find((t) => t.term === "wine")!;
  assert.deepEqual([wineTyped.rankedSessions, wineTyped.typedEvents, wineTyped.urlEvents], [1, 1, 1]);
  assert.equal("demandSessions" in wineTyped, false);
});

test("zero results and daily buckets follow the ranked origin only", () => {
  const rows = [
    sr({ search_term: "dice", origin: "url", result_count: 0, session_id: "a" }),
    sr({ search_term: "dice", origin: "typed", result_count: 4, session_id: "b" }),
  ];
  const typed = aggregateSearchDemand(rows);
  assert.deepEqual([typed.zeroResultEvents, typed.zeroResultTerms.length, typed.daily.length], [0, 0, 1]);
  const url = aggregateSearchDemand(rows, { rankedOrigin: "url" });
  assert.deepEqual([url.zeroResultEvents, url.zeroResultTerms.map((t) => t.term)], [1, ["dice"]]);
});

test("history, hero hand-off and unknown-origin rows are never ranked under either origin", () => {
  const rows = [sr({ origin: "history" }), sr({ origin: "hero_see_all" }), sr({ origin: null, mode: null })];
  for (const o of ["typed", "url"] as const) {
    const r = aggregateSearchDemand(rows, { rankedOrigin: o });
    assert.deepEqual([r.rankedEvents, r.terms.length, r.rowsAnalysed], [0, 0, 3], o);
  }
});

// ── Section engagement ──────────────────────────────────────────────────────

test("engagement: an exposure that qualified AFTER the click in the same page view still counts (set match, not time)", () => {
  const rows = [click("pv1", V1, 0), exposure("pv1")]; // click first in time
  const [s] = aggregateSections(rows);
  assert.deepEqual([s.exposedPageViews, s.engagedExposedPageViews, s.engagementRate, s.clicksOutsideExposure], [1, 1, 1, 0]);
});

test("engagement matches page view AND section: an exposure of another section doesn't count", () => {
  const rows = [exposure("pv1", { section_id: S2 }), click("pv1", V1, 0, { section_id: S1 })];
  const s1 = aggregateSections(rows).find((s) => s.sectionId === S1)!;
  const s2 = aggregateSections(rows).find((s) => s.sectionId === S2)!;
  assert.deepEqual([s1.exposedPageViews, s1.engagementRate, s1.clicksOutsideExposure], [0, null, 1]);
  assert.deepEqual([s2.exposedPageViews, s2.engagedExposedPageViews, s2.engagementRate], [1, 0, 0]);
});

test("engagement never exceeds 100% — randomized page views, repeated clicks and unexposed clicks", () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 200; trial++) {
    const rows: DiscoveryRow[] = [];
    for (let pv = 0; pv < 12; pv++) {
      if (rnd() < 0.6) rows.push(exposure(`p${pv}`));
      if (rnd() < 0.3) rows.push(exposure(`p${pv}`)); // duplicate exposure rows
      const clicks = Math.floor(rnd() * 4);
      for (let c = 0; c < clicks; c++) rows.push(rnd() < 0.5 ? click(`p${pv}`, V1, c) : ev({ event_type: "view_all_click", page_view_id: `p${pv}` }));
    }
    for (const s of aggregateSections(rows)) {
      assert.ok(s.engagedExposedPageViews <= s.exposedPageViews);
      assert.ok(s.engagementRate === null || (s.engagementRate >= 0 && s.engagementRate <= 1));
      assert.ok(s.ctr === null || (s.ctr >= 0 && s.ctr <= 1));
    }
  }
});
