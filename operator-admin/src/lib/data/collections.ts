/**
 * Server-side data helpers for the Collections data layer
 * (collections, collection_venue_overrides, collection_event_overrides,
 * collection_guide_items — migration 058_collections_homepages_foundation.sql).
 *
 * Must only be imported from Server Components, Route Handlers, or Server
 * Actions. Client-safe constants, types, and pure validators live in
 * collectionsShared.ts.
 *
 * Internal-only tables (no RLS policies for anon/authenticated) — always
 * queried via createAdminClient() (service-role), consistent with
 * contentGuides.ts / discoverOverrides.ts / faqLibrary.ts.
 *
 * Scope: this file is the data layer only (CRUD + validation). It does not
 * seed the legacy Discover Management rails, does not resolve algorithmic
 * membership (that belongs to a future Collections resolver, analogous to
 * discoverEngine.ts), and does not render anything. See migration 058's
 * header comment for the intended Discover Management transition path.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { validateCityBelongsToMarket } from "@/lib/geo/geography";
import { normalizeHomepageStatus } from "@/lib/data/homepagesShared";
import {
  isCollectionType,
  normalizeCollectionStatus,
  validateAlgorithmKey,
  validateItemLimit,
  type CollectionType,
  type CollectionStatus,
  type AlgorithmKey,
  type CollectionSummary,
  type CollectionDetail,
  type CollectionListFilters,
  type CollectionVenueOverride,
  type CollectionEventOverride,
  type CollectionGuideItem,
  type CollectionUsageSummary,
  type CollectionUsageEntry,
  type CollectionWriteResult,
  type CollectionMutationResult,
} from "@/lib/data/collectionsShared";

export {
  COLLECTION_TYPES,
  isCollectionType,
  normalizeCollectionStatus,
  ALGORITHM_KEYS,
  ALGORITHM_COLLECTION_TYPE,
  isAlgorithmKey,
  validateAlgorithmKey,
  validateItemLimit,
  type CollectionType,
  type CollectionStatus,
  type AlgorithmKey,
  type CollectionSummary,
  type CollectionDetail,
  type CollectionVenueOverride,
  type CollectionEventOverride,
  type CollectionGuideItem,
  type CollectionUsageSummary,
  type CollectionUsageEntry,
  type CollectionListFilters,
  type CollectionWriteResult,
  type CollectionMutationResult,
} from "@/lib/data/collectionsShared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ── Row mappers ──────────────────────────────────────────────────────────────

function mapCollectionSummaryRow(row: Row): CollectionSummary {
  const market = (row.market as Row | null) ?? {};
  const city = (row.city as Row | null) ?? null;
  return {
    id:            row.id as string,
    name:          row.name as string,
    collectionType: row.collection_type as CollectionType,
    status:        normalizeCollectionStatus(row.status as string),
    algorithmKey:  (row.algorithm_key as AlgorithmKey | null) ?? null,
    marketId:      row.market_id as string,
    marketName:    (market.name as string | undefined) ?? "",
    cityId:        (row.city_id as string | null) ?? null,
    cityName:      (city?.name as string | undefined) ?? null,
    updatedAt:     row.updated_at as string,
  };
}

function mapVenueOverrideRow(row: Row): CollectionVenueOverride {
  const venue = (row.venue as Row | null) ?? null;
  return {
    id:           row.id as string,
    collectionId: row.collection_id as string,
    venueId:      row.venue_id as string,
    venueName:    (venue?.name as string | undefined) ?? null,
    action:       row.action as "include" | "exclude",
    boost:        row.boost as number,
    sortOrder:    row.sort_order as number,
    reasonType:   (row.reason_type as string | null) ?? null,
    note:         (row.note as string | null) ?? null,
    createdAt:    row.created_at as string,
    createdBy:    (row.created_by as string | null) ?? null,
    updatedAt:    row.updated_at as string,
    updatedBy:    (row.updated_by as string | null) ?? null,
  };
}

function mapEventOverrideRow(row: Row): CollectionEventOverride {
  const event = (row.event as Row | null) ?? null;
  return {
    id:           row.id as string,
    collectionId: row.collection_id as string,
    eventId:      row.event_id as string,
    eventTitle:   (event?.title as string | undefined) ?? null,
    action:       row.action as "include" | "exclude",
    boost:        row.boost as number,
    sortOrder:    row.sort_order as number,
    reasonType:   (row.reason_type as string | null) ?? null,
    note:         (row.note as string | null) ?? null,
    createdAt:    row.created_at as string,
    createdBy:    (row.created_by as string | null) ?? null,
    updatedAt:    row.updated_at as string,
    updatedBy:    (row.updated_by as string | null) ?? null,
  };
}

function mapGuideItemRow(row: Row): CollectionGuideItem {
  const guide = (row.guide as Row | null) ?? null;
  return {
    id:           row.id as string,
    collectionId: row.collection_id as string,
    guideId:      row.guide_id as string,
    guideTitle:   (guide?.title as string | undefined) ?? null,
    sortOrder:    row.sort_order as number,
    createdAt:    row.created_at as string,
    createdBy:    (row.created_by as string | null) ?? null,
    updatedAt:    row.updated_at as string,
    updatedBy:    (row.updated_by as string | null) ?? null,
  };
}

const COLLECTION_SUMMARY_COLUMNS =
  "id, name, collection_type, status, algorithm_key, market_id, city_id, updated_at, " +
  "market:markets(name), city:cities(name)";

// ── Collection list ──────────────────────────────────────────────────────────

/**
 * Returns Collections for the management list, filtered as requested.
 * Ordering is deterministic (name, then id as a tiebreak) so a filtered list
 * stays stable across reloads/pagination rather than drifting with
 * updated_at churn.
 */
