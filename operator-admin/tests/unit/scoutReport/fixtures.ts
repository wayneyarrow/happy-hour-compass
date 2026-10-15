/**
 * Fixtures for the Scout report tests: a fake ScoutReportDeps whose loaders
 * return what the real loaders' SQL would (including the inclusive `lte`
 * upper bound of the Search & Discovery loaders, so a row at exactly endUtc
 * is returned and must be dropped by the builder).
 */

import type { ScoutReportDeps, UsageTrackingStarts } from "../../../src/lib/scoutReport/buildScoutReport";
import type { NameMaps } from "../../../src/lib/data/searchDiscoveryReport";
import type { SearchRow } from "../../../src/lib/searchDiscoveryReporting/searchMetrics";
import type { DiscoveryRow } from "../../../src/lib/searchDiscoveryReporting/placementMetrics";
import type { VenueViewMilestonePlan } from "../../../src/lib/customerSuccess/detectVenueViewMilestones";
import type { MilestoneEventRow } from "../../../src/lib/scoutReport/milestones";
import type { DailySpecialClickRow, EventViewRow, IntentRow, SaveRow, VenueViewRow } from "../../../src/lib/scoutReport/usageData";

/** Monday Oct 19 2026, 10:00 PDT. */
export const NOW = new Date("2026-10-19T17:00:00Z");
export const CUR = { startUtc: "2026-10-12T07:00:00.000Z", endUtc: "2026-10-19T07:00:00.000Z" };
export const CMP = { startUtc: "2026-10-05T07:00:00.000Z", endUtc: "2026-10-12T07:00:00.000Z" };

export const V = { a: "aaaaaaaa-0000-4000-8000-000000000001", b: "aaaaaaaa-0000-4000-8000-000000000002", c: "aaaaaaaa-0000-4000-8000-000000000003" };
export const SECTION = "bbbbbbbb-0000-4000-8000-000000000001";
export const GUIDE_SECTION = "bbbbbbbb-0000-4000-8000-000000000002";
export const SPECIALS_SECTION = "bbbbbbbb-0000-4000-8000-000000000003";
export const GUIDE = "cccccccc-0000-4000-8000-000000000001";
export const SPECIAL = "dddddddd-0000-4000-8000-000000000001";
export const EVENT = "eeeeeeee-0000-4000-8000-000000000001";

const at = (iso: string) => iso;

let n = 0;
const sr = (p: Partial<SearchRow>): SearchRow => ({
  id: `s${++n}`,
  search_term: "wings",
  surface: "listing_page",
  mode: "happy_hours",
  origin: "typed",
  result_count: 4,
  result_count_capped: false,
  other_filters_active: false,
  session_id: "sess-1",
  searched_at: at("2026-10-14T20:00:00+00:00"),
  ...p,
});

/** Current-week search rows as the loader returns them (SQL already excluded QA; one QA row kept to prove the in-memory exclusion still applies). */
export const SEARCH_ROWS_CURRENT: SearchRow[] = [
  sr({ session_id: "sess-1" }),
  sr({ session_id: "sess-2" }),
  sr({ search_term: "Boston Pizza", origin: "url", session_id: "sess-3" }),
  sr({ search_term: "xyz", result_count: 0, session_id: "sess-4" }),
  sr({ search_term: "abc", result_count: 0, other_filters_active: true, session_id: "sess-4" }),
  sr({ search_term: "capped", result_count: 0, result_count_capped: null, session_id: "sess-5" }),
  sr({ search_term: "wings", origin: "hero_see_all", session_id: "sess-1" }),
  sr({ search_term: "wings", origin: "history", session_id: "sess-1" }),
  sr({ search_term: "old", origin: null, mode: null, session_id: "sess-6" }),
  sr({ search_term: "call 250 555 1234", result_count: 0, session_id: "sess-7" }),
  sr({ search_term: "me@example.com", session_id: "sess-8", mode: "events", surface: "homepage_hero" }),
  sr({ search_term: "wings", session_id: "qa-110-prod-check" }),
  // Exactly at the window end: belongs to the NEXT week.
  sr({ search_term: "late", session_id: "sess-9", searched_at: at("2026-10-19T07:00:00+00:00") }),
  // Microseconds just before the end: inside.
  sr({ search_term: "just-in", session_id: "sess-10", searched_at: at("2026-10-19T06:59:59.999999+00:00") }),
];

