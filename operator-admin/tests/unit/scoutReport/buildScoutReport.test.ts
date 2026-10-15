import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScoutReport, scoutReportFilename, SCOUT_REPORT_SCHEMA_VERSION } from "../../../src/lib/scoutReport/buildScoutReport";
import { aggregateSearchDemand } from "../../../src/lib/searchDiscoveryReporting/searchMetrics";
import {
  aggregateGuideOpensFromHomepage,
  aggregateGuidePages,
  aggregatePlacementItems,
  aggregatePlacementPositions,
  aggregateSections,
  aggregateVenueOverview,
} from "../../../src/lib/searchDiscoveryReporting/placementMetrics";
import { buildItemVenueMap } from "../../../src/lib/data/searchDiscoveryReport";
import { ReportTooLargeError } from "../../../src/lib/data/searchDiscoveryReport";
import {
  CUR,
  CMP,
  DIRECT_COUNTS,
  DISCOVERY_ROWS_CURRENT,
  GUIDE,
  NAMES,
  NOW,
  SEARCH_ROWS_CURRENT,
  SECTION,
  V,
  fakeDeps,
} from "./fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const halfOpen = <T>(rows: T[], ts: (r: T) => string) => rows.filter((r) => Date.parse(ts(r)) < Date.parse(CUR.endUtc));

test("metadata: schema version, generation time captured once, exact windows and labels", async () => {
  const { deps } = fakeDeps();
  const r = await buildScoutReport({ now: NOW, deps });
  assert.equal(r.schemaVersion, SCOUT_REPORT_SCHEMA_VERSION);
  assert.equal(r.generatedAt, NOW.toISOString());
  assert.equal(r.windows.current.startUtc, CUR.startUtc);
  assert.equal(r.windows.current.endUtc, CUR.endUtc);
  assert.equal(r.windows.comparison.startUtc, CMP.startUtc);
  assert.equal(r.windows.snapshot.asOf, NOW.toISOString());
  assert.equal(r.timeZone, "America/Vancouver");
  assert.ok(r.definitions.venueViews && r.definitions.searchDiscovery && r.definitions.milestones);
  assert.ok(r.limitations.some((l) => /vertical position/.test(l)));
  assert.ok(r.limitations.some((l) => /October 10, 2026/.test(l)));
  assert.equal(r.status, "complete");
  assert.deepEqual(r.incompleteSections, []);
  assert.equal(scoutReportFilename(r), "hhc-scout-report_2026-10-12_to_2026-10-18_generated-2026-10-19.json");
});

// ── Search & Discovery parity ───────────────────────────────────────────────

test("Search: same numbers as the Control Panel aggregator on the same (half-open) rows; typed and URL separate", async () => {
  const { deps, calls } = fakeDeps();
  const r = await buildScoutReport({ now: NOW, deps });
  const sd = r.sections.searchDiscovery.data!;
  const rows = halfOpen(SEARCH_ROWS_CURRENT, (x) => x.searched_at);
  const typed = aggregateSearchDemand(rows, { rankedOrigin: "typed" });
  const url = aggregateSearchDemand(rows, { rankedOrigin: "url" });
  const s = sd.current.search!;
  assert.equal(s.typed.rankedEvents, typed.rankedEvents);
  assert.equal(s.typed.rankedSessions, typed.rankedSessions);
  assert.equal(s.typed.zeroResultEvents, typed.zeroResultEvents);
  assert.equal(s.url.rankedEvents, url.rankedEvents);
  assert.equal(s.url.rankedSessions, url.rankedSessions);
  assert.deepEqual(s.originCounts, typed.originCounts);
  assert.equal(s.rowsAnalysed, typed.rowsAnalysed);
  // The loader was asked for the exact window; the row at exactly endUtc was dropped, the QA row excluded.
  assert.ok(calls.includes(`search ${CUR.startUtc} ${CUR.endUtc}`));
  assert.ok(!s.typed.topTerms.rows.some((t) => t.term === "late"));
  assert.ok(s.typed.topTerms.rows.some((t) => t.term === "just-in"));
  assert.equal(s.typed.topTerms.rows.find((t) => t.term === "wings")!.rankedSessions, 2, "QA session excluded");
  // Zero results follow the existing isZeroResult(): no other filters and not capped (capped = true excluded;
  // a NULL/legacy flag is not excluded) — "xyz", "capped" (NULL flag) and the redacted phone term.
  // Filtered zero is reported separately; the NULL flag is surfaced in the caveats.
  assert.equal(s.typed.zeroResultEvents, 3);
  assert.equal(s.typed.zeroWithFiltersEvents, 1);
  assert.equal(s.caveats.rowsWithCappedOrUnknownCount, 1);
  assert.equal(s.url.rankedEvents, 1);
});

