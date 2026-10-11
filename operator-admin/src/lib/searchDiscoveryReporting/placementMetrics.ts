/**
 * Placement metrics — pure functions over website_discovery_events rows
 * (new, visibility-based tracking only; never venue_discover_events).
 * Definitions: docs/analytics/SEARCH_DISCOVERY_TRACKING.md.
 *
 * Combination ("combo") = page_view_id + placement + item. Placement is the
 * section (homepage), guide + block (guide pages) or the hero.
 *
 *   impressions          distinct impressed combos
 *   raw clicks           every item_click row (never a CTR numerator)
 *   matched clicked      distinct impressed combos with ≥1 item_click for the
 *                        same combo — matched by the join key, never by time,
 *                        so an impression that qualified after the click in
 *                        the same page view still matches
 *   item CTR             matched clicked ÷ impressions (null when 0 impressions)
 *   unmatched clicks     item_click rows whose combo has no impression
 *   exposed page views   distinct page views with a section_exposure
 *   engagement rate      exposed page views with ≥1 section click (item_click
 *                        or view_all_click) ÷ exposed page views
 *   clicks outside exposure  section clicks in page views with no exposure
 */

import { isReleaseQaSession } from "./config";

export type DiscoveryRow = {
  id: string;
  event_type: string;
  surface: string;
  page_view_id: string;
  session_id: string;
  section_id: string | null;
  section_kind: string | null;
  guide_id: string | null;
  guide_block: string | null;
  item_type: string | null;
  item_id: string | null;
  position: number | null;
  mode: string | null;
  occurred_at: string;
};

export function placementKeyOf(r: Pick<DiscoveryRow, "surface" | "section_id" | "guide_id" | "guide_block">): string {
  if (r.surface === "homepage_section") return `s:${r.section_id}`;
  if (r.surface === "guide") return `g:${r.guide_id}:${r.guide_block}`;
  return "hero";
}
export const itemKeyOf = (r: Pick<DiscoveryRow, "item_type" | "item_id">) => `${r.item_type}:${r.item_id}`;
const comboKeyOf = (r: DiscoveryRow) => `${r.page_view_id}|${placementKeyOf(r)}|${itemKeyOf(r)}`;

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function withoutQa(rows: DiscoveryRow[]): DiscoveryRow[] {
  return rows.filter((r) => !isReleaseQaSession(r.session_id));
}

export type ItemPerf = {
  impressions: number;
  rawClicks: number;
  matchedClicked: number;
  unmatchedClicks: number;
  ctr: number | null;
};

const emptyPerf = (): ItemPerf => ({ impressions: 0, rawClicks: 0, matchedClicked: 0, unmatchedClicks: 0, ctr: null });

/**
 * Item performance grouped by `groupOf(row)` (applied to impression rows for
 * impressions/matched, and to click rows for raw/unmatched clicks). Rows
 * that aren't item_impression / item_click are ignored.
 */
export function itemPerformance(rows: DiscoveryRow[], groupOf: (r: DiscoveryRow) => string | null): Map<string, ItemPerf> {
  const impressions = new Map<string, DiscoveryRow>(); // combo → first impression row
  const clickedCombos = new Set<string>();
  for (const r of rows) {
    if (r.event_type === "item_impression") {
      const k = comboKeyOf(r);
      if (!impressions.has(k)) impressions.set(k, r);
    } else if (r.event_type === "item_click") {
      clickedCombos.add(comboKeyOf(r));
    }
  }
  const out = new Map<string, ItemPerf>();
  const get = (g: string) => {
    let p = out.get(g);
    if (!p) out.set(g, (p = emptyPerf()));
    return p;
  };
  for (const [k, r] of impressions) {
    const g = groupOf(r);
    if (g === null) continue;
    const p = get(g);
    p.impressions++;
    if (clickedCombos.has(k)) p.matchedClicked++;
  }
  for (const r of rows) {
    if (r.event_type !== "item_click") continue;
    const g = groupOf(r);
    if (g === null) continue;
    const p = get(g);
    p.rawClicks++;
    if (!impressions.has(comboKeyOf(r))) p.unmatchedClicks++;
  }
  for (const p of out.values()) p.ctr = rate(p.matchedClicked, p.impressions);
  return out;
}

