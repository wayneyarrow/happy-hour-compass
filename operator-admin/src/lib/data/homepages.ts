/**
 * Server-side data helpers for the Homepages data layer
 * (homepages, homepage_sections — migrations
 * 058_collections_homepages_foundation.sql and
 * 060_homepage_sections_editor.sql).
 *
 * Must only be imported from Server Components, Route Handlers, or Server
 * Actions. Client-safe constants, types, and pure validators live in
 * homepagesShared.ts.
 *
 * Internal-only tables (no RLS policies for anon/authenticated) — always
 * queried via createAdminClient() (service-role), consistent with
 * contentGuides.ts / collections.ts.
 *
 * The "public loader" functions at the bottom (getPublishedMarketHomepage,
 * getPublishedCityHomepage, getPublishedHomepageForLocation) are the
 * published-only geography resolution used by the public Homepage route
 * (see homepagePublic.ts, which layers Section-content resolution on top of
 * what these return). See docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md
 * "Homepage Fallback" for the product rule they implement (City Homepage
 * first, Market Homepage fallback).
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  validateCityBelongsToMarket,
  getMarketBySlug,
  getCityBySlug,
  getAllMarkets,
  getCitiesByMarket,
} from "@/lib/geo/geography";
import type { MarketRecord, CityRecord } from "@/lib/geo/types";
import { getCollections } from "@/lib/data/collections";
import {
  normalizeCollectionStatus,
  type CollectionType,
  type CollectionSummary,
} from "@/lib/data/collectionsShared";
import {
  isHomepageSectionType,
  normalizeHomepageStatus,
  normalizeContentMode,
  isCollectionAssignableToHomepage,
  type HomepageStatus,
  type HomepageSectionType,
  type HomepageSectionContentMode,
  type HomepageSummary,
  type HomepageDetail,
  type HomepageSection,
  type HomepageSectionCollectionRef,
  type HomepageSectionFeatureRef,
  type HomepageGuideFeatureCandidate,
  type HomepageListFilters,
  type HomepageWriteResult,
  type HomepageMutationResult,
} from "@/lib/data/homepagesShared";

export {
  HOMEPAGE_SECTION_TYPES,
  HOMEPAGE_SECTION_KINDS,
  SECTION_KIND_LABELS,
  isHomepageSectionType,
  isHomepageSectionKind,
  normalizeHomepageStatus,
  normalizeContentMode,
  isCollectionAssignableToHomepage,
  toSectionKind,
  fromSectionKind,
  type HomepageStatus,
  type HomepageSectionType,
  type HomepageSectionContentMode,
  type HomepageSectionKind,
  type HomepageSummary,
  type HomepageDetail,
  type HomepageSection,
  type HomepageSectionCollectionRef,
  type HomepageSectionFeatureRef,
  type HomepageGuideFeatureCandidate,
  type HomepageListFilters,
  type HomepageWriteResult,
  type HomepageMutationResult,
} from "@/lib/data/homepagesShared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// `city:cities!city_id(...)` disambiguates the embed: homepages has two FK
// paths to cities (the plain city_id FK, and the composite
// homepages_city_market_consistency FK — migration 058) — same fix as
// collections.ts's identical `city:cities!city_id(name)` (see its comment).
const HOMEPAGE_SUMMARY_COLUMNS =
  "id, name, status, market_id, city_id, updated_at, market:markets(name), city:cities!city_id(name)";

const HOMEPAGE_DETAIL_COLUMNS =
  "id, name, status, market_id, city_id, page_title, meta_title, meta_description, " +
  "og_title, og_description, canonical_url, created_at, updated_at, " +
  "market:markets(name), city:cities!city_id(name)";

// content_mode/venue_id/event_id/guide_id — migration 060. venue_id/event_id/
// guide_id each have exactly one FK path to their target table (no composite
// twin the way collection_id has), so none of these embeds need the
// `!column` disambiguation hint collection_id's embed above needs.
const SECTION_COLUMNS =
  "id, homepage_id, section_type, content_mode, title, collection_id, venue_id, event_id, guide_id, " +
  "display_order, is_enabled, created_at, updated_at, " +
  "collection:collections(id, name, collection_type, status, market_id, city_id), " +
  "venue:venues(id, name, city), " +
  "event:events(id, title, venue:venues(name, city)), " +
  "guide:content_guides(id, title)";

// ── Row mappers ──────────────────────────────────────────────────────────────

function mapHomepageSummaryRow(row: Row): HomepageSummary {
  const market = (row.market as Row | null) ?? {};
  const city = (row.city as Row | null) ?? null;
  return {
    id:         row.id as string,
    name:       row.name as string,
    status:     normalizeHomepageStatus(row.status as string),
    marketId:   row.market_id as string,
    marketName: (market.name as string | undefined) ?? "",
    cityId:     (row.city_id as string | null) ?? null,
    cityName:   (city?.name as string | undefined) ?? null,
    updatedAt:  row.updated_at as string,
  };
}

function mapSectionCollectionRef(row: Row | null): HomepageSectionCollectionRef | null {
  if (!row) return null;
  return {
    id:             row.id as string,
    name:           row.name as string,
    collectionType: row.collection_type as CollectionType,
    status:         normalizeCollectionStatus(row.status as string),
    marketId:       row.market_id as string,
    cityId:         (row.city_id as string | null) ?? null,
  };
}

/** Resolves whichever of venue/event/guide is the Feature target — only one of the three raw *_id columns is ever set (see homepage_sections_content_mode_target_check, migration 060). */
function mapSectionFeatureRef(row: Row): HomepageSectionFeatureRef | null {
  if (row.venue_id && row.venue) {
    const v = row.venue as Row;
    return { id: v.id as string, name: v.name as string, secondaryLabel: (v.city as string | null) ?? null };
  }
  if (row.event_id && row.event) {
    const e = row.event as Row;
    const venue = (e.venue as Row | null) ?? null;
    const venueName = (venue?.name as string | undefined) ?? "";
    const venueCity = (venue?.city as string | null) ?? null;
    return {
      id: e.id as string,
      name: e.title as string,
      secondaryLabel: venueCity ? `${venueName} · ${venueCity}` : venueName || null,
    };
  }
  if (row.guide_id && row.guide) {
    const g = row.guide as Row;
    return { id: g.id as string, name: g.title as string, secondaryLabel: null };
  }
  return null;
}

