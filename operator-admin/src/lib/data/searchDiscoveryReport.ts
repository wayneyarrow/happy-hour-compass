/**
 * Data loading for the Founder Control Panel "Search & Discovery" report
 * (/control-panel/analytics/search-discovery). Server-only: every read uses
 * createAdminClient(), and the page sits behind the Control Panel layout's
 * admin allowlist.
 *
 * ── Completeness ────────────────────────────────────────────────────────────
 * PostgREST returns at most 1,000 rows per request (verified 2026-10-11), and
 * the report's metrics (distinct page views, matched combinations) need
 * row-level data. fetchAllRows() therefore:
 *   1. takes an exact COUNT for the same filters,
 *   2. refuses (ReportTooLargeError) if it exceeds MAX_ROWS_PER_READ,
 *   3. reads every page (1,000 rows, ordered, a few in parallel),
 *   4. verifies rows read = count, ids unique, and an unchanged re-count
 *      (retry once, else IncompleteReadError) — see its doc comment.
 * The window's upper bound is fixed 30s in the past (resolveRange) so rows
 * still being written can't shift pages. Totals are therefore either
 * complete or an explicit error — never silently truncated. When a range
 * outgrows the ceiling, move the aggregation into SQL (see the report's
 * "Decisions" note / docs/analytics/SEARCH_DISCOVERY_TRACKING.md).
 *
 * Legacy load rows (venue_discover_events impressions, ~53k rows) are never
 * read row-by-row: they are COUNTed per rail with exact head counts.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { COUNTED_VIEW_ENVIRONMENT_FILTER } from "@/lib/analyticsEnvironment";
import { qaSessionNotInFilter, type ReportSource } from "@/lib/searchDiscoveryReporting/config";
import type { SearchRow } from "@/lib/searchDiscoveryReporting/searchMetrics";
import type { DiscoveryRow, ItemVenueMap, LegacyClickRow } from "@/lib/searchDiscoveryReporting/placementMetrics";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

export const PAGE_SIZE = 1000;
export const MAX_ROWS_PER_READ = 150_000;
const PAGE_CONCURRENCY = 6;

export class ReportTooLargeError extends Error {
  constructor(public table: string, public rows: number) {
    super(`${table}: ${rows.toLocaleString()} rows in this range exceeds the ${MAX_ROWS_PER_READ.toLocaleString()}-row limit for complete in-app aggregation.`);
  }
}
export class IncompleteReadError extends Error {
  constructor(public table: string, public expected: number, public read: number) {
    super(`${table}: read ${read.toLocaleString()} of ${expected.toLocaleString()} rows — totals would be incomplete, so nothing is shown. Refresh to retry.`);
  }
}

/**
 * Reads every row matching `filter` (applied identically to every count and
 * page). `order` must be deterministic (end with a unique column) and
 * `columns` must include `id`.
 *
 * Read consistency (offset pagination, so pages could shift if rows were
 * added to or removed from the window mid-read):
 *   1. exact COUNT before reading;
 *   2. every page read (in parallel);
 *   3. rows read must equal that count AND every id must be unique;
 *   4. exact COUNT again after reading — it must be unchanged.
 * Any concurrent change inside the window therefore surfaces as a mismatch
 * (never as silently missing or duplicated rows); the read is retried once,
 * then IncompleteReadError is shown. Normal tracking inserts can't trigger
 * this: the window ends 30s before the request (resolveRange) and
 * occurred_at/searched_at are set by the database at insert time, so new
 * rows fall after `until`. Only a write held open >30s, a back-dated row
 * or a deletion inside the window could — the visible result is a
 * temporary "refresh to retry" error, never wrong totals.
 */
export async function fetchAllRows<T extends { id: unknown }>(
  admin: Admin,
  table: string,
  columns: string,
  filter: (q: Query) => Query,
  order: string[],
  attempt = 1
): Promise<T[]> {
  const count = async () => {
    const res = await filter(admin.from(table).select("*", { count: "exact", head: true }));
    if (res.error) throw new Error(`${table} count failed: ${res.error.message}`);
    return (res.count ?? 0) as number;
  };
  const total = await count();
  if (total > MAX_ROWS_PER_READ) throw new ReportTooLargeError(table, total);
  if (total === 0) return [];

  const pages = Math.ceil(total / PAGE_SIZE);
  const results: T[][] = new Array(pages);
  let next = 0;
  async function worker() {
    while (next < pages) {
      const i = next++;
      let q = filter(admin.from(table).select(columns));
      for (const col of order) q = q.order(col, { ascending: true });
      const res = await q.range(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE - 1);
      if (res.error) throw new Error(`${table} page ${i} failed: ${res.error.message}`);
      results[i] = res.data as T[];
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pages) }, worker));
  const rows = results.flat();
  const uniqueIds = new Set(rows.map((r) => r.id)).size;
  const after = await count();
  if (rows.length !== total || uniqueIds !== rows.length || after !== total) {
    if (attempt < 2) return fetchAllRows<T>(admin, table, columns, filter, order, attempt + 1);
    throw new IncompleteReadError(table, total, uniqueIds);
  }
  return rows;
}

