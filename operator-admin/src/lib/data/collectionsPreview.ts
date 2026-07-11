/**
 * Read-only resolver for the Collections editor's "Resolved Collection"
 * working area (migration 058_collections_homepages_foundation.sql).
 * Answers "what does this Collection actually contain right now?" — see
 * docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md.
 *
 * Called from three places: ResolvedCollectionTable.tsx's live editorial
 * refinement (generateCollectionResultAction in
 * control-panel/collections/actions.ts), which re-resolves after an
 * exclude/restore/boost/add/reorder edit against current, possibly-unsaved
 * override state; the Publish validation step in updateCollectionAction,
 * which runs it against the submitted (about to be saved) state to confirm
 * at least one item resolves; and resolveCollectionPreviewById below, which
 * the Edit page calls on every visit to an Algorithmic Collection to
 * display its current base pool (Algorithmic Collections are generated
 * once, automatically, at creation — there is no user-facing "Generate"
 * action anymore). No call site requires a public preview route — this is
 * purely an internal admin resolver. A true public preview will only be
 * meaningful once Collection landing pages exist (out of scope here — see
 * product spec, "Collection Landing Pages").
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
import { getCollectionById } from "@/lib/data/collections";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getCPFeaturedEventCandidates, type CPFeaturedEventItem } from "@/lib/data/events";
import { getRailVenuesByKey, type RailOverride, type MarketConfig } from "@/lib/discover/discoverEngine";
import { computeFeaturedEventRail } from "@/lib/discover/featuredEventsEngine";
import type { EventRailOverride } from "@/lib/data/discoverOverridesShared";
import {
  MANUAL_ADD_REASON,
  type CollectionType,
  type AlgorithmKey,
  type CollectionVenueOverride,
  type CollectionEventOverride,
  type CollectionGuideItem,
} from "@/lib/data/collectionsShared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// Real geography membership already gates the candidate pool below, so this
// MarketConfig only needs to never itself exclude anything — see module
// docstring. lat/lng are irrelevant once radiusKm is unbounded.
const UNBOUNDED_MARKET: MarketConfig = { lat: 0, lng: 0, radiusKm: Number.MAX_SAFE_INTEGER };

/**
 * "algorithm" — the item is part of the algorithm's own capped base (its
 * natural, override-free ranking, sliced to the configured Item Limit — see
 * resolveAlgorithmicVenues/resolveAlgorithmicEvents below). "manual-include"
 * — the item was explicitly added by an editor via an include-override row
 * carrying MANUAL_ADD_REASON (collectionsShared.ts), added on TOP of the
 * capped base rather than counted against the Item Limit.
 *
 * This is NOT "does an include-override row exist" — a row can also exist
 * purely to carry a promoted algorithm-native row's position/boost for
 * reordering (see ResolvedCollectionTable.tsx's `promote()`/`updateBoost()`),
 * and such a row never carries MANUAL_ADD_REASON. A genuine manual add keeps
 * its "manual-include" label even if the same item would also naturally
 * qualify for the algorithm's base. Reordering, boosting, excluding, or
 * restoring an item never changes this value on its own.
 */
export type PreviewOrigin = "algorithm" | "manual-include";

export type CollectionPreviewItem = {
  id: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  origin: PreviewOrigin;
  boosted: boolean;
};