export async function getCollections(filters: CollectionListFilters = {}): Promise<CollectionSummary[]> {
  const supabase = createAdminClient();

  let query = supabase.from("collections").select(COLLECTION_SUMMARY_COLUMNS);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.collectionType) query = query.eq("collection_type", filters.collectionType);
  if (filters.marketId) query = query.eq("market_id", filters.marketId);
  if (filters.cityId) query = query.eq("city_id", filters.cityId);
  if (filters.search?.trim()) query = query.ilike("name", `%${filters.search.trim()}%`);

  const { data, error } = await query
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[getCollections]", error.message);
    return [];
  }
  return (data ?? []).map(mapCollectionSummaryRow);
}

// ── Collection detail ────────────────────────────────────────────────────────

/** Loads one Collection by id, including its geography, relevant membership rows, and current Homepage usage. Returns null if not found. */
export async function getCollectionById(id: string): Promise<CollectionDetail | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("collections")
    .select(
      "id, name, description, collection_type, status, algorithm_key, item_limit, " +
        "market_id, city_id, created_at, updated_at, market:markets(name), city:cities(name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[getCollectionById]", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as Row;
  const collectionType = row.collection_type as CollectionType;

  const [venueOverrides, eventOverrides, guideItems, usage] = await Promise.all([
    collectionType === "venue" ? getCollectionVenueOverrides(id) : Promise.resolve([]),
    collectionType === "event" ? getCollectionEventOverrides(id) : Promise.resolve([]),
    collectionType === "guide" ? getCollectionGuideItems(id) : Promise.resolve([]),
    getCollectionUsage(id),
  ]);

  const market = (row.market as Row | null) ?? {};
  const city = (row.city as Row | null) ?? null;

  return {
    id:             row.id as string,
    name:           row.name as string,
    description:    (row.description as string | null) ?? null,
    collectionType,
    marketId:       row.market_id as string,
    marketName:     (market.name as string | undefined) ?? "",
    cityId:         (row.city_id as string | null) ?? null,
    cityName:       (city?.name as string | undefined) ?? null,
    status:         normalizeCollectionStatus(row.status as string),
    algorithmKey:   (row.algorithm_key as AlgorithmKey | null) ?? null,
    itemLimit:      (row.item_limit as number | null) ?? null,
    createdAt:      row.created_at as string,
    updatedAt:      row.updated_at as string,
    venueOverrides,
    eventOverrides,
    guideItems,
    usage,
  };
}