// ── Homepage sections ───────────────────────────────────────────────────────

export type SectionStat = ItemPerf & {
  sectionId: string;
  sectionKind: string | null;
  exposedPageViews: number;
  clickingPageViews: number;
  engagedExposedPageViews: number;
  engagementRate: number | null;
  clicksOutsideExposure: number;
  viewAllClicks: number;
};

export function aggregateSections(rows: DiscoveryRow[]): SectionStat[] {
  const home = rows.filter((r) => r.surface === "homepage_section" && r.section_id);
  const perf = itemPerformance(home, (r) => r.section_id);
  const by = new Map<string, { kind: string | null; exposed: Set<string>; clicking: Set<string>; outside: number; viewAll: number }>();
  const get = (r: DiscoveryRow) => {
    let s = by.get(r.section_id as string);
    if (!s) by.set(r.section_id as string, (s = { kind: r.section_kind, exposed: new Set(), clicking: new Set(), outside: 0, viewAll: 0 }));
    if (!s.kind && r.section_kind) s.kind = r.section_kind;
    return s;
  };
  for (const r of home) {
    const s = get(r);
    if (r.event_type === "section_exposure") s.exposed.add(r.page_view_id);
  }
  for (const r of home) {
    const s = get(r);
    if (r.event_type === "item_click" || r.event_type === "view_all_click") {
      s.clicking.add(r.page_view_id);
      if (!s.exposed.has(r.page_view_id)) s.outside++;
    }
    if (r.event_type === "view_all_click") s.viewAll++;
  }
  return [...by.entries()].map(([sectionId, s]) => {
    const engaged = [...s.clicking].filter((pv) => s.exposed.has(pv)).length;
    return {
      sectionId,
      sectionKind: s.kind,
      ...(perf.get(sectionId) ?? emptyPerf()),
      exposedPageViews: s.exposed.size,
      clickingPageViews: s.clicking.size,
      engagedExposedPageViews: engaged,
      engagementRate: rate(engaged, s.exposed.size),
      clicksOutsideExposure: s.outside,
      viewAllClicks: s.viewAll,
    };
  });
}

export type ItemRow = ItemPerf & { itemType: string; itemId: string; positions: number[] };

/** Per-item performance within one placement (section, or guide block). */
export function aggregatePlacementItems(rows: DiscoveryRow[], placementKey: string): ItemRow[] {
  const scoped = rows.filter((r) => placementKeyOf(r) === placementKey && r.item_type && r.item_id);
  const perf = itemPerformance(scoped, itemKeyOf);
  const positions = new Map<string, Set<number>>();
  for (const r of scoped) {
    if (r.event_type !== "item_impression" || r.position === null) continue;
    const k = itemKeyOf(r);
    if (!positions.has(k)) positions.set(k, new Set());
    positions.get(k)!.add(r.position);
  }
  return [...perf.entries()]
    .map(([k, p]) => {
      const [itemType, itemId] = k.split(":");
      return { itemType, itemId, ...p, positions: [...(positions.get(k) ?? [])].sort((a, b) => a - b) };
    })
    .sort((a, b) => b.impressions - a.impressions || b.rawClicks - a.rawClicks);
}

export type PositionRow = ItemPerf & { position: number };

/** Performance by rendered position within one placement (impression position for impressions; click position for clicks). */
export function aggregatePlacementPositions(rows: DiscoveryRow[], placementKey: string): PositionRow[] {
  const scoped = rows.filter((r) => placementKeyOf(r) === placementKey && r.position !== null);
  const perf = itemPerformance(scoped, (r) => String(r.position));
  return [...perf.entries()].map(([p, v]) => ({ position: Number(p), ...v })).sort((a, b) => a.position - b.position);
}

