/**
 * Greater San Diego city & community roster — the single definition of every
 * `cities` row the market needs and every alias that maps a typed or postal
 * place name onto one of them.
 *
 * Consumers see one market (Greater San Diego). Each row here is the value
 * Google Places returns as `locality` for addresses in that place, because
 * that is what the Add Your Venue paths store in `venues.city` and resolve
 * with venueGeographyResolver (match.city ?? typed city). Neighbourhoods of
 * the City of San Diego (La Jolla, Pacific Beach, North Park…) come back from
 * Google as locality "San Diego", so they are aliases + internal coverage
 * tags, never cities — the venue keeps its real city ("San Diego").
 *
 * Verified 2026-11-13 with read-only Places API (New) text searches (see
 * scripts/output/greater-san-diego-seed-plan-2026-11-13/). `googleLocality`
 * records what that probe showed:
 *   "verified"   — Google returned this place as its own locality
 *   "unverified" — a Census place, but no probe result confirmed Google
 *                  uses it as a locality (harmless if it never matches)
 *
 * Centers: US Census 2024 Gazetteer internal points (public domain), so no
 * Google-sourced coordinate is stored. null where the Gazetteer has no
 * place record. Solana Beach keeps the center already applied in Step 1.
 *
 * Nothing here writes to the database. The cities are applied only through
 * the reviewed SQL in docs/operations/greater-san-diego/ (step2-cities-*.sql),
 * which is generated from this file by scripts/buildGreaterSanDiegoCitiesSql.ts.
 */

export const GREATER_SAN_DIEGO_MARKET_SLUG = "greater-san-diego";

export type GsdSubregion =
  | "City of San Diego"
  | "North County Coastal"
  | "North County Inland"
  | "South Bay"
  | "East County"
  | "Backcountry";

export type GsdCity = {
  slug: string;
  name: string;
  subregion: GsdSubregion;
  /** Incorporated city, or a census-designated community (unincorporated). */
  kind: "city" | "community";
  /** Planned seed venues at launch (Encore Sushi counts toward Solana Beach). 0 = submissions only. */
  launchTarget: number;
  googleLocality: "verified" | "unverified";
  center_lat: number | null;
  center_lng: number | null;
  /** Already in the shared DB (Step 1) — the Step 2 SQL never re-inserts or edits it. */
  existing?: true;
};