export const SEARCH_ROWS_COMPARISON: SearchRow[] = [
  sr({ session_id: "sess-20", searched_at: at("2026-10-10T22:00:00+00:00") }),
  sr({ search_term: "tacos", session_id: "sess-21", searched_at: at("2026-10-11T22:00:00+00:00") }),
];

let d = 0;
const dr = (p: Partial<DiscoveryRow>): DiscoveryRow => ({
  id: `d${++d}`,
  event_type: "item_impression",
  surface: "homepage_section",
  page_view_id: "pv1",
  session_id: "sess-1",
  section_id: SECTION,
  section_kind: "venue_rail",
  guide_id: null,
  guide_block: null,
  item_type: "venue",
  item_id: V.a,
  position: 0,
  mode: null,
  occurred_at: at("2026-10-14T20:00:00+00:00"),
  ...p,
});

export const DISCOVERY_ROWS_CURRENT: DiscoveryRow[] = [
  dr({ event_type: "section_exposure", item_type: null, item_id: null, position: null }),
  dr({ event_type: "section_exposure", item_type: null, item_id: null, position: null, page_view_id: "pv2", session_id: "sess-2" }),
  dr({}),
  dr({ item_id: V.b, position: 1 }),
  dr({ page_view_id: "pv2", session_id: "sess-2" }),
  dr({ event_type: "item_click" }),
  dr({ event_type: "item_click" }), // a second click on the same combination: raw 2, matched once
  dr({ event_type: "item_click", item_id: V.c, position: 2, page_view_id: "pv2", session_id: "sess-2" }), // unmatched
  dr({ event_type: "view_all_click", item_type: null, item_id: null, position: null, page_view_id: "pv2", session_id: "sess-2" }),
  // Homepage guide card (opens a guide).
  dr({ section_id: GUIDE_SECTION, section_kind: "guide_rail", item_type: "guide", item_id: GUIDE, page_view_id: "pv3", session_id: "sess-3" }),
  dr({ event_type: "item_click", section_id: GUIDE_SECTION, section_kind: "guide_rail", item_type: "guide", item_id: GUIDE, page_view_id: "pv3", session_id: "sess-3" }),
  // Inside the guide.
  dr({ surface: "guide", section_id: null, section_kind: null, guide_id: GUIDE, guide_block: "venues", event_type: "section_exposure", item_type: null, item_id: null, position: null, page_view_id: "pv4", session_id: "sess-3" }),
  dr({ surface: "guide", section_id: null, section_kind: null, guide_id: GUIDE, guide_block: "venues", item_id: V.b, page_view_id: "pv4", session_id: "sess-3" }),
  dr({ surface: "guide", section_id: null, section_kind: null, guide_id: GUIDE, guide_block: "venues", item_id: V.b, event_type: "item_click", page_view_id: "pv4", session_id: "sess-3" }),
  // Today's Specials card for venue B.
  dr({ section_id: SPECIALS_SECTION, section_kind: "specials_rail", item_type: "daily_special", item_id: SPECIAL }),
  // Hero suggestion pick.
  dr({ surface: "homepage_hero", section_id: null, section_kind: null, event_type: "suggestion_select", item_id: V.a, mode: "happy_hours" }),
  // Exactly at the window end: excluded.
  dr({ event_type: "item_click", item_id: V.b, position: 1, occurred_at: at("2026-10-19T07:00:00+00:00") }),
];

export const DISCOVERY_ROWS_COMPARISON: DiscoveryRow[] = [dr({ occurred_at: at("2026-10-11T20:00:00+00:00"), page_view_id: "pv9" })];

