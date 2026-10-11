/**
 * Search Demand metrics — pure functions over website_search_events rows.
 * See docs/analytics/SEARCH_DISCOVERY_TRACKING.md for the definitions.
 *
 * New tracking (production/staging) — ranked per origin, never combined:
 *   typed        = the visitor typed the search (default ranking)
 *   url          = the page opened with ?q= (often an external/shared link —
 *                  ranked separately; sessions never added to typed)
 *   history      = Back/Forward re-displays — shown, never ranked
 *   hero handoff = origin 'hero_see_all' on the listing page; the hero row
 *                  for the same search is already counted — shown, never ranked
 *   unknown      = rows with no origin (a browser still running the pre-110
 *                  bundle) — shown separately, never ranked
 *   zero-result  = ranked-origin row with result_count 0, other_filters_active not
 *                  true, and a full (uncapped) count. Zero with other filters
 *                  on is reported separately (the filters, not the term, may
 *                  have emptied the results).
 * Ranking is by distinct searching tab sessions (session_id = one browser
 * tab, not a person).
 *
 * Legacy (environment NULL, before migration 110): captured after a 200ms
 * pause, so partial words were logged. collapseLegacyPrefixes() drops a row
 * when the same tab + surface searched a longer extension of it within 30s.
 * Origin, mode and environment are unknown; hero counts were capped at 8.
 */

import { isReleaseQaSession, vancouverDateKey } from "./config";

export type SearchRow = {
  id: string;
  search_term: string;
  surface: string;
  mode: string | null;
  origin: string | null;
  result_count: number;
  result_count_capped: boolean | null;
  other_filters_active: boolean | null;
  session_id: string;
  searched_at: string;
};

/**
 * Which origin a ranking is computed for. Typed and URL-initialized searches
 * are ranked separately and their session totals are never combined: a typed
 * search is what a visitor asked for on the site, a `?q=` landing is often
 * an external or shared link (one link can bring many identical sessions).
 */
export type RankedOrigin = "typed" | "url";

export type SearchTermStat = {
  term: string;
  /** Distinct tab sessions with ≥1 search of the ranked origin. */
  rankedSessions: number;
  /** Searches of the ranked origin. */
  rankedEvents: number;
  typedEvents: number;
  urlEvents: number;
  historyEvents: number;
  heroHandoffEvents: number;
  unknownOriginEvents: number;
  /** Zero-result searches of the ranked origin (full count, no other filters). */
  zeroResultEvents: number;
  zeroResultSessions: number;
  /** Zero-result searches of the ranked origin while other filters were on. */
  zeroWithFiltersEvents: number;
  lastSeen: string;
  modes: string[];
  surfaces: string[];
};

export type SearchDemandReport = {
  rankedOrigin: RankedOrigin;
  rowsAnalysed: number;
  rankedEvents: number;
  rankedSessions: number;
  distinctTerms: number;
  zeroResultEvents: number;
  originCounts: { typed: number; url: number; history: number; hero_see_all: number; unknown: number };
  terms: SearchTermStat[];
  zeroResultTerms: SearchTermStat[];
  daily: { day: string; events: number }[];
};

export function normalizeTermKey(term: string): string {
  return term.trim().replace(/\s+/g, " ").toLowerCase();
}

type OriginBucket = "typed" | "url" | "history" | "hero_see_all" | "unknown";
function originBucket(origin: string | null): OriginBucket {
  return origin === "typed" || origin === "url" || origin === "history" || origin === "hero_see_all" ? origin : "unknown";
}

/** A zero that reflects the term itself: full (uncapped) count and no other filters narrowing it. */
export function isZeroResult(row: Pick<SearchRow, "result_count" | "result_count_capped" | "other_filters_active">): boolean {
  return row.result_count === 0 && row.other_filters_active !== true && row.result_count_capped !== true;
}