const withinRange = (col: string, since: string | null, until: string) => (q: Query) => {
  let out = q.lte(col, until);
  if (since) out = out.gte(col, since);
  return out;
};
const notQa = (q: Query) => q.not("session_id", "in", qaSessionNotInFilter());

// ── Collection start ────────────────────────────────────────────────────────

export type CollectionStarts = {
  /** First recorded event for the source and view, including release-QA rows — when tracking began. */
  tracking: { search: string | null; discovery: string | null };
  /** First event that counts in reports (release-QA sessions excluded). */
  firstQualifying: { search: string | null; discovery: string | null };
};

/**
 * Tracking start vs first qualifying event, per view. New sources: the new
 * tracking only (search rows from the new client, i.e. mode set). Legacy:
 * environment-NULL search rows; all of venue_discover_events.
 */
export async function getCollectionStarts(source: ReportSource): Promise<CollectionStarts> {
  const admin = createAdminClient();
  const first = async (table: string, col: string, f: (q: Query) => Query) => {
    const res = await f(admin.from(table).select(col)).order(col, { ascending: true }).limit(1).maybeSingle();
    if (res.error) throw new Error(`${table} start lookup failed: ${res.error.message}`);
    return (res.data?.[col] as string | undefined) ?? null;
  };
  const searchScope = (q: Query) => (source === "legacy" ? q.is("environment", null) : q.eq("environment", source).not("mode", "is", null));
  // venue_discover_events is legacy in its entirety (mixed environments:
  // pre-110 website rows are NULL; consumer-app / old-tab rows since carry a label).
  const discoveryTable = source === "legacy" ? "venue_discover_events" : "website_discovery_events";
  const discoveryScope = (q: Query) => (source === "legacy" ? q : q.eq("environment", source));
  const [trackSearch, trackDiscovery, qualSearch, qualDiscovery] = await Promise.all([
    first("website_search_events", "searched_at", searchScope),
    first(discoveryTable, "occurred_at", discoveryScope),
    first("website_search_events", "searched_at", (q) => notQa(searchScope(q))),
    first(discoveryTable, "occurred_at", (q) => notQa(discoveryScope(q))),
  ]);
  return {
    tracking: { search: trackSearch, discovery: trackDiscovery },
    firstQualifying: { search: qualSearch, discovery: qualDiscovery },
  };
}

// ── Search ──────────────────────────────────────────────────────────────────

const SEARCH_COLUMNS = "id, search_term, surface, mode, origin, result_count, result_count_capped, other_filters_active, session_id, searched_at";

/** New tracking: every row for the environment (new-client rows and old-bundle rows with no origin). Legacy: environment NULL only. */
export async function loadSearchRows(source: ReportSource, since: string | null, until: string): Promise<SearchRow[]> {
  const admin = createAdminClient();
  const env = (q: Query) => (source === "legacy" ? q.is("environment", null) : q.eq("environment", source));
  return fetchAllRows<SearchRow>(
    admin,
    "website_search_events",
    SEARCH_COLUMNS,
    (q) => notQa(withinRange("searched_at", since, until)(env(q))),
    ["searched_at", "id"]
  );
}

// ── Discovery (new tracking) ────────────────────────────────────────────────

const DISCOVERY_COLUMNS =
  "id, event_type, surface, page_view_id, session_id, section_id, section_kind, guide_id, guide_block, item_type, item_id, position, mode, occurred_at";

export async function loadDiscoveryRows(source: Exclude<ReportSource, "legacy">, since: string | null, until: string): Promise<DiscoveryRow[]> {
  const admin = createAdminClient();
  return fetchAllRows<DiscoveryRow>(
    admin,
    "website_discovery_events",
    DISCOVERY_COLUMNS,
    (q) => notQa(withinRange("occurred_at", since, until)(q.eq("environment", source))),
    ["occurred_at", "id"]
  );
}

// ── Name resolution ─────────────────────────────────────────────────────────

export type SectionInfo = { title: string; kind: string; homepage: string | null; enabled: boolean; homepagePublished: boolean };
export type NameMaps = {
  sections: Map<string, SectionInfo>;
  guides: Map<string, { title: string; slug: string }>;
  venues: Map<string, string>;
  events: Map<string, { title: string; venueId: string | null }>;
  specials: Map<string, { title: string; venueId: string | null }>;
  guideBySlug: Map<string, string>;
};

async function inChunks<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await fn(ids.slice(i, i + 100))));
  return out;
}