export const GREATER_SAN_DIEGO_CITIES: readonly GsdCity[] = [
  // ── City of San Diego ──────────────────────────────────────────────────────
  { slug: "san-diego", name: "San Diego", subregion: "City of San Diego", kind: "city", launchTarget: 48, googleLocality: "verified", center_lat: 32.815, center_lng: -117.1356 },

  // ── North County Coastal ──────────────────────────────────────────────────
  { slug: "solana-beach", name: "Solana Beach", subregion: "North County Coastal", kind: "city", launchTarget: 2, googleLocality: "verified", center_lat: 32.9912, center_lng: -117.2711, existing: true },
  { slug: "oceanside", name: "Oceanside", subregion: "North County Coastal", kind: "city", launchTarget: 5, googleLocality: "verified", center_lat: 33.2246, center_lng: -117.3063 },
  { slug: "carlsbad", name: "Carlsbad", subregion: "North County Coastal", kind: "city", launchTarget: 4, googleLocality: "verified", center_lat: 33.1293, center_lng: -117.2842 },
  { slug: "encinitas", name: "Encinitas", subregion: "North County Coastal", kind: "city", launchTarget: 4, googleLocality: "verified", center_lat: 33.0506, center_lng: -117.2636 },
  { slug: "del-mar", name: "Del Mar", subregion: "North County Coastal", kind: "city", launchTarget: 1, googleLocality: "verified", center_lat: 32.9639, center_lng: -117.2598 },
  { slug: "rancho-santa-fe", name: "Rancho Santa Fe", subregion: "North County Coastal", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 33.0258, center_lng: -117.1981 },

  // ── North County Inland ───────────────────────────────────────────────────
  { slug: "escondido", name: "Escondido", subregion: "North County Inland", kind: "city", launchTarget: 4, googleLocality: "verified", center_lat: 33.1331, center_lng: -117.074 },
  { slug: "san-marcos", name: "San Marcos", subregion: "North County Inland", kind: "city", launchTarget: 2, googleLocality: "verified", center_lat: 33.1326, center_lng: -117.1699 },
  { slug: "vista", name: "Vista", subregion: "North County Inland", kind: "city", launchTarget: 2, googleLocality: "verified", center_lat: 33.1895, center_lng: -117.2386 },
  { slug: "poway", name: "Poway", subregion: "North County Inland", kind: "city", launchTarget: 1, googleLocality: "verified", center_lat: 32.9877, center_lng: -117.0218 },
  { slug: "fallbrook", name: "Fallbrook", subregion: "North County Inland", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 33.3742, center_lng: -117.2204 },
  { slug: "bonsall", name: "Bonsall", subregion: "North County Inland", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 33.2749, center_lng: -117.1919 },
  { slug: "valley-center", name: "Valley Center", subregion: "North County Inland", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 33.233, center_lng: -117.0158 },
  { slug: "pala", name: "Pala", subregion: "North County Inland", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 33.3639, center_lng: -117.0678 },
  { slug: "pauma-valley", name: "Pauma Valley", subregion: "North County Inland", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: null, center_lng: null },
  { slug: "ramona", name: "Ramona", subregion: "North County Inland", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 33.0458, center_lng: -116.8775 },

  // ── South Bay ─────────────────────────────────────────────────────────────
  { slug: "chula-vista", name: "Chula Vista", subregion: "South Bay", kind: "city", launchTarget: 6, googleLocality: "verified", center_lat: 32.6277, center_lng: -117.0152 },
  { slug: "coronado", name: "Coronado", subregion: "South Bay", kind: "city", launchTarget: 2, googleLocality: "verified", center_lat: 32.6576, center_lng: -117.1565 },
  { slug: "national-city", name: "National City", subregion: "South Bay", kind: "city", launchTarget: 1, googleLocality: "verified", center_lat: 32.6659, center_lng: -117.0974 },
  { slug: "imperial-beach", name: "Imperial Beach", subregion: "South Bay", kind: "city", launchTarget: 0, googleLocality: "verified", center_lat: 32.5691, center_lng: -117.1149 },
  { slug: "bonita", name: "Bonita", subregion: "South Bay", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.6732, center_lng: -117.0061 },

  // ── East County ───────────────────────────────────────────────────────────
  { slug: "la-mesa", name: "La Mesa", subregion: "East County", kind: "city", launchTarget: 3, googleLocality: "verified", center_lat: 32.7695, center_lng: -117.0219 },
  { slug: "el-cajon", name: "El Cajon", subregion: "East County", kind: "city", launchTarget: 3, googleLocality: "verified", center_lat: 32.8017, center_lng: -116.9605 },
  { slug: "santee", name: "Santee", subregion: "East County", kind: "city", launchTarget: 2, googleLocality: "verified", center_lat: 32.855, center_lng: -116.9861 },
  { slug: "lemon-grove", name: "Lemon Grove", subregion: "East County", kind: "city", launchTarget: 0, googleLocality: "verified", center_lat: 32.7331, center_lng: -117.0344 },
  { slug: "spring-valley", name: "Spring Valley", subregion: "East County", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.7299, center_lng: -116.9764 },
  { slug: "lakeside", name: "Lakeside", subregion: "East County", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.8566, center_lng: -116.9042 },
  { slug: "alpine", name: "Alpine", subregion: "East County", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.8425, center_lng: -116.7559 },
  { slug: "jamul", name: "Jamul", subregion: "East County", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.7184, center_lng: -116.8709 },

  // ── Backcountry (mountains, desert, border) ───────────────────────────────
  { slug: "julian", name: "Julian", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 33.0735, center_lng: -116.5889 },
  { slug: "borrego-springs", name: "Borrego Springs", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 33.241, center_lng: -116.3571 },
  { slug: "descanso", name: "Descanso", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.8696, center_lng: -116.6279 },
  { slug: "pine-valley", name: "Pine Valley", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "unverified", center_lat: 32.8415, center_lng: -116.5107 },
  { slug: "mount-laguna", name: "Mount Laguna", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.8711, center_lng: -116.4247 },
  { slug: "campo", name: "Campo", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.641, center_lng: -116.4745 },
  { slug: "potrero", name: "Potrero", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "unverified", center_lat: 32.6131, center_lng: -116.6068 },
  { slug: "dulzura", name: "Dulzura", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: null, center_lng: null },
  { slug: "boulevard", name: "Boulevard", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "unverified", center_lat: 32.664, center_lng: -116.2896 },
  { slug: "jacumba-hot-springs", name: "Jacumba Hot Springs", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: 32.6365, center_lng: -116.1907 },
  { slug: "warner-springs", name: "Warner Springs", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: null, center_lng: null },
  { slug: "santa-ysabel", name: "Santa Ysabel", subregion: "Backcountry", kind: "community", launchTarget: 0, googleLocality: "verified", center_lat: null, center_lng: null },
];

