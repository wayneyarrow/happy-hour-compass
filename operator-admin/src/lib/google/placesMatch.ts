/**
 * Canonical Google Places (New) search + confidence-gate + venue-field-mapping
 * logic, shared between:
 *   - the operator-submission intake flow ((consumer)/suggest/owner/actions.ts)
 *   - automatic post-approval reconciliation (google/reconcileVenueGoogleIdentity.ts)
 *   - the Founder Control Panel "Google Identity" manual fallback
 *     (control-panel/venues/[id]/actions.ts)
 *
 * This is intentionally NOT wired into the older standalone maintenance
 * scripts (scripts/backfillGoogleRating.ts, backfillMissingBusinessHours.ts,
 * refreshSeededVenues.ts) — those use a deliberately different, more
 * permissive matching strategy (place_id-first, then name-similarity +
 * haversine-distance-guarded text search) suited to bulk seeded-venue
 * enrichment, not to gating a brand-new, unverified business submission.
 * Consolidating all four call sites onto one shared module is a reasonable
 * follow-up but is out of scope here — see the implementation report.
 *
 * Server-only — reads GOOGLE_PLACES_API_KEY. Never import from a Client
 * Component.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Structured Google Places match result returned by a search or a direct
 * place lookup.
 *
 * All fields are nullable — the lookup may return partial data depending on
 * what the Places API has for a given business.
 */
export type GoogleMatch = {
  placeId: string | null;
  /** Business name from Google displayName.text */
  name: string | null;
  /** Full formatted address string from Google */
  formattedAddress: string | null;
  /** Street address: street_number + route (e.g. "460 Doyle Ave") */
  streetAddress: string | null;
  city: string | null;
  province: string | null;
  /** Short/abbreviated province from Google addressComponents (e.g. "BC" for "British Columbia").
   *  Used by the confidence gate to match submitted abbreviations like "BC" against full names. */
  provinceShort: string | null;
  postalCode: string | null;
  country: string | null;
  /** Latitude from location.latitude */
  lat: number | null;
  /** Longitude from location.longitude */
  lng: number | null;
  /** International phone number (e.g. "+1 604-555-0100") */
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** First photo resource name (e.g. "places/ChIJ.../photos/Aaw...") */
  photoReference: string | null;
};

/** Google identity lifecycle state stored on venues.google_identity_status. */
export type GoogleIdentityStatus = "matched" | "unmatched" | "exempt";

// ── Google Places API (New) constants ─────────────────────────────────────────

const PLACES_API_BASE = "https://places.googleapis.com/v1";

/**
 * Field mask shared by text search and direct Get Place lookups.
 * Fetches everything needed for the confirmation screen plus fields stored
 * for later downstream use (rating, reviewCount, photoReference).
 */
const PLACES_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "location",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "photos",
].join(",");

const SEARCH_FIELD_MASK = PLACES_FIELD_MASK.split(",")
  .map((f) => `places.${f}`)
  .join(",");

// ── Google Places response parsing ────────────────────────────────────────────

/** Extract a single address component's longText by Google type string. */
function extractLong(
  components: Record<string, unknown>[],
  type: string
): string | null {
  const match = components.find(
    (c) => Array.isArray(c.types) && (c.types as string[]).includes(type)
  );
  return (match?.longText as string | undefined) ?? null;
}

/** Extract a single address component's shortText by Google type string. */
function extractShort(
  components: Record<string, unknown>[],
  type: string
): string | null {
  const match = components.find(
    (c) => Array.isArray(c.types) && (c.types as string[]).includes(type)
  );
  return (match?.shortText as string | undefined) ?? null;
}