/** Internal — just enough of a Collection to validate a membership write, without the detail query's joins/usage lookup. */
async function getCollectionForValidation(
  id: string
): Promise<{ id: string; collectionType: CollectionType; marketId: string; cityId: string | null } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("collections")
    .select("id, collection_type, market_id, city_id")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as Row;
  return {
    id: row.id as string,
    collectionType: row.collection_type as CollectionType,
    marketId: row.market_id as string,
    cityId: (row.city_id as string | null) ?? null,
  };
}

// ── Collection creation ──────────────────────────────────────────────────────

export type CreateCollectionInput = {
  name: string;
  description: string | null;
  collectionType: CollectionType;
  marketId: string;
  cityId: string | null;
  status: CollectionStatus;
  algorithmKey: string | null;
  itemLimit: number | null;
};

/**
 * Creates a Collection. Validates name/type/geography/algorithm/item-limit
 * before writing — does NOT seed any legacy Discover rail data (see
 * migration 058's transition-plan header comment; that is explicitly a
 * separate, later task).
 */
export async function createCollection(
  input: CreateCollectionInput,
  actorEmail: string | null = null
): Promise<CollectionWriteResult> {
  const name = input.name.trim();
  if (!name) return { success: false, error: "Name is required." };
  if (!isCollectionType(input.collectionType)) {
    return { success: false, error: `Invalid collection type "${input.collectionType}".` };
  }
  if (!input.marketId) return { success: false, error: "Market is required." };

  const algorithmError = validateAlgorithmKey(input.algorithmKey, input.collectionType);
  if (algorithmError) return { success: false, error: algorithmError };

  const itemLimitError = validateItemLimit(input.itemLimit);
  if (itemLimitError) return { success: false, error: itemLimitError };

  const supabase = createAdminClient();

  const { data: market } = await supabase
    .from("markets")
    .select("id")
    .eq("id", input.marketId)
    .maybeSingle();
  if (!market) return { success: false, error: "Market not found." };

  let cityMarketId: string | null = null;
  if (input.cityId) {
    const { data: city } = await supabase
      .from("cities")
      .select("id, market_id")
      .eq("id", input.cityId)
      .maybeSingle();
    cityMarketId = (city?.market_id as string | undefined) ?? null;
  }
  const geoError = validateCityBelongsToMarket({
    marketId: input.marketId,
    cityId: input.cityId,
    cityMarketId,
  });
  if (geoError) return { success: false, error: geoError };

  const { data, error } = await supabase
    .from("collections")
    .insert({
      name,
      description: input.description?.trim() || null,
      collection_type: input.collectionType,
      market_id: input.marketId,
      city_id: input.cityId,
      status: input.status,
      algorithm_key: input.algorithmKey,
      item_limit: input.itemLimit,
      created_by: actorEmail,
      updated_by: actorEmail,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createCollection]", error.message);
    return { success: false, error: "Failed to create Collection." };
  }
  return { success: true, id: (data as Row).id as string };
}

// ── Collection update ────────────────────────────────────────────────────────

export type UpdateCollectionInput = {
  name?: string;
  description?: string | null;
  marketId?: string;
  cityId?: string | null;
  status?: CollectionStatus;
  algorithmKey?: string | null;
  itemLimit?: number | null;
};

/**
 * Updates a Collection's core fields. collection_type is deliberately not
 * updatable here — changing it while Homepage Sections reference this
 * Collection would violate homepage_sections_collection_type_match
 * (migration 058) and is rejected at the DB level; the data layer simply
 * never offers the field rather than surfacing that as a runtime error.
 */
