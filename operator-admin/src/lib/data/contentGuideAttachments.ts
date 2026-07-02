import { createAdminClient } from "@/lib/supabase/server";
import type { GuideType } from "@/lib/data/contentGuides";

/**
 * Data helpers for Content Engine guide attachments (Card 3).
 *
 * Guides reference live venues/events through content_guide_venues /
 * content_guide_events (migration 053) — those tables store only
 * (guide_id, venue_id | event_id, sort_order). Names, cities, and every
 * other display detail below are always read live via a join; nothing is
 * duplicated into the guide or the attachment tables.
 *
 * Internal-only tables (no RLS policies for anon/authenticated) — always
 * queried via createAdminClient() (service-role), consistent with
 * contentGuides.ts.
 */

// ── Shared types ─────────────────────────────────────────────────────────────

export type MatchTier = "neighbourhood" | "city" | "market" | "other";

const TIER_ORDER: Record<MatchTier, number> = {
  neighbourhood: 0,
  city: 1,
  market: 2,
  other: 3,
};

/** A searchable venue/event result, ranked by proximity to the guide's location. */
export type AttachmentCandidate = {
  id: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  matchTier: MatchTier;
};

/** An already-attached venue/event, shown in the selector's "selected" list. */
export type GuideAttachmentItem = {
  id: string;
  primaryLabel: string;
  secondaryLabel: string | null;
};

type GeoRow = {
  market_id: string | null;
  city_id: string | null;
  neighbourhood_id: string | null;
};

type SearchParams = {
  marketId: string;
  cityId?: string | null;
  neighbourhoodId?: string | null;
  query?: string;
  excludeIds?: string[];
  limit?: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeIds(ids: string[] | undefined): string[] {
  return (ids ?? []).filter((id) => UUID_PATTERN.test(id));
}

function computeTier(row: GeoRow, params: SearchParams): MatchTier {
  if (params.neighbourhoodId && row.neighbourhood_id === params.neighbourhoodId) {
    return "neighbourhood";
  }
  if (params.cityId && row.city_id === params.cityId) return "city";
  if (row.market_id === params.marketId) return "market";
  return "other";
}

const DEFAULT_RESULT_LIMIT = 20;

type GeoTierColumn = "neighbourhood_id" | "city_id" | "market_id";

// ── Candidate search — venues ────────────────────────────────────────────────

/**
 * Fetches one geography tier's worth of venue candidates (e.g. just the
 * guide's city), tagged with the known tier directly rather than recomputed —
 * each tier is its own targeted query, so there's no ambiguity about which
 * bucket a row belongs to.
 */
async function fetchVenueTier(
  supabase: ReturnType<typeof createAdminClient>,
  column: GeoTierColumn,
  value: string,
  tier: MatchTier,
  excludeIds: string[],
  take: number
): Promise<AttachmentCandidate[]> {
  if (take <= 0) return [];

  let queryBuilder = supabase
    .from("venues")
    .select("id, name, city")
    .eq("is_published", true)
    .eq(column, value);

  if (excludeIds.length > 0) {
    queryBuilder = queryBuilder.not("id", "in", `(${excludeIds.join(",")})`);
  }

  const { data, error } = await queryBuilder.order("name", { ascending: true }).limit(take);

  if (error) {
    console.error(`[searchVenueCandidates] ${tier} tier error:`, error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: Record<string, any>) => ({
    id: row.id as string,
    primaryLabel: row.name as string,
    secondaryLabel: (row.city as string | null) ?? null,
    matchTier: tier,
  }));
}

/**
 * Builds the default (no search text) venue candidate list.
 *
 * Root cause this replaces: the previous implementation pulled up to 200
 * venues from the whole *market* up front, ranked them client-side, then
 * sliced to the display limit. When a city had fewer venues than the limit,
 * the remaining slots were filled with whatever market venues happened to
 * sort alphabetically first — e.g. a Burnaby guide's default list padded
 * with unrelated Greater Vancouver venues that had nothing to do with
 * Burnaby.
 *
 * Fix: each geography tier the guide has selected (neighbourhood, then
 * city) is queried on its own, narrowest first, and the broader market tier
 * is only queried at all once the narrower tiers have been exhausted and
 * still haven't filled the list. So:
 *   - City selected, city alone fills the limit → market is never queried.
 *   - City selected, city has fewer venues than the limit → market pads the
 *     remainder (visually separated in the UI via a group heading).
 *   - Only market selected → market is the sole tier, as before.
 */
async function defaultVenueCandidates(
  supabase: ReturnType<typeof createAdminClient>,
  params: SearchParams,
  excludeIds: string[],
  limit: number
): Promise<AttachmentCandidate[]> {
  const collected: AttachmentCandidate[] = [];
  const seen = new Set(excludeIds);

  async function addTier(column: GeoTierColumn, value: string | null | undefined, tier: MatchTier) {
    if (!value || collected.length >= limit) return;
    const rows = await fetchVenueTier(
      supabase, column, value, tier, Array.from(seen), limit - collected.length
    );
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      collected.push(row);
    }
  }

  await addTier("neighbourhood_id", params.neighbourhoodId, "neighbourhood");
  await addTier("city_id", params.cityId, "city");
  await addTier("market_id", params.marketId, "market");

  return collected;
}

