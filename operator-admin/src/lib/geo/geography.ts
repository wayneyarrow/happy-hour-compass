/**
 * Shared geography helpers — server-side only.
 *
 * Reads from the DB-backed markets / cities / neighbourhoods tables introduced
 * in migration 048_geography_foundation_v1.sql. All queries use the admin
 * client (service-role, bypasses RLS) consistent with other server-side data
 * helpers in src/lib/data/*.ts.
 *
 * The config-based MARKETS array in src/lib/markets.ts is NOT replaced by
 * this module — it still drives the active-market cookie and the (consumer)
 * app's MarketChip/MarketModal. These helpers are the foundation layer for
 * the upcoming Header & Navigation V1 (Region & Location Switcher). The two
 * layers coexist until a future card wires them together.
 *
 * See "Geographic Information Architecture" in
 * docs/website/WEBSITE_PRODUCT_PLAYBOOK.md for the product architecture.
 */

import { createAdminClient } from "@/lib/supabase/server";
import type {
  BrowsingLocation,
  CityRecord,
  MarketRecord,
  NeighbourhoodRecord,
  Region,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Row mappers
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMarket(row: any): MarketRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    province: row.province,
    country: row.country,
    status: row.status,
    centerLat: row.center_lat ?? null,
    centerLng: row.center_lng ?? null,
    radiusKm: row.radius_km ?? null,
    defaultCityId: row.default_city_id ?? null,
    displayOrder: row.display_order ?? 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCity(row: any): CityRecord {
  return {
    id: row.id,
    marketId: row.market_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    supportsNeighbourhoods: row.supports_neighbourhoods ?? false,
    displayOrder: row.display_order ?? 0,
    centerLat: row.center_lat ?? null,
    centerLng: row.center_lng ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapNeighbourhood(row: any): NeighbourhoodRecord {
  return {
    id: row.id,
    cityId: row.city_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    displayOrder: row.display_order ?? 0,
    centerLat: row.center_lat ?? null,
    centerLng: row.center_lng ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markets / Regions
// ─────────────────────────────────────────────────────────────────────────────

/** Returns all markets ordered by display_order. */
export async function getAllMarkets(): Promise<MarketRecord[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("markets")
    .select("*")
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapMarket);
}

/**
 * Alias for getAllMarkets(). Use this in consumer-facing UI where the
 * public-facing "Region" label is appropriate. See `Region` type in types.ts.
 */
export async function getAllRegions(): Promise<Region[]> {
  return getAllMarkets();
}

/** Returns a single market by its slug, or null if not found. */
export async function getMarketBySlug(slug: string): Promise<MarketRecord | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("markets")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error) return null;
  return data ? mapMarket(data) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cities
// ─────────────────────────────────────────────────────────────────────────────

/** Returns all cities for a market, ordered by display_order. */
export async function getCitiesByMarket(marketId: string): Promise<CityRecord[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cities")
    .select("*")
    .eq("market_id", marketId)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapCity);
}

/**
 * Returns the default city for a market.
 *
 * Resolution order:
 *   1. markets.default_city_id if set and the city exists.
 *   2. First active city ordered by display_order.
 *   3. null if no cities exist for the market.
 */
export async function getDefaultCityForMarket(marketId: string): Promise<CityRecord | null> {
  const supabase = createAdminClient();
  const { data: market } = await supabase
    .from("markets")
    .select("default_city_id")
    .eq("id", marketId)
    .single();

  if (market?.default_city_id) {
    const { data: city } = await supabase
      .from("cities")
      .select("*")
      .eq("id", market.default_city_id)
      .single();
    if (city) return mapCity(city);
  }

  // Fall back to first active city by display_order.
  const { data: fallback } = await supabase
    .from("cities")
    .select("*")
    .eq("market_id", marketId)
    .eq("status", "active")
    .order("display_order", { ascending: true })
    .limit(1)
    .single();
  return fallback ? mapCity(fallback) : null;
}

/**
 * Returns a city by its market slug + city slug.
 * Useful for resolving URL segments like `/greater-vancouver/burnaby`.
 *
 * The `markets!market_id!inner(slug)` hint is required, not optional: cities
 * and markets have TWO FK relationships (cities.market_id -> markets.id, the
 * one we want, and markets.default_city_id -> cities.id, added in migration
 * 048's "circular FK" workaround). Without the `!market_id` hint, PostgREST
 * can't tell which relationship to embed and errors with "Could not embed
 * because more than one relationship was found for 'cities' and 'markets'"
 * — silently swallowed by `if (error) return null`, so this function always
 * returned null, for every market/city pair, until this fix (confirmed live
 * against the project — see Task 9's root-cause diagnosis).
 */
export async function getCityBySlug(
  marketSlug: string,
  citySlug: string
): Promise<CityRecord | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cities")
    .select("*, markets!market_id!inner(slug)")
    .eq("markets.slug", marketSlug)
    .eq("slug", citySlug)
    .single();
  if (error) return null;
  return data ? mapCity(data) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Neighbourhoods
// ─────────────────────────────────────────────────────────────────────────────

/** Returns all neighbourhoods for a city, ordered by display_order. */
export async function getNeighbourhoodsByCity(cityId: string): Promise<NeighbourhoodRecord[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("neighbourhoods")
    .select("*")
    .eq("city_id", cityId)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapNeighbourhood);
}

// ─────────────────────────────────────────────────────────────────────────────
// Browsing Location — pure function, no DB call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the effective browsing location (map center + label) from the
 * current geographic context.
 *
 * Implements Search Origin Priority from the Geographic Information
 * Architecture (docs/website/WEBSITE_PRODUCT_PLAYBOOK.md):
 *   1. User-selected map position / explicitly searched location
 *   2. Selected city
 *   3. User GPS location (if permission granted)
 *   4. Selected market center
 *   5. Default market center (caller passes the appropriate market as fallback)
 *
 * Returns null only when no usable coordinates are available.
 */
export function deriveBrowsingLocation(params: {
  explicit?: { lat: number; lng: number; label: string } | null;
  city?: CityRecord | null;
  gps?: { lat: number; lng: number } | null;
  market?: MarketRecord | null;
}): BrowsingLocation | null {
  if (params.explicit) {
    return { ...params.explicit, source: "explicit" };
  }
  if (params.city?.centerLat != null && params.city?.centerLng != null) {
    return {
      lat: params.city.centerLat,
      lng: params.city.centerLng,
      label: params.city.name,
      source: "city",
    };
  }
  if (params.gps) {
    return {
      lat: params.gps.lat,
      lng: params.gps.lng,
      label: "Current Location",
      source: "gps",
    };
  }
  if (params.market?.centerLat != null && params.market?.centerLng != null) {
    return {
      lat: params.market.centerLat,
      lng: params.market.centerLng,
      label: params.market.name,
      source: "market",
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cities with assigned venues
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns active cities in the market that have at least one venue assigned
 * (venues.city_id IS NOT NULL and matches the city).
 *
 * Used by the Region & Location Switcher to show only useful "Also in this
 * region" locations — not empty cities that exist in the DB but have no
 * content yet.
 *
 * Two queries: (1) city list for the market, (2) distinct city_ids present in
 * venues. Cities not represented in venues are filtered out before returning.
 */
export async function getCitiesWithVenues(marketId: string): Promise<CityRecord[]> {
  const supabase = createAdminClient();

  const { data: cities, error: citiesError } = await supabase
    .from("cities")
    .select("*")
    .eq("market_id", marketId)
    .eq("status", "active")
    .order("display_order", { ascending: true });
  if (citiesError) throw citiesError;
  if (!cities?.length) return [];

  const cityIds = cities.map((c) => c.id);

  const { data: venueRows, error: venuesError } = await supabase
    .from("venues")
    .select("city_id")
    .in("city_id", cityIds)
    .not("city_id", "is", null)
    .limit(500);
  if (venuesError) throw venuesError;

  const cityIdsWithVenues = new Set((venueRows ?? []).map((v) => v.city_id as string));

  return cities.filter((c) => cityIdsWithVenues.has(c.id)).map(mapCity);
}

// ─────────────────────────────────────────────────────────────────────────────
// Nearby cities — STUB (deferred)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STUB — not yet implemented.
 *
 * Intended to return cities geographically close to the given city,
 * potentially across market boundaries (e.g. Burnaby is near Coquitlam and
 * Port Moody, which matter for search results that cross municipal lines).
 *
 * This requires city center coordinates for all seeded cities plus a
 * distance-ranking implementation. Deferred to the Header & Navigation V1
 * card or a dedicated geography-enrichment card.
 *
 * Do NOT wire this function into any UI until it returns real data.
 */
export async function getNearbyCities(
  _cityId: string,
  _radiusKm = 25
): Promise<CityRecord[]> {
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// City / Market consistency — pure function, no DB call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The application-level twin of the composite FK constraints added in
 * migration 058 (`collections_city_market_consistency`,
 * `homepages_city_market_consistency`): a selected city must belong to the
 * selected market. Pure — deliberately takes the city's own market_id as a
 * plain string rather than a full CityRecord, so a caller that already has
 * to look up the city for existence (a single `id, market_id` query) never
 * needs a second, heavier fetch just to run this check.
 *
 * Returns null when valid (including the "no city selected" case — always
 * valid), or a short, user-facing error string otherwise.
 */
export function validateCityBelongsToMarket(input: {
  marketId: string;
  cityId: string | null;
  /** The selected city's own market_id, or null if cityId was set but no matching city was found. Ignored when cityId is null. */
  cityMarketId: string | null;
}): string | null {
  if (input.cityId === null) return null;
  if (input.cityMarketId === null) return "Selected city could not be found.";
  if (input.cityMarketId !== input.marketId) {
    return "Selected city does not belong to the selected market.";
  }
  return null;
}