function mapHomepageSectionRow(row: Row): HomepageSection {
  const contentMode = normalizeContentMode(row.content_mode as string);
  return {
    id:           row.id as string,
    homepageId:   row.homepage_id as string,
    sectionType:  row.section_type as HomepageSectionType,
    contentMode,
    title:        row.title as string,
    collectionId: (row.collection_id as string | null) ?? null,
    collection:   mapSectionCollectionRef((row.collection as Row | null) ?? null),
    venueId:      (row.venue_id as string | null) ?? null,
    eventId:      (row.event_id as string | null) ?? null,
    guideId:      (row.guide_id as string | null) ?? null,
    feature:      contentMode === "feature" ? mapSectionFeatureRef(row) : null,
    displayOrder: row.display_order as number,
    isEnabled:    row.is_enabled as boolean,
    createdAt:    row.created_at as string,
    updatedAt:    row.updated_at as string,
  };
}

async function getHomepageSections(homepageId: string): Promise<HomepageSection[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("homepage_sections")
    .select(SECTION_COLUMNS)
    .eq("homepage_id", homepageId)
    .order("display_order", { ascending: true });

  if (error) {
    console.error("[getHomepageSections]", error.message);
    return [];
  }
  return (data ?? []).map(mapHomepageSectionRow);
}

// ── Form geography (create/edit page) ───────────────────────────────────────

export type HomepageFormGeography = { markets: MarketRecord[]; cities: CityRecord[] };

/** Mirrors getCollectionFormGeography() in collections.ts — Homepages have no neighbourhood tier. */
export async function getHomepageFormGeography(): Promise<HomepageFormGeography> {
  const markets = await getAllMarkets();
  const citiesByMarket = await Promise.all(markets.map((m) => getCitiesByMarket(m.id)));
  return { markets, cities: citiesByMarket.flat() };
}

// ── Homepage list ────────────────────────────────────────────────────────────

/** Returns Homepages for the management list. Deterministic ordering (name, then id) for a stable filtered list. */
export async function getHomepages(filters: HomepageListFilters = {}): Promise<HomepageSummary[]> {
  const supabase = createAdminClient();

  let query = supabase.from("homepages").select(HOMEPAGE_SUMMARY_COLUMNS);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.marketId) query = query.eq("market_id", filters.marketId);
  if (filters.cityId) query = query.eq("city_id", filters.cityId);

  const { data, error } = await query
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[getHomepages]", error.message);
    return [];
  }
  return (data ?? []).map(mapHomepageSummaryRow);
}

