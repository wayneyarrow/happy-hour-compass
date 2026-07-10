/**
 * Server-side data helpers for the Homepages data layer
 * (homepages, homepage_sections — migration
 * 058_collections_homepages_foundation.sql).
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
 * getPublishedCityHomepage, getPublishedHomepageForLocation) are read
 * helpers only — not wired to any route yet. See docs/website/
 * HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md "Homepage Fallback" for the product
 * rule they implement (City Homepage first, Market Homepage fallback).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { validateCityBelongsToMarket, getMarketBySlug, getCityBySlug } from "@/lib/geo/geography";
import { getCollections } from "@/lib/data/collections";
import {
  normalizeCollectionStatus,
  type CollectionType,
  type CollectionSummary,
} from "@/lib/data/collectionsShared";
import {
  isHomepageSectionType,
  normalizeHomepageStatus,
  isCollectionAssignableToHomepage,
  type HomepageStatus,
  type HomepageSectionType,
  type HomepageSummary,
  type HomepageDetail,
  type HomepageSection,
  type HomepageSectionCollectionRef,
  type HomepageListFilters,
  type HomepageWriteResult,
  type HomepageMutationResult,
} from "@/lib/data/homepagesShared";

export {
  HOMEPAGE_SECTION_TYPES,
  isHomepageSectionType,
  normalizeHomepageStatus,
  isCollectionAssignableToHomepage,
  type HomepageStatus,
  type HomepageSectionType,
  type HomepageSummary,
  type HomepageDetail,
  type HomepageSection,
  type HomepageSectionCollectionRef,
  type HomepageListFilters,
  type HomepageWriteResult,
  type HomepageMutationResult,
} from "@/lib/data/homepagesShared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const HOMEPAGE_SUMMARY_COLUMNS =
  "id, name, status, market_id, city_id, updated_at, market:markets(name), city:cities(name)";

const HOMEPAGE_DETAIL_COLUMNS =
  "id, name, status, market_id, city_id, page_title, meta_title, meta_description, " +
  "og_title, og_description, canonical_url, created_at, updated_at, " +
  "market:markets(name), city:cities(name)";

const SECTION_COLUMNS =
  "id, homepage_id, section_type, title, collection_id, display_order, is_enabled, created_at, updated_at, " +
  "collection:collections(id, name, collection_type, status, market_id, city_id)";

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

function mapHomepageSectionRow(row: Row): HomepageSection {
  return {
    id:           row.id as string,
    homepageId:   row.homepage_id as string,
    sectionType:  row.section_type as HomepageSectionType,
    title:        row.title as string,
    collectionId: (row.collection_id as string | null) ?? null,
    collection:   mapSectionCollectionRef((row.collection as Row | null) ?? null),
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

/** Default V1 template — Featured Venues, Featured Events, Featured Guides, each with no Collection assigned yet (see HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md "Homepage Templates"). */
const DEFAULT_TEMPLATE_SECTIONS: { sectionType: HomepageSectionType; title: string }[] = [
  { sectionType: "venue", title: "Featured Venues" },
  { sectionType: "event", title: "Featured Events" },
  { sectionType: "guide", title: "Featured Guides" },
];

/**
 * Creates a Homepage and seeds it with the standard V1 template (Featured
 * Venues / Featured Events / Featured Guides, each unassigned). A reusable,
 * UI-independent data helper — editors never start from a blank page (see
 * spec "Homepage Templates"), but this is opt-in: createHomepage() alone
 * still creates a Homepage with zero sections for callers that want that.
 * Template seeding failure does not roll back Homepage creation — the
 * Homepage still exists and sections can be added manually.
 */