/**
 * Typed / postal / neighbourhood names → the roster city Google files them
 * under (alias → city slug). Used only for the typed-text fallback: a
 * Google-matched submission already arrives with the parent city as
 * `locality`. Every mapping was observed in the 2026-11-13 Places probe
 * (neighbourhood or postal name → locality), except the spelling variants.
 * Scoped to this market by venueGeographyResolver, and subject to its
 * province veto, so generic names ("North Park", "Hillcrest") can never
 * resolve into another market.
 */
export const GREATER_SAN_DIEGO_CITY_ALIASES: Readonly<Record<string, string>> = {
  // City of San Diego neighbourhoods / postal names
  "la jolla": "san-diego",
  "pacific beach": "san-diego",
  "mission beach": "san-diego",
  "ocean beach": "san-diego",
  "point loma": "san-diego",
  "little italy": "san-diego",
  "gaslamp": "san-diego",
  "gaslamp quarter": "san-diego",
  "east village": "san-diego",
  "downtown san diego": "san-diego",
  "marina": "san-diego",
  "barrio logan": "san-diego",
  "hillcrest": "san-diego",
  "mission hills": "san-diego",
  "middletown": "san-diego",
  "north park": "san-diego",
  "south park": "san-diego",
  "golden hill": "san-diego",
  "normal heights": "san-diego",
  "university heights": "san-diego",
  "mission valley": "san-diego",
  "kearny mesa": "san-diego",
  "convoy": "san-diego",
  "university city": "san-diego",
  "utc": "san-diego",
  "carmel valley": "san-diego",
  "carmel mountain": "san-diego",
  "carmel mountain ranch": "san-diego",
  "rancho bernardo": "san-diego",
  "4s ranch": "san-diego",
  "scripps ranch": "san-diego",
  "rancho penasquitos": "san-diego",
  "rancho peñasquitos": "san-diego",
  "sorrento valley": "san-diego",
  "sorrento mesa": "san-diego",
  "san ysidro": "san-diego",
  "otay mesa": "san-diego",
  // Encinitas
  "cardiff": "encinitas",
  "cardiff by the sea": "encinitas",
  "cardiff-by-the-sea": "encinitas",
  "leucadia": "encinitas",
  "olivenhain": "encinitas",
  // Carlsbad
  "la costa": "carlsbad",
  "carlsbad village": "carlsbad",
  // Oceanside
  "camp pendleton": "oceanside",
  // Escondido
  "elfin forest": "escondido",
  "harmony grove": "escondido",
  // Chula Vista
  "eastlake": "chula-vista",
  "otay ranch": "chula-vista",
  // El Cajon
  "rancho san diego": "el-cajon",
  "bostonia": "el-cajon",
  "crest": "el-cajon",
  "harbison canyon": "el-cajon",
  // Spring Valley / Lakeside / Fallbrook (unincorporated parents)
  "la presa": "spring-valley",
  "winter gardens": "lakeside",
  "granite hills": "lakeside",
  "rainbow": "fallbrook",
  // Spelling variants Google itself uses in formatted addresses
  "mt laguna": "mount-laguna",
  "mt. laguna": "mount-laguna",
  "jacumba": "jacumba-hot-springs",
};

/** Launch-target total (Encore Sushi included in Solana Beach). */
export function greaterSanDiegoLaunchTargetTotal(): number {
  return GREATER_SAN_DIEGO_CITIES.reduce((n, c) => n + c.launchTarget, 0);
}