export function aggregateSearchDemand(
  rows: SearchRow[],
  filters: { mode?: string | null; surface?: string | null; rankedOrigin?: RankedOrigin } = {}
): SearchDemandReport {
  const rankedOrigin: RankedOrigin = filters.rankedOrigin ?? "typed";
  const kept = rows.filter(
    (r) =>
      !isReleaseQaSession(r.session_id) &&
      (!filters.mode || r.mode === filters.mode) &&
      (!filters.surface || r.surface === filters.surface)
  );

  const originCounts = { typed: 0, url: 0, history: 0, hero_see_all: 0, unknown: 0 };
  const byTerm = new Map<string, {
    stat: SearchTermStat;
    rankedSessions: Set<string>;
    zeroSessions: Set<string>;
    modes: Set<string>;
    surfaces: Set<string>;
  }>();
  const rankedSessions = new Set<string>();
  const daily = new Map<string, number>();
  let rankedEvents = 0;
  let zeroResultEvents = 0;

  for (const r of kept) {
    const b = originBucket(r.origin);
    originCounts[b]++;
    const key = normalizeTermKey(r.search_term);
    let t = byTerm.get(key);
    if (!t) {
      t = {
        stat: {
          term: key, rankedSessions: 0, rankedEvents: 0, typedEvents: 0, urlEvents: 0, historyEvents: 0,
          heroHandoffEvents: 0, unknownOriginEvents: 0, zeroResultEvents: 0, zeroResultSessions: 0,
          zeroWithFiltersEvents: 0, lastSeen: r.searched_at, modes: [], surfaces: [],
        },
        rankedSessions: new Set(), zeroSessions: new Set(), modes: new Set(), surfaces: new Set(),
      };
      byTerm.set(key, t);
    }
    const s = t.stat;
    if (r.searched_at > s.lastSeen) s.lastSeen = r.searched_at;
    t.modes.add(r.mode ?? "unknown");
    t.surfaces.add(r.surface);
    if (b === "typed") s.typedEvents++;
    else if (b === "url") s.urlEvents++;
    else if (b === "history") s.historyEvents++;
    else if (b === "hero_see_all") s.heroHandoffEvents++;
    else s.unknownOriginEvents++;

    if (b !== rankedOrigin) continue;
    s.rankedEvents++;
    rankedEvents++;
    t.rankedSessions.add(r.session_id);
    rankedSessions.add(r.session_id);
    const day = vancouverDateKey(r.searched_at);
    daily.set(day, (daily.get(day) ?? 0) + 1);
    if (isZeroResult(r)) {
      s.zeroResultEvents++;
      zeroResultEvents++;
      t.zeroSessions.add(r.session_id);
    } else if (r.result_count === 0 && r.other_filters_active === true) {
      s.zeroWithFiltersEvents++;
    }
  }

  const terms = [...byTerm.values()].map((t) => ({
    ...t.stat,
    rankedSessions: t.rankedSessions.size,
    zeroResultSessions: t.zeroSessions.size,
    modes: [...t.modes].sort(),
    surfaces: [...t.surfaces].sort(),
  }));
  const rank = (a: SearchTermStat, b: SearchTermStat) =>
    b.rankedSessions - a.rankedSessions || b.rankedEvents - a.rankedEvents || a.term.localeCompare(b.term);
  const ranked = terms.filter((t) => t.rankedEvents > 0);

  return {
    rankedOrigin,
    rowsAnalysed: kept.length,
    rankedEvents,
    rankedSessions: rankedSessions.size,
    distinctTerms: ranked.length,
    zeroResultEvents,
    originCounts,
    terms: ranked.sort(rank),
    zeroResultTerms: terms
      .filter((t) => t.zeroResultEvents > 0)
      .sort((a, b) => b.zeroResultSessions - a.zeroResultSessions || b.zeroResultEvents - a.zeroResultEvents || a.term.localeCompare(b.term)),
    daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, events: n })),
  };
}

// ── Legacy ──────────────────────────────────────────────────────────────────

export const LEGACY_PREFIX_WINDOW_MS = 30_000;