export async function resolveNames(ids: {
  sectionIds?: Iterable<string>;
  guideIds?: Iterable<string>;
  venueIds?: Iterable<string>;
  eventIds?: Iterable<string>;
  specialIds?: Iterable<string>;
  guideSlugs?: Iterable<string>;
}): Promise<NameMaps> {
  const admin = createAdminClient();
  const uniq = (it?: Iterable<string>) => [...new Set(it ?? [])].filter(Boolean);
  const sectionIds = uniq(ids.sectionIds);
  const specialIds = uniq(ids.specialIds);
  const eventIds = uniq(ids.eventIds);
  const guideSlugs = uniq(ids.guideSlugs);

  const [sections, specials, events, guidesBySlug, history] = await Promise.all([
    inChunks(sectionIds, async (c) => {
      const r = await admin.from("homepage_sections").select("id, title, section_type, content_mode, is_enabled, homepages(name, status)").in("id", c);
      if (r.error) throw new Error(`homepage_sections: ${r.error.message}`);
      return r.data ?? [];
    }),
    inChunks(specialIds, async (c) => {
      const r = await admin.from("daily_specials").select("id, title, venue_id").in("id", c);
      if (r.error) throw new Error(`daily_specials: ${r.error.message}`);
      return r.data ?? [];
    }),
    inChunks(eventIds, async (c) => {
      const r = await admin.from("events").select("id, title, venue_id").in("id", c);
      if (r.error) throw new Error(`events: ${r.error.message}`);
      return r.data ?? [];
    }),
    inChunks(guideSlugs, async (c) => {
      const r = await admin.from("content_guides").select("id, slug").in("slug", c);
      if (r.error) throw new Error(`content_guides: ${r.error.message}`);
      return r.data ?? [];
    }),
    inChunks(guideSlugs, async (c) => {
      const r = await admin.from("content_guide_slug_history").select("guide_id, old_slug").in("old_slug", c);
      if (r.error) throw new Error(`content_guide_slug_history: ${r.error.message}`);
      return r.data ?? [];
    }),
  ]);

  const guideBySlug = new Map<string, string>();
  for (const h of history as { guide_id: string; old_slug: string }[]) guideBySlug.set(h.old_slug, h.guide_id);
  for (const g of guidesBySlug as { id: string; slug: string }[]) guideBySlug.set(g.slug, g.id);

  const specialsMap = new Map((specials as { id: string; title: string; venue_id: string | null }[]).map((s) => [s.id, { title: s.title, venueId: s.venue_id }]));
  const eventsMap = new Map((events as { id: string; title: string; venue_id: string | null }[]).map((e) => [e.id, { title: e.title, venueId: e.venue_id }]));

  const guideIds = uniq([...(ids.guideIds ?? []), ...guideBySlug.values()]);
  const venueIds = uniq([
    ...(ids.venueIds ?? []),
    ...[...specialsMap.values()].map((s) => s.venueId ?? ""),
    ...[...eventsMap.values()].map((e) => e.venueId ?? ""),
  ]);
  const [guides, venues] = await Promise.all([
    inChunks(guideIds, async (c) => {
      const r = await admin.from("content_guides").select("id, title, slug").in("id", c);
      if (r.error) throw new Error(`content_guides: ${r.error.message}`);
      return r.data ?? [];
    }),
    inChunks(venueIds, async (c) => {
      const r = await admin.from("venues").select("id, name").in("id", c);
      if (r.error) throw new Error(`venues: ${r.error.message}`);
      return r.data ?? [];
    }),
  ]);

  return {
    sections: new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sections as any[]).map((s) => [
        s.id,
        {
          title: s.title,
          kind: `${s.section_type}_${s.content_mode}`,
          homepage: s.homepages?.name ?? null,
          enabled: !!s.is_enabled,
          homepagePublished: s.homepages?.status === "published",
        },
      ])
    ),
    guides: new Map((guides as { id: string; title: string; slug: string }[]).map((g) => [g.id, { title: g.title, slug: g.slug }])),
    venues: new Map((venues as { id: string; name: string }[]).map((v) => [v.id, v.name])),
    events: eventsMap,
    specials: specialsMap,
    guideBySlug,
  };
}

/** item key → venue id, for Daily Special and Event cards. */
export function buildItemVenueMap(names: NameMaps): ItemVenueMap {
  const m: ItemVenueMap = new Map();
  for (const [id, s] of names.specials) if (s.venueId) m.set(`daily_special:${id}`, s.venueId);
  for (const [id, e] of names.events) if (e.venueId) m.set(`event:${id}`, e.venueId);
  return m;
}

// ── Venue page views (production + legacy) ──────────────────────────────────

