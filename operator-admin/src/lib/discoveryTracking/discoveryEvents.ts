/**
 * Website discovery tracking — event vocabulary, payload validation and the
 * once-per-page-view dedupe key (migration 110, website_discovery_events).
 *
 * Pure and client-safe: the browser uses the types/constants, and
 * /api/track/discovery uses validateDiscoveryEvent() + buildDedupeKey().
 *
 * ── Metric definitions (use these denominators in reports) ─────────────────
 *   item_impression   A card was ≥50% visible for ≥1 continuous second while
 *                     the tab was visible. Counted once per page view per
 *                     placement + item (the same venue in two sections is two
 *                     placements). This is an on-screen impression.
 *   section_exposure  The section's heading marker met the same threshold —
 *                     once per page view. "Section seen" denominator.
 *   item_click        The card's link was activated (double-clicks within 1s
 *                     are one click).
 *   view_all_click    A section's "View all" link (or the hero's "See all …
 *                     matching" option, surface homepage_hero).
 *   browse_click      The hero's Browse button.
 *   suggestion_select A hero search suggestion was chosen.
 *   page_view_id      One mounted homepage/guide page instance.
 *
 * Load-based venue_discover_events impressions (pre-migration-110 website
 * rows, and the consumer app) are a DIFFERENT metric — never sum or compare
 * them with item_impression.
 */

export const DISCOVERY_EVENT_TYPES = [
  "item_impression",
  "section_exposure",
  "item_click",
  "view_all_click",
  "browse_click",
  "suggestion_select",
] as const;
export type DiscoveryEventType = (typeof DISCOVERY_EVENT_TYPES)[number];

export const DISCOVERY_SURFACES = ["homepage_section", "homepage_hero", "guide"] as const;
export type DiscoverySurface = (typeof DISCOVERY_SURFACES)[number];

export const DISCOVERY_ITEM_TYPES = ["venue", "guide", "event", "daily_special"] as const;
export type DiscoveryItemType = (typeof DISCOVERY_ITEM_TYPES)[number];

export const DISCOVERY_SECTION_KINDS = [
  "venue_collection",
  "event_collection",
  "guide_collection",
  "daily_special_collection",
  "venue_feature",
  "event_feature",
  "guide_feature",
] as const;
export type DiscoverySectionKind = (typeof DISCOVERY_SECTION_KINDS)[number];

export const GUIDE_BLOCKS = ["venues", "events", "related_guides"] as const;
export type GuideBlock = (typeof GUIDE_BLOCKS)[number];

export const SEARCH_MODES = ["happy_hours", "daily_specials", "events"] as const;
export type SearchModeValue = (typeof SEARCH_MODES)[number];

/** Event types that always carry item_type/item_id/position. */
const ITEM_EVENT_TYPES: ReadonlySet<string> = new Set(["item_impression", "item_click", "suggestion_select"]);
/** Event types counted once per page view (server-side dedupe key). */
const ONCE_PER_PAGE_VIEW_TYPES: ReadonlySet<string> = new Set(["item_impression", "section_exposure"]);

/** Wire payload sent by the browser (camelCase). */
export type DiscoveryEventPayload = {
  eventType: DiscoveryEventType;
  surface: DiscoverySurface;
  pageViewId: string;
  sessionId: string;
  marketId?: string | null;
  homepageId?: string | null;
  sectionId?: string | null;
  sectionKind?: DiscoverySectionKind | null;
  guideId?: string | null;
  guideBlock?: GuideBlock | null;
  itemType?: DiscoveryItemType | null;
  itemId?: string | null;
  position?: number | null;
  mode?: SearchModeValue | null;
  searchId?: string | null;
  targetPath?: string | null;
};

/** Row shape for public.website_discovery_events (minus id/occurred_at/environment). */
export type DiscoveryEventRow = {
  event_type: DiscoveryEventType;
  surface: DiscoverySurface;
  page_view_id: string;
  session_id: string;
  market_id: string | null;
  homepage_id: string | null;
  section_id: string | null;
  section_kind: DiscoverySectionKind | null;
  guide_id: string | null;
  guide_block: GuideBlock | null;
  item_type: DiscoveryItemType | null;
  item_id: string | null;
  position: number | null;
  mode: SearchModeValue | null;
  search_id: string | null;
  target_path: string | null;
  dedupe_key: string | null;
};