export type CollectionPreviewResult = {
  /**
   * Resolved, ordered result — what a Homepage Section using this Collection
   * would show. For an Algorithmic Collection, the Item Limit is applied
   * only to the algorithm-origin portion (see resolveAlgorithmicVenues/
   * resolveAlgorithmicEvents below) — genuine manual adds are layered on top
   * and are never capped by it, so `items.length` can exceed the configured
   * limit.
   */
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
  const venueByUuid = new Map(pool.map((v) => [v.venueUuid, v]));
  const excludedCount = overrides.filter((o) => o.action === "exclude").length;

  // Step 1+3: the natural algorithm base — excludes applied (backfilling
  // from the next-ranked candidate, matching the rail's existing exclude
  // semantics), but NO include overrides at all. Neither a genuine manual
  // add nor a reorder/boost promotion row may influence which venues the
  // algorithm itself selects or how many "slots" it fills — that's the
  // Item Limit's job, applied next, to this base alone.
  const excludeOnlyOverrides: RailOverride[] = overrides
    .filter((o) => o.action === "exclude")
    .map((o) => ({ venueUuid: o.venueId, action: "exclude" as const }));
  const naturalBase = getRailVenuesByKey(algorithmKey, pool, excludeOnlyOverrides, UNBOUNDED_MARKET);

  // Step 2: cap to the configured Item Limit. This is the ONLY place the
  // limit is applied — it fixes algorithm-origin membership; nothing outside
  // this capped set can ever be labeled "algorithm" (see approved behavior:
  // "The configured Item Limit applies only to the algorithm-generated
  // starting list").
  const cappedBase = itemLimit ? naturalBase.slice(0, itemLimit) : naturalBase;

  // Step 4: genuine manual adds, identified by MANUAL_ADD_REASON — NOT
  // merely "has an include override row" (a promotion row created only to
  // give an already-capped algorithm venue a stored position/boost for
  // reordering also has action "include", but no MANUAL_ADD_REASON — see
  // ResolvedCollectionTable.tsx's promote()/updateBoost()). A manual add
  // keeps its "Added manually" label even if it also happens to appear in
  // the natural/capped algorithm base (approved behavior) — so it's always
  // removed from the algorithm side and only ever counted once, as manual.
  const manualAddIds = new Set(
    overrides.filter((o) => o.action === "include" && o.reasonType === MANUAL_ADD_REASON).map((o) => o.venueId)
  );
  const algorithmVenues = cappedBase.filter((v) => !manualAddIds.has(v.venueUuid));
  const manualVenues = [...manualAddIds]
    .map((id) => venueByUuid.get(id))
    .filter((v): v is NonNullable<typeof v> => v !== undefined);

  // Step 5: ordering/boost — applies uniformly across the combined list
  // (added on top per step 4, never capped by Item Limit) and never affects
  // origin, which was already fixed above.
  const includeOverrides = overrides.filter((o) => o.action === "include");
  const boostByVenue = new Map(includeOverrides.map((o) => [o.venueId, o.boost]));
  // Position among override rows only — see module docstring "Explicit ordering note".
  const orderByVenue = new Map(includeOverrides.map((o, i) => [o.venueId, i]));

  const combined = [...algorithmVenues, ...manualVenues];
  const withBoost = combined.map((v, index) => ({
    venue: v,
    index,
    boost: boostByVenue.get(v.venueUuid) ?? 0,
    origin: (manualAddIds.has(v.venueUuid) ? "manual-include" : "algorithm") as PreviewOrigin,
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

  const items: CollectionPreviewItem[] = withBoost.map(({ venue, boost, origin }) => ({
    id: venue.venueUuid,
    primaryLabel: venue.name,
    secondaryLabel: venue.city || null,
    origin,
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
  const eventByUuid = new Map(pool.map((e) => [e.eventUuid, e]));
  const excludedCount = overrides.filter((o) => o.action === "exclude").length;

  // Steps 1+3 — see the identical comments in resolveAlgorithmicVenues above.
  const excludeOnlyOverrides: EventRailOverride[] = overrides
    .filter((o) => o.action === "exclude")
    .map((o) => ({ eventUuid: o.eventId, action: "exclude" as const }));
  const naturalBase = computeFeaturedEventRail(pool, excludeOnlyOverrides, [], UNBOUNDED_MARKET);

  // Step 2: cap to the configured Item Limit.
  const cappedBase = itemLimit ? naturalBase.slice(0, itemLimit) : naturalBase;

  // Step 4: genuine manual adds, identified by MANUAL_ADD_REASON.
  const manualAddIds = new Set(
    overrides.filter((o) => o.action === "include" && o.reasonType === MANUAL_ADD_REASON).map((o) => o.eventId)
  );
  const algorithmEvents = cappedBase.filter((e) => !manualAddIds.has(e.eventUuid));
  const manualEvents = [...manualAddIds]
    .map((id) => eventByUuid.get(id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);

  // Step 5: ordering/boost — see resolveAlgorithmicVenues above.
  const includeOverrides = overrides.filter((o) => o.action === "include");
  const boostByEvent = new Map(includeOverrides.map((o) => [o.eventId, o.boost]));
  const orderByEvent = new Map(includeOverrides.map((o, i) => [o.eventId, i]));

  const combined = [...algorithmEvents, ...manualEvents];
  const withBoost = combined.map((e, index) => ({
    event: e,
    index,
    boost: boostByEvent.get(e.eventUuid) ?? 0,
    origin: (manualAddIds.has(e.eventUuid) ? "manual-include" : "algorithm") as PreviewOrigin,
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

  const items: CollectionPreviewItem[] = withBoost.map(({ event, boost, origin }) => ({
    id: event.eventUuid,
    primaryLabel: event.title,
    secondaryLabel: event.venueName,
    origin,
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

// ── By-id entry point (Algorithmic Collection auto-resolution) ──────────────
//
// Approved V1 product rule: "Algorithmic Collections are generated once
// during creation." After that, Curation Method/Algorithm/Item Limit are
// locked (see CollectionForm.tsx's module docstring) and there is no
// "Generate"/"Regenerate" button anywhere in the normal Edit flow — so the
// Edit page's initial load (control-panel/collections/[id]/edit/page.tsx)
// calls this on EVERY visit to an Algorithmic Collection, not just right
// after creation, to resolve and display its current base pool + stored
// overrides. This is load/display behavior, not user-triggered regeneration.
// It funnels through the exact same resolveCollectionPreview() above that
// the override-editing handlers in ResolvedCollectionTable.tsx (via
// generateCollectionResultAction) already use for live editorial refinement
// — nothing about the algorithm, geography, ranking, or override logic is
// duplicated.
//
// Deliberately takes a collectionId and re-fetches the Collection's own
// saved state rather than accepting an already-loaded CollectionDetail:
// Algorithm/Item Limit/geography are locked, so the Collection's current
// stored state is always exactly what should be resolved against — there is
// no unsaved client state to account for here (contrast with
// generateCollectionResultAction, which intentionally works off raw,
// possibly-unsaved form values for the editor's live override-editing
// refinement). Structured success/failure result — never throws — so a
// resolution failure can be surfaced as a clear message without losing the
// Collection, altering its status, or resetting stored overrides.
export type CollectionPreviewByIdResult =
  | { success: true; preview: CollectionPreviewResult }
  | { success: false; error: string };

export async function resolveCollectionPreviewById(collectionId: string): Promise<CollectionPreviewByIdResult> {
  const collection = await getCollectionById(collectionId);
  if (!collection) return { success: false, error: "Collection not found." };
  if (collection.collectionType === "guide" || collection.algorithmKey === null) {
    // Guide Collections are manual-only and Manual venue/event Collections
    // have no algorithm to run — callers should only invoke this for
    // Algorithmic venue/event Collections, but this guard keeps the function
    // safe (a structured error, not a crash) if that ever isn't true.
    return { success: false, error: "This Collection is not Algorithmic." };
  }

  try {
    const preview = await resolveCollectionPreview({
      collectionType: collection.collectionType,
      marketId: collection.marketId,
      cityId: collection.cityId,
      algorithmKey: collection.algorithmKey,
      itemLimit: collection.itemLimit,
      venueOverrides: collection.venueOverrides,
      eventOverrides: collection.eventOverrides,
      guideItems: [],
    });
    return { success: true, preview };
  } catch (err) {
    console.error("[resolveCollectionPreviewById]", err);
    // No "click Generate Collection" wording — that action no longer exists
    // (see header comment). This can surface on any visit, not just after
    // creation, so the copy points at retrying the page or fixing data,
    // not a one-time creation step.
    return {
      success: false,
      error: "This Collection's resolved items could not be loaded. Try reloading the page, or the underlying data may need attention.",
    };
  }
}