export async function createHomepageWithDefaultTemplate(
  input: CreateHomepageInput,
  actorEmail: string | null = null
): Promise<HomepageWriteResult> {
  const created = await createHomepage(input, actorEmail);
  if (!created.success) return created;

  const templateResult = await replaceHomepageSections(
    created.id,
    DEFAULT_TEMPLATE_SECTIONS.map((section) => ({ ...section, collectionId: null })),
    actorEmail
  );
  if (!templateResult.success) {
    console.error("[createHomepageWithDefaultTemplate] template seeding failed:", templateResult.error);
  }
  return created;
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

// ── Section <-> Collection compatibility validation ─────────────────────────

/** Shared by createHomepageSection, assignCollectionToSection, and replaceHomepageSections so the rule is never re-derived per call site. */
async function validateSectionCollectionAssignment(
  homepage: { marketId: string; cityId: string | null },
  sectionType: HomepageSectionType,
  collectionId: string | null
): Promise<string | null> {
  if (collectionId === null) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("collections")
    .select("id, collection_type, market_id, city_id")
    .eq("id", collectionId)
    .maybeSingle();

  if (error || !data) return "Collection not found.";
  const row = data as Row;

  if ((row.collection_type as string) !== sectionType) {
    return `A ${sectionType} section requires a ${sectionType} Collection.`;
  }
  const collectionGeo = { marketId: row.market_id as string, cityId: (row.city_id as string | null) ?? null };
  if (!isCollectionAssignableToHomepage(homepage, collectionGeo)) {
    return "This Collection's geography is not compatible with this Homepage.";
  }
  return null;
}

// ── Homepage Sections ─────────────────────────────────────────────────────────

export type CreateHomepageSectionInput = {
  sectionType: HomepageSectionType;
  title: string;
  collectionId?: string | null;
  displayOrder?: number;
  isEnabled?: boolean;
};

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
  if (!title) return { success: false, error: "Title is required." };

  const supabase = createAdminClient();

  const { data: existingSection } = await supabase
    .from("homepage_sections")
    .select("id")
    .eq("homepage_id", homepageId)
    .eq("section_type", input.sectionType)
    .maybeSingle();
  if (existingSection) {
    return { success: false, error: `This Homepage already has a ${input.sectionType} section.` };
  }

  const collectionId = input.collectionId ?? null;
  const collectionError = await validateSectionCollectionAssignment(homepage, input.sectionType, collectionId);
  if (collectionError) return { success: false, error: collectionError };

  const { data, error } = await supabase
    .from("homepage_sections")
    .insert({
      homepage_id: homepageId,
      section_type: input.sectionType,
      title,
      collection_id: collectionId,
      display_order: input.displayOrder ?? 0,
      is_enabled: input.isEnabled ?? true,
      created_by: actorEmail,
      updated_by: actorEmail,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createHomepageSection]", error.message);
    if (error.code === "23505") {
      return { success: false, error: `This Homepage already has a ${input.sectionType} section.` };
    }
    return { success: false, error: "Failed to create section." };
  }
  return { success: true, id: (data as Row).id as string };
}

export async function updateHomepageSectionTitle(
  sectionId: string,
  title: string,
  actorEmail: string | null = null
): Promise<HomepageMutationResult> {
  const trimmed = title.trim();
  if (!trimmed) return { success: false, error: "Title is required." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("homepage_sections")
    .update({ title: trimmed, updated_by: actorEmail })
    .eq("id", sectionId);

  if (error) {
    console.error("[updateHomepageSectionTitle]", error.message);
    return { success: false, error: "Failed to update section title." };
  }
  return { success: true };
}

/** Assigns (or clears, with collectionId = null) a Section's Collection. Re-validates type + geography compatibility every time. */
export async function assignCollectionToSection(
  sectionId: string,
  collectionId: string | null,
  actorEmail: string | null = null
): Promise<HomepageMutationResult> {
  const supabase = createAdminClient();

  const { data: section, error: sectionError } = await supabase
    .from("homepage_sections")
    .select("id, homepage_id, section_type")
    .eq("id", sectionId)
    .maybeSingle();
  if (sectionError || !section) return { success: false, error: "Section not found." };
  const sectionRow = section as Row;

  const homepage = await getHomepageForValidation(sectionRow.homepage_id as string);
  if (!homepage) return { success: false, error: "Homepage not found." };

  const collectionError = await validateSectionCollectionAssignment(
    homepage,
    sectionRow.section_type as HomepageSectionType,
    collectionId
  );
  if (collectionError) return { success: false, error: collectionError };

  const { error } = await supabase
    .from("homepage_sections")
    .update({ collection_id: collectionId, updated_by: actorEmail })
    .eq("id", sectionId);

  if (error) {
    console.error("[assignCollectionToSection]", error.message);
    return { success: false, error: "Failed to assign Collection." };
  }
  return { success: true };
}

export async function setHomepageSectionEnabled(
  sectionId: string,
  isEnabled: boolean,
  actorEmail: string | null = null
): Promise<HomepageMutationResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("homepage_sections")
    .update({ is_enabled: isEnabled, updated_by: actorEmail })
    .eq("id", sectionId);

  if (error) {
    console.error("[setHomepageSectionEnabled]", error.message);
    return { success: false, error: "Failed to update section." };
  }
  return { success: true };
}