/**
 * Searches published venues as candidates for a Venue Guide's attachments.
 *
 * V1 behaviour (see CONTENT_ENGINE_PRODUCT_SPEC.md + WEBSITE_PRODUCT_PLAYBOOK
 * Geographic Information Architecture):
 *   - No query text: the default browse list, built tier-by-tier — see
 *     defaultVenueCandidates() for why this no longer pads with unrelated
 *     same-market venues.
 *   - With query text: search spans all markets by name (an admin must be
 *     able to find a venue outside the guide's own city), but results
 *     matching the guide's neighbourhood/city/market still sort first.
 */
export async function searchVenueCandidates(
  params: SearchParams
): Promise<AttachmentCandidate[]> {
  const supabase = createAdminClient();
  const trimmedQuery = (params.query ?? "").trim();
  const limit = params.limit ?? DEFAULT_RESULT_LIMIT;
  const excludeIds = sanitizeIds(params.excludeIds);

  if (!trimmedQuery) {
    return defaultVenueCandidates(supabase, params, excludeIds, limit);
  }

  let queryBuilder = supabase
    .from("venues")
    .select("id, name, city, market_id, city_id, neighbourhood_id")
    .eq("is_published", true)
    .ilike("name", `%${trimmedQuery}%`);

  if (excludeIds.length > 0) {
    queryBuilder = queryBuilder.not("id", "in", `(${excludeIds.join(",")})`);
  }

  const { data, error } = await queryBuilder
    .order("name", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[searchVenueCandidates]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ranked = (data ?? []).map((row: Record<string, any>) => ({
    id: row.id as string,
    primaryLabel: row.name as string,
    secondaryLabel: (row.city as string | null) ?? null,
    matchTier: computeTier(row as GeoRow, params),
  }));

  ranked.sort(
    (a, b) =>
      TIER_ORDER[a.matchTier] - TIER_ORDER[b.matchTier] ||
      a.primaryLabel.localeCompare(b.primaryLabel)
  );

  return ranked.slice(0, limit);
}

// ── Candidate search — events ────────────────────────────────────────────────

/** Same tier-by-tier default logic as fetchVenueTier, joined through the
 * parent venue since events have no geography columns of their own. */
async function fetchEventTier(
  supabase: ReturnType<typeof createAdminClient>,
  column: GeoTierColumn,
  value: string,
  tier: MatchTier,
  excludeIds: string[],
  take: number
): Promise<AttachmentCandidate[]> {
  if (take <= 0) return [];

  let queryBuilder = supabase
    .from("events")
    .select(`id, title, venues!inner(name, city, ${column})`)
    .eq("is_published", true)
    .eq(`venues.${column}`, value);

  if (excludeIds.length > 0) {
    queryBuilder = queryBuilder.not("id", "in", `(${excludeIds.join(",")})`);
  }

  const { data, error } = await queryBuilder.order("title", { ascending: true }).limit(take);

  if (error) {
    console.error(`[searchEventCandidates] ${tier} tier error:`, error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: Record<string, any>) => {
    const venue = (row.venues as Record<string, unknown>) ?? {};
    const venueName = (venue.name as string) ?? "";
    const venueCity = (venue.city as string | null) ?? null;
    return {
      id: row.id as string,
      primaryLabel: row.title as string,
      secondaryLabel: venueCity ? `${venueName} · ${venueCity}` : venueName || null,
      matchTier: tier,
    };
  });
}

/** Same default-list behaviour as defaultVenueCandidates, for Event Guide attachments. */
async function defaultEventCandidates(
  supabase: ReturnType<typeof createAdminClient>,
  params: SearchParams,
  excludeIds: string[],
  limit: number
): Promise<AttachmentCandidate[]> {
  const collected: AttachmentCandidate[] = [];
  const seen = new Set(excludeIds);

  async function addTier(column: GeoTierColumn, value: string | null | undefined, tier: MatchTier) {
    if (!value || collected.length >= limit) return;
    const rows = await fetchEventTier(
      supabase, column, value, tier, Array.from(seen), limit - collected.length
    );
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      collected.push(row);
    }
  }

  await addTier("neighbourhood_id", params.neighbourhoodId, "neighbourhood");
  await addTier("city_id", params.cityId, "city");
  await addTier("market_id", params.marketId, "market");

  return collected;
}