// ── Homepage detail ──────────────────────────────────────────────────────────

/** Loads one Homepage by id with all sections ordered by display_order (unfiltered — includes disabled sections, for the editor). Returns null if not found. */
export async function getHomepageById(id: string): Promise<HomepageDetail | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("homepages")
    .select(HOMEPAGE_DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[getHomepageById]", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as Row;
  const sections = await getHomepageSections(id);

  return {
    ...mapHomepageSummaryRow(row),
    pageTitle:       (row.page_title as string | null) ?? null,
    metaTitle:       (row.meta_title as string | null) ?? null,
    metaDescription: (row.meta_description as string | null) ?? null,
    ogTitle:         (row.og_title as string | null) ?? null,
    ogDescription:   (row.og_description as string | null) ?? null,
    canonicalUrl:    (row.canonical_url as string | null) ?? null,
    createdAt:       row.created_at as string,
    sections,
  };
}

/** Internal — just enough of a Homepage to validate a section write. */
async function getHomepageForValidation(
  id: string
): Promise<{ id: string; marketId: string; cityId: string | null } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("homepages")
    .select("id, market_id, city_id")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as Row;
  return { id: row.id as string, marketId: row.market_id as string, cityId: (row.city_id as string | null) ?? null };
}

// ── Homepage creation ────────────────────────────────────────────────────────

export type CreateHomepageInput = {
  name: string;
  marketId: string;
  cityId: string | null;
  status: HomepageStatus;
  pageTitle?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  canonicalUrl?: string | null;
};

/**
 * Creates a Homepage. Validates geography, then relies on the DB's own
 * partial unique indexes (homepages_one_market_homepage_per_market,
 * homepages_one_homepage_per_city — migration 058) as the authoritative
 * duplicate-geography guard, translating a 23505 violation into a readable
 * error rather than surfacing the raw Postgres error.
 *
 * Creates with zero Sections — the Homepage Sections editor (control-panel/
 * homepages/HomepageSectionsEditor.tsx) starts from an empty state and adds
 * Sections one at a time via "Add Section". An earlier version of this data
 * layer offered createHomepageWithDefaultTemplate() to pre-seed three fixed,
 * unassigned Sections (Featured Venues/Events/Guides) — removed once the
 * Homepage Sections editor task replaced that rigid three-slot template with
 * a top-down, repeatable Add Section workflow supporting six Section Types;
 * a fixed three-slot template no longer matches the product.
 */
export async function createHomepage(
  input: CreateHomepageInput,
  actorEmail: string | null = null
): Promise<HomepageWriteResult> {
  const name = input.name.trim();
  if (!name) return { success: false, error: "Name is required." };
  if (!input.marketId) return { success: false, error: "Market is required." };

  const supabase = createAdminClient();

  const { data: market } = await supabase.from("markets").select("id").eq("id", input.marketId).maybeSingle();
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
    .from("homepages")
    .insert({
      name,
      market_id: input.marketId,
      city_id: input.cityId,
      status: input.status,
      page_title: input.pageTitle ?? null,
      meta_title: input.metaTitle ?? null,
      meta_description: input.metaDescription ?? null,
      og_title: input.ogTitle ?? null,
      og_description: input.ogDescription ?? null,
      canonical_url: input.canonicalUrl ?? null,
      created_by: actorEmail,
      updated_by: actorEmail,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createHomepage]", error.message);
    if (error.code === "23505") {
      return {
        success: false,
        error: input.cityId
          ? "A Homepage already exists for this city."
          : "A Homepage already exists for this market.",
      };
    }
    return { success: false, error: "Failed to create Homepage." };
  }
  return { success: true, id: (data as Row).id as string };
}

// ── Homepage update ──────────────────────────────────────────────────────────

export type UpdateHomepageInput = {
  name?: string;
  marketId?: string;
  cityId?: string | null;
  status?: HomepageStatus;
  pageTitle?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  canonicalUrl?: string | null;
};

