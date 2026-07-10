/**
 * Read-only resolver for the Collections editor's "Resolved Collection"
 * working area (migration 058_collections_homepages_foundation.sql).
 * Answers "what does this Collection actually contain right now?" — see
 * docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md.
 *
 * Called from two places: the editor's explicit "Generate Collection" action
 * (generateCollectionResultAction in control-panel/collections/actions.ts),
 * which runs it against the CURRENT, possibly-unsaved form state so an
 * editor can see results before ever saving; and the Publish validation step
 * in updateCollectionAction, which runs it against the submitted (about to
 * be saved) state to confirm at least one item resolves. Neither call site
 * requires a public preview route — this is purely an internal admin
 * resolver. A true public preview will only be meaningful once Collection
 * landing pages exist (out of scope here — see product spec, "Collection
 * Landing Pages").
 *
 * This is NOT the future Collections resolver that will power public
 * Homepage Sections (see migration 058's header comment on the intended
 * Discover Management transition) — it exists only to render an admin-facing
 * resolved list from inside the Control Panel. It deliberately reuses the
 * existing, live Discover Engine algorithm functions (discoverEngine.ts,
 * featuredEventsEngine.ts) and data readers (venues.ts, events.ts) exactly as
 * Discover Management itself does — nothing here duplicates that logic, and
 * nothing here is imported by any consumer-facing code path. Reusing rather
 * than reimplementing means an algorithm improvement in the Discover Engine
 * is automatically reflected here too.
 *
 * Geography note: discoverEngine.ts's algorithm functions gate candidates
 * through isNearMarket(), a lat/lng-radius heuristic calibrated only for the
 * single Central Okanagan launch market (see MARKET_CONFIG). Collections are
 * geography-aware across multiple markets via venues.market_id/city_id
 * (migration 048) — a real, authoritative assignment, unlike the radius
 * heuristic. This resolver therefore pre-filters the candidate pool by exact
 * market_id/city_id membership (the same authoritative check
 * validateContentGeography already applies to manual overrides), then passes
 * an effectively-unbounded MarketConfig into the algorithm functions so their
 * internal isNearMarket call never re-filters (and never wrongly excludes)
 * venues/events outside the hardcoded Kelowna radius. This does not change
 * discoverEngine.ts or its behavior for the live consumer app in any way.
 *
 * Explicit ordering note: for an algorithmic Collection, the algorithm's own
 * ranking is authoritative — sort_order on an override row is only a
 * secondary tie-break among rows that HAVE an override entry (see
 * collection_venue_overrides.sort_order comment, migration 058). A pure
 * algorithm-only row (no override) has no stored position, so it can't be
 * given an exact rank relative to other un-touched algorithm rows; it simply
 * keeps the algorithm's own relative order. The editor's Move Up/Down
 * controls work by first "promoting" a row to an override entry (see
 * ResolvedCollectionTable.tsx), which is what makes it tie-break-orderable.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getCPFeaturedEventCandidates, type CPFeaturedEventItem } from "@/lib/data/events";
import { getRailVenuesByKey, type RailOverride, type MarketConfig } from "@/lib/discover/discoverEngine";
import { computeFeaturedEventRail } from "@/lib/discover/featuredEventsEngine";
import type { EventRailOverride } from "@/lib/data/discoverOverridesShared";
import type {
  CollectionType,
  AlgorithmKey,
  CollectionVenueOverride,
  CollectionEventOverride,
  CollectionGuideItem,
} from "@/lib/data/collectionsShared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// Real geography membership already gates the candidate pool below, so this
// MarketConfig only needs to never itself exclude anything — see module
// docstring. lat/lng are irrelevant once radiusKm is unbounded.
const UNBOUNDED_MARKET: MarketConfig = { lat: 0, lng: 0, radiusKm: Number.MAX_SAFE_INTEGER };

export type PreviewOrigin = "algorithm" | "manual-include";

export type CollectionPreviewItem = {
  id: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  origin: PreviewOrigin;
  boosted: boolean;
};

export type CollectionPreviewResult = {
  /** Resolved, ordered, item-limit-applied result — what a Homepage Section using this Collection would show. */
  items: CollectionPreviewItem[];
  /** Manual override rows with action = "exclude" that are currently suppressing content — shown for admin visibility. */
  excludedCount: number;
  /** Short, user-facing reason when items is empty. Null when items is non-empty. */
  emptyReason: string | null;
};