// ── Hero ────────────────────────────────────────────────────────────────────

export type HeroStat = { eventType: string; mode: string; events: number; sessions: number };

export function aggregateHero(rows: DiscoveryRow[]): HeroStat[] {
  const by = new Map<string, { n: number; s: Set<string> }>();
  for (const r of rows) {
    if (r.surface !== "homepage_hero") continue;
    const k = `${r.event_type}|${r.mode ?? "unknown"}`;
    let g = by.get(k);
    if (!g) by.set(k, (g = { n: 0, s: new Set() }));
    g.n++;
    g.s.add(r.session_id);
  }
  return [...by.entries()]
    .map(([k, g]) => {
      const [eventType, mode] = k.split("|");
      return { eventType, mode, events: g.n, sessions: g.s.size };
    })
    .sort((a, b) => a.eventType.localeCompare(b.eventType) || b.events - a.events);
}

// ── Guides ──────────────────────────────────────────────────────────────────

export type GuideOpenStat = ItemPerf & { guideId: string; sectionIds: string[] };

/** Homepage cards that open a guide (item_type 'guide' on homepage sections). */
export function aggregateGuideOpensFromHomepage(rows: DiscoveryRow[]): GuideOpenStat[] {
  const scoped = rows.filter((r) => r.surface === "homepage_section" && r.item_type === "guide" && r.item_id);
  const perf = itemPerformance(scoped, (r) => r.item_id);
  const sections = new Map<string, Set<string>>();
  for (const r of scoped) {
    if (!sections.has(r.item_id!)) sections.set(r.item_id!, new Set());
    sections.get(r.item_id!)!.add(r.section_id!);
  }
  return [...perf.entries()]
    .map(([guideId, p]) => ({ guideId, ...p, sectionIds: [...(sections.get(guideId) ?? [])] }))
    .sort((a, b) => b.impressions - a.impressions || b.rawClicks - a.rawClicks);
}

export type GuideBlockStat = ItemPerf & { block: string; exposedPageViews: number };
export type GuidePageStat = { guideId: string; pageViews: number; blocks: GuideBlockStat[] };

/** Inside guide pages: per guide, per block (venues / events / related_guides). */
export function aggregateGuidePages(rows: DiscoveryRow[]): GuidePageStat[] {
  const scoped = rows.filter((r) => r.surface === "guide" && r.guide_id);
  const pageViews = new Map<string, Set<string>>();
  const exposures = new Map<string, Set<string>>();
  for (const r of scoped) {
    if (!pageViews.has(r.guide_id!)) pageViews.set(r.guide_id!, new Set());
    pageViews.get(r.guide_id!)!.add(r.page_view_id);
    if (r.event_type === "section_exposure") {
      const k = `${r.guide_id}|${r.guide_block}`;
      if (!exposures.has(k)) exposures.set(k, new Set());
      exposures.get(k)!.add(r.page_view_id);
    }
  }
  const perf = itemPerformance(scoped, (r) => `${r.guide_id}|${r.guide_block}`);
  const blocksByGuide = new Map<string, GuideBlockStat[]>();
  const keys = new Set([...perf.keys(), ...exposures.keys()]);
  for (const k of keys) {
    const [guideId, block] = k.split("|");
    const list = blocksByGuide.get(guideId) ?? [];
    list.push({ block, ...(perf.get(k) ?? emptyPerf()), exposedPageViews: exposures.get(k)?.size ?? 0 });
    blocksByGuide.set(guideId, list);
  }
  const order = { venues: 0, events: 1, related_guides: 2 } as Record<string, number>;
  return [...pageViews.entries()]
    .map(([guideId, pv]) => ({
      guideId,
      pageViews: pv.size,
      blocks: (blocksByGuide.get(guideId) ?? []).sort((a, b) => (order[a.block] ?? 9) - (order[b.block] ?? 9)),
    }))
    .sort((a, b) => b.pageViews - a.pageViews);
}