export async function updateCollection(
  id: string,
  input: UpdateCollectionInput,
  actorEmail: string | null = null
): Promise<CollectionMutationResult> {
  const existing = await getCollectionForValidation(id);
  if (!existing) return { success: false, error: "Collection not found." };

  const patch: Row = { updated_by: actorEmail };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { success: false, error: "Name is required." };
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.algorithmKey !== undefined) {
    const algorithmError = validateAlgorithmKey(input.algorithmKey, existing.collectionType);
    if (algorithmError) return { success: false, error: algorithmError };
    patch.algorithm_key = input.algorithmKey;
  }
  if (input.itemLimit !== undefined) {
    const itemLimitError = validateItemLimit(input.itemLimit);
    if (itemLimitError) return { success: false, error: itemLimitError };
    patch.item_limit = input.itemLimit;
  }

  const nextMarketId = input.marketId ?? existing.marketId;
  const nextCityId = input.cityId !== undefined ? input.cityId : existing.cityId;

  if (input.marketId !== undefined || input.cityId !== undefined) {
    const supabase = createAdminClient();
    let cityMarketId: string | null = null;
    if (nextCityId) {
      const { data: city } = await supabase
        .from("cities")
        .select("id, market_id")
        .eq("id", nextCityId)
        .maybeSingle();
      cityMarketId = (city?.market_id as string | undefined) ?? null;
    }
    const geoError = validateCityBelongsToMarket({
      marketId: nextMarketId,
      cityId: nextCityId,
      cityMarketId,
    });
    if (geoError) return { success: false, error: geoError };

    if (input.marketId !== undefined) patch.market_id = input.marketId;
    if (input.cityId !== undefined) patch.city_id = input.cityId;
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("collections").update(patch).eq("id", id);

  if (error) {
    console.error("[updateCollection]", error.message);
    return { success: false, error: "Failed to update Collection." };
  }
  return { success: true };
}

// ── Content geography validation ─────────────────────────────────────────────
//
// Implements the application-level rule migration 058 could not safely
// express as a composite FK (see that migration's header comment): a Venue/
// Event/Guide added to a Collection must belong to the Collection's declared
// geography — the Collection's market always, and (for a City Collection)
// the Collection's city specifically. Ambiguous/missing content geography is
// rejected outright, never silently allowed (venues.market_id/city_id are
// nullable and not fully backfilled — see migration 048).

function validateContentGeography(
  content: { marketId: string | null; cityId: string | null } | null,
  collection: { marketId: string; cityId: string | null },
  kind: "Venue" | "Event" | "Guide"
): string | null {
  if (!content) return `${kind} not found.`;
  if (content.marketId === null) {
    return `${kind} has no assigned market — cannot add to a Collection until its geography is backfilled.`;
  }
  if (content.marketId !== collection.marketId) {
    return `${kind} does not belong to this Collection's market.`;
  }
  if (collection.cityId !== null) {
    if (content.cityId === null) {
      return `${kind} has no assigned city — cannot add to this City Collection until its geography is backfilled.`;
    }
    if (content.cityId !== collection.cityId) {
      return `${kind} does not belong to this Collection's city.`;
    }
  }
  return null;
}

async function fetchVenueGeographyById(
  venueIds: string[]
): Promise<Map<string, { marketId: string | null; cityId: string | null }>> {
  const supabase = createAdminClient();
  const map = new Map<string, { marketId: string | null; cityId: string | null }>();
  if (venueIds.length === 0) return map;

  const { data, error } = await supabase
    .from("venues")
    .select("id, market_id, city_id")
    .in("id", venueIds);
  if (error) {
    console.error("[fetchVenueGeographyById]", error.message);
    return map;
  }
  for (const row of (data ?? []) as Row[]) {
    map.set(row.id as string, {
      marketId: (row.market_id as string | null) ?? null,
      cityId: (row.city_id as string | null) ?? null,
    });
  }
  return map;
}