/**
 * Drops a legacy row when the same tab + surface searched a longer
 * extension of it (case-insensitive) within 30 seconds — the old 200ms
 * capture logged each partial word ("b", "bo", "bos"…).
 */
export function collapseLegacyPrefixes(rows: SearchRow[]): SearchRow[] {
  const groups = new Map<string, SearchRow[]>();
  for (const r of rows) {
    const k = `${r.session_id}|${r.surface}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const kept: SearchRow[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.searched_at.localeCompare(b.searched_at));
    for (let i = 0; i < g.length; i++) {
      const cur = normalizeTermKey(g[i].search_term);
      const next = g[i + 1];
      if (next) {
        const nt = normalizeTermKey(next.search_term);
        const gap = new Date(next.searched_at).getTime() - new Date(g[i].searched_at).getTime();
        if (nt !== cur && nt.startsWith(cur) && gap >= 0 && gap < LEGACY_PREFIX_WINDOW_MS) continue;
      }
      kept.push(g[i]);
    }
  }
  return kept;
}

export type LegacyTermStat = {
  term: string;
  sessions: number;
  events: number;
  zeroResultEvents: number;
  singleSearchSessions: number;
  lastSeen: string;
  surfaces: string[];
};

export type LegacySearchReport = {
  rawRows: number;
  collapsedRows: number;
  prefixRowsRemoved: number;
  sessions: number;
  terms: LegacyTermStat[];
  zeroResultTerms: LegacyTermStat[];
};

/**
 * Legacy search report (environment NULL rows only). Every collapsed row is
 * counted — origin is unknown, so URL landings and typed searches can't be
 * separated. "Single-search sessions" (tabs whose only legacy search was
 * this term) is shown so repeated-link patterns are visible without being
 * removed.
 */
export function aggregateLegacySearch(rows: SearchRow[], filters: { surface?: string | null } = {}): LegacySearchReport {
  const scoped = rows.filter((r) => !isReleaseQaSession(r.session_id) && (!filters.surface || r.surface === filters.surface));
  const collapsed = collapseLegacyPrefixes(scoped);
  const rowsPerSession = new Map<string, number>();
  for (const r of collapsed) rowsPerSession.set(r.session_id, (rowsPerSession.get(r.session_id) ?? 0) + 1);

  const byTerm = new Map<string, { s: LegacyTermStat; sessions: Set<string>; single: Set<string>; surfaces: Set<string> }>();
  for (const r of collapsed) {
    const key = normalizeTermKey(r.search_term);
    let t = byTerm.get(key);
    if (!t) {
      t = { s: { term: key, sessions: 0, events: 0, zeroResultEvents: 0, singleSearchSessions: 0, lastSeen: r.searched_at, surfaces: [] }, sessions: new Set(), single: new Set(), surfaces: new Set() };
      byTerm.set(key, t);
    }
    t.s.events++;
    if (r.result_count === 0) t.s.zeroResultEvents++;
    if (r.searched_at > t.s.lastSeen) t.s.lastSeen = r.searched_at;
    t.sessions.add(r.session_id);
    if (rowsPerSession.get(r.session_id) === 1) t.single.add(r.session_id);
    t.surfaces.add(r.surface);
  }
  const terms = [...byTerm.values()].map((t) => ({ ...t.s, sessions: t.sessions.size, singleSearchSessions: t.single.size, surfaces: [...t.surfaces].sort() }));
  const rank = (a: LegacyTermStat, b: LegacyTermStat) => b.sessions - a.sessions || b.events - a.events || a.term.localeCompare(b.term);
  return {
    rawRows: scoped.length,
    collapsedRows: collapsed.length,
    prefixRowsRemoved: scoped.length - collapsed.length,
    sessions: new Set(collapsed.map((r) => r.session_id)).size,
    terms: terms.sort(rank),
    zeroResultTerms: terms.filter((t) => t.zeroResultEvents > 0).sort(rank),
  };
}