export async function updateHomepage(
  id: string,
  input: UpdateHomepageInput,
  actorEmail: string | null = null
): Promise<HomepageMutationResult> {
  const existing = await getHomepageForValidation(id);
  if (!existing) return { success: false, error: "Homepage not found." };

  const patch: Row = { updated_by: actorEmail };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { success: false, error: "Name is required." };
    patch.name = name;
  }
  if (input.status !== undefined) patch.status = input.status;
  if (input.pageTitle !== undefined) patch.page_title = input.pageTitle;
  if (input.metaTitle !== undefined) patch.meta_title = input.metaTitle;
  if (input.metaDescription !== undefined) patch.meta_description = input.metaDescription;
  if (input.ogTitle !== undefined) patch.og_title = input.ogTitle;
  if (input.ogDescription !== undefined) patch.og_description = input.ogDescription;
  if (input.canonicalUrl !== undefined) patch.canonical_url = input.canonicalUrl;

  const nextMarketId = input.marketId ?? existing.marketId;
  const nextCityId = input.cityId !== undefined ? input.cityId : existing.cityId;

  const supabase = createAdminClient();

  if (input.marketId !== undefined || input.cityId !== undefined) {
    let cityMarketId: string | null = null;
    if (nextCityId) {
      const { data: city } = await supabase
        .from("cities")
        .select("id, market_id")
        .eq("id", nextCityId)
        .maybeSingle();
      cityMarketId = (city?.market_id as string | undefined) ?? null;
    }
    const geoError = validateCityBelongsToMarket({ marketId: nextMarketId, cityId: nextCityId, cityMarketId });
    if (geoError) return { success: false, error: geoError };

    if (input.marketId !== undefined) patch.market_id = input.marketId;
    if (input.cityId !== undefined) patch.city_id = input.cityId;
  }

  const { error } = await supabase.from("homepages").update(patch).eq("id", id);

  if (error) {
    console.error("[updateHomepage]", error.message);
    if (error.code === "23505") {
      return { success: false, error: "A Homepage already exists for that geography." };
    }
    return { success: false, error: "Failed to update Homepage." };
  }
  return { success: true };
}

// ── Section content validation ────────────────────────────────────────────────

/** Shared by createHomepageSection and updateHomepageSectionContent for Collection-mode Sections. */
async function validateSectionCollectionAssignment(
  homepage: { marketId: string; cityId: string | null },
  sectionType: HomepageSectionType,
  collectionId: string
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("collections")
    .select("id, collection_type, status, market_id, city_id, archived_at")
    .eq("id", collectionId)
    .maybeSingle();

  if (error || !data) return "Collection not found.";
  const row = data as Row;

  // Archived Collections (migration 059) can't be assigned to a new
  // Homepage Section — archiving is a separate lifecycle from `status`, but
  // an archived Collection is no longer an active editorial asset.
  if (row.archived_at) {
    return "This Collection is archived and can't be assigned to a Homepage Section. Restore it first.";
  }
  if (normalizeCollectionStatus(row.status as string) !== "published") {
    return "Only Published Collections can be assigned to a Homepage Section.";
  }
  if ((row.collection_type as string) !== sectionType) {
    return `A ${sectionType} section requires a ${sectionType} Collection.`;
  }
  const collectionGeo = { marketId: row.market_id as string, cityId: (row.city_id as string | null) ?? null };
  if (!isCollectionAssignableToHomepage(homepage, collectionGeo)) {
    return "This Collection's geography is not compatible with this Homepage.";
  }
  return null;
}

/**
 * Feature-content geography rule — deliberately different from
 * isCollectionAssignableToHomepage's Collection-reuse rule. A single Venue/
 * Event/Guide always belongs to one concrete city; there is no "market-level
 * Venue" the way there's a market-level Collection (city_id IS NULL). So a
 * Market Homepage may feature anything within the market (any city); a City
 * Homepage may only feature content in that exact city — no market-level
 * fallback, unlike Collection reuse.
 */
function isFeatureContentAssignableToHomepage(
  homepage: { marketId: string; cityId: string | null },
  content: { marketId: string | null; cityId: string | null }
): boolean {
  if (content.marketId !== homepage.marketId) return false;
  if (homepage.cityId === null) return true;
  return content.cityId === homepage.cityId;
}

