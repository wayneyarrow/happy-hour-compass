/**
 * Haversine great-circle distance between two WGS-84 coordinates, in km.
 * Pure utility — server and client safe.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type LatLngBounds = { north: number; south: number; east: number; west: number };

/**
 * True when (lat, lng) falls inside a map viewport's bounds. Same bounding-box
 * check already used by the consumer app's map view (VenueDiscovery.tsx /
 * VenueMapView.tsx) to narrow a venue list to what's visible on screen,
 * formalized here so other presentation layers can reuse it without
 * duplicating the comparison logic.
 */
export function isWithinBounds(lat: number, lng: number, bounds: LatLngBounds): boolean {
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}