export const NAMES = (ids: { sectionIds?: Iterable<string>; venueIds?: Iterable<string>; eventIds?: Iterable<string>; specialIds?: Iterable<string>; guideIds?: Iterable<string> }): NameMaps => {
  const venues = new Map<string, string>([[V.a, "Alpha Bar"], [V.b, "Bravo Pub"], [V.c, "Charlie Grill"], ["v-95", "Ninety-Five"], ["v-100", "Exactly Hundred"], ["v-48", "Forty-Eight"], ["v-5000", "Max Venue"], ["v-230", "Two-Thirty"], ["v-89", "Eighty-Nine"], ["v-51", "Fifty-One"]]);
  void ids;
  return {
    sections: new Map([
      [SECTION, { title: "Top patios", kind: "venue_rail_algorithmic", homepage: "Kelowna", enabled: true, homepagePublished: true }],
      [GUIDE_SECTION, { title: "Guides", kind: "guide_rail_manual", homepage: "Kelowna", enabled: true, homepagePublished: true }],
      [SPECIALS_SECTION, { title: "Today's Specials", kind: "specials_rail_algorithmic", homepage: "Kelowna", enabled: true, homepagePublished: true }],
    ]),
    removedSections: new Map(),
    guides: new Map([[GUIDE, { title: "Best Wings", slug: "best-wings" }]]),
    venues,
    events: new Map([[EVENT, { title: "Trivia Night", venueId: V.c }]]),
    specials: new Map([[SPECIAL, { title: "Half-price wings", venueId: V.b }]]),
    guideBySlug: new Map(),
  };
};

// ── Usage ───────────────────────────────────────────────────────────────────

export const VENUE_VIEWS = {
  current: [
    { id: "vv1", venue_id: V.a, environment: "production" },
    { id: "vv2", venue_id: V.a, environment: "production" },
    { id: "vv3", venue_id: V.b, environment: null },
    { id: "vv4", venue_id: "v-95", environment: "production" },
  ] as VenueViewRow[],
  comparison: [
    { id: "vv5", venue_id: V.a, environment: null },
    { id: "vv6", venue_id: "v-95", environment: null },
  ] as VenueViewRow[],
};
export const EVENT_VIEWS = { current: [{ id: "ev1", event_id: EVENT, environment: "production" }] as EventViewRow[], comparison: [] as EventViewRow[] };
export const DS_CLICKS = {
  current: [
    { id: "dc1", daily_special_id: SPECIAL, venue_id: V.b, source: "search_results", environment: "production" },
    { id: "dc2", daily_special_id: SPECIAL, venue_id: V.b, source: "search_results", environment: "staging" },
  ] as DailySpecialClickRow[],
  comparison: [] as DailySpecialClickRow[],
};
export const INTENT = {
  current: [
    { id: "ic1", venue_id: V.a, click_type: "website" },
    { id: "ic2", venue_id: V.a, click_type: "menu" },
    { id: "ic3", venue_id: V.b, click_type: "hh_schedule_expand" },
  ] as IntentRow[],
  comparison: [{ id: "ic4", venue_id: V.a, click_type: "website" }] as IntentRow[],
};
export const SAVES = { current: [{ id: "sv1", venue_id: V.a }] as SaveRow[], comparison: [] as SaveRow[] };

export const TRACKING_STARTS: UsageTrackingStarts = {
  venueViews: { firstRecordedAt: "2026-06-12T18:00:00+00:00", labellingStartedAt: "2026-10-10T19:00:00+00:00" },
  eventViews: { firstRecordedAt: "2026-06-12T18:00:00+00:00", labellingStartedAt: "2026-10-10T19:00:00+00:00" },
  dailySpecialClicks: "2026-09-26T18:00:00+00:00",
  intent: { website: "2026-09-30T18:00:00+00:00", menu: "2026-09-30T18:00:00+00:00", hh_schedule_expand: "2026-09-13T18:00:00+00:00", business_hours_expand: "2026-09-30T18:00:00+00:00" },
  saves: null,
};

// ── Milestones ──────────────────────────────────────────────────────────────