async function fetchEventGeographyById(
  eventIds: string[]
): Promise<Map<string, { marketId: string | null; cityId: string | null }>> {
  const supabase = createAdminClient();
  const map = new Map<string, { marketId: string | null; cityId: string | null }>();
  if (eventIds.length === 0) return map;

  // Events have no market_id/city_id of their own — geography is resolved
  // via the parent venue (events.venue_id -> venues.market_id/city_id).
  const { data, error } = await supabase
    .from("events")
    .select("id, venue:venues(market_id, city_id)")
    .in("id", eventIds);
  if (error) {
    console.error("[fetchEventGeographyById]", error.message);
    return map;
  }
  for (const row of (data ?? []) as Row[]) {
    const venue = (row.venue as Row | null) ?? null;
    map.set(row.id as string, {
      marketId: (venue?.market_id as string | null | undefined) ?? null,
      cityId: (venue?.city_id as string | null | undefined) ?? null,
    });
  }
  return map;
}

async function fetchGuideGeographyById(
  guideIds: string[]
): Promise<Map<string, { marketId: string | null; cityId: string | null }>> {
  const supabase = createAdminClient();
  const map = new Map<string, { marketId: string | null; cityId: string | null }>();
  if (guideIds.length === 0) return map;

  const { data, error } = await supabase
    .from("content_guides")
    .select("id, market_id, city_id")
    .in("id", guideIds);
  if (error) {
    console.error("[fetchGuideGeographyById]", error.message);
    return map;
  }
  for (const row of (data ?? []) as Row[]) {
    map.set(row.id as string, {
      marketId: (row.market_id as string | null) ?? null,
      cityId: (row.city_id as string | null) ?? null,
    });
  }
  return map;
}

// ── Venue Collection membership ──────────────────────────────────────────────

export type VenueOverrideInput = {
  venueId: string;
  action: "include" | "exclude";
  boost?: number;
  sortOrder?: number;
  reasonType?: string | null;
  note?: string | null;
};

async function getCollectionVenueOverrides(collectionId: string): Promise<CollectionVenueOverride[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("collection_venue_overrides")
    .select(
      "id, collection_id, venue_id, action, boost, sort_order, reason_type, note, " +
        "created_at, created_by, updated_at, updated_by, venue:venues(name)"
    )
    .eq("collection_id", collectionId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getCollectionVenueOverrides]", error.message);
    return [];
  }
  return (data ?? []).map(mapVenueOverrideRow);
}

/** Adds or updates one venue's membership in a Venue Collection. Validates type + geography before writing. */
export async function upsertVenueOverride(
  collectionId: string,
  input: VenueOverrideInput,
  actorEmail: string | null = null
): Promise<CollectionMutationResult> {
  const collection = await getCollectionForValidation(collectionId);
  if (!collection) return { success: false, error: "Collection not found." };
  if (collection.collectionType !== "venue") {
    return { success: false, error: "This Collection is not a venue Collection." };
  }

  const geography = await fetchVenueGeographyById([input.venueId]);
  const geoError = validateContentGeography(geography.get(input.venueId) ?? null, collection, "Venue");
  if (geoError) return { success: false, error: geoError };

  const supabase = createAdminClient();
  const { error } = await supabase.from("collection_venue_overrides").upsert(
    {
      collection_id: collectionId,
      venue_id: input.venueId,
      action: input.action,
      boost: input.boost ?? 0,
      sort_order: input.sortOrder ?? 0,
      reason_type: input.reasonType ?? null,
      note: input.note ?? null,
      updated_by: actorEmail,
      created_by: actorEmail,
    },
    { onConflict: "collection_id,venue_id" }
  );

  if (error) {
    console.error("[upsertVenueOverride]", error.message);
    return { success: false, error: "Failed to save venue membership." };
  }
  return { success: true };
}

export async function removeVenueOverride(collectionId: string, venueId: string): Promise<CollectionMutationResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("collection_venue_overrides")
    .delete()
    .eq("collection_id", collectionId)
    .eq("venue_id", venueId);

  if (error) {
    console.error("[removeVenueOverride]", error.message);
    return { success: false, error: "Failed to remove venue membership." };
  }
  return { success: true };
}