/** Maps a single raw Places API "place" object into a structured GoogleMatch. */
function parsePlace(p: Record<string, unknown>): GoogleMatch {
  const components = (p.addressComponents as Record<string, unknown>[]) ?? [];

  const streetNumber = extractLong(components, "street_number");
  const route = extractLong(components, "route");
  const streetAddress = [streetNumber, route].filter(Boolean).join(" ") || null;

  const location = p.location as { latitude?: number; longitude?: number } | undefined;
  const displayName = p.displayName as { text?: string } | undefined;
  const photos = p.photos as { name?: string }[] | undefined;

  const placeId = typeof p.id === "string" ? p.id : null;
  const name = displayName?.text ?? null;

  return {
    placeId,
    name,
    formattedAddress:
      typeof p.formattedAddress === "string" ? p.formattedAddress : null,
    streetAddress,
    city:
      extractLong(components, "locality") ??
      extractLong(components, "sublocality_level_1") ??
      null,
    province: extractLong(components, "administrative_area_level_1") ?? null,
    provinceShort: extractShort(components, "administrative_area_level_1") ?? null,
    postalCode: extractLong(components, "postal_code") ?? null,
    country: extractLong(components, "country") ?? null,
    lat: location?.latitude ?? null,
    lng: location?.longitude ?? null,
    phone:
      typeof p.internationalPhoneNumber === "string"
        ? p.internationalPhoneNumber
        : null,
    website: typeof p.websiteUri === "string" ? p.websiteUri : null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    photoReference: photos?.[0]?.name ?? null,
  };
}

/**
 * Performs a Google Places API (New) text search and returns a structured
 * GoogleMatch object from the top result.
 *
 * Uses GOOGLE_PLACES_API_KEY (server-side only — never exposed to the client).
 * This key must be set in Vercel → Settings → Environment Variables for all
 * environments (Production, Preview, Development). See .env.local.example.
 *
 * Returns null on API failure, missing key, or no results.
 */
export async function searchGooglePlace(
  businessName: string,
  city: string,
  province: string
): Promise<GoogleMatch | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  console.log("[searchGooglePlace] GOOGLE_PLACES_API_KEY present:", !!apiKey);

  if (!apiKey) {
    console.error(
      "[searchGooglePlace] GOOGLE_PLACES_API_KEY is not configured. " +
        "Add it to .env.local for local dev and to Vercel Environment Variables " +
        "(Production + Preview + Development) to enable Google matching."
    );
    return null;
  }

  // Name + city + province is the primary lookup signal.
  // Street address is intentionally excluded from the query — it tends to
  // confuse the Places text search when combined with name.
  const textQuery = `${businessName}, ${city}, ${province}`;
  console.log("[searchGooglePlace] query:", textQuery);

  let data: Record<string, unknown>;
  try {
    const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery }),
      cache: "no-store",
    });

    console.log("[searchGooglePlace] Places API HTTP status:", res.status);

    if (!res.ok) {
      let errorBody: unknown = null;
      try {
        errorBody = await res.json();
      } catch {
        // Ignore — body may not be JSON.
      }
      console.error(
        "[searchGooglePlace] Places API error — status:",
        res.status,
        res.statusText,
        "— body:",
        JSON.stringify(errorBody)
      );
      return null;
    }

    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[searchGooglePlace] Places API fetch error:", err);
    return null;
  }

  const places = data.places as Record<string, unknown>[] | undefined;
  console.log("[searchGooglePlace] candidates returned:", places?.length ?? 0);

  if (!places?.length) return null;

  const match = parsePlace(places[0] as Record<string, unknown>);
  console.log("[searchGooglePlace] selected candidate:", {
    name: match.name,
    placeId: match.placeId,
  });
  return match;
}

/**
 * Fetches a single place directly by its Google Places ID ("Get Place").
 *
 * Used for authoritative re-fetches (e.g. the Founder Control Panel "Confirm
 * this listing" action) so persisted rating/review data always comes from a
 * fresh server-side call rather than trusting a client-echoed value.
 *
 * Returns null on API failure, missing key, or an unknown/removed place_id.
 */
