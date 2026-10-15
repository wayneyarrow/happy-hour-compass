/**
 * Scout "Product Usage & Discovery" report builder (server-only, read-only).
 *
 * One shared builder for the Founder Control Panel download (stage one) and,
 * later, a scheduled export. It reuses the established readers and
 * aggregation functions and only adds explicit weekly windows:
 *   - Product usage: the Operator Admin / Control Panel counting predicates
 *     (usageData.ts) and the venue_view_counts / event_view_counts RPCs
 *     (strictViewCounts.ts) for all-time totals.
 *   - Search & Discovery: the Control Panel report's own loaders
 *     (src/lib/data/searchDiscoveryReport.ts) and pure aggregators
 *     (src/lib/searchDiscoveryReporting/), Production source.
 *   - Customer Success: the side-effect-free milestone reader
 *     computeVenueViewMilestoneDecisions() plus a read of
 *     customer_success_events. Detection apply, run and delivery functions
 *     are never imported (pinned by tests/unit/scoutReport/wiring.test.ts).
 *
 * Nothing here writes to the database, sends email or Slack, or changes how
 * any existing figure is counted. A failed or truncated read never becomes
 * zero: the affected section is marked "failed" or "incomplete" and the
 * whole report "incomplete".
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  getCollectionStarts,
  loadDiscoveryRows,
  loadSearchRows,
  resolveNames,
  buildItemVenueMap,
  type CollectionStarts,
  type NameMaps,
} from "@/lib/data/searchDiscoveryReport";
import { aggregateSearchDemand, type SearchRow, type SearchTermStat } from "@/lib/searchDiscoveryReporting/searchMetrics";
import {
  aggregateGuideOpensFromHomepage,
  aggregateGuidePages,
  aggregateHero,
  aggregatePlacementItems,
  aggregatePlacementPositions,
  aggregateSections,
  aggregateVenueOverview,
  rate,
  venueOfItem,
  type DiscoveryRow,
  type ItemPerf,
  type ItemVenueMap,
} from "@/lib/searchDiscoveryReporting/placementMetrics";
import { RELEASE_QA_SESSION_IDS, REPORT_TIME_ZONE, isReleaseQaSession, vancouverDateKey } from "@/lib/searchDiscoveryReporting/config";
import { computeVenueViewMilestoneDecisions, type VenueViewMilestonePlan } from "@/lib/customerSuccess/detectVenueViewMilestones";
import { VENUE_VIEW_MILESTONES } from "@/lib/customerSuccess/venueViewMilestones";
import { fetchAllRows as fetchAllPages } from "@/lib/customerSuccess/pagination";
import { VENUE_CLICK_TYPES, type VenueClickType } from "@/lib/venueClickTracking";
import { computeReportWindows, coverageFor, isInWindow, type Coverage, type ReportWindow } from "./windows";
import { compareMetric, combineComparability, coverageComparability, effectiveLabellingStart, labellingComparability, type MetricComparison } from "./comparison";
import { redactSearchTerm } from "./redaction";
import { describeCommunication, isEarnedNotSent, milestoneProgress, verifyReaderCounts, type MilestoneCommunication, type MilestoneEventRow } from "./milestones";
import { getEventViewCountsStrict, getVenueViewCountsStrict, sumCounts } from "./strictViewCounts";
import {
  countNotCountedViewRows,
  countedViews,
  firstRowAt,
  loadDailySpecialClickRows,
  loadEventViewRows,
  loadIntentRows,
  loadSaveRows,
  loadVenueViewRows,
  type DailySpecialClickRow,
  type EventViewRow,
  type IntentRow,
  type SaveRow,
  type VenueViewRow,
} from "./usageData";
import { LIMITATIONS, METRIC_DEFINITIONS, SAVES_COLLECTION, SOURCE_POLICY_SUMMARY } from "./definitions";
import { classifyFailure, type IssueKind, type ReportIssue } from "./issues";

export const SCOUT_REPORT_SCHEMA_VERSION = "hhc-scout-report/1.0";

/** Presentation caps for named lists. Totals are always computed over every row; a capped list says how many it lists. */
export const LIST_LIMITS = { terms: 25, sectionItems: 20, guideItems: 20, venues: 150, events: 25 } as const;

type Win = Pick<ReportWindow, "startUtc" | "endUtc">;

// ── Dependencies (real by default; injectable for tests) ────────────────────

export type UsageTrackingStarts = {
  venueViews: { firstRecordedAt: string | null; labellingStartedAt: string | null };
  eventViews: { firstRecordedAt: string | null; labellingStartedAt: string | null };
  dailySpecialClicks: string | null;
  intent: Record<VenueClickType, string | null>;
  saves: string | null;
};

export type ScoutReportDeps = {
  usage: {
    loadVenueViewRows: (w: Win) => Promise<VenueViewRow[]>;
    loadEventViewRows: (w: Win) => Promise<EventViewRow[]>;
    loadDailySpecialClickRows: (w: Win) => Promise<DailySpecialClickRow[]>;
    loadIntentRows: (w: Win) => Promise<IntentRow[]>;
    loadSaveRows: (w: Win) => Promise<SaveRow[]>;
    countNotCountedViewRows: (table: "venue_view_events" | "event_view_events", w: Win) => Promise<number>;
    trackingStarts: () => Promise<UsageTrackingStarts>;
    allTimeVenueViews: () => Promise<Map<string, number>>;
    allTimeEventViews: () => Promise<Map<string, number>>;
  };
  searchDiscovery: {
    getCollectionStarts: () => Promise<CollectionStarts>;
    loadSearchRows: (since: string, until: string) => Promise<SearchRow[]>;
    loadDiscoveryRows: (since: string, until: string) => Promise<DiscoveryRow[]>;
  };
  milestones: {
    computeDecisions: () => Promise<VenueViewMilestonePlan>;
    directVenueViews: (venueIds: string[]) => Promise<Map<string, number>>;
    loadEvents: (venueIds: string[]) => Promise<MilestoneEventRow[]>;
  };
  resolveNames: typeof resolveNames;
};