/** Venue page views from any source: legacy (NULL) + production rows (the migration-111 rule). Not attributed to discovery. */
export async function countVenueViews(venueId: string, since: string | null, until: string): Promise<number | null> {
  const admin = createAdminClient();
  let q = admin
    .from("venue_view_events")
    .select("*", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .or(COUNTED_VIEW_ENVIRONMENT_FILTER)
    .not("session_id", "in", qaSessionNotInFilter())
    .lte("viewed_at", until);
  if (since) q = q.gte("viewed_at", since);
  const r = await q;
  return r.error ? null : r.count ?? 0;
}

// ── Legacy discovery (venue_discover_events) ────────────────────────────────

export const CONSUMER_APP_RAILS = ["spotlight", "patio_picks", "highly_rated", "featured_nearby", "new_this_week"];

/**
 * Legacy rails: exact load-row counts per rail (head counts — never read
 * row-by-row) and every click row. `unattributedLoadRows` is the gap
 * between the total and the per-rail counts (rails not in the candidate
 * list); it is shown, never hidden.
 */
export async function loadLegacyDiscovery(
  since: string | null,
  until: string,
  venueId?: string | null
): Promise<{ loadCounts: Map<string, number>; totalLoadRows: number; unattributedLoadRows: number; clicks: LegacyClickRow[]; railCandidates: string[] }> {
  const admin = createAdminClient();
  const scope = (q: Query) => {
    let out = notQa(withinRange("occurred_at", since, until)(q));
    if (venueId) out = out.eq("venue_id", venueId);
    return out;
  };
  const clicks = await fetchAllRows<LegacyClickRow & { id: string }>(
    admin,
    "venue_discover_events",
    "id, venue_id, rail_name, position, session_id, occurred_at",
    (q) => scope(q.eq("event_type", "click")),
    ["occurred_at", "id"]
  );

  const [sectionsRes, guidesRes, historyRes] = await Promise.all([
    admin.from("homepage_sections").select("id"),
    admin.from("content_guides").select("slug"),
    admin.from("content_guide_slug_history").select("old_slug"),
  ]);
  if (sectionsRes.error || guidesRes.error || historyRes.error) throw new Error("legacy rail candidates lookup failed");
  const candidates = new Set<string>([
    ...clicks.map((c) => c.rail_name),
    ...(sectionsRes.data ?? []).flatMap((s: { id: string }) => [`homepage_rail:${s.id}`, `homepage_feature:${s.id}`]),
    ...(guidesRes.data ?? []).map((g: { slug: string }) => `guide:${g.slug}`),
    ...(historyRes.data ?? []).map((h: { old_slug: string }) => `guide:${h.old_slug}`),
    "homepage_rail:todays-specials",
    ...CONSUMER_APP_RAILS,
  ]);
  const railCandidates = [...candidates];

  const countLoads = async (rail?: string) => {
    let q = scope(admin.from("venue_discover_events").select("*", { count: "exact", head: true }).eq("event_type", "impression"));
    if (rail) q = q.eq("rail_name", rail);
    const r = await q;
    if (r.error) throw new Error(`venue_discover_events count failed: ${r.error.message}`);
    return r.count ?? 0;
  };
  const total = await countLoads();
  const loadCounts = new Map<string, number>();
  let i = 0;
  async function worker() {
    while (i < railCandidates.length) {
      const rail = railCandidates[i++];
      const n = await countLoads(rail);
      if (n > 0) loadCounts.set(rail, n);
    }
  }
  await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, worker));
  const attributed = [...loadCounts.values()].reduce((a, b) => a + b, 0);
  return { loadCounts, totalLoadRows: total, unattributedLoadRows: total - attributed, clicks, railCandidates };
}

/** Human label for a legacy rail_name. */
export function legacyRailLabel(rail: string, names: NameMaps): string {
  if (rail === "homepage_rail:todays-specials") return "Today's Specials (pre-110 fixed rail name)";
  const [prefix, rest] = rail.includes(":") ? [rail.slice(0, rail.indexOf(":")), rail.slice(rail.indexOf(":") + 1)] : ["", rail];
  if (prefix === "homepage_rail" || prefix === "homepage_feature") {
    const s = names.sections.get(rest);
    const kind = prefix === "homepage_feature" ? "Feature" : "Rail";
    return s ? `${s.title} (${kind})` : `Deleted or unknown section · ${rest.slice(0, 8)} (${kind})`;
  }
  if (prefix === "guide") {
    const id = names.guideBySlug.get(rest);
    const g = id ? names.guides.get(id) : undefined;
    return g ? `Guide: ${g.title}` : `Guide (unknown slug): ${rest}`;
  }
  return prefix ? rail : `Consumer app: ${rail}`;
}

/** Every published venue (id, name) for the report's venue picker — complete via fetchAllRows. */
export async function listPublishedVenues(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  return fetchAllRows<{ id: string; name: string }>(admin, "venues", "id, name", (q) => q.eq("is_published", true), ["name", "id"]);
}