/**
 * Replaces a Venue Collection's entire manual membership set. Validates
 * every row (type + geography) before writing any of them — if any row
 * fails, nothing is written. Delete-then-insert, the same replacement
 * pattern already used by saveGuideFaqs/saveGuideChannels (no multi-
 * statement DB transaction available via the Supabase JS client — this
 * matches the repository's existing accepted tradeoff there).
 */
export async function replaceVenueOverrides(
  collectionId: string,
  rows: VenueOverrideInput[],
  actorEmail: string | null = null
): Promise<CollectionMutationResult> {
  const collection = await getCollectionForValidation(collectionId);
  if (!collection) return { success: false, error: "Collection not found." };
  if (collection.collectionType !== "venue") {
    return { success: false, error: "This Collection is not a venue Collection." };
  }

  const geography = await fetchVenueGeographyById(rows.map((r) => r.venueId));
  for (const row of rows) {
    const geoError = validateContentGeography(geography.get(row.venueId) ?? null, collection, "Venue");
    if (geoError) return { success: false, error: `${geoError} (venue_id: ${row.venueId})` };
  }

  const supabase = createAdminClient();
  const { error: deleteError } = await supabase
    .from("collection_venue_overrides")
    .delete()
    .eq("collection_id", collectionId);
  if (deleteError) {
    console.error("[replaceVenueOverrides] delete failed:", deleteError.message);
    return { success: false, error: "Failed to replace venue membership." };
  }
  if (rows.length === 0) return { success: true };

  const { error: insertError } = await supabase.from("collection_venue_overrides").insert(
    rows.map((row, index) => ({
      collection_id: collectionId,
      venue_id: row.venueId,
      action: row.action,
      boost: row.boost ?? 0,
      sort_order: row.sortOrder ?? index,
      reason_type: row.reasonType ?? null,
      note: row.note ?? null,
      created_by: actorEmail,
      updated_by: actorEmail,
    }))
  );
  if (insertError) {
    console.error("[replaceVenueOverrides] insert failed:", insertError.message);
    return { success: false, error: "Failed to replace venue membership." };
  }
  return { success: true };
}

// ── Event Collection membership ──────────────────────────────────────────────

export type EventOverrideInput = {
  eventId: string;
  action: "include" | "exclude";
  boost?: number;
  sortOrder?: number;
  reasonType?: string | null;
  note?: string | null;
};

async function getCollectionEventOverrides(collectionId: string): Promise<CollectionEventOverride[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("collection_event_overrides")
    .select(
      "id, collection_id, event_id, action, boost, sort_order, reason_type, note, " +
        "created_at, created_by, updated_at, updated_by, event:events(title)"
    )
    .eq("collection_id", collectionId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getCollectionEventOverrides]", error.message);
    return [];
  }
  return (data ?? []).map(mapEventOverrideRow);
}

export async function upsertEventOverride(
  collectionId: string,
  input: EventOverrideInput,
  actorEmail: string | null = null
): Promise<CollectionMutationResult> {
  const collection = await getCollectionForValidation(collectionId);
  if (!collection) return { success: false, error: "Collection not found." };
  if (collection.collectionType !== "event") {
    return { success: false, error: "This Collection is not an event Collection." };
  }

  const geography = await fetchEventGeographyById([input.eventId]);
  const geoError = validateContentGeography(geography.get(input.eventId) ?? null, collection, "Event");
  if (geoError) return { success: false, error: geoError };

  const supabase = createAdminClient();
  const { error } = await supabase.from("collection_event_overrides").upsert(
    {
      collection_id: collectionId,
      event_id: input.eventId,
      action: input.action,
      boost: input.boost ?? 0,
      sort_order: input.sortOrder ?? 0,
      reason_type: input.reasonType ?? null,
      note: input.note ?? null,
      updated_by: actorEmail,
      created_by: actorEmail,
    },
    { onConflict: "collection_id,event_id" }
  );

  if (error) {
    console.error("[upsertEventOverride]", error.message);
    return { success: false, error: "Failed to save event membership." };
  }
  return { success: true };
}