/** Same V1 behaviour as searchVenueCandidates, but for Event Guide attachments. */
export async function searchEventCandidates(
  params: SearchParams
): Promise<AttachmentCandidate[]> {
  const supabase = createAdminClient();
  const trimmedQuery = (params.query ?? "").trim();
  const limit = params.limit ?? DEFAULT_RESULT_LIMIT;
  const excludeIds = sanitizeIds(params.excludeIds);

  if (!trimmedQuery) {
    return defaultEventCandidates(supabase, params, excludeIds, limit);
  }

  // Events have no geography columns of their own — geography is derived
  // from the parent venue (venues!inner so venue-side filters apply).
  let queryBuilder = supabase
    .from("events")
    .select(
      "id, title, venue_id, venues!inner(id, name, city, market_id, city_id, neighbourhood_id)"
    )
    .eq("is_published", true)
    .ilike("title", `%${trimmedQuery}%`);

  if (excludeIds.length > 0) {
    queryBuilder = queryBuilder.not("id", "in", `(${excludeIds.join(",")})`);
  }

  const { data, error } = await queryBuilder
    .order("title", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[searchEventCandidates]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ranked = (data ?? []).map((row: Record<string, any>) => {
    const venue = (row.venues as Record<string, unknown>) ?? {};
    const venueName = (venue.name as string) ?? "";
    const venueCity = (venue.city as string | null) ?? null;
    return {
      id: row.id as string,
      primaryLabel: row.title as string,
      secondaryLabel: venueCity ? `${venueName} · ${venueCity}` : venueName || null,
      matchTier: computeTier(venue as GeoRow, params),
    };
  });

  ranked.sort(
    (a, b) =>
      TIER_ORDER[a.matchTier] - TIER_ORDER[b.matchTier] ||
      a.primaryLabel.localeCompare(b.primaryLabel)
  );

  return ranked.slice(0, limit);
}

// ── Existing attachments (edit form load) ────────────────────────────────────

/** Returns a venue guide's attached venues, in saved order. */
export async function getGuideVenueAttachments(
  guideId: string
): Promise<GuideAttachmentItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("content_guide_venues")
    .select("venue_id, sort_order, venues!venue_id(id, name, city)")
    .eq("guide_id", guideId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getGuideVenueAttachments]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: Record<string, any>) => {
    const venue = (row.venues as Record<string, unknown>) ?? {};
    return {
      id: (venue.id as string) ?? (row.venue_id as string),
      primaryLabel: (venue.name as string) ?? "",
      secondaryLabel: (venue.city as string | null) ?? null,
    };
  });
}

/** Returns an event guide's attached events, in saved order. */
export async function getGuideEventAttachments(
  guideId: string
): Promise<GuideAttachmentItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("content_guide_events")
    .select(
      "event_id, sort_order, events!event_id(id, title, venues!venue_id(name, city))"
    )
    .eq("guide_id", guideId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getGuideEventAttachments]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: Record<string, any>) => {
    const event = (row.events as Record<string, unknown>) ?? {};
    const venue = (event.venues as Record<string, unknown>) ?? {};
    const venueName = (venue.name as string) ?? "";
    const venueCity = (venue.city as string | null) ?? null;
    return {
      id: (event.id as string) ?? (row.event_id as string),
      primaryLabel: (event.title as string) ?? "",
      secondaryLabel: venueCity ? `${venueName} · ${venueCity}` : venueName || null,
    };
  });
}

// ── Save (create + edit) ─────────────────────────────────────────────────────

/**
 * Persists a guide's ordered attachment list, replacing whatever was there
 * before. Also clears the *other* attachment table for this guide, so a
 * guide can never carry both venue and event attachments — this is the
 * server-side enforcement of "venue_guide attaches venues only, event_guide
 * attaches events only" (the guide form UI never presents both, but this
 * keeps stale rows from lingering if guide_type changes on an existing
 * guide).
 *
 * Delete-then-insert rather than diffing: attachment lists are short
 * (V1 guides feature a handful of venues/events), so a full replace on every
 * save is simpler and just as correct as computing an add/remove/reorder
 * diff.
 *
 * Errors are logged but non-fatal — the guide row itself has already been
 * saved by the time this runs, matching the fire-and-forget pattern used by
 * logAuditEvent for other post-write side effects.
 */
export async function saveGuideAttachments(
  guideId: string,
  guideType: GuideType,
  orderedIds: string[]
): Promise<void> {
  const supabase = createAdminClient();
  const ids = sanitizeIds(orderedIds);

  const [keepTable, clearTable, column] =
    guideType === "venue_guide"
      ? (["content_guide_venues", "content_guide_events", "venue_id"] as const)
      : (["content_guide_events", "content_guide_venues", "event_id"] as const);

  const { error: clearError } = await supabase
    .from(clearTable)
    .delete()
    .eq("guide_id", guideId);
  if (clearError) {
    console.error(`[saveGuideAttachments] Failed clearing ${clearTable}:`, clearError.message);
  }

  const { error: replaceError } = await supabase
    .from(keepTable)
    .delete()
    .eq("guide_id", guideId);
  if (replaceError) {
    console.error(`[saveGuideAttachments] Failed clearing ${keepTable}:`, replaceError.message);
    return;
  }

  if (ids.length === 0) return;

  const rows = ids.map((id, index) => ({
    guide_id: guideId,
    [column]: id,
    sort_order: index,
  }));

  const { error: insertError } = await supabase.from(keepTable).insert(rows);
  if (insertError) {
    console.error(`[saveGuideAttachments] Failed inserting into ${keepTable}:`, insertError.message);
  }
}
