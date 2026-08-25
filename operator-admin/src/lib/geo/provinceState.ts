/**
 * Province/state plausibility validation — shared by every public Add Your
 * Venue entry point (intake forms + the more-info correction flow).
 *
 * Purpose: reject obviously-invalid free-text input (e.g. "Yes", "123",
 * "asdf") before it ever reaches operator_submissions.province. This is a
 * PLAUSIBILITY check, not a geography lookup — it accepts any real Canadian
 * province/territory or US state, in either abbreviated or full-name form,
 * regardless of whether HHC currently operates a market there.
 *
 * Deliberately NOT the same table as PROVINCE_CODES in
 * src/lib/geo/venueGeographyResolver.ts. That table serves a different,
 * narrower purpose: a safety veto used only to reject a city match when the
 * submitted province clearly disagrees with the matched city's *seeded*
 * market — so it intentionally only lists provinces HHC currently has
 * markets in (today: BC, AB). Expanding it to cover every province/state
 * would change its semantics for that unrelated concern. This module is the
 * general-purpose "is this plausibly a real province or state" check used at
 * public intake, before geography/market resolution ever runs.
 *
 * Normalization: trim, lowercase, collapse internal whitespace, and strip
 * accents (so "Québec" and "Quebec" both match). Returns the canonical
 * two-letter code on a match, or null otherwise.
 */

function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (é -> e)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Canadian provinces and territories: full name -> canonical 2-letter code. */
const CANADA_PROVINCES: Record<string, string> = {
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "newfoundland and labrador": "NL",
  "nova scotia": "NS",
  "northwest territories": "NT",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  quebec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
};

/** US states + DC: full name -> canonical 2-letter code. */
const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

/** Every valid 2-letter code, for direct abbreviation lookups. */
const ALL_CODES = new Set<string>([
  ...Object.values(CANADA_PROVINCES),
  ...Object.values(US_STATES),
]);

/** Full-name -> code lookup, keyed by normalizeKey(). */
const FULL_NAME_TO_CODE: Record<string, string> = {};
for (const [name, code] of Object.entries({ ...CANADA_PROVINCES, ...US_STATES })) {
  FULL_NAME_TO_CODE[normalizeKey(name)] = code;
}

/**
 * Normalizes free-text province/state input to its canonical 2-letter code
 * if it plausibly identifies a real Canadian province/territory or US state
 * (by abbreviation or full name, case/accent/whitespace-insensitive).
 * Returns null for anything else (including empty input) — never guesses.
 */
export function normalizeProvinceState(input: string | null | undefined): string | null {
  if (!input) return null;
  const key = normalizeKey(input);
  if (!key) return null;

  if (key.length === 2 && ALL_CODES.has(key.toUpperCase())) {
    return key.toUpperCase();
  }
  return FULL_NAME_TO_CODE[key] ?? null;
}

/** True if the input plausibly identifies a real province/state. */
export function isValidProvinceState(input: string | null | undefined): boolean {
  return normalizeProvinceState(input) !== null;
}