export async function removeEventOverride(collectionId: string, eventId: string): Promise<CollectionMutationResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("collection_event_overrides")
    .delete()
    .eq("collection_id", collectionId)
    .eq("event_id", eventId);

  if (error) {
    console.error("[removeEventOverride]", error.message);
    return { success: false, error: "Failed to remove event membership." };
  }
  return { success: true };
}

/** Replaces an Event Collection's entire manual membership set — see replaceVenueOverrides for the full rationale (identical pattern). */
export async function replaceEventOverrides(
  collectionId: string,
  rows: EventOverrideInput[],
  actorEmail: string | null = null
): Promise<CollectionMutationResult> {
  const collection = await getCollectionForValidation(collectionId);
  if (!collection) return { success: false, error: "Collection not found." };
  if (collection.collectionType !== "event") {
    return { success: false, error: "This Collection is not an event Collection." };
  }

  const geography = await fetchEventGeographyById(rows.map((r) => r.eventId));
  for (const row of rows) {
    const geoError = validateContentGeography(geography.get(row.eventId) ?? null, collection, "Event");
    if (geoError) return { success: false, error: `${geoError} (event_id: ${row.eventId})` };
  }

  const supabase = createAdminClient();
  const { error: deleteError } = await supabase
    .from("collection_event_overrides")
    .delete()
    .eq("collection_id", collectionId);
  if (deleteError) {
    console.error("[replaceEventOverrides] delete failed:", deleteError.message);
    return { success: false, error: "Failed to replace event membership." };
  }
  if (rows.length === 0) return { success: true };

  const { error: insertError } = await supabase.from("collection_event_overrides").insert(
    rows.map((row, index) => ({
      collection_id: collectionId,
      event_id: row.eventId,
      action: row.action,
      boost: row.boost ?? 0,
      sort_order: row.sortOrder ?? index,
      reason_type: row.reasonType ?? null,
      note: row.note ?? null,
      created_by: actorEmail,
      updated_by: actorEmail,
    }))
  );
  if (insertError) {
    console.error("[replaceEventOverrides] insert failed:", insertError.message);
    return { success: false, error: "Failed to replace event membership." };
  }
  return { success: true };
}

// ── Guide Collection membership ──────────────────────────────────────────────

export type GuideItemInput = {
  guideId: string;
  sortOrder?: number;
};

async function getCollectionGuideItems(collectionId: string): Promise<CollectionGuideItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("collection_guide_items")
    .select(
      "id, collection_id, guide_id, sort_order, created_at, created_by, updated_at, updated_by, guide:content_guides(title)"
    )
    .eq("collection_id", collectionId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getCollectionGuideItems]", error.message);
    return [];
  }
  return (data ?? []).map(mapGuideItemRow);
}

export async function upsertGuideItem(
  collectionId: string,
  input: GuideItemInput,
  actorEmail: string | null = null
): Promise<CollectionMutationResult> {
  const collection = await getCollectionForValidation(collectionId);
  if (!collection) return { success: false, error: "Collection not found." };
  if (collection.collectionType !== "guide") {
    return { success: false, error: "This Collection is not a guide Collection." };
  }

  const geography = await fetchGuideGeographyById([input.guideId]);
  const geoError = validateContentGeography(geography.get(input.guideId) ?? null, collection, "Guide");
  if (geoError) return { success: false, error: geoError };

  const supabase = createAdminClient();
  const { error } = await supabase.from("collection_guide_items").upsert(
    {
      collection_id: collectionId,
      guide_id: input.guideId,
      sort_order: input.sortOrder ?? 0,
      updated_by: actorEmail,
      created_by: actorEmail,
    },
    { onConflict: "collection_id,guide_id" }
  );

  if (error) {
    console.error("[upsertGuideItem]", error.message);
    return { success: false, error: "Failed to save guide membership." };
  }
  return { success: true };
}