export function createDefaultScoutReportDeps(): ScoutReportDeps {
  const admin = createAdminClient();
  return {
    usage: {
      loadVenueViewRows: (w) => loadVenueViewRows(admin, w),
      loadEventViewRows: (w) => loadEventViewRows(admin, w),
      loadDailySpecialClickRows: (w) => loadDailySpecialClickRows(admin, w),
      loadIntentRows: (w) => loadIntentRows(admin, w),
      loadSaveRows: (w) => loadSaveRows(admin, w),
      countNotCountedViewRows: (table, w) => countNotCountedViewRows(admin, table, w),
      trackingStarts: async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const labelled = (q: any) => q.not("environment", "is", null);
        const [vFirst, vLabel, eFirst, eLabel, ds, saves, ...intent] = await Promise.all([
          firstRowAt(admin, "venue_view_events", "viewed_at", countedViews),
          firstRowAt(admin, "venue_view_events", "viewed_at", labelled),
          firstRowAt(admin, "event_view_events", "viewed_at", countedViews),
          firstRowAt(admin, "event_view_events", "viewed_at", labelled),
          firstRowAt(admin, "daily_special_click_events", "clicked_at"),
          firstRowAt(admin, "venue_save_events", "saved_at", (q) => q.eq("action", "save")),
          ...VENUE_CLICK_TYPES.map((t) => firstRowAt(admin, "venue_click_events", "clicked_at", (q) => q.eq("click_type", t))),
        ]);
        return {
          venueViews: { firstRecordedAt: vFirst, labellingStartedAt: vLabel },
          eventViews: { firstRecordedAt: eFirst, labellingStartedAt: eLabel },
          dailySpecialClicks: ds,
          saves,
          intent: Object.fromEntries(VENUE_CLICK_TYPES.map((t, i) => [t, intent[i]])) as Record<VenueClickType, string | null>,
        };
      },
      allTimeVenueViews: () => getVenueViewCountsStrict(admin, null),
      allTimeEventViews: () => getEventViewCountsStrict(admin, null),
    },
    searchDiscovery: {
      getCollectionStarts: () => getCollectionStarts("production"),
      loadSearchRows: (since, until) => loadSearchRows("production", since, until),
      loadDiscoveryRows: (since, until) => loadDiscoveryRows("production", since, until),
    },
    milestones: {
      computeDecisions: () => computeVenueViewMilestoneDecisions(admin),
      directVenueViews: (ids) => getVenueViewCountsStrict(admin, null, ids),
      loadEvents: (ids) =>
        ids.length === 0
          ? Promise.resolve([])
          : fetchAllPages<MilestoneEventRow>((from, to) =>
              admin
                .from("customer_success_events")
                // recipient_email is deliberately never selected.
                .select("venue_id, milestone_value, communication_status, achieved_at, sent_at, next_attempt_at, attempt_count, processing_started_at, recipient_blocked_reason")
                .eq("event_type", "venue_view_milestone")
                .in("venue_id", ids)
                .order("id", { ascending: true })
                .range(from, to)
            ),
    },
    resolveNames,
  };
}

// ── Sections ────────────────────────────────────────────────────────────────

export type SectionStatus = "complete" | "incomplete" | "failed";
export type ReportSection<T> = {
  status: SectionStatus;
  data: T | null;
  notes: string[];
  /** One line per issue (message only). */
  errors: string[];
  /** The same issues with their cause and whether a retry could help. */
  issues: ReportIssue[];
};

type SectionCtx = { notes: string[]; issues: ReportIssue[] };

const issueLine = (i: ReportIssue) => (i.part === "Section" ? i.message : `${i.part}: ${i.message}`);

async function runSection<T>(fn: (ctx: SectionCtx) => Promise<T>): Promise<ReportSection<T>> {
  const ctx: SectionCtx = { notes: [], issues: [] };
  try {
    const data = await fn(ctx);
    return { status: ctx.issues.length ? "incomplete" : "complete", data, notes: ctx.notes, errors: ctx.issues.map(issueLine), issues: ctx.issues };
  } catch (e) {
    const issues = [...ctx.issues, classifyFailure("Section", e)];
    return { status: "failed", data: null, notes: ctx.notes, errors: issues.map(issueLine), issues };
  }
}

/** A non-essential part: on failure, null plus an error that marks the section incomplete. */
async function soft<T>(ctx: SectionCtx, what: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    ctx.issues.push(classifyFailure(what, e));
    return null;
  }
}