export async function getGooglePlaceById(placeId: string): Promise<GoogleMatch | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.error("[getGooglePlaceById] GOOGLE_PLACES_API_KEY is not configured.");
    return null;
  }

  try {
    const res = await fetch(`${PLACES_API_BASE}/places/${placeId}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("[getGooglePlaceById] Places API error — status:", res.status, res.statusText);
      return null;
    }

    const data = (await res.json()) as Record<string, unknown>;
    return parsePlace(data);
  } catch (err) {
    console.error("[getGooglePlaceById] Places API fetch error:", err);
    return null;
  }
}

// ── Confidence gate ───────────────────────────────────────────────────────────
//
// Determines whether a Google Places result is a strong enough match to
// surface/attach automatically. If any gate fails the result is treated as
// no-match rather than showing/attaching an unrelated business.
//
// Deterministic V1 gate — no scoring engine. Four independent checks, each of
// which must pass independently.

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "at", "in", "on", "by",
]);

/** Lowercase, strip punctuation, tokenise, drop short tokens and stop words. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Gate 1: Name similarity.
 * At least 60% of the submitted name's meaningful tokens must appear in the
 * Google candidate name.
 */
export function nameSimilarityOk(submittedName: string, candidateName: string): boolean {
  const submittedT = nameTokens(submittedName);
  const candidateSet = new Set(nameTokens(candidateName));
  if (submittedT.length === 0) return false;
  const matches = submittedT.filter((t) => candidateSet.has(t)).length;
  return matches / submittedT.length >= 0.6;
}

/**
 * Gate 2: City match.
 * Case-insensitive exact match after trimming.
 * Intentionally strict — a business in "North Vancouver" should not match
 * a candidate in "Vancouver".
 */
export function cityMatches(submitted: string, googleCity: string): boolean {
  return submitted.trim().toLowerCase() === googleCity.trim().toLowerCase();
}

/**
 * Gate 3: Province/state match.
 * Handles both full names and common abbreviations.
 * Submitted "BC" matches Google long="British Columbia" or short="BC".
 * Submitted "British Columbia" matches Google long="British Columbia".
 */
export function provinceMatches(
  submitted: string,
  googleLong: string | null,
  googleShort: string | null
): boolean {
  const s = submitted.trim().toLowerCase();
  if (!s) return false;
  const long = (googleLong ?? "").trim().toLowerCase();
  const short = (googleShort ?? "").trim().toLowerCase();
  return s === long || s === short;
}

/** Extract the leading street number from an address string, ignoring any unit/subpremise prefix. */
function extractLeadingNumber(address: string): string | null {
  const m = address.trim().match(/^(\d+)/);
  return m ? m[1] : null;
}

/**
 * Gate 4 support: derive every plausible "street number" reading of a
 * submitted address, in priority order.
 *
 * Candidate 1 is always the plain leading number — this preserves the exact
 * existing behaviour for ordinary addresses ("123 Main St" → "123").
 *
 * A second candidate is added ONLY when the address matches one of a small,
 * explicit set of common unit-first formats seen in Canadian addresses
 * (building/suite number written before the street number):
 *   "701 - 460 Doyle Ave"        (spaced hyphen)
 *   "701-460 Doyle Ave"          (bare hyphen)
 *   "Unit 701, 460 Doyle Ave"
 *   "Suite 701, 460 Doyle Ave"
 *   "Apt 701, 460 Doyle Ave"
 *   "#701, 460 Doyle Ave"
 * In each of those cases the second candidate is the number immediately
 * following the recognized unit prefix.
 *
 * This never REPLACES candidate 1 — it only ever adds a second, precise
 * candidate for a specific recognized shape. An address with no recognized
 * unit prefix behaves identically to the original single-candidate logic.
 */
export function extractStreetNumberCandidates(address: string): string[] {
  const trimmed = address.trim();
  if (!trimmed) return [];

  const candidates: string[] = [];
  const leading = extractLeadingNumber(trimmed);
  if (leading) candidates.push(leading);

  // "Unit 701, 460 Doyle Ave" / "Suite 701, 460 Doyle Ave" / "Apt 701, 460 Doyle Ave"
  const wordPrefixMatch = trimmed.match(
    /^(?:unit|suite|apt\.?|apartment)\s*#?\s*\d+\s*[,\-]\s*(\d+)/i
  );
  if (wordPrefixMatch) {
    candidates.push(wordPrefixMatch[1]);
  }

  // "#701, 460 Doyle Ave" / "#701 - 460 Doyle Ave"
  const hashPrefixMatch = trimmed.match(/^#\s*\d+\s*[,\-]\s*(\d+)/);
  if (hashPrefixMatch) {
    candidates.push(hashPrefixMatch[1]);
  }

  // Bare unit-street pair: "701 - 460 Doyle Ave" / "701-460 Doyle Ave"
  // Only fires when the string starts with NUMBER (-|,) NUMBER — i.e. the
  // exact shape the word/hash prefixes above already exclude.
  const barePairMatch = trimmed.match(/^\d+\s*[-,]\s*(\d+)\b/);
  if (barePairMatch) {
    candidates.push(barePairMatch[1]);
  }

  // De-duplicate while preserving priority order.
  return Array.from(new Set(candidates));
}

/**
 * Gate 4: Street number match.
 * Only applied when both the submitted and Google addresses contain a leading
 * number. Mismatched numbers (e.g. submitted "123" vs Google "456") are a
 * strong signal that the candidate is a different business.
 *
 * Skipped when either side has no number — e.g. "Main Street Mall, Unit 5"
 * is common and we don't want to incorrectly reject those cases.
 *
 * The submitted side is checked against every candidate returned by
 * extractStreetNumberCandidates() — this is what lets a unit-first address
 * like "701 - 460 Doyle Ave" correctly match Google's street number "460"
 * without weakening the check for ordinary addresses (which only ever
 * produce one candidate).
 */
export function streetNumberMatches(
  submittedStreet: string,
  googleStreet: string | null
): boolean {
  const submittedCandidates = extractStreetNumberCandidates(submittedStreet);
  if (submittedCandidates.length === 0) return true; // No number submitted — skip check
  const googleNum = googleStreet ? extractLeadingNumber(googleStreet) : null;
  if (!googleNum) return true; // Google has no leading number — skip check
  return submittedCandidates.includes(googleNum);
}

export type ConfidenceGateSubmitted = {
  businessName: string;
  streetAddress: string;
  city: string;
  province: string;
};

/**
 * Runs all four confidence gates against a candidate GoogleMatch.
 *
 * Returns true only if name, city, province, AND street number all pass.
 * Any single failure causes the whole gate to fail (AND logic — not scoring).
 */
export function passesConfidenceGate(
  submitted: ConfidenceGateSubmitted,
  candidate: GoogleMatch
): boolean {
  if (!candidate.name || !nameSimilarityOk(submitted.businessName, candidate.name)) {
    console.log(
      "[confidenceGate] FAIL name — submitted:", submitted.businessName,
      "google:", candidate.name
    );
    return false;
  }

  if (!candidate.city || !cityMatches(submitted.city, candidate.city)) {
    console.log(
      "[confidenceGate] FAIL city — submitted:", submitted.city,
      "google:", candidate.city
    );
    return false;
  }

  if (!provinceMatches(submitted.province, candidate.province, candidate.provinceShort)) {
    console.log(
      "[confidenceGate] FAIL province — submitted:", submitted.province,
      "google long:", candidate.province, "short:", candidate.provinceShort
    );
    return false;
  }

  if (!streetNumberMatches(submitted.streetAddress, candidate.streetAddress)) {
    console.log(
      "[confidenceGate] FAIL street number — submitted:", submitted.streetAddress,
      "google:", candidate.streetAddress
    );
    return false;
  }

  return true;
}

// ── Venue field mapping ───────────────────────────────────────────────────────

/**
 * Canonical Google-identity fields to persist on `venues` once a match is
 * confirmed — the single mapping every call site (submission auto-approve,
 * manual Founder approve, automatic reconciliation, Control Panel manual
 * confirm) should use, so the set of fields written never drifts between
 * paths again.
 */
/**
 * Safely extracts rating/reviewCount from a raw, possibly-untyped Google
 * match blob — e.g. a stored operator_submissions.google_match_json JSONB
 * value being read back for the manual Founder approval path, where the
 * source object isn't a freshly-validated GoogleMatch straight out of
 * searchGooglePlace(). Used so that path stops silently dropping
 * rating/reviewCount the way it previously did, using the same shape as
 * toVenueGoogleFields() below rather than a third bespoke extraction.
 */
export function extractGoogleRatingFields(raw: Record<string, unknown> | null | undefined): {
  google_rating: number | null;
  google_review_count: number | null;
} {
  return {
    google_rating: typeof raw?.rating === "number" ? (raw.rating as number) : null,
    google_review_count: typeof raw?.reviewCount === "number" ? (raw.reviewCount as number) : null,
  };
}

export function toVenueGoogleFields(match: GoogleMatch): {
  place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_identity_status: GoogleIdentityStatus;
} {
  return {
    place_id: match.placeId,
    google_rating: match.rating,
    google_review_count: match.reviewCount,
    google_identity_status: "matched",
  };
}