export async function removeGuideItem(collectionId: string, guideId: string): Promise<CollectionMutationResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("collection_guide_items")
    .delete()
    .eq("collection_id", collectionId)
    .eq("guide_id", guideId);

  if (error) {
    console.error("[removeGuideItem]", error.message);
    return { success: false, error: "Failed to remove guide membership." };
  }
  return { success: true };
}

/** Replaces a Guide Collection's entire manual membership set — see replaceVenueOverrides for the full rationale (identical pattern). */
export async function replaceGuideItems(
  collectionId: string,
  rows: GuideItemInput[],
  actorEmail: string | null = null
): Promise<CollectionMutationResult> {
  const collection = await getCollectionForValidation(collectionId);
  if (!collection) return { success: false, error: "Collection not found." };
  if (collection.collectionType !== "guide") {
    return { success: false, error: "This Collection is not a guide Collection." };
  }

  const geography = await fetchGuideGeographyById(rows.map((r) => r.guideId));
  for (const row of rows) {
    const geoError = validateContentGeography(geography.get(row.guideId) ?? null, collection, "Guide");
    if (geoError) return { success: false, error: `${geoError} (guide_id: ${row.guideId})` };
  }

  const supabase = createAdminClient();
  const { error: deleteError } = await supabase
    .from("collection_guide_items")
    .delete()
    .eq("collection_id", collectionId);
  if (deleteError) {
    console.error("[replaceGuideItems] delete failed:", deleteError.message);
    return { success: false, error: "Failed to replace guide membership." };
  }
  if (rows.length === 0) return { success: true };

  const { error: insertError } = await supabase.from("collection_guide_items").insert(
    rows.map((row, index) => ({
      collection_id: collectionId,
      guide_id: row.guideId,
      sort_order: row.sortOrder ?? index,
      created_by: actorEmail,
      updated_by: actorEmail,
    }))
  );
  if (insertError) {
    console.error("[replaceGuideItems] insert failed:", insertError.message);
    return { success: false, error: "Failed to replace guide membership." };
  }
  return { success: true };
}

// ── Collection usage (delete-protection readiness) ──────────────────────────

/**
 * Reports which Homepage Sections currently reference this Collection. Read
 * only — does not weaken or duplicate the DB's own ON DELETE RESTRICT
 * (homepage_sections_collection_type_match, migration 058), which remains
 * the authoritative backstop regardless of what this reports.
 */
export async function getCollectionUsage(collectionId: string): Promise<CollectionUsageSummary> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("homepage_sections")
    .select(
      "id, section_type, title, " +
        "homepage:homepages(id, name, status, market:markets(name), city:cities(name))"
    )
    .eq("collection_id", collectionId);

  if (error) {
    console.error("[getCollectionUsage]", error.message);
    return { collectionId, isUsedByPublishedHomepage: false, entries: [] };
  }

  const entries: CollectionUsageEntry[] = (data ?? []).map((row: Row) => {
    const homepage = (row.homepage as Row | null) ?? {};
    const market = (homepage.market as Row | null) ?? {};
    const city = (homepage.city as Row | null) ?? null;
    return {
      homepageId: homepage.id as string,
      homepageName: (homepage.name as string | undefined) ?? "",
      homepageStatus: normalizeHomepageStatus((homepage.status as string | undefined) ?? "draft"),
      homepageMarketName: (market.name as string | undefined) ?? "",
      homepageCityName: (city?.name as string | undefined) ?? null,
      sectionId: row.id as string,
      sectionType: row.section_type as CollectionType,
      sectionTitle: row.title as string,
    };
  });

  return {
    collectionId,
    isUsedByPublishedHomepage: entries.some((e) => e.homepageStatus === "published"),
    entries,
  };
}