// ── Geography membership helpers ─────────────────────────────────────────────

async function getEligibleVenueIds(marketId: string, cityId: string | null): Promise<Set<string>> {
  const supabase = createAdminClient();
  let query = supabase.from("venues").select("id").eq("market_id", marketId).eq("is_published", true);
  if (cityId) query = query.eq("city_id", cityId);
  const { data, error } = await query;
  if (error) {
    console.error("[getEligibleVenueIds]", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r: Row) => r.id as string));
}

async function getEligibleEventIds(marketId: string, cityId: string | null): Promise<Set<string>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, venues!venue_id(market_id, city_id)")
    .eq("is_published", true);
  if (error) {
    console.error("[getEligibleEventIds]", error.message);
    return new Set();
  }
  const ids = new Set<string>();
  for (const row of (data ?? []) as Row[]) {
    const venue = (row.venues as Row | null) ?? {};
    if (venue.market_id !== marketId) continue;
    if (cityId && venue.city_id !== cityId) continue;
    ids.add(row.id as string);
  }
  return ids;
}

// ── Manual resolution ─────────────────────────────────────────────────────────

function resolveManualVenueOrEvent(
  overrides: (CollectionVenueOverride | CollectionEventOverride)[],
  idKey: "venueId" | "eventId",
  labelKey: "venueName" | "eventTitle"
): CollectionPreviewResult {
  const included = overrides
    .filter((o) => o.action === "include")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const excludedCount = overrides.filter((o) => o.action === "exclude").length;

  const items: CollectionPreviewItem[] = included.map((o) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id: (o as any)[idKey] as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    primaryLabel: ((o as any)[labelKey] as string | null) ?? "(unknown)",
    secondaryLabel: null,
    origin: "manual-include",
    boosted: o.boost > 0,
  }));

  return {
    items,
    excludedCount,
    emptyReason: items.length === 0 ? "No content has been added to this Collection yet." : null,
  };
}

function resolveManualGuides(guideItems: CollectionGuideItem[]): CollectionPreviewResult {
  const ordered = guideItems.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const items: CollectionPreviewItem[] = ordered.map((g) => ({
    id: g.guideId,
    primaryLabel: g.guideTitle ?? "(unknown)",
    secondaryLabel: null,
    origin: "manual-include",
    boosted: false,
  }));
  return {
    items,
    excludedCount: 0,
    emptyReason: items.length === 0 ? "No guides have been added to this Collection yet." : null,
  };
}

// ── Algorithmic resolution — venues ──────────────────────────────────────────

async function resolveAlgorithmicVenues(
  marketId: string,
  cityId: string | null,
  algorithmKey: AlgorithmKey,
  itemLimit: number | null,
  overrides: CollectionVenueOverride[]
): Promise<CollectionPreviewResult> {
  const [eligibleIds, allVenues] = await Promise.all([
    getEligibleVenueIds(marketId, cityId),
    getPublishedVenuesForConsumer(),
  ]);

  const pool = allVenues.filter((v) => eligibleIds.has(v.venueUuid));
  const railOverrides: RailOverride[] = overrides.map((o) => ({ venueUuid: o.venueId, action: o.action }));
  const excludedCount = overrides.filter((o) => o.action === "exclude").length;

  const resolved = getRailVenuesByKey(algorithmKey, pool, railOverrides, UNBOUNDED_MARKET);

  const includeOverrides = overrides.filter((o) => o.action === "include");
  const boostByVenue = new Map(includeOverrides.map((o) => [o.venueId, o.boost]));
  const includedByVenue = new Set(includeOverrides.map((o) => o.venueId));
  // Position among override rows only — see module docstring "Explicit ordering note".
  const orderByVenue = new Map(includeOverrides.map((o, i) => [o.venueId, i]));

  const withBoost = resolved.map((v, index) => ({
    venue: v,
    index,
    boost: boostByVenue.get(v.venueUuid) ?? 0,
  }));
  // Stable: boost lifts first; among equal boost, rows with an explicit
  // override position tie-break by that position, then float above
  // untouched algorithm-only ties; remaining ties keep algorithm order.
  withBoost.sort((a, b) => {
    if (b.boost !== a.boost) return b.boost - a.boost;
    const orderA = orderByVenue.get(a.venue.venueUuid);
    const orderB = orderByVenue.get(b.venue.venueUuid);
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    return a.index - b.index;
  });

  const limited = itemLimit ? withBoost.slice(0, itemLimit) : withBoost;

  const items: CollectionPreviewItem[] = limited.map(({ venue, boost }) => ({
    id: venue.venueUuid,
    primaryLabel: venue.name,
    secondaryLabel: venue.city || null,
    origin: includedByVenue.has(venue.venueUuid) ? "manual-include" : "algorithm",
    boosted: boost > 0,
  }));

  return {
    items,
    excludedCount,
    emptyReason:
      items.length === 0
        ? "No eligible venues were found for this algorithm within the selected geography."
        : null,
  };
}

