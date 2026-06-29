/**
 * Market configuration — the current source of truth for live market
 * selection (MarketChip, MarketModal, marketActions, hhc_market cookie).
 *
 * A DB-backed `markets` table now exists (migration 048_geography_foundation_v1.sql)
 * as the foundation for the upcoming Header & Navigation V1 (Region & Location
 * Switcher). The two sources coexist intentionally: this config still drives
 * all live behavior; the DB table drives future website geography features.
 *
 * When wiring the DB table as the source of truth:
 *   • MARKETS[].id values match markets.slug 1:1 — a straight slug lookup works.
 *   • MARKETS[].center.lat/lng match markets.center_lat/center_lng.
 *   • MARKETS[].radiusKm matches markets.radius_km.
 *   • Retire this file and update getActiveMarket(), setMarketAction(),
 *     findNearestActiveMarket(), and toMarketConfig() in that migration.
 *
 * Until that wiring is done, add new markets here AND in seedGeography.ts.
 *
 * center     — geographic center used for isNearMarket() distance gating.
 * mapCenter  — default map viewport center (may differ from geo center).
 * radiusKm   — market radius; venues within this distance are included.
 * mapZoom    — default Google Maps zoom level for this market.
 */

export type Market = {
  id: string;
  name: string;
  status: "active" | "coming_soon";
  center: { lat: number; lng: number };
  radiusKm: number;
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
};

export const MARKETS: Market[] = [
  {
    id: "central-okanagan",
    name: "Central Okanagan",
    status: "active",
    center: { lat: 49.888, lng: -119.496 },
    radiusKm: 50,
    mapCenter: { lat: 49.888, lng: -119.496 },
    mapZoom: 13,
  },
  {
    id: "greater-vancouver",
    name: "Greater Vancouver",
    status: "active",
    center: { lat: 49.2827, lng: -123.1207 },
    radiusKm: 50,
    mapCenter: { lat: 49.2827, lng: -123.1207 },
    mapZoom: 12,
  },
  {
    id: "victoria",
    name: "Victoria",
    status: "coming_soon",
    center: { lat: 48.4284, lng: -123.3656 },
    radiusKm: 25,
    mapCenter: { lat: 48.4284, lng: -123.3656 },
    mapZoom: 13,
  },
  {
    id: "calgary",
    name: "Calgary",
    status: "coming_soon",
    center: { lat: 51.0447, lng: -114.0719 },
    radiusKm: 40,
    mapCenter: { lat: 51.0447, lng: -114.0719 },
    mapZoom: 12,
  },
];

export const DEFAULT_MARKET_ID = "central-okanagan";

export function getMarketById(id: string): Market | undefined {
  return MARKETS.find((m) => m.id === id);
}

export function getDefaultMarket(): Market {
  return MARKETS.find((m) => m.id === DEFAULT_MARKET_ID)!;
}

/** Converts a Market to the minimal config shape expected by the discover engine. */
export function toMarketConfig(market: Market): { lat: number; lng: number; radiusKm: number } {
  return { lat: market.center.lat, lng: market.center.lng, radiusKm: market.radiusKm };
}

// Private haversine — used only for nearest-market selection below.
// The canonical export lives in discoverEngine.ts to avoid a circular import.
function _haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns the nearest active market to the given coordinates.
 * Falls back to the default market when the user is farther than maxDistanceKm
 * from all active markets (prevents assigning far-away users to the wrong city).
 */
export function findNearestActiveMarket(
  lat: number,
  lng: number,
  maxDistanceKm = 400
): Market {
  const active = MARKETS.filter((m) => m.status === "active");
  if (active.length === 0) return getDefaultMarket();

  const nearest = active.reduce((best, m) => {
    const dBest = _haversineKm(lat, lng, best.center.lat, best.center.lng);
    const dCurrent = _haversineKm(lat, lng, m.center.lat, m.center.lng);
    return dCurrent < dBest ? m : best;
  });

  if (_haversineKm(lat, lng, nearest.center.lat, nearest.center.lng) > maxDistanceKm) {
    return getDefaultMarket();
  }

  return nearest;
}