/** Shared by createHomepageSection and updateHomepageSectionContent for Feature-mode Sections — mirrors validateSectionCollectionAssignment's shape. */
async function validateFeatureContentAssignment(
  homepage: { marketId: string; cityId: string | null },
  sectionType: HomepageSectionType,
  contentId: string
): Promise<string | null> {
  const supabase = createAdminClient();

  if (sectionType === "venue") {
    const { data, error } = await supabase
      .from("venues")
      .select("id, market_id, city_id, is_published")
      .eq("id", contentId)
      .maybeSingle();
    if (error || !data) return "Venue not found.";
    const row = data as Row;
    if (!row.is_published) return "This Venue is not published and can't be featured.";
    if (!isFeatureContentAssignableToHomepage(homepage, { marketId: (row.market_id as string | null) ?? null, cityId: (row.city_id as string | null) ?? null })) {
      return "This Venue's geography is not compatible with this Homepage.";
    }
    return null;
  }

  if (sectionType === "event") {
    const { data, error } = await supabase
      .from("events")
      .select("id, is_published, venue:venues(market_id, city_id)")
      .eq("id", contentId)
      .maybeSingle();
    if (error || !data) return "Event not found.";
    const row = data as Row;
    if (!row.is_published) return "This Event is not published and can't be featured.";
    const venue = (row.venue as Row | null) ?? {};
    if (!isFeatureContentAssignableToHomepage(homepage, { marketId: (venue.market_id as string | null) ?? null, cityId: (venue.city_id as string | null) ?? null })) {
      return "This Event's geography is not compatible with this Homepage.";
    }
    return null;
  }

  // guide
  const { data, error } = await supabase
    .from("content_guides")
    .select("id, status, market_id, city_id")
    .eq("id", contentId)
    .maybeSingle();
  if (error || !data) return "Guide not found.";
  const row = data as Row;
  if ((row.status as string) !== "published") {
    return "This Guide is not published and can't be featured.";
  }
  if (!isFeatureContentAssignableToHomepage(homepage, { marketId: (row.market_id as string | null) ?? null, cityId: (row.city_id as string | null) ?? null })) {
    return "This Guide's geography is not compatible with this Homepage.";
  }
  return null;
}

type ContentColumn = "collection_id" | "venue_id" | "event_id" | "guide_id";

/** "A Homepage may not use the same Collection or Feature more than once" — checked against every OTHER Section on this Homepage. excludeSectionId lets an edit re-save its own current content without tripping over itself. Backed by the four partial unique indexes added in migration 060 (homepage_sections_unique_*_per_homepage) as the authoritative DB-level guard; this is the friendly pre-check. */
async function isContentAlreadyUsed(
  homepageId: string,
  column: ContentColumn,
  value: string,
  excludeSectionId: string | null
): Promise<boolean> {
  const supabase = createAdminClient();
  let query = supabase.from("homepage_sections").select("id").eq("homepage_id", homepageId).eq(column, value);
  if (excludeSectionId) query = query.neq("id", excludeSectionId);
  const { data } = await query.maybeSingle();
  return Boolean(data);
}

const CONTENT_COLUMN_LABEL: Record<ContentColumn, string> = {
  collection_id: "Collection",
  venue_id: "Venue",
  event_id: "Event",
  guide_id: "Guide",
};

function contentColumnFor(sectionType: HomepageSectionType): ContentColumn {
  return sectionType === "venue" ? "venue_id" : sectionType === "event" ? "event_id" : "guide_id";
}

// ── Homepage Sections — create ────────────────────────────────────────────────

export type CreateHomepageSectionInput = {
  sectionType: HomepageSectionType;
  contentMode: HomepageSectionContentMode;
  title: string;
  collectionId?: string | null;
  venueId?: string | null;
  eventId?: string | null;
  guideId?: string | null;
};

/**
 * Adds a Section to the bottom of a Homepage. No more one-Section-per-type
 * limit (migration 060 dropped homepage_sections_unique_type_per_homepage) —
 * "repeat as needed" is the approved workflow. display_order is always
 * computed as the current max + 1, so a new Section always lands at the
 * bottom, matching "The section is immediately added to the bottom of the
 * Homepage."
 */
