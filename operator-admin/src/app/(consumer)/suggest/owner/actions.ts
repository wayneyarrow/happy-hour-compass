"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import type {
  GoogleMatch,
  LookupResult,
  SavePayload,
  SaveResult,
} from "./types";

// ── Google Places API (New) constants ─────────────────────────────────────────

const PLACES_API_BASE = "https://places.googleapis.com/v1";

/**
 * Field mask for the initial text search.
 * Fetches everything needed for the confirmation screen plus fields stored
 * for later downstream use (rating, reviewCount, photoReference).
 */
const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.regularOpeningHours",
  "places.rating",
  "places.userRatingCount",
  "places.photos",
].join(",");

// ── Google Places helpers ─────────────────────────────────────────────────────

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

/**
 * Performs a Google Places API (New) text search and returns a structured
 * GoogleMatch object from the top result.
 *
 * Uses GOOGLE_PLACES_API_KEY (server-side only — never exposed to the client).
 * Returns null on API failure, missing key, or no results.
 */
async function searchGooglePlace(
  businessName: string,
  city: string,
  province: string
): Promise<GoogleMatch | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error(
      "[searchGooglePlace] GOOGLE_PLACES_API_KEY is not configured. " +
        "Add it to .env.local to enable Google matching."
    );
    return null;
  }

  // Name + city + province is the primary lookup signal.
  // Street address is intentionally excluded from the query — it tends to
  // confuse the Places text search when combined with name.
  const textQuery = `${businessName}, ${city}, ${province}`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(
        "[searchGooglePlace] Places API HTTP error:",
        res.status,
        res.statusText
      );
      return null;
    }

    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[searchGooglePlace] Places API fetch error:", err);
    return null;
  }

  const places = data.places as Record<string, unknown>[] | undefined;
  if (!places?.length) return null;

  const p = places[0] as Record<string, unknown>;
  const components = (p.addressComponents as Record<string, unknown>[]) ?? [];

  const streetNumber = extractLong(components, "street_number");
  const route = extractLong(components, "route");
  const streetAddress = [streetNumber, route].filter(Boolean).join(" ") || null;

  const location = p.location as { latitude?: number; longitude?: number } | undefined;
  const displayName = p.displayName as { text?: string } | undefined;
  const photos = p.photos as { name?: string }[] | undefined;

  return {
    placeId: typeof p.id === "string" ? p.id : null,
    name: displayName?.text ?? null,
    formattedAddress:
      typeof p.formattedAddress === "string" ? p.formattedAddress : null,
    streetAddress,
    city:
      extractLong(components, "locality") ??
      extractLong(components, "sublocality_level_1") ??
      null,
    province: extractLong(components, "administrative_area_level_1") ?? null,
    // provinceShort is the abbreviation (e.g. "BC") — needed for confidence gate
    // when submitters enter abbreviated province codes.
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

// ── Confidence gate ───────────────────────────────────────────────────────────
//
// Determines whether a Google Places result is a strong enough match to surface
// as the confirmation candidate. If any gate fails the result is treated as
// no-match rather than showing an unrelated business to the submitter.
//
// This is a deterministic V1 gate — no scoring engine. Four independent checks,
// each of which must pass independently. Ported from the name-similarity logic
// already used in scripts/backfillGoogleRating.ts.

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
 * Google candidate name. Matches the threshold used in the backfill script.
 */
function nameSimilarityOk(submittedName: string, candidateName: string): boolean {
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
function cityMatches(submitted: string, googleCity: string): boolean {
  return submitted.trim().toLowerCase() === googleCity.trim().toLowerCase();
}

/**
 * Gate 3: Province/state match.
 * Handles both full names and common abbreviations.
 * Submitted "BC" matches Google long="British Columbia" or short="BC".
 * Submitted "British Columbia" matches Google long="British Columbia".
 */
function provinceMatches(
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

/**
 * Extract the leading street number from an address string.
 * "123 Main St" → "123".  "Main St" → null.
 */
function extractLeadingNumber(address: string): string | null {
  const m = address.trim().match(/^(\d+)/);
  return m ? m[1] : null;
}

/**
 * Gate 4: Street number match.
 * Only applied when both the submitted and Google addresses contain a leading
 * number. Mismatched numbers (e.g. submitted "123" vs Google "456") are a
 * strong signal that the candidate is a different business.
 *
 * Skipped when either side has no number — e.g. "Main Street Mall, Unit 5"
 * is common and we don't want to incorrectly reject those cases.
 */
function streetNumberMatches(
  submittedStreet: string,
  googleStreet: string | null
): boolean {
  const submittedNum = extractLeadingNumber(submittedStreet);
  if (!submittedNum) return true; // No number submitted — skip check
  const googleNum = googleStreet ? extractLeadingNumber(googleStreet) : null;
  if (!googleNum) return true; // Google has no leading number — skip check
  return submittedNum === googleNum;
}

/**
 * Runs all four confidence gates against a candidate GoogleMatch.
 *
 * Returns true only if name, city, province, AND street number all pass.
 * Any single failure causes the whole gate to fail (AND logic — not scoring).
 */
function passesConfidenceGate(
  submitted: {
    businessName: string;
    streetAddress: string;
    city: string;
    province: string;
  },
  candidate: GoogleMatch
): boolean {
  if (!candidate.name || !nameSimilarityOk(submitted.businessName, candidate.name)) {
    console.log(
      "[confidenceGate] FAIL name — submitted:",
      submitted.businessName,
      "google:",
      candidate.name
    );
    return false;
  }

  if (!candidate.city || !cityMatches(submitted.city, candidate.city)) {
    console.log(
      "[confidenceGate] FAIL city — submitted:",
      submitted.city,
      "google:",
      candidate.city
    );
    return false;
  }

  if (!provinceMatches(submitted.province, candidate.province, candidate.provinceShort)) {
    console.log(
      "[confidenceGate] FAIL province — submitted:",
      submitted.province,
      "google long:",
      candidate.province,
      "short:",
      candidate.provinceShort
    );
    return false;
  }

  if (!streetNumberMatches(submitted.streetAddress, candidate.streetAddress)) {
    console.log(
      "[confidenceGate] FAIL street number — submitted:",
      submitted.streetAddress,
      "google:",
      candidate.streetAddress
    );
    return false;
  }

  return true;
}

// ── Server actions ────────────────────────────────────────────────────────────

/**
 * Validates the operator submission form, performs a backend Google Places
 * lookup, and runs a confidence gate on the top result.
 *
 * Does NOT write to the database — purely a lookup action.
 * DB write happens in saveOperatorSubmissionAction after match confirmation.
 *
 * Returns:
 *   { match: GoogleMatch }  — candidate passed all confidence gates
 *   { match: null }         — no result, API unavailable, or gate failed
 *   { fieldErrors: {...} }  — validation failed, no lookup performed
 */
export async function lookupBusinessAction(
  formData: FormData
): Promise<LookupResult> {
  // ── Extract + sanitize ────────────────────────────────────────────────────
  const businessName  = (formData.get("business_name")  as string | null)?.trim() ?? "";
  const streetAddress = (formData.get("street_address") as string | null)?.trim() ?? "";
  const city          = (formData.get("city")           as string | null)?.trim() ?? "";
  const province      = (formData.get("province")       as string | null)?.trim() ?? "";
  const firstName     = (formData.get("first_name")     as string | null)?.trim() ?? "";
  const lastName      = (formData.get("last_name")      as string | null)?.trim() ?? "";
  const position      = (formData.get("position")       as string | null)?.trim() ?? "";
  const email         = (formData.get("email")          as string | null)?.trim().toLowerCase() ?? "";

  // ── Server-side validation ────────────────────────────────────────────────
  const fieldErrors: Record<string, string> = {};

  if (!businessName)  fieldErrors.business_name  = "Required";
  if (!streetAddress) fieldErrors.street_address = "Required";
  if (!city)          fieldErrors.city           = "Required";
  if (!province)      fieldErrors.province       = "Required";
  if (!firstName)     fieldErrors.first_name     = "Required";
  if (!lastName)      fieldErrors.last_name      = "Required";
  if (!position)      fieldErrors.position       = "Required";
  if (!email) {
    fieldErrors.email = "Required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Please enter a valid email address";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { match: null, fieldErrors };
  }

  // ── Google Places lookup ──────────────────────────────────────────────────
  const candidate = await searchGooglePlace(businessName, city, province);

  if (!candidate) {
    return { match: null };
  }

  // ── Confidence gate ───────────────────────────────────────────────────────
  // Only surface the candidate if it passes all four deterministic checks.
  // Failing the gate is not an error — it routes to the no-match path instead.
  const confident = passesConfidenceGate(
    { businessName, streetAddress, city, province },
    candidate
  );

  if (!confident) {
    console.log(
      "[lookupBusinessAction] Candidate failed confidence gate — routing to no-match.",
      { submitted: { businessName, city, province }, candidate: candidate.name }
    );
    return { match: null };
  }

  return { match: candidate };
}

/**
 * Persists the operator submission to operator_submissions.
 *
 * Called after the submitter has responded to the Google match confirmation:
 *   - matchConfirmed: true  → match_status = 'confirmed'
 *   - matchConfirmed: false → match_status = 'rejected' (or 'no_match' if no match)
 *
 * Captures IP address from request headers for future trust signal use.
 */
export async function saveOperatorSubmissionAction(
  payload: SavePayload
): Promise<SaveResult> {
  const {
    formValues,
    match,
    matchConfirmed,
    rejectionNotes,
    website,
    additionalNotes,
  } = payload;

  // ── IP capture (for trust signals in Phase 3B+) ───────────────────────────
  const heads = await headers();
  const forwarded = heads.get("x-forwarded-for");
  const ip =
    forwarded
      ? forwarded.split(",")[0].trim()
      : (heads.get("x-real-ip") ?? null);

  // ── Derive match_status ───────────────────────────────────────────────────
  // no_match:  Google returned nothing (match is null)
  // confirmed: submitter said "yes, this is my business"
  // rejected:  submitter said "this is not my business"
  const matchStatus =
    match === null ? "no_match" : matchConfirmed ? "confirmed" : "rejected";

  // Only store the Google place_id on the top-level column when confirmed.
  // The full match object is always stored in google_match_json for review.
  const placeId = matchConfirmed && match?.placeId ? match.placeId : null;

  // ── Insert ────────────────────────────────────────────────────────────────
  const supabase = createAdminClient();

  const { error } = await supabase.from("operator_submissions").insert({
    // Identity — operator_name kept as combined name for backwards-compat
    operator_name:     `${formValues.firstName} ${formValues.lastName}`.trim(),
    first_name:        formValues.firstName,
    last_name:         formValues.lastName,
    email:             formValues.email,
    position:          formValues.position,

    // Business info submitted by the operator
    venue_name:        formValues.businessName,
    street_address:    formValues.streetAddress,
    city:              formValues.city,
    province:          formValues.province,

    // Google match results
    place_id:          placeId,
    google_match_json: match ?? null,
    match_status:      matchStatus,

    // Rejection path fields (null when not on rejection path)
    rejection_notes:   rejectionNotes || null,
    website:           website || null,
    additional_notes:  additionalNotes || null,

    // Trust signal seed
    ip_address:        ip,

    // Review routing — always starts as 'new'
    status:            "new",
  });

  if (error) {
    console.error("[saveOperatorSubmissionAction] Insert error:", error);
    return { error: "Something went wrong. Please try again." };
  }

  return { success: true };
}