const noDecision = { baselineNeeded: false, newlyPending: null, newlySuperseded: [], pendingToSupersede: [] };
export const PLAN: VenueViewMilestonePlan = {
  venuesEvaluated: 7,
  venuesIgnoredIneligible: 40,
  entries: [
    { venue: { id: "v-95", operatorId: "op-secret-1" }, currentViews: 95, decision: noDecision },
    { venue: { id: "v-100", operatorId: "op-secret-2" }, currentViews: 100, decision: noDecision },
    { venue: { id: "v-48", operatorId: "op-secret-3" }, currentViews: 48, decision: noDecision },
    { venue: { id: "v-5000", operatorId: "op-secret-4" }, currentViews: 5000, decision: noDecision },
    { venue: { id: "v-230", operatorId: "op-secret-5" }, currentViews: 230, decision: noDecision },
    { venue: { id: "v-89", operatorId: "op-secret-6" }, currentViews: 89, decision: noDecision },
    { venue: { id: "v-51", operatorId: "op-secret-7" }, currentViews: 51, decision: { ...noDecision, newlyPending: 50 } },
  ],
};
const ev = (p: Partial<MilestoneEventRow> & { venue_id: string; milestone_value: number; communication_status: string }) =>
  ({
    achieved_at: "2026-10-01T22:00:00+00:00",
    sent_at: null,
    next_attempt_at: null,
    attempt_count: 0,
    processing_started_at: null,
    recipient_blocked_reason: null,
    recipient_email: "owner-secret@example.com", // must never reach the export
    ...p,
  }) as MilestoneEventRow;
export const MILESTONE_EVENTS: MilestoneEventRow[] = [
  ev({ venue_id: "v-95", milestone_value: 50, communication_status: "sent", sent_at: "2026-09-20T22:00:00+00:00" }),
  ev({ venue_id: "v-100", milestone_value: 50, communication_status: "superseded" }),
  ev({ venue_id: "v-100", milestone_value: 100, communication_status: "pending", next_attempt_at: "2026-10-20T22:00:00+00:00" }),
  ev({ venue_id: "v-230", milestone_value: 100, communication_status: "failed", attempt_count: 3 }),
];
export const DIRECT_COUNTS = new Map(PLAN.entries.map((e) => [e.venue.id, e.currentViews]));

// ── Deps ────────────────────────────────────────────────────────────────────

const pick = <T>(w: { startUtc: string }, cur: T, cmp: T) => (w.startUtc === CUR.startUtc ? cur : cmp);

export function fakeDeps(over: { usage?: Partial<ScoutReportDeps["usage"]>; searchDiscovery?: Partial<ScoutReportDeps["searchDiscovery"]>; milestones?: Partial<ScoutReportDeps["milestones"]>; resolveNames?: ScoutReportDeps["resolveNames"] } = {}) {
  const calls: string[] = [];
  const deps: ScoutReportDeps = {
    usage: {
      loadVenueViewRows: async (w) => pick(w, VENUE_VIEWS.current, VENUE_VIEWS.comparison),
      loadEventViewRows: async (w) => pick(w, EVENT_VIEWS.current, EVENT_VIEWS.comparison),
      loadDailySpecialClickRows: async (w) => pick(w, DS_CLICKS.current, DS_CLICKS.comparison),
      loadIntentRows: async (w) => pick(w, INTENT.current, INTENT.comparison),
      loadSaveRows: async (w) => pick(w, SAVES.current, SAVES.comparison),
      countNotCountedViewRows: async (table, w) => (table === "venue_view_events" && w.startUtc === CUR.startUtc ? 2 : 0),
      trackingStarts: async () => TRACKING_STARTS,
      allTimeVenueViews: async () => new Map([[V.a, 120], [V.b, 30]]),
      allTimeEventViews: async () => new Map([[EVENT, 7]]),
      ...over.usage,
    },
    searchDiscovery: {
      getCollectionStarts: async () => ({
        tracking: { search: "2026-10-10T18:00:00+00:00", discovery: "2026-10-10T18:00:00+00:00" },
        firstQualifying: { search: "2026-10-10T19:00:00+00:00", discovery: "2026-10-10T19:00:00+00:00" },
      }),
      loadSearchRows: async (since, until) => {
        calls.push(`search ${since} ${until}`);
        return since === CUR.startUtc ? SEARCH_ROWS_CURRENT : SEARCH_ROWS_COMPARISON;
      },
      loadDiscoveryRows: async (since, until) => {
        calls.push(`discovery ${since} ${until}`);
        return since === CUR.startUtc ? DISCOVERY_ROWS_CURRENT : DISCOVERY_ROWS_COMPARISON;
      },
      ...over.searchDiscovery,
    },
    milestones: {
      computeDecisions: async () => PLAN,
      directVenueViews: async () => DIRECT_COUNTS,
      loadEvents: async () => MILESTONE_EVENTS,
      ...over.milestones,
    },
    resolveNames: over.resolveNames ?? (async (ids) => NAMES(ids)),
  };
  return { deps, calls };
}