function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function environmentBreakdown(rows: { environment: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r.environment ?? "unlabelled";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ── Product usage ───────────────────────────────────────────────────────────

type WindowUsage = {
  venueViews: VenueViewRow[];
  eventViews: EventViewRow[];
  dailySpecialClicks: DailySpecialClickRow[];
  intent: IntentRow[];
  saves: SaveRow[];
};

async function loadWindowUsage(deps: ScoutReportDeps, w: Win): Promise<WindowUsage> {
  const [venueViews, eventViews, dailySpecialClicks, intent, saves] = await Promise.all([
    deps.usage.loadVenueViewRows(w),
    deps.usage.loadEventViewRows(w),
    deps.usage.loadDailySpecialClickRows(w),
    deps.usage.loadIntentRows(w),
    deps.usage.loadSaveRows(w),
  ]);
  return { venueViews, eventViews, dailySpecialClicks, intent, saves };
}

type CountWithCoverage = { total: number | null; coverage: Coverage };
type WeeklyMetric = {
  current: CountWithCoverage & Record<string, unknown>;
  comparison: CountWithCoverage & Record<string, unknown>;
  change: MetricComparison;
};

/** A count is null (never 0) when the window has no coverage. */
const valueFor = (n: number, coverage: Coverage) => (coverage.status === "unavailable" ? null : n);

function weeklyMetric(
  cur: number,
  cmp: number,
  covCur: Coverage,
  covCmp: Coverage,
  extra: { current?: Record<string, unknown>; comparison?: Record<string, unknown> } = {},
  labellingStartedAt?: string | null,
  windows?: { current: Win; comparison: Win }
): WeeklyMetric {
  const comparability = combineComparability(
    coverageComparability(covCur, covCmp),
    labellingStartedAt !== undefined && windows ? labellingComparability(windows.current, windows.comparison, labellingStartedAt) : { comparable: true, reasons: [] }
  );
  const current = valueFor(cur, covCur);
  const comparison = valueFor(cmp, covCmp);
  return {
    current: { total: current, coverage: covCur, ...extra.current },
    comparison: { total: comparison, coverage: covCmp, ...extra.comparison },
    change: compareMetric(current, comparison, comparability),
  };
}

export type WeeklyVenueViews = { current: Map<string, number>; comparison: Map<string, number> };

async function buildProductUsage(deps: ScoutReportDeps, windows: { current: ReportWindow; comparison: ReportWindow }, asOf: string, ctx: SectionCtx, out: { weeklyVenueViews: WeeklyVenueViews | null }) {
  const [cur, cmp, starts] = await Promise.all([loadWindowUsage(deps, windows.current), loadWindowUsage(deps, windows.comparison), deps.usage.trackingStarts()]);
  out.weeklyVenueViews = { current: countBy(cur.venueViews, (r) => r.venue_id), comparison: countBy(cmp.venueViews, (r) => r.venue_id) };

  const [notCounted, allTimeVenue, allTimeEvent] = await Promise.all([
    soft(
      ctx,
      "Non-counted view rows (informational)",
      Promise.all([
        deps.usage.countNotCountedViewRows("venue_view_events", windows.current),
        deps.usage.countNotCountedViewRows("venue_view_events", windows.comparison),
        deps.usage.countNotCountedViewRows("event_view_events", windows.current),
        deps.usage.countNotCountedViewRows("event_view_events", windows.comparison),
      ])
    ),
    soft(ctx, "All-time venue views", deps.usage.allTimeVenueViews()),
    soft(ctx, "All-time event views", deps.usage.allTimeEventViews()),
  ]);

  // Names and event → venue mapping (current week only: the named breakdowns).
  const venueIds = new Set<string>([
    ...cur.venueViews.map((r) => r.venue_id),
    ...cur.dailySpecialClicks.map((r) => r.venue_id),
    ...cur.intent.map((r) => r.venue_id),
    ...cur.saves.map((r) => r.venue_id),
  ]);
  const eventIds = [...new Set(cur.eventViews.map((r) => r.event_id))];
  const names = await soft(ctx, "Venue and event names", deps.resolveNames({ venueIds, eventIds }));
  const venueName = (id: string) => names?.venues.get(id) ?? null;

  const ws = { current: windows.current, comparison: windows.comparison };
  const cov = (first: string | null) => ({ cur: coverageFor(windows.current, first), cmp: coverageFor(windows.comparison, first) });

  const vCov = cov(starts.venueViews.firstRecordedAt);
  const eCov = cov(starts.eventViews.firstRecordedAt);
  const dCov = cov(starts.dailySpecialClicks);
  // Saves: collection is not established (SAVES_COLLECTION), so they stay unavailable — never 0, and recorded rows
  // never switch the metric on (partial collection is not complete tracking). Only a reviewed tracking fix that
  // sets SAVES_COLLECTION.status = "established" enables normal counting.
  const savesEstablished = SAVES_COLLECTION.status === "established";
  const savesUnavailable: Coverage = { status: "unavailable", firstRecordedAt: starts.saves, note: SAVES_COLLECTION.reason };
  const sCov = savesEstablished ? cov(starts.saves) : { cur: savesUnavailable, cmp: savesUnavailable };

  const venueViews = weeklyMetric(
    cur.venueViews.length,
    cmp.venueViews.length,
    vCov.cur,
    vCov.cmp,
    {
      current: { environmentBreakdown: environmentBreakdown(cur.venueViews), notCountedRows: notCounted?.[0] ?? null },
      comparison: { environmentBreakdown: environmentBreakdown(cmp.venueViews), notCountedRows: notCounted?.[1] ?? null },
    },
    effectiveLabellingStart(starts.venueViews.labellingStartedAt),
    ws
  );
  const eventViews = weeklyMetric(
    cur.eventViews.length,
    cmp.eventViews.length,
    eCov.cur,
    eCov.cmp,
    {
      current: { environmentBreakdown: environmentBreakdown(cur.eventViews), notCountedRows: notCounted?.[2] ?? null },
      comparison: { environmentBreakdown: environmentBreakdown(cmp.eventViews), notCountedRows: notCounted?.[3] ?? null },
    },
    effectiveLabellingStart(starts.eventViews.labellingStartedAt),
    ws
  );
  const dailySpecialClicks = weeklyMetric(cur.dailySpecialClicks.length, cmp.dailySpecialClicks.length, dCov.cur, dCov.cmp, {
    current: { bySource: Object.fromEntries(countBy(cur.dailySpecialClicks, (r) => r.source)), environmentBreakdown: environmentBreakdown(cur.dailySpecialClicks) },
    comparison: { bySource: Object.fromEntries(countBy(cmp.dailySpecialClicks, (r) => r.source)), environmentBreakdown: environmentBreakdown(cmp.dailySpecialClicks) },
  });
  const saves = { ...weeklyMetric(cur.saves.length, cmp.saves.length, sCov.cur, sCov.cmp), collection: SAVES_COLLECTION };

  const intentCur = countBy(cur.intent, (r) => r.click_type);
  const intentCmp = countBy(cmp.intent, (r) => r.click_type);
  const intentByType = Object.fromEntries(
    VENUE_CLICK_TYPES.map((t) => {
      const c = cov(starts.intent[t]);
      return [t, weeklyMetric(intentCur.get(t) ?? 0, intentCmp.get(t) ?? 0, c.cur, c.cmp)];
    })
  ) as Record<VenueClickType, WeeklyMetric>;
  const known = new Set<string>(VENUE_CLICK_TYPES);
  const unrecognized = (m: Map<string, number>) => Object.fromEntries([...m].filter(([k]) => !known.has(k)));
  const sumTyped = (key: "current" | "comparison") => {
    const vals = VENUE_CLICK_TYPES.map((t) => intentByType[t][key].total);
    return vals.some((v) => v === null) ? null : (vals as number[]).reduce((a, b) => a + b, 0);
  };
  const intentTotalComparability = combineComparability(
    ...VENUE_CLICK_TYPES.map((t) => coverageComparability(intentByType[t].current.coverage, intentByType[t].comparison.coverage))
  );
  const intentTotal = compareMetric(sumTyped("current"), sumTyped("comparison"), intentTotalComparability);

  // Per-venue breakdown for the reporting week.
  const eventVenue = (eventId: string) => names?.events.get(eventId)?.venueId ?? null;
  const vv = countBy(cur.venueViews, (r) => r.venue_id);
  const vvPrev = countBy(cmp.venueViews, (r) => r.venue_id);
  const ev = names ? countBy(cur.eventViews, (r) => eventVenue(r.event_id)) : null;
  const ds = countBy(cur.dailySpecialClicks, (r) => r.venue_id);
  const sv = countBy(cur.saves, (r) => r.venue_id);
  const intentByVenue = new Map<string, Record<string, number>>();
  for (const r of cur.intent) {
    const o = intentByVenue.get(r.venue_id) ?? Object.fromEntries(VENUE_CLICK_TYPES.map((t) => [t, 0]));
    o[r.click_type] = (o[r.click_type] ?? 0) + 1;
    intentByVenue.set(r.venue_id, o);
  }
  if (ev) for (const id of ev.keys()) venueIds.add(id);
  const venueRows = [...venueIds]
    .map((id) => ({
      venueId: id,
      venueName: venueName(id),
      venueViews: vv.get(id) ?? 0,
      venueViewsComparisonWeek: vvPrev.get(id) ?? 0,
      eventViews: ev ? ev.get(id) ?? 0 : null,
      dailySpecialClicks: ds.get(id) ?? 0,
      intentActions: intentByVenue.get(id) ?? Object.fromEntries(VENUE_CLICK_TYPES.map((t) => [t, 0])),
      saves: savesEstablished ? sv.get(id) ?? 0 : null,
    }))
    .sort((a, b) => b.venueViews - a.venueViews || (a.venueName ?? "").localeCompare(b.venueName ?? ""));
  const unmappedEventViews = names ? cur.eventViews.filter((r) => !eventVenue(r.event_id)).length : null;
  if (unmappedEventViews) ctx.notes.push(`${unmappedEventViews} event view(s) belong to events with no current venue and are not in the per-venue breakdown (they are in the total).`);

  const evCount = countBy(cur.eventViews, (r) => r.event_id);
  const topEvents = [...evCount]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIST_LIMITS.events)
    .map(([eventId, views]) => {
      const e = names?.events.get(eventId);
      return { eventId, title: e?.title ?? null, venueId: e?.venueId ?? null, venueName: e?.venueId ? venueName(e.venueId) : null, views };
    });

  return {
    allTime: {
      asOf,
      venueViews: allTimeVenue ? sumCounts(allTimeVenue) : null,
      eventViews: allTimeEvent ? sumCounts(allTimeEvent) : null,
      note: "Same RPCs and rule as the Control Panel all-time figures (legacy unlabelled + production rows, no QA exclusion). Different time horizon from the weekly totals.",
    },
    venueViews,
    eventViews,
    dailySpecialClicks,
    intentActions: {
      byType: intentByType,
      total: intentTotal,
      unrecognizedTypes: { current: unrecognized(intentCur), comparison: unrecognized(intentCmp) },
      directions: "Not stored in the database — not reported.",
    },
    saves,
    venues: { totalWithActivity: venueRows.length, listed: Math.min(venueRows.length, LIST_LIMITS.venues), rows: venueRows.slice(0, LIST_LIMITS.venues) },
    topEvents: { totalWithViews: evCount.size, listed: topEvents.length, rows: topEvents },
  };
}

// ── Search & Discovery ──────────────────────────────────────────────────────

const SEARCH_MODES = ["happy_hours", "daily_specials", "events"] as const;
const SEARCH_SURFACES = ["homepage_hero", "listing_page"] as const;

function termOut(t: SearchTermStat) {
  const r = redactSearchTerm(t.term);
  return {
    term: r.term,
    redacted: r.redacted,
    rankedSessions: t.rankedSessions,
    rankedEvents: t.rankedEvents,
    typedEvents: t.typedEvents,
    urlEvents: t.urlEvents,
    historyEvents: t.historyEvents,
    heroHandoffEvents: t.heroHandoffEvents,
    unknownOriginEvents: t.unknownOriginEvents,
    zeroResultEvents: t.zeroResultEvents,
    zeroResultSessions: t.zeroResultSessions,
    zeroWithFiltersEvents: t.zeroWithFiltersEvents,
    modes: t.modes,
    surfaces: t.surfaces,
  };
}

function originSummary(rows: SearchRow[], rankedOrigin: "typed" | "url") {
  const r = aggregateSearchDemand(rows, { rankedOrigin });
  return {
    rankedEvents: r.rankedEvents,
    rankedSessions: r.rankedSessions,
    distinctTerms: r.distinctTerms,
    zeroResultEvents: r.zeroResultEvents,
    zeroWithFiltersEvents: r.terms.reduce((a, t) => a + t.zeroWithFiltersEvents, 0),
    topTerms: { listed: Math.min(r.terms.length, LIST_LIMITS.terms), of: r.terms.length, rows: r.terms.slice(0, LIST_LIMITS.terms).map(termOut) },
    zeroResultTerms: { listed: Math.min(r.zeroResultTerms.length, LIST_LIMITS.terms), of: r.zeroResultTerms.length, rows: r.zeroResultTerms.slice(0, LIST_LIMITS.terms).map(termOut) },
    daily: r.daily,
  };
}

export function summarizeSearch(rows: SearchRow[]) {
  const all = aggregateSearchDemand(rows, { rankedOrigin: "typed" });
  const kept = rows.filter((r) => !isReleaseQaSession(r.session_id));
  const split = (filters: { mode?: string; surface?: string }) => {
    const t = aggregateSearchDemand(rows, { ...filters, rankedOrigin: "typed" });
    const u = aggregateSearchDemand(rows, { ...filters, rankedOrigin: "url" });
    return { typedEvents: t.rankedEvents, typedSessions: t.rankedSessions, typedZeroResultEvents: t.zeroResultEvents, urlEvents: u.rankedEvents, urlSessions: u.rankedSessions, urlZeroResultEvents: u.zeroResultEvents };
  };
  return {
    rowsAnalysed: all.rowsAnalysed,
    originCounts: all.originCounts,
    typed: originSummary(rows, "typed"),
    url: originSummary(rows, "url"),
    byMode: Object.fromEntries(SEARCH_MODES.map((m) => [m, split({ mode: m })])),
    bySurface: Object.fromEntries(SEARCH_SURFACES.map((s) => [s, split({ surface: s })])),
    caveats: {
      rowsWithCappedOrUnknownCount: kept.filter((r) => r.result_count_capped !== false).length,
      rowsWithOtherFiltersActive: kept.filter((r) => r.other_filters_active === true).length,
      note:
        "Zero-result counts use the Control Panel rule: 0 results, other filters not on, and not flagged as capped. Rows with no capped flag (an old client) are not excluded — rowsWithCappedOrUnknownCount shows how many rows were flagged capped or carry no flag. Zero results with other filters on are reported separately. Hero hand-off, back/forward and unknown-origin rows are counted in originCounts but never ranked.",
    },
  };
}

const sumPerf = (ps: ItemPerf[]) => {
  const t = ps.reduce(
    (a, p) => ({ impressions: a.impressions + p.impressions, rawClicks: a.rawClicks + p.rawClicks, matchedClicked: a.matchedClicked + p.matchedClicked, unmatchedClicks: a.unmatchedClicks + p.unmatchedClicks }),
    { impressions: 0, rawClicks: 0, matchedClicked: 0, unmatchedClicks: 0 }
  );
  return { ...t, itemCtr: rate(t.matchedClicked, t.impressions) };
};

function itemName(names: NameMaps | null, type: string, id: string): string | null {
  if (!names) return null;
  if (type === "venue") return names.venues.get(id) ?? null;
  if (type === "event") return names.events.get(id)?.title ?? null;
  if (type === "daily_special") return names.specials.get(id)?.title ?? null;
  if (type === "guide") return names.guides.get(id)?.title ?? null;
  return null;
}

/** Totals only (comparison week): homepage-section and guide-page item performance. */
export function discoveryTotals(rows: DiscoveryRow[]) {
  const sections = aggregateSections(rows);
  const guides = aggregateGuidePages(rows);
  return {
    homepageSections: {
      ...sumPerf(sections),
      sectionsWithActivity: sections.length,
      viewAllClicks: sections.reduce((a, s) => a + s.viewAllClicks, 0),
      clicksOutsideExposure: sections.reduce((a, s) => a + s.clicksOutsideExposure, 0),
    },
    guidePages: { ...sumPerf(guides.flatMap((g) => g.blocks)), guidesWithActivity: guides.length, pageViews: guides.reduce((a, g) => a + g.pageViews, 0) },
  };
}

export function summarizeDiscovery(rows: DiscoveryRow[], names: NameMaps | null, itemVenue: ItemVenueMap) {
  const itemsOut = (placementKey: string, limit: number) => {
    const items = aggregatePlacementItems(rows, placementKey);
    return {
      listed: Math.min(items.length, limit),
      of: items.length,
      rows: items.slice(0, limit).map((i) => ({ itemType: i.itemType, itemId: i.itemId, name: itemName(names, i.itemType, i.itemId), positions: i.positions, impressions: i.impressions, rawClicks: i.rawClicks, matchedClicked: i.matchedClicked, unmatchedClicks: i.unmatchedClicks, itemCtr: i.ctr })),
    };
  };
  const sections = aggregateSections(rows)
    .map((s) => {
      const info = names?.sections.get(s.sectionId);
      const removed = names?.removedSections.get(s.sectionId);
      return {
        sectionId: s.sectionId,
        title: info?.title ?? removed?.title ?? null,
        deleted: !info,
        kind: s.sectionKind,
        homepage: info?.homepage ?? null,
        enabled: info ? info.enabled : null,
        homepagePublished: info ? info.homepagePublished : null,
        exposedPageViews: s.exposedPageViews,
        impressions: s.impressions,
        rawClicks: s.rawClicks,
        matchedClicked: s.matchedClicked,
        unmatchedClicks: s.unmatchedClicks,
        itemCtr: s.ctr,
        clickingPageViews: s.clickingPageViews,
        engagedExposedPageViews: s.engagedExposedPageViews,
        engagementRate: s.engagementRate,
        clicksOutsideExposure: s.clicksOutsideExposure,
        viewAllClicks: s.viewAllClicks,
        items: itemsOut(`s:${s.sectionId}`, LIST_LIMITS.sectionItems),
        positions: aggregatePlacementPositions(rows, `s:${s.sectionId}`).map((p) => ({ position: p.position, impressions: p.impressions, rawClicks: p.rawClicks, matchedClicked: p.matchedClicked, unmatchedClicks: p.unmatchedClicks, itemCtr: p.ctr })),
      };
    })
    .sort((a, b) => (a.kind ?? "").localeCompare(b.kind ?? "") || b.exposedPageViews - a.exposedPageViews);

  const homepageGuideOpens = aggregateGuideOpensFromHomepage(rows).map((g) => ({
    guideId: g.guideId,
    title: names?.guides.get(g.guideId)?.title ?? null,
    sectionIds: g.sectionIds,
    impressions: g.impressions,
    rawClicks: g.rawClicks,
    matchedClicked: g.matchedClicked,
    unmatchedClicks: g.unmatchedClicks,
    itemCtr: g.ctr,
  }));
  const insideGuides = aggregateGuidePages(rows).map((g) => ({
    guideId: g.guideId,
    title: names?.guides.get(g.guideId)?.title ?? null,
    pageViews: g.pageViews,
    blocks: g.blocks.map((b) => ({
      block: b.block,
      exposedPageViews: b.exposedPageViews,
      impressions: b.impressions,
      rawClicks: b.rawClicks,
      matchedClicked: b.matchedClicked,
      unmatchedClicks: b.unmatchedClicks,
      itemCtr: b.ctr,
      items: itemsOut(`g:${g.guideId}:${b.block}`, LIST_LIMITS.guideItems),
    })),
  }));

  const venueOverview = aggregateVenueOverview(rows, itemVenue);
  const perf = (p: ItemPerf) => ({ impressions: p.impressions, rawClicks: p.rawClicks, matchedClicked: p.matchedClicked, unmatchedClicks: p.unmatchedClicks, itemCtr: p.ctr });
  const unmappedCardRows = rows.filter(
    (r) =>
      r.surface !== "homepage_hero" &&
      (r.item_type === "daily_special" || r.item_type === "event") &&
      (r.event_type === "item_impression" || r.event_type === "item_click") &&
      venueOfItem(r, itemVenue) === null
  ).length;

  return {
    totals: discoveryTotals(rows),
    homepageSections: sections,
    hero: aggregateHero(rows),
    homepageGuideOpens: {
      note: "Homepage cards that open a guide. Reported separately from activity inside guides — never summed, and no journey from one to the other is inferred.",
      rows: homepageGuideOpens,
    },
    insideGuides: { note: "Venue, event and related-guide cards on guide pages, by block.", rows: insideGuides },
    venueDiscovery: {
      note: "Per venue: its venue cards, Daily Special cards and event cards across homepage sections and guides, plus hero suggestion picks. Guide cards are not venue discovery. No lift or attribution is claimed.",
      totalVenues: venueOverview.length,
      listed: Math.min(venueOverview.length, LIST_LIMITS.venues),
      rows: venueOverview.slice(0, LIST_LIMITS.venues).map((v) => ({
        venueId: v.venueId,
        venueName: names?.venues.get(v.venueId) ?? null,
        venueCards: perf(v.venueCards),
        dailySpecialCards: perf(v.specialCards),
        eventCards: perf(v.eventCards),
        heroSuggestionSelects: v.suggestionSelects,
      })),
      unmappedCardRows,
    },
  };
}

async function buildSearchDiscovery(deps: ScoutReportDeps, windows: { current: ReportWindow; comparison: ReportWindow }, ctx: SectionCtx) {
  const starts = await deps.searchDiscovery.getCollectionStarts();
  const coverage = {
    search: { current: coverageFor(windows.current, starts.tracking.search), comparison: coverageFor(windows.comparison, starts.tracking.search) },
    discovery: { current: coverageFor(windows.current, starts.tracking.discovery), comparison: coverageFor(windows.comparison, starts.tracking.discovery) },
  };

  // The loaders' upper bound is inclusive (lte); rows at exactly endUtc are dropped here, making each window half-open.
  const load = async <T>(cov: Coverage, w: ReportWindow, fn: (since: string, until: string) => Promise<T[]>, ts: (r: T) => string) =>
    cov.status === "unavailable" ? null : (await fn(w.startUtc, w.endUtc)).filter((r) => isInWindow(ts(r), w));

  const [sCur, sCmp, dCur, dCmp] = await Promise.all([
    load(coverage.search.current, windows.current, deps.searchDiscovery.loadSearchRows, (r) => r.searched_at),
    load(coverage.search.comparison, windows.comparison, deps.searchDiscovery.loadSearchRows, (r) => r.searched_at),
    load(coverage.discovery.current, windows.current, deps.searchDiscovery.loadDiscoveryRows, (r) => r.occurred_at),
    load(coverage.discovery.comparison, windows.comparison, deps.searchDiscovery.loadDiscoveryRows, (r) => r.occurred_at),
  ]);

  let discoveryCurrent: ReturnType<typeof summarizeDiscovery> | null = null;
  if (dCur) {
    const ids = (type: string) => dCur.filter((r) => r.item_type === type && r.item_id).map((r) => r.item_id as string);
    const names = await soft(
      ctx,
      "Discovery names",
      deps.resolveNames({
        sectionIds: dCur.map((r) => r.section_id).filter((x): x is string => !!x),
        guideIds: [...dCur.map((r) => r.guide_id).filter((x): x is string => !!x), ...ids("guide")],
        venueIds: ids("venue"),
        eventIds: ids("event"),
        specialIds: ids("daily_special"),
      })
    );
    if (!names) ctx.notes.push("Names could not be resolved, so venue discovery for Daily Special and event cards is unavailable this run.");
    const itemVenue = names ? buildItemVenueMap(names) : new Map<string, string>();
    discoveryCurrent = summarizeDiscovery(dCur, names, itemVenue);
  }

  const searchCur = sCur ? summarizeSearch(sCur) : null;
  const searchCmp = sCmp ? summarizeSearch(sCmp) : null;
  const totCur = dCur ? discoveryTotals(dCur) : null;
  const totCmp = dCmp ? discoveryTotals(dCmp) : null;
  const sComp = coverageComparability(coverage.search.current, coverage.search.comparison);
  const dComp = coverageComparability(coverage.discovery.current, coverage.discovery.comparison);

  return {
    source: "production",
    releaseQaSessionsExcluded: RELEASE_QA_SESSION_IDS.length,
    tracking: { trackingStartedAt: starts.tracking, firstQualifyingAt: starts.firstQualifying },
    coverage,
    current: { search: searchCur, discovery: discoveryCurrent },
    comparison: {
      search: searchCmp
        ? { rowsAnalysed: searchCmp.rowsAnalysed, originCounts: searchCmp.originCounts, typed: { rankedEvents: searchCmp.typed.rankedEvents, rankedSessions: searchCmp.typed.rankedSessions, zeroResultEvents: searchCmp.typed.zeroResultEvents }, url: { rankedEvents: searchCmp.url.rankedEvents, rankedSessions: searchCmp.url.rankedSessions, zeroResultEvents: searchCmp.url.zeroResultEvents } }
        : null,
      discovery: totCmp,
    },
    changes: {
      typedSearches: compareMetric(searchCur?.typed.rankedEvents ?? null, searchCmp?.typed.rankedEvents ?? null, sComp),
      typedSearchSessions: compareMetric(searchCur?.typed.rankedSessions ?? null, searchCmp?.typed.rankedSessions ?? null, sComp),
      urlLandings: compareMetric(searchCur?.url.rankedEvents ?? null, searchCmp?.url.rankedEvents ?? null, sComp),
      typedZeroResultSearches: compareMetric(searchCur?.typed.zeroResultEvents ?? null, searchCmp?.typed.zeroResultEvents ?? null, sComp),
      homepageImpressions: compareMetric(totCur?.homepageSections.impressions ?? null, totCmp?.homepageSections.impressions ?? null, dComp),
      homepageMatchedClicked: compareMetric(totCur?.homepageSections.matchedClicked ?? null, totCmp?.homepageSections.matchedClicked ?? null, dComp),
      homepageRawClicks: compareMetric(totCur?.homepageSections.rawClicks ?? null, totCmp?.homepageSections.rawClicks ?? null, dComp),
      homepageItemCtr: {
        current: totCur?.homepageSections.itemCtr ?? null,
        comparison: totCmp?.homepageSections.itemCtr ?? null,
        comparable: dComp.comparable,
        notes: [...dComp.reasons, "A rate — reported side by side, no change calculated."],
      },
    },
  };
}

// ── Customer success ────────────────────────────────────────────────────────

async function buildCustomerSuccess(deps: ScoutReportDeps, asOf: string, weekly: WeeklyVenueViews | null, usageIssueKind: IssueKind | null, ctx: SectionCtx) {
  const plan = await deps.milestones.computeDecisions();
  const ids = plan.entries.map((e) => e.venue.id);
  const direct = await deps.milestones.directVenueViews(ids);
  verifyReaderCounts(plan.entries.map((e) => ({ venueId: e.venue.id, currentViews: e.currentViews })), direct);
  const [events, names] = await Promise.all([deps.milestones.loadEvents(ids), deps.resolveNames({ venueIds: ids })]);
  if (!weekly) {
    ctx.issues.push({
      part: "Recent weekly views",
      message: "Unavailable because the product usage section could not be read.",
      kind: usageIssueKind ?? "unknown",
      retryAdvice: "Depends on the product usage section — follow that section's retry advice.",
    });
  }

  const eventsByVenue = new Map<string, MilestoneEventRow[]>();
  for (const e of events) {
    const list = eventsByVenue.get(e.venue_id) ?? [];
    list.push(e);
    eventsByVenue.set(e.venue_id, list);
  }
  const name = (id: string) => names.venues.get(id) ?? null;
  const recent = (id: string) =>
    weekly ? { reportingWeek: weekly.current.get(id) ?? 0, comparisonWeek: weekly.comparison.get(id) ?? 0 } : null;

  const approaching: Record<string, unknown>[] = [];
  const beyondMaximum: { venueId: string; venueName: string | null; allTimeViews: number }[] = [];
  const crossedNotYetRecorded: Record<string, unknown>[] = [];
  for (const e of plan.entries) {
    const id = e.venue.id;
    const p = milestoneProgress(e.currentViews);
    const recorded = (eventsByVenue.get(id) ?? []).slice().sort((a, b) => (b.milestone_value ?? 0) - (a.milestone_value ?? 0));
    if (p.approaching) {
      approaching.push({
        venueId: id,
        venueName: name(id),
        allTimeViews: e.currentViews,
        highestMilestoneReached: p.highestReached,
        nextMilestone: p.next,
        viewsRemaining: p.remaining,
        recentWeeklyViews: recent(id),
        lastRecordedMilestone: recorded[0] ? describeCommunication(recorded[0]) : null,
      });
    }
    if (p.beyondMaximum) beyondMaximum.push({ venueId: id, venueName: name(id), allTimeViews: e.currentViews });
    if (e.decision.newlyPending !== null || e.decision.newlySuperseded.length > 0 || e.decision.baselineNeeded) {
      crossedNotYetRecorded.push({
        venueId: id,
        venueName: name(id),
        allTimeViews: e.currentViews,
        detectorWouldRecordPending: e.decision.newlyPending,
        detectorWouldRecordSuperseded: e.decision.newlySuperseded,
        firstObservation: e.decision.baselineNeeded,
        note: e.decision.baselineNeeded
          ? "Not yet observed by the hourly detector. On first observation, milestones already passed are recorded as history (superseded), not sent."
          : "Crossed since the hourly detector last ran; it will record this on its next run. This report records nothing.",
      });
    }
  }
  approaching.sort((a, b) => (a.viewsRemaining as number) - (b.viewsRemaining as number) || String(a.venueName ?? "").localeCompare(String(b.venueName ?? "")));

  const earnedNotSent: (MilestoneCommunication & { venueId: string; venueName: string | null })[] = events
    .filter((e) => isEarnedNotSent(e.communication_status))
    .map((e) => ({ venueId: e.venue_id, venueName: name(e.venue_id), ...describeCommunication(e) }))
    .sort((a, b) => (a.venueName ?? "").localeCompare(b.venueName ?? "") || a.milestone - b.milestone);

  const statusCounts: Record<string, number> = {};
  for (const e of events) statusCounts[e.communication_status] = (statusCounts[e.communication_status] ?? 0) + 1;

  return {
    asOf,
    rule: "Approaching = views remaining to the next threshold are positive and no more than 10% of that threshold. Already-earned milestones are listed separately by their recorded status.",
    thresholds: [...VENUE_VIEW_MILESTONES],
    eligibility: "Published, verified and operator-owned venues (Customer Success eligibility, unchanged).",
    eligibleVenues: plan.venuesEvaluated,
    ineligibleVenues: plan.venuesIgnoredIneligible,
    approaching: { count: approaching.length, rows: approaching },
    earnedNotSent: { note: "Milestone communications recorded as pending or failed. Shown for review only — this report never sends, retries or changes them.", count: earnedNotSent.length, rows: earnedNotSent },
    crossedNotYetRecorded: { count: crossedNotYetRecorded.length, rows: crossedNotYetRecorded },
    beyondMaximum: { count: beyondMaximum.length, rows: beyondMaximum },
    recordedStatusCounts: statusCounts,
    recentWeeklyViewsNote:
      "Recent weekly views use the same counting rule as the all-time count, but cover only one week each. They are context, not a prediction.",
  };
}

// ── Report ──────────────────────────────────────────────────────────────────

export type ScoutReport = Awaited<ReturnType<typeof buildScoutReport>>;

const localStamp = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export async function buildScoutReport(opts: { now: Date; deps?: ScoutReportDeps }) {
  const now = opts.now; // captured once by the caller
  const deps = opts.deps ?? createDefaultScoutReportDeps();
  const generatedAt = now.toISOString();
  const windows = computeReportWindows(now);

  const usageOut: { weeklyVenueViews: WeeklyVenueViews | null } = { weeklyVenueViews: null };
  const productUsage = await runSection((ctx) => buildProductUsage(deps, windows, generatedAt, ctx, usageOut));
  const [searchDiscovery, customerSuccess] = await Promise.all([
    runSection((ctx) => buildSearchDiscovery(deps, windows, ctx)),
    runSection((ctx) => buildCustomerSuccess(deps, generatedAt, usageOut.weeklyVenueViews, productUsage.issues[0]?.kind ?? null, ctx)),
  ]);

  const sections = { productUsage, searchDiscovery, customerSuccess };
  const incompleteSections = (Object.keys(sections) as (keyof typeof sections)[]).filter((k) => sections[k].status !== "complete");

  const pu = productUsage.data;
  const sd = searchDiscovery.data;
  const cs = customerSuccess.data;
  const unavailable = (section: string): MetricComparison => ({
    current: null,
    comparison: null,
    absoluteChange: null,
    percentChange: null,
    comparable: false,
    notes: [`The ${section} section could not be read — value unavailable.`],
  });
  const headlines = {
    venueViews: pu ? pu.venueViews.change : unavailable("product usage"),
    eventViews: pu ? pu.eventViews.change : unavailable("product usage"),
    dailySpecialClicks: pu ? pu.dailySpecialClicks.change : unavailable("product usage"),
    intentActions: pu ? pu.intentActions.total : unavailable("product usage"),
    saves: pu ? pu.saves.change : unavailable("product usage"),
    typedSearches: sd ? sd.changes.typedSearches : unavailable("Search & Discovery"),
    urlLandings: sd ? sd.changes.urlLandings : unavailable("Search & Discovery"),
    typedZeroResultSearches: sd ? sd.changes.typedZeroResultSearches : unavailable("Search & Discovery"),
    homepageImpressions: sd ? sd.changes.homepageImpressions : unavailable("Search & Discovery"),
    homepageItemCtr: sd ? sd.changes.homepageItemCtr : { current: null, comparison: null, comparable: false, notes: ["The Search & Discovery section could not be read — value unavailable."] },
    venuesApproachingMilestone: cs ? cs.approaching.count : null,
    milestoneCommunicationsPendingOrFailed: cs ? cs.earnedNotSent.count : null,
  };

  const completeness = describeCompleteness(sections, unavailableMetrics(pu, sd));

  return {
    schemaVersion: SCOUT_REPORT_SCHEMA_VERSION,
    reportType: "product_usage_and_discovery",
    status: incompleteSections.length === 0 ? ("complete" as const) : ("incomplete" as const),
    incompleteSections,
    completeness,
    generatedAt,
    generatedAtLocal: localStamp.format(now),
    timeZone: REPORT_TIME_ZONE,
    windows: {
      current: windows.current,
      comparison: windows.comparison,
      snapshot: { asOf: generatedAt, description: "All-time totals and milestone state as of generation." },
    },
    summary: { headlines },
    sourcePolicies: SOURCE_POLICY_SUMMARY,
    definitions: METRIC_DEFINITIONS,
    limitations: LIMITATIONS,
    sections,
  };
}

// ── Completeness ────────────────────────────────────────────────────────────

const SECTION_LABELS = { productUsage: "Product usage", searchDiscovery: "Search & Discovery", customerSuccess: "Customer success" } as const;

export type UnavailableMetric = { metric: string; window: "current" | "comparison"; reason: string | null };

/** Metrics with no data for a window (coverage "unavailable"). Expected, not a failure — they don't make the report incomplete. */
export function unavailableMetrics(
  pu: { venueViews: WeeklyMetric; eventViews: WeeklyMetric; dailySpecialClicks: WeeklyMetric; saves: WeeklyMetric; intentActions: { byType: Record<string, WeeklyMetric> } } | null,
  sd: { coverage: { search: Record<"current" | "comparison", Coverage>; discovery: Record<"current" | "comparison", Coverage> } } | null
): UnavailableMetric[] {
  const out: UnavailableMetric[] = [];
  const add = (metric: string, m: { current: { coverage: Coverage }; comparison: { coverage: Coverage } }) => {
    for (const w of ["current", "comparison"] as const) if (m[w].coverage.status === "unavailable") out.push({ metric, window: w, reason: m[w].coverage.note });
  };
  if (pu) {
    add("Venue views", pu.venueViews);
    add("Event views", pu.eventViews);
    add("Daily Specials clicks", pu.dailySpecialClicks);
    for (const [t, m] of Object.entries(pu.intentActions.byType)) add(`Intent: ${t}`, m);
    add("Saves", pu.saves);
  }
  if (sd) {
    for (const [k, label] of [["search", "Search"], ["discovery", "Homepage & guide discovery"]] as const) {
      for (const w of ["current", "comparison"] as const) if (sd.coverage[k][w].status === "unavailable") out.push({ metric: label, window: w, reason: sd.coverage[k][w].note });
    }
  }
  return out;
}

export function describeCompleteness(sections: Record<keyof typeof SECTION_LABELS, ReportSection<unknown>>, unavailable: UnavailableMetric[]) {
  const keys = Object.keys(SECTION_LABELS) as (keyof typeof SECTION_LABELS)[];
  const perSection = Object.fromEntries(keys.map((k) => [k, { label: SECTION_LABELS[k], status: sections[k].status, issues: sections[k].issues }])) as Record<
    keyof typeof SECTION_LABELS,
    { label: string; status: SectionStatus; issues: ReportIssue[] }
  >;
  const issues = keys.flatMap((k) => sections[k].issues);
  const complete = keys.every((k) => sections[k].status === "complete");
  const transient = issues.filter((i) => i.kind === "transient");
  const unknown = issues.filter((i) => i.kind === "unknown");
  const retry: "not_needed" | "suggested" | "may_help" | "not_suggested" = complete
    ? "not_needed"
    : transient.length > 0
      ? "suggested"
      : unknown.length > 0
        ? "may_help"
        : "not_suggested";
  const names = (s: SectionStatus) => keys.filter((k) => sections[k].status === s).map((k) => SECTION_LABELS[k]);
  const guidance: string[] = [];
  if (complete) {
    guidance.push("All sections are complete.");
  } else {
    guidance.push("This report is INCOMPLETE. Do not present it as a complete weekly report.");
    const failed = names("failed");
    const partial = names("incomplete");
    const ok = names("complete");
    if (failed.length) guidance.push(`Failed (no data): ${failed.join(", ")}.`);
    if (partial.length) guidance.push(`Incomplete (some parts missing — see issues): ${partial.join(", ")}.`);
    if (ok.length) guidance.push(`Complete: ${ok.join(", ")}. These sections may be used, with the caveat that other parts of the report are missing.`);
    guidance.push(
      retry === "suggested"
        ? "At least one failure looks temporary — one retry in a few minutes may produce a complete report."
        : retry === "may_help"
          ? "The cause of at least one failure is unclear — one retry is reasonable; if it fails the same way, report the issue instead of retrying again."
          : "None of the failures look temporary — retrying is unlikely to help. Report the listed issues."
    );
  }
  if (unavailable.length) {
    guidance.push("Metrics listed under unavailableMetrics have no data for that week (for example, tracking began later or collection isn't established). That is expected, does not make the report incomplete, and their values are null — never treat them as zero.");
  }
  return { status: complete ? ("complete" as const) : ("incomplete" as const), sections: perSection, retry, unavailableMetrics: unavailable, guidance };
}

export function scoutReportFilename(report: Pick<ScoutReport, "windows" | "generatedAt" | "status">): string {
  const gen = vancouverDateKey(report.generatedAt);
  const base = `hhc-scout-report_${report.windows.current.startDate}_to_${report.windows.current.endDateInclusive}_generated-${gen}`;
  return `${base}${report.status === "complete" ? "" : "_INCOMPLETE"}.json`;
}