/** Reassigns display_order 0..n-1 to match array position. Rejects if the id set doesn't exactly match the Homepage's current sections (deterministic — no partial reorders). */
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

export type ReplaceSectionInput = {
  sectionType: HomepageSectionType;
  title: string;
  collectionId: string | null;
  isEnabled?: boolean;
};

/**
 * Replaces a Homepage's complete ordered section set. Validates every
 * section (type, no duplicate types, Collection compatibility) before
 * writing any of them — matches the validate-then-delete-then-insert
 * pattern used by collections.ts's replace*Overrides functions. display_order
 * is always assigned deterministically from array position (0..n-1),
 * regardless of any order implied by input.
 */
export async function replaceHomepageSections(
  homepageId: string,
  sections: ReplaceSectionInput[],
  actorEmail: string | null = null
): Promise<HomepageMutationResult> {
  const homepage = await getHomepageForValidation(homepageId);
  if (!homepage) return { success: false, error: "Homepage not found." };

  const seenTypes = new Set<string>();
  for (const section of sections) {
    if (!isHomepageSectionType(section.sectionType)) {
      return { success: false, error: `Invalid section type "${section.sectionType}".` };
    }
    if (seenTypes.has(section.sectionType)) {
      return {
        success: false,
        error: `Duplicate section type "${section.sectionType}" — a Homepage may have at most one section of each type.`,
      };
    }
    seenTypes.add(section.sectionType);

    if (!section.title.trim()) return { success: false, error: "Title is required for every section." };

    const collectionError = await validateSectionCollectionAssignment(
      homepage,
      section.sectionType,
      section.collectionId
    );
    if (collectionError) return { success: false, error: `${collectionError} (section: ${section.sectionType})` };
  }

  const supabase = createAdminClient();
  const { error: deleteError } = await supabase.from("homepage_sections").delete().eq("homepage_id", homepageId);
  if (deleteError) {
    console.error("[replaceHomepageSections] delete failed:", deleteError.message);
    return { success: false, error: "Failed to replace sections." };
  }
  if (sections.length === 0) return { success: true };

  const { error: insertError } = await supabase.from("homepage_sections").insert(
    sections.map((section, index) => ({
      homepage_id: homepageId,
      section_type: section.sectionType,
      title: section.title.trim(),
      collection_id: section.collectionId,
      display_order: index,
      is_enabled: section.isEnabled ?? true,
      created_by: actorEmail,
      updated_by: actorEmail,
    }))
  );
  if (insertError) {
    console.error("[replaceHomepageSections] insert failed:", insertError.message);
    return { success: false, error: "Failed to replace sections." };
  }
  return { success: true };
}

// ── Assignable Collections (future editor support) ──────────────────────────

/**
 * Published Collections of the right type, filtered to this Homepage's
 * geography per isCollectionAssignableToHomepage — the same "editors should
 * always be guided toward the correct choices through filtered, geography-
 * aware workflows" behavior the spec describes for the future section
 * editor's Collection picker.
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

// ── Public loaders (read-only; not wired to any route yet) ─────────────────
//
// Every loader here returns only a published Homepage with enabled Sections,
// and only surfaces a Section's Collection when that Collection is itself
// published — a draft Collection is not yet "eligible" content, mirroring
// the spec's "an assigned Collection with no eligible members does not
// render publicly" principle at the publish-status level. This is a data
// safety net only; no card resolution or rendering happens here (deferred).

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