// ── Algorithmic resolution — events (featured-events only in V1) ────────────

async function resolveAlgorithmicEvents(
  marketId: string,
  cityId: string | null,
  itemLimit: number | null,
  overrides: CollectionEventOverride[]
): Promise<CollectionPreviewResult> {
  const [eligibleIds, allCandidates] = await Promise.all([
    getEligibleEventIds(marketId, cityId),
    getCPFeaturedEventCandidates(),
  ]);

  const pool: CPFeaturedEventItem[] = allCandidates.filter((e) => eligibleIds.has(e.eventUuid));
  const eventOverrides: EventRailOverride[] = overrides.map((o) => ({ eventUuid: o.eventId, action: o.action }));
  const excludedCount = overrides.filter((o) => o.action === "exclude").length;

  const resolved = computeFeaturedEventRail(pool, eventOverrides, [], UNBOUNDED_MARKET);

  const includeOverrides = overrides.filter((o) => o.action === "include");
  const boostByEvent = new Map(includeOverrides.map((o) => [o.eventId, o.boost]));
  const includedByEvent = new Set(includeOverrides.map((o) => o.eventId));
  const orderByEvent = new Map(includeOverrides.map((o, i) => [o.eventId, i]));

  const withBoost = resolved.map((e, index) => ({
    event: e,
    index,
    boost: boostByEvent.get(e.eventUuid) ?? 0,
  }));
  withBoost.sort((a, b) => {
    if (b.boost !== a.boost) return b.boost - a.boost;
    const orderA = orderByEvent.get(a.event.eventUuid);
    const orderB = orderByEvent.get(b.event.eventUuid);
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    return a.index - b.index;
  });

  const limited = itemLimit ? withBoost.slice(0, itemLimit) : withBoost;

  const items: CollectionPreviewItem[] = limited.map(({ event, boost }) => ({
    id: event.eventUuid,
    primaryLabel: event.title,
    secondaryLabel: event.venueName,
    origin: includedByEvent.has(event.eventUuid) ? "manual-include" : "algorithm",
    boosted: boost > 0,
  }));

  return {
    items,
    excludedCount,
    emptyReason:
      items.length === 0
        ? "No eligible events were found for this algorithm within the selected geography."
        : null,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

export type CollectionPreviewInput = {
  collectionType: CollectionType;
  marketId: string;
  cityId: string | null;
  algorithmKey: AlgorithmKey | null;
  itemLimit: number | null;
  venueOverrides: CollectionVenueOverride[];
  eventOverrides: CollectionEventOverride[];
  guideItems: CollectionGuideItem[];
};

export async function resolveCollectionPreview(input: CollectionPreviewInput): Promise<CollectionPreviewResult> {
  if (input.collectionType === "guide") {
    return resolveManualGuides(input.guideItems);
  }
  if (input.collectionType === "venue") {
    if (input.algorithmKey === null) {
      return resolveManualVenueOrEvent(input.venueOverrides, "venueId", "venueName");
    }
    return resolveAlgorithmicVenues(input.marketId, input.cityId, input.algorithmKey, input.itemLimit, input.venueOverrides);
  }
  // event
  if (input.algorithmKey === null) {
    return resolveManualVenueOrEvent(input.eventOverrides, "eventId", "eventTitle");
  }
  return resolveAlgorithmicEvents(input.marketId, input.cityId, input.itemLimit, input.eventOverrides);
}
