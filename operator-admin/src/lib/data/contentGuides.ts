import { createAdminClient } from "@/lib/supabase/server";
import { getAllMarkets, getCitiesByMarket, getNeighbourhoodsByCity } from "@/lib/geo/geography";
import type { MarketRecord, CityRecord, NeighbourhoodRecord } from "@/lib/geo/types";

/**
 * Data helpers for the Content Engine (content_guides table).
 *
 * See docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md. Card 1 added the list
 * read (getContentGuides). Card 2 adds the single-record read used by the
 * edit form (getContentGuideById). Create/update writes live in
 * app/control-panel/content-engine/actions.ts, following the actions.ts
 * convention used by discover/ and platform-admins/.
 *
 * Internal-only table (no RLS policies for anon/authenticated) — always
 * queried via createAdminClient() (service-role).
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type GuideType = "venue_guide" | "event_guide";
export type GuideStatus = "draft" | "scheduled" | "published" | "expired";

export type ContentGuideRow = {
  id: string;
  guide_type: GuideType;
  status: GuideStatus;
  title: string;
  slug: string;
  marketName: string | null;
  cityName: string | null;
  publish_at: string | null;
  updated_at: string;
};

/** Full row shape used by the create/edit form (raw FK ids, not joined names). */
export type ContentGuideDetail = {
  id: string;
  guide_type: GuideType;
  status: GuideStatus;
  market_id: string;
  city_id: string;
  neighbourhood_id: string | null;
  title: string;
  slug: string;
  primary_keyword: string | null;
  secondary_keywords: string[];
  intro: string | null;
  body: string | null;
  hero_image_url: string | null;
  publish_at: string | null;
  expire_at: string | null;
  created_at: string;
  updated_at: string;
};

// ── Queries ───────────────────────────────────────────────────────────────────

/** Returns all content guides, newest-updated first, for the Content Engine list page. */
export async function getContentGuides(): Promise<ContentGuideRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("content_guides")
    .select(
      "id, guide_type, status, title, slug, publish_at, updated_at, " +
        "market:markets(name), city:cities(name)"
    )
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[getContentGuides]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: Record<string, any>) => ({
    id:          row.id as string,
    guide_type:  row.guide_type as GuideType,
    status:      row.status as GuideStatus,
    title:       row.title as string,
    slug:        row.slug as string,
    marketName:  (row.market?.name as string | undefined) ?? null,
    cityName:    (row.city?.name as string | undefined) ?? null,
    publish_at:  row.publish_at as string | null,
    updated_at:  row.updated_at as string,
  }));
}

/** Returns a single guide by id, or null if not found — used by the edit form. */
export async function getContentGuideById(id: string): Promise<ContentGuideDetail | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("content_guides")
    .select(
      "id, guide_type, status, market_id, city_id, neighbourhood_id, title, slug, " +
        "primary_keyword, secondary_keywords, intro, body, hero_image_url, " +
        "publish_at, expire_at, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[getContentGuideById]", error.message);
    return null;
  }
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as Record<string, any>;

  return {
    id:                 row.id as string,
    guide_type:         row.guide_type as GuideType,
    status:             row.status as GuideStatus,
    market_id:          row.market_id as string,
    city_id:            row.city_id as string,
    neighbourhood_id:   row.neighbourhood_id as string | null,
    title:              row.title as string,
    slug:               row.slug as string,
    primary_keyword:    row.primary_keyword as string | null,
    secondary_keywords: (row.secondary_keywords as string[] | null) ?? [],
    intro:              row.intro as string | null,
    body:               row.body as string | null,
    hero_image_url:     row.hero_image_url as string | null,
    publish_at:         row.publish_at as string | null,
    expire_at:          row.expire_at as string | null,
    created_at:         row.created_at as string,
    updated_at:         row.updated_at as string,
  };
}

// ── Geography options for the guide form ────────────────────────────────────
// Reuses the Geography Data Foundation helpers (src/lib/geo/geography.ts).
// Market/city/neighbourhood counts are small, so all three levels are loaded
// upfront and filtered client-side by GuideForm — no per-selection round trip.

export type GuideFormGeography = {
  markets: MarketRecord[];
  cities: CityRecord[];
  neighbourhoods: NeighbourhoodRecord[];
};

/** Returns all markets, cities, and neighbourhoods for the guide form's location selects. */
export async function getGuideFormGeography(): Promise<GuideFormGeography> {
  const markets = await getAllMarkets();
  const citiesByMarket = await Promise.all(markets.map((m) => getCitiesByMarket(m.id)));
  const cities = citiesByMarket.flat();
  const neighbourhoodsByCity = await Promise.all(cities.map((c) => getNeighbourhoodsByCity(c.id)));
  const neighbourhoods = neighbourhoodsByCity.flat();

  return { markets, cities, neighbourhoods };
}
