/**
 * Shared types for the Geography Data Foundation.
 *
 * See "Geographic Information Architecture" in
 * docs/website/WEBSITE_PRODUCT_PLAYBOOK.md for the product decisions behind
 * this model. Terminology:
 *   Market   = internal operational region
 *   Region   = public-facing label for Market (same row — see `Region` below)
 *   City     = primary consumer/SEO geography
 *   Neighbourhood = optional future layer, unseeded as of V1
 *   Browsing Location = derived, not persisted — see `BrowsingLocation`
 */

export type GeoStatus = "active" | "coming_soon";

export type MarketRecord = {
  id: string;
  slug: string;
  name: string;
  province: string;
  country: string;
  status: GeoStatus;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  defaultCityId: string | null;
  displayOrder: number;
};

/**
 * "Region" is the public-facing label for a Market — the same underlying
 * row, presented under different naming depending on context (internal
 * tooling says "Market"; consumer-facing UI, like the future Region &
 * Location Switcher, says "Region"). This type alias exists so that
 * Header & Navigation work can speak in "Region" terms without a second
 * table or a data mapping step.
 */
export type Region = MarketRecord;

export type CityRecord = {
  id: string;
  marketId: string;
  slug: string;
  name: string;
  status: GeoStatus;
  supportsNeighbourhoods: boolean;
  displayOrder: number;
  centerLat: number | null;
  centerLng: number | null;
};

export type NeighbourhoodRecord = {
  id: string;
  cityId: string;
  slug: string;
  name: string;
  status: GeoStatus;
  displayOrder: number;
  centerLat: number | null;
  centerLng: number | null;
};

/**
 * The effective center point + label the experience should be centered on
 * right now. Derived at request time via deriveBrowsingLocation() — never
 * persisted. `source` records which Search Origin Priority tier produced it.
 */
export type BrowsingLocation = {
  lat: number;
  lng: number;
  label: string;
  source: "explicit" | "city" | "gps" | "market";
};