export async function createHomepageSection(
  homepageId: string,
  input: CreateHomepageSectionInput,
  actorEmail: string | null = null
): Promise<HomepageWriteResult> {
  const homepage = await getHomepageForValidation(homepageId);
  if (!homepage) return { success: false, error: "Homepage not found." };
  if (!isHomepageSectionType(input.sectionType)) {
    return { success: false, error: `Invalid section type "${input.sectionType}".` };
  }
  const title = input.title.trim();
  if (!title) return { success: false, error: "A public heading is required." };

  const supabase = createAdminClient();
  const insertRow: Row = {
    homepage_id: homepageId,
    section_type: input.sectionType,
    content_mode: input.contentMode,
    title,
    collection_id: null,
    venue_id: null,
    event_id: null,
    guide_id: null,
    is_enabled: true,
    created_by: actorEmail,
    updated_by: actorEmail,
  };

  if (input.contentMode === "collection") {
    const collectionId = input.collectionId ?? null;
    if (!collectionId) return { success: false, error: "Select a Collection." };
    const collectionError = await validateSectionCollectionAssignment(homepage, input.sectionType, collectionId);
    if (collectionError) return { success: false, error: collectionError };
    if (await isContentAlreadyUsed(homepageId, "collection_id", collectionId, null)) {
      return { success: false, error: "This Collection is already used on this Homepage." };
    }
    insertRow.collection_id = collectionId;
  } else {
    const column = contentColumnFor(input.sectionType);
    const contentId =
      input.sectionType === "venue" ? input.venueId ?? null :
      input.sectionType === "event" ? input.eventId ?? null :
      input.guideId ?? null;
    if (!contentId) return { success: false, error: `Select a ${CONTENT_COLUMN_LABEL[column]}.` };
    const contentError = await validateFeatureContentAssignment(homepage, input.sectionType, contentId);
    if (contentError) return { success: false, error: contentError };
    if (await isContentAlreadyUsed(homepageId, column, contentId, null)) {
      return { success: false, error: `This ${CONTENT_COLUMN_LABEL[column]} is already used on this Homepage.` };
    }
    insertRow[column] = contentId;
  }

  // Append to the bottom.
  const { data: maxRow } = await supabase
    .from("homepage_sections")
    .select("display_order")
    .eq("homepage_id", homepageId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  insertRow.display_order = maxRow ? (maxRow.display_order as number) + 1 : 0;

  const { data, error } = await supabase
    .from("homepage_sections")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    console.error("[createHomepageSection]", error.message);
    if (error.code === "23505") {
      return { success: false, error: "This content is already used on this Homepage." };
    }
    return { success: false, error: "Failed to create section." };
  }
  return { success: true, id: (data as Row).id as string };
}

// ── Homepage Sections — edit (heading + content together) ───────────────────

export type UpdateHomepageSectionContentInput = {
  title: string;
  collectionId?: string | null;
  venueId?: string | null;
  eventId?: string | null;
  guideId?: string | null;
};

/**
 * Edits a Section's public heading and/or its assigned content.
 * sectionType and contentMode are locked at creation and never change here
 * — "Edit... Change the public heading. Select different compatible
 * content" (approved behavior does not include changing Section Type).
 * Only the one content column matching the Section's existing
 * sectionType/contentMode is ever read from `input` or written.
 */
export async function updateHomepageSectionContent(
  sectionId: string,
  input: UpdateHomepageSectionContentInput,
  actorEmail: string | null = null
): Promise<HomepageMutationResult> {
  const supabase = createAdminClient();
  const { data: section, error: sectionError } = await supabase
    .from("homepage_sections")
    .select("id, homepage_id, section_type, content_mode")
    .eq("id", sectionId)
    .maybeSingle();
  if (sectionError || !section) return { success: false, error: "Section not found." };
  const sectionRow = section as Row;
  const homepageId = sectionRow.homepage_id as string;
  const sectionType = sectionRow.section_type as HomepageSectionType;
  const contentMode = normalizeContentMode(sectionRow.content_mode as string);

  const homepage = await getHomepageForValidation(homepageId);
  if (!homepage) return { success: false, error: "Homepage not found." };

  const title = input.title.trim();
  if (!title) return { success: false, error: "A public heading is required." };

  const patch: Row = { title, updated_by: actorEmail };

  if (contentMode === "collection") {
    const collectionId = input.collectionId ?? null;
    if (!collectionId) return { success: false, error: "Select a Collection." };
    const collectionError = await validateSectionCollectionAssignment(homepage, sectionType, collectionId);
    if (collectionError) return { success: false, error: collectionError };
    if (await isContentAlreadyUsed(homepageId, "collection_id", collectionId, sectionId)) {
      return { success: false, error: "This Collection is already used on this Homepage." };
    }
    patch.collection_id = collectionId;
  } else {
    const column = contentColumnFor(sectionType);
    const contentId =
      sectionType === "venue" ? input.venueId ?? null :
      sectionType === "event" ? input.eventId ?? null :
      input.guideId ?? null;
    if (!contentId) return { success: false, error: `Select a ${CONTENT_COLUMN_LABEL[column]}.` };
    const contentError = await validateFeatureContentAssignment(homepage, sectionType, contentId);
    if (contentError) return { success: false, error: contentError };
    if (await isContentAlreadyUsed(homepageId, column, contentId, sectionId)) {
      return { success: false, error: `This ${CONTENT_COLUMN_LABEL[column]} is already used on this Homepage.` };
    }
    patch[column] = contentId;
  }

  const { error } = await supabase.from("homepage_sections").update(patch).eq("id", sectionId);
  if (error) {
    console.error("[updateHomepageSectionContent]", error.message);
    if (error.code === "23505") {
      return { success: false, error: "This content is already used on this Homepage." };
    }
    return { success: false, error: "Failed to update section." };
  }
  return { success: true };
}