test("Discovery: sections, items, positions, guide opens vs inside-guide and venue discovery match the existing aggregators", async () => {
  const { deps } = fakeDeps();
  const r = await buildScoutReport({ now: NOW, deps });
  const disc = r.sections.searchDiscovery.data!.current.discovery!;
  const rows = halfOpen(DISCOVERY_ROWS_CURRENT, (x) => x.occurred_at);

  const expectedSection = aggregateSections(rows).find((s) => s.sectionId === SECTION)!;
  const got = disc.homepageSections.find((s) => s.sectionId === SECTION)!;
  assert.equal(got.title, "Top patios");
  assert.equal(got.exposedPageViews, expectedSection.exposedPageViews);
  assert.equal(got.impressions, expectedSection.impressions);
  assert.equal(got.rawClicks, expectedSection.rawClicks);
  assert.equal(got.matchedClicked, expectedSection.matchedClicked);
  assert.equal(got.unmatchedClicks, expectedSection.unmatchedClicks);
  assert.equal(got.itemCtr, expectedSection.ctr);
  assert.equal(got.engagementRate, expectedSection.engagementRate);
  assert.equal(got.viewAllClicks, expectedSection.viewAllClicks);
  // The boundary click (exactly endUtc) is excluded: 3 raw clicks, not 4.
  assert.equal(got.rawClicks, 3);
  assert.equal(got.matchedClicked, 1);
  assert.equal(got.itemCtr, 1 / 3);
  assert.equal(got.engagementRate, 1, "both exposed page views clicked");

  const expectedItems = aggregatePlacementItems(rows, `s:${SECTION}`);
  assert.deepEqual(got.items.rows.map((i) => [i.itemId, i.impressions, i.rawClicks, i.matchedClicked]), expectedItems.map((i) => [i.itemId, i.impressions, i.rawClicks, i.matchedClicked]));
  assert.equal(got.items.rows[0].name, "Alpha Bar");
  assert.deepEqual(got.positions.map((p) => [p.position, p.impressions, p.rawClicks]), aggregatePlacementPositions(rows, `s:${SECTION}`).map((p) => [p.position, p.impressions, p.rawClicks]));

  // Homepage guide opens and inside-guide activity: separate structures, never summed.
  const opens = aggregateGuideOpensFromHomepage(rows);
  assert.deepEqual(disc.homepageGuideOpens.rows.map((g) => [g.guideId, g.impressions, g.rawClicks]), opens.map((g) => [g.guideId, g.impressions, g.rawClicks]));
  assert.equal(disc.homepageGuideOpens.rows[0].title, "Best Wings");
  const pages = aggregateGuidePages(rows);
  const inside = disc.insideGuides.rows.find((g) => g.guideId === GUIDE)!;
  assert.equal(inside.pageViews, pages[0].pageViews);
  assert.equal(inside.blocks[0].block, "venues");
  assert.equal(inside.blocks[0].impressions, 1);
  assert.equal(inside.blocks[0].matchedClicked, 1);

  // Venue discovery: Daily Special card attributed to its venue (B) through the existing item → venue map.
  const names = NAMES({});
  const overview = aggregateVenueOverview(rows, buildItemVenueMap(names));
  const b = disc.venueDiscovery.rows.find((v) => v.venueId === V.b)!;
  const bExp = overview.find((v) => v.venueId === V.b)!;
  assert.equal(b.venueName, "Bravo Pub");
  assert.equal(b.dailySpecialCards.impressions, bExp.specialCards.impressions);
  assert.equal(b.venueCards.impressions, bExp.venueCards.impressions);
  assert.equal(disc.venueDiscovery.rows.find((v) => v.venueId === V.a)!.heroSuggestionSelects, 1);
});

test("Search & Discovery coverage: tracking began Oct 10, so the Oct 5–11 comparison is partial and no change is calculated", async () => {
  const { deps } = fakeDeps();
  const sd = (await buildScoutReport({ now: NOW, deps })).sections.searchDiscovery.data!;
  assert.equal(sd.coverage.search.current.status, "full");
  assert.equal(sd.coverage.search.comparison.status, "partial");
  assert.equal(sd.changes.typedSearches.comparable, false);
  assert.equal(sd.changes.typedSearches.absoluteChange, null);
  assert.equal(sd.changes.typedSearches.percentChange, null);
  assert.equal(sd.changes.typedSearches.comparison, 2, "the partial week's total is still reported");
});