// ── Venues ──────────────────────────────────────────────────────────────────

/** item key ("venue:<id>", "daily_special:<id>", "event:<id>") → venue id. Venue items map to themselves. */
export type ItemVenueMap = Map<string, string>;

export function venueOfItem(r: Pick<DiscoveryRow, "item_type" | "item_id">, itemVenue: ItemVenueMap): string | null {
  if (!r.item_type || !r.item_id) return null;
  if (r.item_type === "venue") return r.item_id;
  return itemVenue.get(itemKeyOf(r)) ?? null;
}

export type VenueOverviewRow = {
  venueId: string;
  venueCards: ItemPerf;
  specialCards: ItemPerf;
  eventCards: ItemPerf;
  suggestionSelects: number;
};

/** Per-venue discovery across homepage sections and guides, split by card type (guides opened are not venue discovery). */
export function aggregateVenueOverview(rows: DiscoveryRow[], itemVenue: ItemVenueMap): VenueOverviewRow[] {
  const cards = rows.filter((r) => r.surface !== "homepage_hero" && (r.item_type === "venue" || r.item_type === "daily_special" || r.item_type === "event"));
  const perf = itemPerformance(cards, (r) => {
    const v = venueOfItem(r, itemVenue);
    return v ? `${v}|${r.item_type}` : null;
  });
  const out = new Map<string, VenueOverviewRow>();
  const get = (v: string) => {
    let o = out.get(v);
    if (!o) out.set(v, (o = { venueId: v, venueCards: emptyPerf(), specialCards: emptyPerf(), eventCards: emptyPerf(), suggestionSelects: 0 }));
    return o;
  };
  for (const [k, p] of perf) {
    const [v, type] = k.split("|");
    const o = get(v);
    if (type === "venue") o.venueCards = p;
    else if (type === "daily_special") o.specialCards = p;
    else o.eventCards = p;
  }
  for (const r of rows) {
    if (r.surface !== "homepage_hero" || r.event_type !== "suggestion_select") continue;
    const v = venueOfItem(r, itemVenue);
    if (v) get(v).suggestionSelects++;
  }
  const total = (o: VenueOverviewRow) => o.venueCards.impressions + o.specialCards.impressions + o.eventCards.impressions;
  return [...out.values()].sort((a, b) => total(b) - total(a) || b.venueCards.rawClicks - a.venueCards.rawClicks);
}

export type VenueBreakdownRow = ItemPerf & { placementKey: string; itemType: string; position: number | null };

/** One venue's discovery by placement × card type × position. Hero suggestion selects are reported as raw clicks with no impressions. */
export function aggregateVenueBreakdown(rows: DiscoveryRow[], venueId: string, itemVenue: ItemVenueMap): VenueBreakdownRow[] {
  const mine = rows.filter((r) => venueOfItem(r, itemVenue) === venueId);
  const cardRows = mine.filter((r) => r.surface !== "homepage_hero");
  const perf = itemPerformance(cardRows, (r) => `${placementKeyOf(r)}|${r.item_type}|${r.position ?? ""}`);
  const out: VenueBreakdownRow[] = [...perf.entries()].map(([k, p]) => {
    const [placementKey, itemType, pos] = k.split("|");
    return { placementKey, itemType, position: pos === "" ? null : Number(pos), ...p };
  });
  const selects = mine.filter((r) => r.surface === "homepage_hero" && r.event_type === "suggestion_select");
  if (selects.length > 0) {
    out.push({ placementKey: "hero", itemType: "suggestion", position: null, impressions: 0, rawClicks: selects.length, matchedClicked: 0, unmatchedClicks: 0, ctr: null });
  }
  return out.sort((a, b) => a.placementKey.localeCompare(b.placementKey) || a.itemType.localeCompare(b.itemType) || (a.position ?? 99) - (b.position ?? 99));
}