// ── Homepage Sections — reorder ──────────────────────────────────────────────

/** Reassigns display_order 0..n-1 to match array position. Rejects if the id set doesn't exactly match the Homepage's current sections (deterministic — no partial reorders). Powers Move Up / Move Down (the caller swaps two adjacent ids and passes the full resulting order). */
export async function updateHomepageSectionOrder(
  homepageId: string,
  orderedSectionIds: string[],
  actorEmail: string | null = null
): Promise<HomepageMutationResult> {
  const supabase = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from("homepage_sections")
    .select("id")
    .eq("homepage_id", homepageId);
  if (fetchError) {
    console.error("[updateHomepageSectionOrder]", fetchError.message);
    return { success: false, error: "Failed to load sections." };
  }

  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  const hasExactMatch =
    orderedSectionIds.length === existingIds.size && orderedSectionIds.every((id) => existingIds.has(id));
  if (!hasExactMatch) {
    return { success: false, error: "Section list does not match this Homepage's current sections." };
  }

  const results = await Promise.all(
    orderedSectionIds.map((id, index) =>
      supabase.from("homepage_sections").update({ display_order: index, updated_by: actorEmail }).eq("id", id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("[updateHomepageSectionOrder]", failed.error.message);
    return { success: false, error: "Failed to update section order." };
  }
  return { success: true };
}

// ── Homepage Sections — remove ───────────────────────────────────────────────

/** Removes a Section from a Homepage only — never touches the underlying Collection/Venue/Event/Guide. (ON DELETE CASCADE only ever runs the other direction: deleting the *content* removes a Feature Section that pointed at it, never the reverse.) */
export async function deleteHomepageSection(
  homepageId: string,
  sectionId: string
): Promise<HomepageMutationResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("homepage_sections")
    .delete()
    .eq("id", sectionId)
    .eq("homepage_id", homepageId);

  if (error) {
    console.error("[deleteHomepageSection]", error.message);
    return { success: false, error: "Failed to remove section." };
  }
  return { success: true };
}

// ── Assignable content for the Sections editor ──────────────────────────────

/**
 * Published Collections of the right type, filtered to this Homepage's
 * geography per isCollectionAssignableToHomepage — the "editors should
 * always be guided toward the correct choices through filtered, geography-
 * aware workflows" behavior the spec describes for the Section editor's
 * Collection picker. Does not exclude Collections already used elsewhere on
 * this Homepage — the editor shows those disabled-but-visible instead (see
 * product task "Already-used content should remain visible but be
 * disabled").
 */
export async function getAssignableCollectionsForSection(
  homepageId: string,
  sectionType: HomepageSectionType
): Promise<CollectionSummary[]> {
  const homepage = await getHomepageForValidation(homepageId);
  if (!homepage) return [];

  const candidates = await getCollections({ collectionType: sectionType, status: "published" });
  return candidates.filter((c) => isCollectionAssignableToHomepage(homepage, { marketId: c.marketId, cityId: c.cityId }));
}

/**
 * Published-only guide candidates for a Guide Feature Section — mirrors
 * getEligibleGuidesForCollection (collections.ts) but restricted to
 * Published guides only. A Guide Collection may stage Draft guides before
 * the Collection itself is published; a Guide Feature Section publishes a
 * single guide directly to the public Homepage, so only already-Published
 * guides are eligible. Takes homepageId (not raw marketId/cityId) to mirror
 * getAssignableCollectionsForSection's signature exactly.
 */
export async function getAssignableGuidesForFeatureSection(
  homepageId: string
): Promise<HomepageGuideFeatureCandidate[]> {
  const homepage = await getHomepageForValidation(homepageId);
  if (!homepage) return [];

  const supabase = createAdminClient();
  let query = supabase
    .from("content_guides")
    .select("id, title, market:markets(name), city:cities(name), city_id")
    .eq("market_id", homepage.marketId)
    .eq("status", "published");
  if (homepage.cityId) query = query.eq("city_id", homepage.cityId);

  const { data, error } = await query.order("title", { ascending: true });
  if (error) {
    console.error("[getAssignableGuidesForFeatureSection]", error.message);
    return [];
  }

  return (data ?? []).map((row: Row) => {
    const market = (row.market as Row | null) ?? {};
    const city = (row.city as Row | null) ?? null;
    return {
      id: row.id as string,
      title: row.title as string,
      marketName: (market.name as string | undefined) ?? "",
      cityName: (city?.name as string | undefined) ?? null,
    };
  });
}

// ── Public loaders (read-only; geography + publish-status gating only) ─────
//
// Every loader here returns only a published Homepage with enabled Sections,
// and only surfaces a Collection-mode Section's Collection when that
// Collection is itself published — a draft Collection is not yet "eligible"
// content, mirroring the spec's "an assigned Collection with no eligible
// members does not render publicly" principle at the publish-status level.
// Feature-mode Section content eligibility (e.g. a Featured Venue that's
// since been unpublished), Collection algorithm/manual resolution, and card
// mapping are NOT done here — that's homepagePublic.ts's job, via the same
// resolveSection() the Preview loader uses. This layer only decides WHICH
// Homepage (if any) is the public source of truth for a geography.

async function getPublishedHomepageByGeography(
  marketId: string,
  cityId: string | null
): Promise<HomepageDetail | null> {
  const supabase = createAdminClient();

  let query = supabase
    .from("homepages")
    .select(HOMEPAGE_DETAIL_COLUMNS)
    .eq("market_id", marketId)
    .eq("status", "published");
  query = cityId === null ? query.is("city_id", null) : query.eq("city_id", cityId);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const row = data as Row;

  const { data: sectionRows, error: sectionError } = await supabase
    .from("homepage_sections")
    .select(SECTION_COLUMNS)
    .eq("homepage_id", row.id)
    .eq("is_enabled", true)
    .order("display_order", { ascending: true });
  if (sectionError) {
    console.error("[getPublishedHomepageByGeography] sections:", sectionError.message);
  }

  const sections = (sectionRows ?? [])
    .map(mapHomepageSectionRow)
    .filter((section) => section.collection === null || section.collection.status === "published");

  return {
    ...mapHomepageSummaryRow(row),
    pageTitle:       (row.page_title as string | null) ?? null,
    metaTitle:       (row.meta_title as string | null) ?? null,
    metaDescription: (row.meta_description as string | null) ?? null,
    ogTitle:         (row.og_title as string | null) ?? null,
    ogDescription:   (row.og_description as string | null) ?? null,
    canonicalUrl:    (row.canonical_url as string | null) ?? null,
    createdAt:       row.created_at as string,
    sections,
  };
}

/** Published Market Homepage (city_id IS NULL) for the given market slug, or null. */
export async function getPublishedMarketHomepage(marketSlug: string): Promise<HomepageDetail | null> {
  const market = await getMarketBySlug(marketSlug);
  if (!market) return null;
  return getPublishedHomepageByGeography(market.id, null);
}

/** Published City Homepage for the given market/city slug pair, or null. */
export async function getPublishedCityHomepage(marketSlug: string, citySlug: string): Promise<HomepageDetail | null> {
  const city = await getCityBySlug(marketSlug, citySlug);
  if (!city) return null;
  return getPublishedHomepageByGeography(city.marketId, city.id);
}

/**
 * Approved V1 fallback (see HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md "Homepage
 * Fallback"): use the City Homepage when one exists for the visitor's
 * geography, otherwise fall back to the parent Market Homepage. Both tiers
 * share getPublishedHomepageByGeography() so the fallback never duplicates
 * query logic — only which geography key is looked up first differs.
 */
export async function getPublishedHomepageForLocation(
  marketSlug: string,
  citySlug?: string | null
): Promise<HomepageDetail | null> {
  if (citySlug) {
    const cityHomepage = await getPublishedCityHomepage(marketSlug, citySlug);
    if (cityHomepage) return cityHomepage;
  }
  return getPublishedMarketHomepage(marketSlug);
}