test("a week with no Search & Discovery coverage reports null, never zero, and isn't even queried", async () => {
  const { deps, calls } = fakeDeps({
    searchDiscovery: {
      getCollectionStarts: async () => ({ tracking: { search: "2026-10-13T00:00:00+00:00", discovery: "2026-10-13T00:00:00+00:00" }, firstQualifying: { search: null, discovery: null } }),
    },
  });
  const sd = (await buildScoutReport({ now: NOW, deps })).sections.searchDiscovery.data!;
  assert.equal(sd.coverage.search.comparison.status, "unavailable");
  assert.equal(sd.comparison.search, null);
  assert.equal(sd.comparison.discovery, null);
  assert.equal(sd.changes.typedSearches.comparison, null);
  assert.equal(sd.changes.homepageImpressions.comparison, null);
  assert.ok(!calls.some((c) => c.startsWith(`search ${CMP.startUtc}`)));
});

// ── Product usage ───────────────────────────────────────────────────────────

test("usage: established totals per metric; labelled views not compared across the labelling change", async () => {
  const { deps } = fakeDeps();
  const pu = (await buildScoutReport({ now: NOW, deps })).sections.productUsage.data!;
  assert.equal(pu.venueViews.current.total, 4);
  assert.equal(pu.venueViews.comparison.total, 2);
  assert.deepEqual(pu.venueViews.current.environmentBreakdown, { production: 3, unlabelled: 1 });
  assert.equal(pu.venueViews.current.notCountedRows, 2, "rows the rule excludes are shown, not added");
  assert.equal(pu.venueViews.change.comparable, false);
  assert.equal(pu.venueViews.change.percentChange, null);
  assert.match(pu.venueViews.change.notes.join(" "), /Environment labelling was rolled out/);
  // Daily Specials clicks: no environment filter (staging row counted, as established); clicks, not views.
  assert.equal(pu.dailySpecialClicks.current.total, 2);
  assert.deepEqual(pu.dailySpecialClicks.current.environmentBreakdown, { production: 1, staging: 1 });
  assert.equal(pu.dailySpecialClicks.change.absoluteChange, 2);
  assert.equal(pu.dailySpecialClicks.change.percentChange, null, "small sample");
  // Intent: per tracked type; directions not reported.
  assert.equal(pu.intentActions.byType.website.current.total, 1);
  assert.equal(pu.intentActions.byType.menu.current.total, 1);
  assert.equal(pu.intentActions.byType.hh_schedule_expand.current.total, 1);
  assert.equal(pu.intentActions.byType.business_hours_expand.current.total, 0);
  assert.equal(pu.intentActions.total.current, 3);
  assert.match(pu.intentActions.directions, /Not stored/);
  // Saves have never been recorded: unavailable, null — not zero.
  assert.equal(pu.saves.current.total, null);
  assert.equal(pu.saves.current.coverage.status, "unavailable");
  // All-time: the RPC sums, unchanged.
  assert.equal(pu.allTime.venueViews, 150);
  assert.equal(pu.allTime.eventViews, 7);
  // Named per-venue breakdown, event views via the event's venue.
  const a = pu.venues.rows.find((v) => v.venueId === V.a)!;
  assert.equal(a.venueName, "Alpha Bar");
  assert.equal(a.venueViews, 2);
  assert.equal(a.venueViewsComparisonWeek, 1);
  assert.deepEqual(a.intentActions, { website: 1, menu: 1, hh_schedule_expand: 0, business_hours_expand: 0 });
  assert.equal(pu.venues.rows.find((v) => v.venueId === V.c)!.eventViews, 1);
  assert.equal(pu.topEvents.rows[0].title, "Trivia Night");
});

// ── Failures & limits ───────────────────────────────────────────────────────

test("a failed read marks its section failed and the report incomplete — headline values are null, not 0", async () => {
  const { deps } = fakeDeps({ usage: { loadVenueViewRows: async () => { throw new Error("venue_view_events page 0 failed: timeout"); } } });
  const r = await buildScoutReport({ now: NOW, deps });
  assert.equal(r.status, "incomplete");
  assert.deepEqual(r.incompleteSections, ["productUsage", "customerSuccess"]);
  assert.equal(r.sections.productUsage.status, "failed");
  assert.equal(r.sections.productUsage.data, null);
  assert.match(r.sections.productUsage.errors.join(" "), /timeout/);
  assert.equal(r.summary.headlines.venueViews.current, null);
  // Customer success still reports milestones but is incomplete without recent weekly views.
  assert.equal(r.sections.customerSuccess.status, "incomplete");
  assert.equal((r.sections.customerSuccess.data!.approaching.rows[0] as Any).recentWeeklyViews, null);
  assert.match(scoutReportFilename(r), /_INCOMPLETE\.json$/);
});

test("a range above the row ceiling is reported as failed, never truncated", async () => {
  const { deps } = fakeDeps({ searchDiscovery: { loadDiscoveryRows: async () => { throw new ReportTooLargeError("website_discovery_events", 150_001); } } });
  const r = await buildScoutReport({ now: NOW, deps });
  assert.equal(r.sections.searchDiscovery.status, "failed");
  assert.match(r.sections.searchDiscovery.errors[0], /150,001/);
  assert.equal(r.summary.headlines.typedSearches.current, null);
});