// ── Legacy (venue_discover_events, LOAD-based) ──────────────────────────────

export type LegacyClickRow = { venue_id: string; rail_name: string; position: number; session_id: string; occurred_at: string };

export type LegacyRailStat = { railName: string; loadRows: number; clicks: number; clickSessions: number };

/**
 * Legacy rails: load rows (impression rows written when a rail RENDERED —
 * not seen) and clicks. No CTR is computed: loads are not a valid
 * denominator (see the tracking doc).
 */
export function aggregateLegacyRails(loadCounts: Map<string, number>, clicks: LegacyClickRow[]): LegacyRailStat[] {
  const kept = clicks.filter((c) => !isReleaseQaSession(c.session_id));
  const by = new Map<string, { n: number; s: Set<string> }>();
  for (const c of kept) {
    let g = by.get(c.rail_name);
    if (!g) by.set(c.rail_name, (g = { n: 0, s: new Set() }));
    g.n++;
    g.s.add(c.session_id);
  }
  const rails = new Set([...loadCounts.keys(), ...by.keys()]);
  return [...rails]
    .map((railName) => ({ railName, loadRows: loadCounts.get(railName) ?? 0, clicks: by.get(railName)?.n ?? 0, clickSessions: by.get(railName)?.s.size ?? 0 }))
    .sort((a, b) => b.clicks - a.clicks || b.loadRows - a.loadRows);
}

export type LegacyLoadRow = { venue_id: string; position: number; session_id?: string };

export type LegacyRailVenueRow = { venueId: string; loadRows: number; clicks: number; clickSessions: number; positions: number[] };
export type LegacyRailPositionRow = { position: number; loadRows: number; clicks: number };

/**
 * One legacy rail's detail: per venue and per recorded card position.
 * Load rows are LOAD-based (written when the rail rendered, whether or not
 * anyone saw the card) — shown beside clicks, never divided into them.
 * Positions are the card's 0-based place within the rail as rendered.
 */
export function aggregateLegacyRailDetail(
  loads: LegacyLoadRow[],
  clicks: LegacyClickRow[]
): { byVenue: LegacyRailVenueRow[]; byPosition: LegacyRailPositionRow[] } {
  const keptLoads = loads.filter((l) => !isReleaseQaSession(l.session_id));
  const keptClicks = clicks.filter((c) => !isReleaseQaSession(c.session_id));
  const venues = new Map<string, { loads: number; clicks: number; sessions: Set<string>; positions: Set<number> }>();
  const positions = new Map<number, { loads: number; clicks: number }>();
  const v = (id: string) => {
    let x = venues.get(id);
    if (!x) venues.set(id, (x = { loads: 0, clicks: 0, sessions: new Set(), positions: new Set() }));
    return x;
  };
  const p = (pos: number) => {
    let x = positions.get(pos);
    if (!x) positions.set(pos, (x = { loads: 0, clicks: 0 }));
    return x;
  };
  for (const l of keptLoads) {
    const x = v(l.venue_id);
    x.loads++;
    x.positions.add(l.position);
    p(l.position).loads++;
  }
  for (const c of keptClicks) {
    const x = v(c.venue_id);
    x.clicks++;
    x.sessions.add(c.session_id);
    x.positions.add(c.position);
    p(c.position).clicks++;
  }
  return {
    byVenue: [...venues.entries()]
      .map(([venueId, x]) => ({ venueId, loadRows: x.loads, clicks: x.clicks, clickSessions: x.sessions.size, positions: [...x.positions].sort((a, b) => a - b) }))
      .sort((a, b) => b.clicks - a.clicks || b.loadRows - a.loadRows),
    byPosition: [...positions.entries()].map(([position, x]) => ({ position, loadRows: x.loads, clicks: x.clicks })).sort((a, b) => a.position - b.position),
  };
}