export const MAX_DISCOVERY_EVENTS_PER_REQUEST = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function optionalUuid(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return isUuid(v) ? v.toLowerCase() : undefined; // undefined = invalid
}

function optionalEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * Path-only destination: must start with a single "/" (never a protocol or
 * protocol-relative URL), query/hash stripped, capped at 500 chars.
 */
export function sanitizeTargetPath(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//")) return undefined;
  const path = v.split(/[?#]/)[0];
  return path.slice(0, 500);
}

/**
 * Validates one browser payload into a table row (without environment).
 * Returns null for anything malformed — the route drops it, never guesses.
 */
export function validateDiscoveryEvent(raw: unknown): DiscoveryEventRow | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  const eventType = optionalEnum(p.eventType, DISCOVERY_EVENT_TYPES);
  const surface = optionalEnum(p.surface, DISCOVERY_SURFACES);
  if (!eventType || !surface) return null;

  if (!isUuid(p.pageViewId)) return null;
  if (typeof p.sessionId !== "string" || p.sessionId.length === 0 || p.sessionId.length > 128) return null;

  let marketId: string | null = null;
  if (p.marketId !== undefined && p.marketId !== null) {
    if (typeof p.marketId !== "string" || p.marketId.length === 0 || p.marketId.length > 100) return null;
    marketId = p.marketId;
  }

  const homepageId = optionalUuid(p.homepageId);
  const sectionId = optionalUuid(p.sectionId);
  const guideId = optionalUuid(p.guideId);
  const itemId = optionalUuid(p.itemId);
  const searchId = optionalUuid(p.searchId);
  const sectionKind = optionalEnum(p.sectionKind, DISCOVERY_SECTION_KINDS);
  const guideBlock = optionalEnum(p.guideBlock, GUIDE_BLOCKS);
  const itemType = optionalEnum(p.itemType, DISCOVERY_ITEM_TYPES);
  const mode = optionalEnum(p.mode, SEARCH_MODES);
  const targetPath = sanitizeTargetPath(p.targetPath);
  if (
    homepageId === undefined || sectionId === undefined || guideId === undefined ||
    itemId === undefined || searchId === undefined || sectionKind === undefined ||
    guideBlock === undefined || itemType === undefined || mode === undefined ||
    targetPath === undefined
  ) {
    return null;
  }

  let position: number | null = null;
  if (p.position !== undefined && p.position !== null) {
    if (typeof p.position !== "number" || !Number.isInteger(p.position) || p.position < 0 || p.position > 1000) return null;
    position = p.position;
  }

  // Item events always identify an item + position; other events never do.
  const isItemEvent = ITEM_EVENT_TYPES.has(eventType);
  const hasItem = itemType !== null && itemId !== null && position !== null;
  if (isItemEvent !== hasItem) return null;

  // Placement identity per surface (mirrors the table's CHECK).
  if (surface === "homepage_section") {
    if (!sectionId || !sectionKind || guideId || guideBlock) return null;
  } else if (surface === "guide") {
    if (!guideId || !guideBlock || sectionId || sectionKind) return null;
  } else {
    if (sectionId || sectionKind || guideId || guideBlock) return null;
  }

  const row: DiscoveryEventRow = {
    event_type: eventType,
    surface,
    page_view_id: (p.pageViewId as string).toLowerCase(),
    session_id: p.sessionId,
    market_id: marketId,
    homepage_id: homepageId,
    section_id: sectionId,
    section_kind: sectionKind,
    guide_id: guideId,
    guide_block: guideBlock,
    item_type: itemType,
    item_id: itemId,
    position,
    mode,
    search_id: searchId,
    target_path: targetPath,
    dedupe_key: null,
  };
  row.dedupe_key = buildDedupeKey(row);
  return row;
}

/**
 * Once-per-page-view identity for impressions/exposures: page view +
 * placement (section, or guide block) + item. NULL for every other event
 * type so clicks are never collapsed server-side.
 */
export function buildDedupeKey(row: Omit<DiscoveryEventRow, "dedupe_key">): string | null {
  if (!ONCE_PER_PAGE_VIEW_TYPES.has(row.event_type)) return null;
  const placement =
    row.surface === "homepage_section"
      ? `s:${row.section_id}`
      : row.surface === "guide"
        ? `g:${row.guide_id}:${row.guide_block}`
        : "hero";
  const item = row.item_type && row.item_id ? `${row.item_type}:${row.item_id}` : "-";
  return `${row.page_view_id}|${row.event_type}|${placement}|${item}`;
}