test("an all-time count failure leaves the all-time total null and the section incomplete", async () => {
  const { deps } = fakeDeps({ usage: { allTimeVenueViews: async () => { throw new Error("venue_view_counts failed: boom"); } } });
  const pu = (await buildScoutReport({ now: NOW, deps })).sections.productUsage;
  assert.equal(pu.status, "incomplete");
  assert.equal(pu.data!.allTime.venueViews, null);
  assert.equal(pu.data!.venueViews.current.total, 4, "weekly totals unaffected");
});

// ── Customer success ────────────────────────────────────────────────────────

test("milestones: approaching list, exact threshold and maximum handled, earned communications separate", async () => {
  const { deps } = fakeDeps();
  const cs = (await buildScoutReport({ now: NOW, deps })).sections.customerSuccess.data!;
  const approaching = cs.approaching.rows as Any[];
  assert.deepEqual(approaching.map((a) => [a.venueName, a.allTimeViews, a.nextMilestone, a.viewsRemaining]), [
    ["Forty-Eight", 48, 50, 2],
    ["Ninety-Five", 95, 100, 5],
    ["Two-Thirty", 230, 250, 20],
  ]);
  // Exactly 100 (pending 100 communication) is not approaching; neither is 89 (11 left) nor the 5000 venue.
  assert.ok(!approaching.some((a) => ["Exactly Hundred", "Eighty-Nine", "Max Venue"].includes(a.venueName)));
  assert.deepEqual((cs.beyondMaximum.rows as Any[]).map((b) => b.venueName), ["Max Venue"]);
  // Recent weekly views come from the same weekly rows as the usage section.
  assert.deepEqual(approaching.find((a) => a.venueName === "Ninety-Five").recentWeeklyViews, { reportingWeek: 1, comparisonWeek: 1 });
  assert.equal(approaching.find((a) => a.venueName === "Ninety-Five").lastRecordedMilestone.state, "Sent");
  assert.equal(approaching.find((a) => a.venueName === "Two-Thirty").lastRecordedMilestone.status, "failed");
  // Earned but not sent: pending + failed only.
  assert.deepEqual(cs.earnedNotSent.rows.map((e) => [e.venueName, e.milestone, e.status]), [
    ["Exactly Hundred", 100, "pending"],
    ["Two-Thirty", 100, "failed"],
  ]);
  // A crossing the hourly detector hasn't recorded yet is shown as such, never as approaching or sent.
  assert.deepEqual((cs.crossedNotYetRecorded.rows as Any[]).map((c) => [c.venueName, c.detectorWouldRecordPending]), [["Fifty-One", 50]]);
  assert.deepEqual(cs.recordedStatusCounts, { sent: 1, superseded: 1, pending: 1, failed: 1 });
  assert.equal(cs.eligibleVenues, 7);
});

test("milestones: the reported all-time count is the milestone reader's, and a silent reader failure fails the section", async () => {
  // One new view arrived for v-95 between the reader and the direct count.
  const { deps } = fakeDeps({ milestones: { directVenueViews: async () => new Map([...DIRECT_COUNTS, ["v-95", 96]]) } });
  const ok = (await buildScoutReport({ now: NOW, deps })).sections.customerSuccess;
  assert.equal(ok.status, "complete");
  assert.equal((ok.data!.approaching.rows as Any[]).find((a) => a.venueName === "Ninety-Five").allTimeViews, 95);

  const zero = fakeDeps({
    milestones: {
      computeDecisions: async () => ({ venuesEvaluated: 1, venuesIgnoredIneligible: 0, entries: [{ venue: { id: "v-95", operatorId: "op" }, currentViews: 0, decision: { baselineNeeded: false, newlyPending: null, newlySuperseded: [], pendingToSupersede: [] } }] }),
      directVenueViews: async () => new Map([["v-95", 95]]),
    },
  });
  const failed = (await buildScoutReport({ now: NOW, deps: zero.deps })).sections.customerSuccess;
  assert.equal(failed.status, "failed");
  assert.match(failed.errors[0], /appears to have failed/);
});

// ── Privacy ─────────────────────────────────────────────────────────────────

test("the export contains no session ids, operator ids, recipient emails or unredacted contact details in search terms", async () => {
  const { deps } = fakeDeps();
  const json = JSON.stringify(await buildScoutReport({ now: NOW, deps }));
  for (const forbidden of ["sess-1", "sess-7", "qa-110-prod-check", "pv1", "op-secret", "owner-secret@example.com", "recipient_email", "me@example.com", "250 555 1234"]) {
    assert.equal(json.includes(forbidden), false, `export must not contain ${forbidden}`);
  }
  assert.ok(json.includes("[email redacted]"));
  assert.ok(json.includes("call [phone redacted]"));
});
