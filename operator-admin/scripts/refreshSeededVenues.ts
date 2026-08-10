/**
 * scripts/refreshSeededVenues.ts
 *
 * Seeded Venue Refresh — a PERMANENT, market-scoped operational tool.
 *
 * This is NOT a one-time Central Okanagan launch script. It is intended to be
 * run every time a previously-seeded market is refreshed before activation /
 * launch (Greater Vancouver, Seattle, Toronto, and any market added later).
 * See CLAUDE.md ("Seeded Market Launch Prep") for the permanent operating
 * doc — read that first if you're picking this up cold.
 *
 * WHAT THIS TOOL DOES
 *   For every venue in a selected market, look up the venue on Google Places
 *   API (New) and compare Google's current data against the production
 *   venues row for these OBJECTIVE, non-Happy-Hour fields:
 *     place_id, business status (open/closed), business_hours, phone,
 *     website_url, google_rating, google_review_count, latitude/longitude,
 *     address/postal code, google_primary_type, google_types.
 *   It reports what differs and — in --apply mode only — writes the safe,
 *   objective fields back to Supabase.
 *
 * WHAT THIS TOOL DOES NOT DO
 *   - Happy Hour data (hh_times, hh_food_details, hh_drink_details,
 *     hh_tagline) is OUT OF SCOPE. Google Places has no concept of "happy
 *     hour" — that data can only come from manual/editorial research (the
 *     separate Happy Hour certification workflow). This tool never reads
 *     Happy Hour fields for comparison purposes and NEVER writes them. It
 *     does surface the *existing* Happy Hour data, unmodified, in the CSV
 *     worksheet this tool produces, purely so a human reviewer has it in
 *     the same place as everything else being checked.
 *   - establishment_type is a curated Happy Hour Compass product field, not
 *     a mirror of Google's primaryType/types. This tool never proposes or
 *     writes an establishment_type change — it only flags a meaningful
 *     mismatch for human judgment.
 *   - address_line1 / postal_code / lat / lng are never auto-updated. A
 *     geographic difference could just as easily mean a bad Google match as
 *     a stale DB value, so these are always flag-only.
 *   - Does not touch is_published, claimed_at, claimed_by,
 *     created_by_operator_id, updated_by_operator_id, source,
 *     placeholder_image_path, media, editorial copy (about_your_venue,
 *     teaser), payment/plan data, guides, or events.
 *
 * GOOGLE PLACES LOGIC REUSE
 *   The Get-Place-by-place_id / Text-Search-fallback pattern, its name-
 *   similarity gate (>=60% token overlap) and its geographic distance gate
 *   (<=300m) are ported from the proven implementations already in this
 *   repo — scripts/backfillMissingBusinessHours.ts and
 *   scripts/backfillGoogleRating.ts (both use the identical algorithm), and
 *   the field-mask/response-shape conventions from searchGooglePlace() in
 *   src/app/(consumer)/suggest/owner/actions.ts. Nothing about the matching
 *   algorithm itself is reinvented here — it's extended (an "ambiguous"
 *   outcome bucket, addressComponents parsing for the geography flag) and
 *   applied to a market-wide multi-field comparison instead of a single
 *   backfill-when-null column. The repo has no shared module for these
 *   scripts to import from one another (each existing backfill script is
 *   already independently self-contained in exactly this way), so — to
 *   avoid touching already-proven, already-shipped scripts for this task —
 *   the ported functions are reproduced here rather than imported.
 *
 * MATCHING
 *   1. venue.place_id present → Get Place (returns a confirmed match; a
 *      direct ID lookup needs no fuzzy confirmation).
 *   2. No place_id, or the stored one 404s / errors → Text Search fallback
 *      using name + city, biased toward existing lat/lng when available:
 *        - name similarity >= 60% of the venue's tokens found in the
 *          candidate name, AND
 *        - geographic distance <= 300 m (skipped only when neither side has
 *          coordinates to check).
 *      Passes both → confirmed match. Some signal but fails a gate →
 *      "ambiguous" (flagged, no data change). Nothing usable → "no match"
 *      (flagged, no data change).
 *
 * SAFETY MODEL
 *   - Defaults to DRY RUN. Zero Supabase writes unless --apply is passed.
 *   - --apply only ever updates venues where:
 *       source = 'seed' AND claimed_at IS NULL AND created_by_operator_id
 *       IS NULL
 *     i.e. venues nobody has claimed or is operating yet. A seeded venue
 *     that has since been claimed is still shown in the report (so the
 *     market total matches expectations) but is never written to — once an
 *     operator can edit a venue from Operator Admin, this tool must not
 *     silently overwrite their data with Google's.
 *   - Every write is scoped to `.eq("id", venue.id)` plus the same
 *     eligibility guard repeated as a WHERE clause (defence in depth against
 *     a venue being claimed between the read and the write).
 *   - Only the approved refresh fields are ever written: business_hours,
 *     phone, website_url, google_rating, google_review_count, place_id,
 *     google_primary_type, google_types. Nothing else, ever.
 *   - Google CLOSED_TEMPORARILY / CLOSED_PERMANENTLY never triggers an
 *     unpublish or delete — only a prominent review flag.
 *
 * OUTPUT
 *   - A console dry-run report: per-venue match info + field-by-field
 *     current/Google/proposed values, followed by a summary (counts by
 *     match outcome, proposed changes by field, venues needing manual
 *     review).
 *   - A CSV "Happy Hour review worksheet" at scripts/output/ — the PERMANENT
 *     working document for the manual Happy Hour review step of every market
 *     launch (Run refresh → generate this CSV → manual HH review → HH import
 *     → QA). One row per venue, columns grouped to follow that human review
 *     workflow rather than the database schema:
 *       1. Identification        — venue_id, venue_name, market
 *       2. Google verification   — match status, operating status, rating,
 *                                   review count
 *       3. Venue verification    — current vs. Google phone/website/business
 *                                   hours (with a status per field) and
 *                                   establishment_type vs. Google's primary
 *                                   type (review flag only — see above)
 *       4. Happy Hour — CURRENT  — existing hh_times/food/drink data, broken
 *                                   into human-readable columns (never JSON).
 *                                   Read-only display: this tool never
 *                                   compares or writes Happy Hour data.
 *       5. Happy Hour — NEW      — always-blank editable columns filled in
 *                                   by hand during manual review, sitting
 *                                   beside the CURRENT columns for
 *                                   comparison: new_hh_schedule (single
 *                                   field), then new_food_1_name/_price/
 *                                   _notes ×3 and new_drink_1_name/_price/
 *                                   _notes ×3 — structured to exactly mirror
 *                                   the CURRENT item columns (not free text)
 *                                   so the future HH import tool can map
 *                                   them deterministically into
 *                                   hh_food_details/hh_drink_details without
 *                                   parsing reviewer prose. Never
 *                                   pre-populated or overwritten by this
 *                                   tool.
 *       6. Workflow               — manual_notes (pre-seeded with this run's
 *                                   system review flags — postal-code
 *                                   mismatches, ambiguous matches, possible
 *                                   closures, establishment_type flags — as a
 *                                   starting point a reviewer can append to)
 *                                   and workflow_status (blank by default;
 *                                   set by hand to e.g. "Not Started" / "In
 *                                   Review" / "Complete" as a venue moves
 *                                   through the review).
 *       7. Reference               — secondary/system columns kept at the
 *                                   very end (google_place_id,
 *                                   google_match_method, google_types,
 *                                   source, is_published, claimed,
 *                                   apply_eligible) — useful context, not
 *                                   part of the primary review flow.
 *     Regenerating this CSV (re-running the tool) always produces a fresh
 *     snapshot from the database and Google — it does not read back or merge
 *     a previously hand-edited CSV. Save any in-progress manual review work
 *     before re-running for the same market.
 *
 * USAGE (from operator-admin/)
 *   npm run refresh:seeded-venues -- --market=<market-slug> --dry-run
 *   npm run refresh:seeded-venues -- --market=<market-slug> --apply
 *
 *   <market-slug> is any markets.slug already in the database (e.g.
 *   central-okanagan, greater-vancouver). Run with no --market (or an
 *   unrecognised one) to print the list of valid markets and exit.
 *
 *   Optional flags:
 *     --limit=<n>   Only process the first n venues (by name) — useful for
 *                   a quick smoke test on a large market before a full run.
 *     --csv=<path>  Override the CSV output path (default: auto-generated
 *                   under scripts/output/).
 *
 * Prerequisites:
 *   GOOGLE_PLACES_API_KEY must be set in operator-admin/.env.local with the
 *   Places API (New) enabled in Google Cloud Console.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { ESTABLISHMENT_TYPE_OPTIONS } from "../src/app/admin/venue/types";

// ── Environment ────────────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    "ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.\n" +
      "       Make sure operator-admin/.env.local is populated."
  );
  process.exit(1);
}

if (!GOOGLE_PLACES_API_KEY) {
  console.error(
    "ERROR: Missing GOOGLE_PLACES_API_KEY.\n" +
      "       Add GOOGLE_PLACES_API_KEY=your_key to operator-admin/.env.local.\n" +
      "       Obtain a key from https://console.cloud.google.com — enable the Places API."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── CLI args ─────────────────────────────────────────────────────────────────

function argValue(flag: string): string | null {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const APPLY = process.argv.includes("--apply");
const MARKET_ARG = argValue("market");
const LIMIT_ARG = argValue("limit");
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG, 10) : null;
const CSV_ARG = argValue("csv");

// ── Rate limiting ──────────────────────────────────────────────────────────────
// Google Places free tier: 5 QPS. 200 ms between requests keeps us safely under
// — same figure used by backfillMissingBusinessHours.ts / backfillGoogleRating.ts.

const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Ported Google Places API (New) helpers
//
// Ported from scripts/backfillMissingBusinessHours.ts, scripts/backfillGoogleRating.ts,
// and searchGooglePlace() in src/app/(consumer)/suggest/owner/actions.ts. Same
// constants, same thresholds, same algorithm — see the header comment above for
// why these are reproduced here rather than imported.
// =============================================================================

const PLACES_API_BASE = "https://places.googleapis.com/v1";

/** Fields requested from Google for every venue — the full set this tool compares. */
const PLACE_FIELDS = [
  "id",
  "displayName",
  "businessStatus",
  "regularOpeningHours",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "formattedAddress",
  "addressComponents",
  "location",
  "primaryType",
  "types",
] as const;

// Get Place (single resource) field mask — bare field names.
const GET_PLACE_FIELD_MASK = PLACE_FIELDS.join(",");
// Text Search field mask — results are wrapped in a `places` array, so every
// field needs the "places." prefix (same convention used by the existing
// fallbackSearchHours()/searchGooglePlace() implementations).
const TEXT_SEARCH_FIELD_MASK = PLACE_FIELDS.map((f) => `places.${f}`).join(",");

function placesHeaders(fieldMask: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
    "X-Goog-FieldMask": fieldMask,
  };
}

// ── Name similarity (ported from backfillMissingBusinessHours.ts) ─────────────

const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "of", "at", "in", "on", "by"]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Returns the fraction (0–1) of the venue's meaningful tokens found in the candidate name. */
function nameSimilarityRatio(venueName: string, candidateName: string): number {
  const venueT = nameTokens(venueName);
  if (venueT.length === 0) return 0;
  const candidateSet = new Set(nameTokens(candidateName));
  const matches = venueT.filter((t) => candidateSet.has(t)).length;
  return matches / venueT.length;
}

const NAME_MATCH_THRESHOLD = 0.6; // matches the existing scripts' gate exactly

// ── Geographic distance (ported from backfillMissingBusinessHours.ts) ─────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 300 m is intentionally conservative (matches existing scripts) — the same
// block is fine, the next neighbourhood over is not.
const MAX_MATCH_DISTANCE_METERS = 300;

// Looser tolerance used ONLY for flagging an already-confirmed venue's stored
// lat/lng against Google's — not a matching gate. Anything under ~50 m is
// ordinary rooftop-vs-entrance point noise and not worth a human's time.
const GEO_FLAG_TOLERANCE_METERS = 50;

// ── Rating / review count validation (ported from backfillGoogleRating.ts) ────

function parseRating(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (isNaN(n) || n < 0 || n > 5) return null;
  return Math.round(n * 10) / 10;
}

function parseReviewCount(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? Math.floor(raw) : parseInt(String(raw), 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}

// ── Opening hours conversion (ported verbatim from backfillMissingBusinessHours.ts) ──

type DayOfWeek =
  | "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

type DayHours = { open: string; close: string };
type BusinessHours = { [K in DayOfWeek]?: DayHours | null };

type GoogleTimePoint = { day: number; hour: number; minute: number };
type GooglePeriod = { open: GoogleTimePoint; close?: GoogleTimePoint };
type GoogleOpeningHours = { periods?: GooglePeriod[] };

const DAYS_BY_INDEX: DayOfWeek[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

function padTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Converts a Google Places regularOpeningHours object to the BusinessHours
 * shape stored in venues.business_hours (JSONB). Identical rules to
 * backfillMissingBusinessHours.ts's convertGoogleHours():
 *   - All 7 days initialised to null (closed).
 *   - First period per day wins (split shifts collapse to the first block).
 *   - A period with no close point (24-hour venue) is skipped — can't be
 *     represented in the HH:MM pair format.
 *   - Identical open/close after formatting is skipped (invalid per the
 *     server action's own validation rule).
 *   - Returns null when there are no usable open days.
 */
function convertGoogleHours(hours: GoogleOpeningHours): BusinessHours | null {
  if (!hours.periods?.length) return null;

  const result: BusinessHours = {};
  for (const day of DAYS_BY_INDEX) result[day] = null;

  let hasAnyOpenDay = false;

  for (const period of hours.periods) {
    const openPoint = period.open;
    if (openPoint?.day == null) continue;
    const dayIdx = openPoint.day;
    if (dayIdx < 0 || dayIdx > 6) continue;
    const dayName = DAYS_BY_INDEX[dayIdx];

    if (result[dayName] != null) continue; // first period per day wins
    if (!period.close) continue; // 24-hour venue — can't represent

    const openStr = padTime(openPoint.hour, openPoint.minute);
    const closeStr = padTime(period.close.hour, period.close.minute);
    if (openStr === closeStr) continue;

    result[dayName] = { open: openStr, close: closeStr };
    hasAnyOpenDay = true;
  }

  return hasAnyOpenDay ? result : null;
}

// ── Address component extraction (ported from searchGooglePlace()) ────────────

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };

function extractLong(components: AddressComponent[], type: string): string | null {
  const match = components.find((c) => (c.types ?? []).includes(type));
  return match?.longText ?? null;
}

// =============================================================================
// Google Place lookup + matching
// =============================================================================

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  businessStatus?: string;
  regularOpeningHours?: GoogleOpeningHours;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
};

/** Normalized, comparison-ready view of a Google Place — what buildDiffs() consumes. */
type GooglePlaceData = {
  placeId: string | null;
  name: string | null;
  businessStatus: string | null;
  businessHours: BusinessHours | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  lat: number | null;
  lng: number | null;
  formattedAddress: string | null;
  streetAddress: string | null;
  city: string | null;
  postalCode: string | null;
  primaryType: string | null;
  types: string[];
};

function normalizePlace(raw: RawPlace): GooglePlaceData {
  const components = raw.addressComponents ?? [];
  const streetNumber = extractLong(components, "street_number");
  const route = extractLong(components, "route");
  return {
    placeId: raw.id ?? null,
    name: raw.displayName?.text ?? null,
    businessStatus: raw.businessStatus ?? null,
    businessHours: raw.regularOpeningHours ? convertGoogleHours(raw.regularOpeningHours) : null,
    phone: raw.internationalPhoneNumber ?? null,
    website: raw.websiteUri ?? null,
    rating: parseRating(raw.rating),
    reviewCount: parseReviewCount(raw.userRatingCount),
    lat: raw.location?.latitude ?? null,
    lng: raw.location?.longitude ?? null,
    formattedAddress: raw.formattedAddress ?? null,
    streetAddress: [streetNumber, route].filter(Boolean).join(" ") || null,
    city:
      extractLong(components, "locality") ??
      extractLong(components, "sublocality_level_1") ??
      null,
    postalCode: extractLong(components, "postal_code") ?? null,
    primaryType: raw.primaryType ?? null,
    types: raw.types ?? [],
  };
}

type MatchMethod = "confirmed_place_id" | "confirmed_text_search" | "ambiguous" | "no_match";

type MatchResult = {
  method: MatchMethod;
  place: GooglePlaceData | null;
  /** Human-readable safeguard/confidence trail shown in the report. */
  detail: string;
};

/** Get Place by resource name. Returns the raw Place, or null + a reason on 404/error. */
async function getPlace(placeId: string): Promise<{ place: RawPlace | null; reason: string }> {
  const resourceId = placeId.startsWith("places/") ? placeId : `places/${placeId}`;
  try {
    const res = await fetch(`${PLACES_API_BASE}/${resourceId}`, {
      method: "GET",
      headers: placesHeaders(GET_PLACE_FIELD_MASK),
    });
    if (!res.ok) return { place: null, reason: `HTTP ${res.status}` };
    const data = (await res.json()) as RawPlace & { error?: unknown };
    if (!data || data.error) return { place: null, reason: "API returned an error body" };
    return { place: data, reason: "ok" };
  } catch (err) {
    return { place: null, reason: `fetch error: ${String(err)}` };
  }
}

type FallbackCandidate = {
  place: RawPlace;
  nameSimRatio: number;
  distanceMeters: number | null;
};

/** Text Search fallback for venues with no (working) place_id. */
async function textSearchCandidate(venue: VenueRow): Promise<FallbackCandidate | null> {
  const queryParts = [venue.name];
  if (venue.city) queryParts.push(venue.city);
  else if (venue.address_line1) queryParts.push(venue.address_line1);
  const textQuery = queryParts.join(", ");

  const body: Record<string, unknown> = { textQuery };
  if (venue.lat != null && venue.lng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: venue.lat, longitude: venue.lng },
        radius: MAX_MATCH_DISTANCE_METERS * 2,
      },
    };
  }

  let data: { places?: RawPlace[] };
  try {
    const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: placesHeaders(TEXT_SEARCH_FIELD_MASK),
      body: JSON.stringify(body),
      cache: "no-store" as RequestCache,
    });
    if (!res.ok) return null;
    data = (await res.json()) as { places?: RawPlace[] };
  } catch {
    return null;
  }

  if (!data.places?.length) return null;

  const candidate = data.places[0];
  const candidateName = candidate.displayName?.text ?? "";
  const nameSimRatio = nameSimilarityRatio(venue.name, candidateName);

  let distanceMeters: number | null = null;
  if (venue.lat != null && venue.lng != null && candidate.location) {
    const { latitude, longitude } = candidate.location;
    if (latitude != null && longitude != null) {
      distanceMeters = haversineMeters(venue.lat, venue.lng, latitude, longitude);
    }
  }

  return { place: candidate, nameSimRatio, distanceMeters };
}

/**
 * Resolves a venue to a Google Place using the matching strategy described
 * in the header comment. Never returns a match for an ambiguous candidate —
 * "ambiguous" and "no_match" both carry `place: null` so callers can never
 * accidentally treat a rejected candidate as confirmed data.
 */
async function matchVenue(venue: VenueRow): Promise<MatchResult> {
  // ── Strategy 1: existing place_id ───────────────────────────────────────
  if (venue.place_id) {
    await sleep(DELAY_MS);
    const { place, reason } = await getPlace(venue.place_id);
    if (place) {
      return {
        method: "confirmed_place_id",
        place: normalizePlace(place),
        detail: `Get Place by existing place_id succeeded (${venue.place_id}).`,
      };
    }
    // Stale/invalid place_id — fall through to text search, noting why.
    console.log(`         place_id lookup failed (${reason}) — trying text search fallback`);
  }

  // ── Strategy 2: text search fallback ────────────────────────────────────
  await sleep(DELAY_MS);
  const candidate = await textSearchCandidate(venue);

  if (!candidate) {
    return {
      method: "no_match",
      place: null,
      detail: venue.place_id
        ? "place_id was stale and text search returned no candidates."
        : "No place_id on file and text search returned no candidates.",
    };
  }

  const { place, nameSimRatio, distanceMeters } = candidate;
  const nameOk = nameSimRatio >= NAME_MATCH_THRESHOLD;
  const distanceOk = distanceMeters == null || distanceMeters <= MAX_MATCH_DISTANCE_METERS;
  const distanceNote =
    distanceMeters == null ? "no coordinates to verify" : `${Math.round(distanceMeters)}m away`;

  if (nameOk && distanceOk) {
    return {
      method: "confirmed_text_search",
      place: normalizePlace(place),
      detail: `Text search match — name similarity ${(nameSimRatio * 100).toFixed(0)}%, ${distanceNote}.`,
    };
  }

  // Some signal, but failed a gate — ambiguous, not a confident match. Never
  // return `place` here: an ambiguous candidate must never be usable as data.
  if (nameSimRatio > 0) {
    return {
      method: "ambiguous",
      place: null,
      detail:
        `Best text search candidate "${place.displayName?.text ?? "?"}" — ` +
        `name similarity ${(nameSimRatio * 100).toFixed(0)}% (need ${NAME_MATCH_THRESHOLD * 100}%), ${distanceNote}. ` +
        `Not accepted — do not treat as a confirmed match.`,
    };
  }

  return {
    method: "no_match",
    place: null,
    detail: `Best text search candidate "${place.displayName?.text ?? "?"}" shares no meaningful name tokens with "${venue.name}".`,
  };
}

// =============================================================================
// Venue row + comparison
// =============================================================================

type VenueRow = {
  id: string;
  slug: string;
  name: string;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website_url: string | null;
  place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_primary_type: string | null;
  google_types: string[] | null;
  business_hours: BusinessHours | null;
  establishment_type: string | null;
  is_published: boolean;
  source: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  created_by_operator_id: string | null;
  hh_times: string | null;
  hh_times_needs_review: boolean | null;
  hh_food_details: string | null;
  hh_drink_details: string | null;
};

type ProposedAction = "update" | "no_change" | "flag_review" | "no_google_data";

type FieldDiff = {
  field: string;
  current: string;
  google: string;
  proposed: ProposedAction;
  note?: string;
};

type VenueReport = {
  venue: VenueRow;
  match: MatchResult;
  diffs: FieldDiff[];
  reviewFlags: string[];
  applyEligible: boolean;
  /** Only the fields buildDiffs() marked "update" — what --apply would write. */
  applyPatch: Record<string, unknown>;
};

// ── Field-level comparison helpers ─────────────────────────────────────────────

function normalizePhoneDigits(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : digits || null;
}

function formatPhoneNational(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizeWebsite(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.host.replace(/^www\./, "").toLowerCase();
    const pathname = u.pathname.replace(/\/$/, "");
    return `${host}${pathname}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");
  }
}

function normalizePostal(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/\s+/g, "").toUpperCase();
}

function businessHoursEqual(a: BusinessHours | null, b: BusinessHours | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  for (const day of DAYS_BY_INDEX) {
    const da = a[day] ?? null;
    const db = b[day] ?? null;
    if (da == null && db == null) continue;
    if (da == null || db == null) return false;
    if (da.open !== db.open || da.close !== db.close) return false;
  }
  return true;
}

function formatHoursForDisplay(h: BusinessHours | null): string {
  if (!h) return "(none)";
  const parts = DAYS_BY_INDEX.filter((d) => h[d] != null).map(
    (d) => `${d.slice(0, 3)} ${h[d]!.open}-${h[d]!.close}`
  );
  return parts.length ? parts.join(", ") : "(all closed)";
}

function arraysEqualAsSets(a: string[] | null, b: string[] | null): boolean {
  const sa = new Set((a ?? []).map((s) => s.toLowerCase()));
  const sb = new Set((b ?? []).map((s) => s.toLowerCase()));
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

// ── establishment_type review heuristic ────────────────────────────────────────
//
// Curated field — NEVER auto-mapped from Google. This is a coarse, informational
// heuristic only (same spirit as bcHygienePass.ts's KNOWN_VENUE_KEYWORDS check):
// if none of Google's primaryType/types share an obvious keyword with the
// establishment_type the venue is curated as, flag it for a human to look at.
// "Other" is deliberately exempt — it has no expected keyword set.

type EstablishmentTypeOption = (typeof ESTABLISHMENT_TYPE_OPTIONS)[number];

const ESTABLISHMENT_TYPE_KEYWORDS: Record<EstablishmentTypeOption, string[]> = {
  "Fast Casual": ["restaurant", "fast_food", "meal_takeaway", "food"],
  "Pub": ["bar", "pub"],
  "Bar": ["bar"],
  "Brewery": ["brewery", "bar"],
  "Winery": ["winery"],
  "Cocktail Bar": ["bar", "cocktail"],
  "Wine Bar": ["bar", "wine"],
  "Cafe": ["cafe", "coffee"],
  "Bistro": ["restaurant", "bistro"],
  "Lounge": ["bar", "lounge", "night_club"],
  "Sports Bar": ["bar"],
  "Restaurant and Bar": ["restaurant", "bar"],
  "Casual Dining": ["restaurant"],
  "Fine Dining": ["restaurant"],
  "Family Dining": ["restaurant"],
  "Taproom": ["bar", "brewery"],
  "Other": [],
};

/** Returns a review note when Google's type data doesn't obviously support the curated establishment_type, else null. */
function checkEstablishmentTypeMismatch(
  establishmentType: string | null,
  primaryType: string | null,
  types: string[]
): string | null {
  if (!establishmentType) return null;
  const keywords = ESTABLISHMENT_TYPE_KEYWORDS[establishmentType as EstablishmentTypeOption];
  if (!keywords || keywords.length === 0) return null; // unknown option or "Other" — never flag

  const googleTokens = [primaryType, ...types]
    .filter((t): t is string => !!t)
    .map((t) => t.toLowerCase());
  if (googleTokens.length === 0) return null; // nothing from Google to compare against

  const hasOverlap = keywords.some((kw) => googleTokens.some((t) => t.includes(kw)));
  if (hasOverlap) return null;

  return (
    `Curated establishment_type "${establishmentType}" doesn't obviously match Google's ` +
    `primaryType/types (${[primaryType, ...types].filter(Boolean).join(", ") || "none"}). ` +
    `Review only — establishment_type is never auto-changed.`
  );
}

// ── Diff builder ────────────────────────────────────────────────────────────────

function buildVenueReport(venue: VenueRow, match: MatchResult): VenueReport {
  const diffs: FieldDiff[] = [];
  const reviewFlags: string[] = [];
  const applyPatch: Record<string, unknown> = {};

  const applyEligible =
    venue.source === "seed" && venue.claimed_at == null && venue.created_by_operator_id == null;

  const g = match.place;

  // No confirmed match at all — nothing to compare, just flag.
  if (!g) {
    reviewFlags.push(
      match.method === "ambiguous"
        ? `Ambiguous Google match — ${match.detail}`
        : `No confident Google match — ${match.detail}`
    );
    return { venue, match, diffs, reviewFlags, applyEligible, applyPatch };
  }

  // place_id
  {
    const current = venue.place_id ?? "(none)";
    const googleVal = g.placeId ?? "(none)";
    if (g.placeId && g.placeId !== venue.place_id) {
      diffs.push({
        field: "place_id",
        current,
        google: googleVal,
        proposed: "update",
        note:
          match.method === "confirmed_text_search"
            ? "Resolved via text search fallback — verify before relying on it."
            : undefined,
      });
      applyPatch.place_id = g.placeId;
      if (venue.place_id) {
        reviewFlags.push(`place_id would change from ${venue.place_id} to ${g.placeId} (fallback match).`);
      }
    } else {
      diffs.push({ field: "place_id", current, google: googleVal, proposed: "no_change" });
    }
  }

  // Google operating status — report/flag only, no venues column to write to.
  {
    const status = g.businessStatus ?? "UNKNOWN";
    diffs.push({
      field: "google_business_status",
      current: "(not stored — flag only)",
      google: status,
      proposed: status === "OPERATIONAL" || status === "UNKNOWN" ? "no_change" : "flag_review",
    });
    if (status === "CLOSED_TEMPORARILY" || status === "CLOSED_PERMANENTLY") {
      reviewFlags.push(
        `Google reports this venue as ${status}. Not auto-unpublished — verify manually before any action.`
      );
    }
  }

  // business_hours
  {
    const current = formatHoursForDisplay(venue.business_hours);
    const googleVal = formatHoursForDisplay(g.businessHours);
    if (g.businessHours == null) {
      diffs.push({ field: "business_hours", current, google: "(no data from Google)", proposed: "no_google_data" });
    } else if (businessHoursEqual(venue.business_hours, g.businessHours)) {
      diffs.push({ field: "business_hours", current, google: googleVal, proposed: "no_change" });
    } else {
      diffs.push({ field: "business_hours", current, google: googleVal, proposed: "update" });
      applyPatch.business_hours = g.businessHours;
    }
  }

  // phone
  {
    const current = venue.phone ?? "(none)";
    const googleRaw = g.phone;
    const googleVal = googleRaw ?? "(no data from Google)";
    if (!googleRaw) {
      diffs.push({ field: "phone", current, google: googleVal, proposed: "no_google_data" });
    } else {
      const dCurrent = normalizePhoneDigits(venue.phone);
      const dGoogle = normalizePhoneDigits(googleRaw);
      if (dCurrent && dGoogle && dCurrent === dGoogle) {
        diffs.push({ field: "phone", current, google: googleVal, proposed: "no_change" });
      } else if (dGoogle) {
        const proposedValue = formatPhoneNational(dGoogle);
        diffs.push({ field: "phone", current, google: googleVal, proposed: "update", note: `→ ${proposedValue}` });
        applyPatch.phone = proposedValue;
      } else {
        diffs.push({ field: "phone", current, google: googleVal, proposed: "flag_review", note: "Google phone unparseable" });
      }
    }
  }

  // website_url
  {
    const current = venue.website_url ?? "(none)";
    const googleRaw = g.website;
    const googleVal = googleRaw ?? "(no data from Google)";
    if (!googleRaw) {
      diffs.push({ field: "website_url", current, google: googleVal, proposed: "no_google_data" });
    } else if (normalizeWebsite(venue.website_url) === normalizeWebsite(googleRaw)) {
      diffs.push({ field: "website_url", current, google: googleVal, proposed: "no_change" });
    } else {
      diffs.push({ field: "website_url", current, google: googleVal, proposed: "update" });
      applyPatch.website_url = googleRaw;
    }
  }

  // google_rating
  {
    const current = venue.google_rating != null ? String(venue.google_rating) : "(none)";
    const googleVal = g.rating != null ? String(g.rating) : "(no data from Google)";
    if (g.rating == null) {
      diffs.push({ field: "google_rating", current, google: googleVal, proposed: "no_google_data" });
    } else if (venue.google_rating === g.rating) {
      diffs.push({ field: "google_rating", current, google: googleVal, proposed: "no_change" });
    } else {
      diffs.push({ field: "google_rating", current, google: googleVal, proposed: "update" });
      applyPatch.google_rating = g.rating;
    }
  }

  // google_review_count
  {
    const current = venue.google_review_count != null ? String(venue.google_review_count) : "(none)";
    const googleVal = g.reviewCount != null ? String(g.reviewCount) : "(no data from Google)";
    if (g.reviewCount == null) {
      diffs.push({ field: "google_review_count", current, google: googleVal, proposed: "no_google_data" });
    } else if (venue.google_review_count === g.reviewCount) {
      diffs.push({ field: "google_review_count", current, google: googleVal, proposed: "no_change" });
    } else {
      diffs.push({ field: "google_review_count", current, google: googleVal, proposed: "update" });
      applyPatch.google_review_count = g.reviewCount;
    }
  }

  // google_primary_type
  {
    const current = venue.google_primary_type ?? "(none)";
    const googleVal = g.primaryType ?? "(no data from Google)";
    if (!g.primaryType) {
      diffs.push({ field: "google_primary_type", current, google: googleVal, proposed: "no_google_data" });
    } else if (venue.google_primary_type === g.primaryType) {
      diffs.push({ field: "google_primary_type", current, google: googleVal, proposed: "no_change" });
    } else {
      diffs.push({ field: "google_primary_type", current, google: googleVal, proposed: "update" });
      applyPatch.google_primary_type = g.primaryType;
    }
  }

  // google_types
  {
    const current = (venue.google_types ?? []).join("|") || "(none)";
    const googleVal = g.types.join("|") || "(no data from Google)";
    if (g.types.length === 0) {
      diffs.push({ field: "google_types", current, google: googleVal, proposed: "no_google_data" });
    } else if (arraysEqualAsSets(venue.google_types, g.types)) {
      diffs.push({ field: "google_types", current, google: googleVal, proposed: "no_change" });
    } else {
      diffs.push({ field: "google_types", current, google: googleVal, proposed: "update" });
      applyPatch.google_types = g.types;
    }
  }

  // establishment_type — review flag only, never a proposed update.
  {
    const current = venue.establishment_type ?? "(none)";
    const googleVal = [g.primaryType, ...g.types].filter(Boolean).join(", ") || "(no data from Google)";
    const mismatchNote = checkEstablishmentTypeMismatch(venue.establishment_type, g.primaryType, g.types);
    diffs.push({
      field: "establishment_type",
      current,
      google: googleVal,
      proposed: mismatchNote ? "flag_review" : "no_change",
      note: "Curated field — never auto-updated.",
    });
    if (mismatchNote) reviewFlags.push(mismatchNote);
  }

  // Geography — always flag-only, never proposed as an update (see header comment).
  {
    const currentLat = venue.lat != null ? String(venue.lat) : "(none)";
    const currentLng = venue.lng != null ? String(venue.lng) : "(none)";
    const googleLat = g.lat != null ? String(g.lat) : "(no data)";
    const googleLng = g.lng != null ? String(g.lng) : "(no data)";
    let geoProposed: ProposedAction = "no_change";
    let geoNote: string | undefined;

    if (venue.lat != null && venue.lng != null && g.lat != null && g.lng != null) {
      const distance = haversineMeters(venue.lat, venue.lng, g.lat, g.lng);
      if (distance > GEO_FLAG_TOLERANCE_METERS) {
        geoProposed = "flag_review";
        geoNote = `${Math.round(distance)}m from Google's location — verify before updating manually.`;
        reviewFlags.push(`Location differs from Google by ~${Math.round(distance)}m.`);
      }
    } else if (g.lat != null && g.lng != null && (venue.lat == null || venue.lng == null)) {
      geoProposed = "flag_review";
      geoNote = "Venue has no stored lat/lng — Google has one.";
      reviewFlags.push("Venue is missing lat/lng that Google has on file.");
    }

    diffs.push({
      field: "latitude_longitude",
      current: `${currentLat}, ${currentLng}`,
      google: `${googleLat}, ${googleLng}`,
      proposed: geoProposed,
      note: geoNote,
    });

    // Address / postal code — same flag-only treatment.
    const currentPostal = normalizePostal(venue.postal_code);
    const googlePostal = normalizePostal(g.postalCode);
    if (googlePostal && currentPostal && googlePostal !== currentPostal) {
      diffs.push({
        field: "postal_code",
        current: venue.postal_code ?? "(none)",
        google: g.postalCode ?? "(none)",
        proposed: "flag_review",
        note: "Postal code differs — verify before updating manually.",
      });
      reviewFlags.push(`Postal code differs: DB "${venue.postal_code}" vs Google "${g.postalCode}".`);
    } else {
      diffs.push({
        field: "postal_code",
        current: venue.postal_code ?? "(none)",
        google: g.postalCode ?? "(no data)",
        proposed: "no_change",
      });
    }
  }

  return { venue, match, diffs, reviewFlags, applyEligible, applyPatch };
}

// =============================================================================
// Happy Hour data — READ ONLY. Surfaced in the CSV worksheet, never compared
// against Google (Google has no happy hour concept) and never modified.
// =============================================================================

type HhItem = { name: string; price?: string; notes?: string };

/** Same three-format tolerance as src/lib/data/venues.ts's parseSpecials(): JSON object array (current format), JSON string array, or legacy newline text. Read-only — never re-serialized or written back. */
function parseHhItems(raw: string | null): HhItem[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item): HhItem => {
        if (typeof item === "string") return { name: item };
        return {
          name: String(item?.name ?? ""),
          price: item?.price != null ? String(item.price) : undefined,
          notes: item?.notes != null ? String(item.notes) : undefined,
        };
      });
    }
  } catch {
    // fall through to legacy plain text
  }
  return raw
    .split(/[\n|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

// =============================================================================
// Market resolution
// =============================================================================

type MarketRow = { id: string; slug: string; name: string; status: string };

async function resolveMarket(marketArg: string | null): Promise<MarketRow> {
  const { data: markets, error } = await supabase
    .from("markets")
    .select("id, slug, name, status")
    .order("display_order");

  if (error) {
    console.error("ERROR: Could not load markets table:", error.message);
    process.exit(1);
  }

  if (!marketArg) {
    console.error("ERROR: --market=<slug> is required.\n");
    printAvailableMarkets(markets ?? []);
    process.exit(1);
  }

  const bySlug = markets?.find((m) => m.slug.toLowerCase() === marketArg.toLowerCase());
  if (bySlug) return bySlug;

  const byId = markets?.find((m) => m.id === marketArg);
  if (byId) return byId;

  const byName = markets?.find((m) => m.name.toLowerCase() === marketArg.toLowerCase());
  if (byName) return byName;

  console.error(`ERROR: No market found matching "${marketArg}".\n`);
  printAvailableMarkets(markets ?? []);
  process.exit(1);
}

function printAvailableMarkets(markets: MarketRow[]) {
  console.error("Available markets (use the slug with --market=):");
  for (const m of markets) {
    console.error(`  ${m.slug.padEnd(20)} ${m.name} [${m.status}]`);
  }
}

// =============================================================================
// CSV worksheet
// =============================================================================

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values.map((v) => csvEscape(v == null ? "" : String(v))).join(",");
}

// Column order follows the human review workflow (Identification → Google
// verification → Venue verification → Happy Hour review → Workflow), not the
// database schema. See the "OUTPUT" section of the header comment. A small
// "Reference" group of secondary/system fields is kept at the very end —
// useful context (e.g. whether a venue is claimed) that the primary review
// flow doesn't need front-and-center, but that shouldn't be thrown away
// either.
const CSV_COLUMNS = [
  // ── Identification ──────────────────────────────────────────────────────
  "venue_id", "venue_name", "market",

  // ── Google verification ─────────────────────────────────────────────────
  "google_verification_status", "google_operating_status",
  "google_rating", "google_review_count",

  // ── Venue verification ───────────────────────────────────────────────────
  "current_phone", "google_phone", "phone_status",
  "current_website", "google_website", "website_status",
  "current_business_hours", "google_business_hours", "business_hours_status",
  "establishment_type", "google_primary_type", "establishment_type_review_flag",

  // ── Happy Hour review — CURRENT (existing data, read-only display; this
  //    tool never reads Happy Hour data for comparison and never writes it) ──
  "current_hh_schedule", "current_hh_status",
  "current_food_1_name", "current_food_1_price", "current_food_1_notes",
  "current_food_2_name", "current_food_2_price", "current_food_2_notes",
  "current_food_3_name", "current_food_3_price", "current_food_3_notes",
  "current_drink_1_name", "current_drink_1_price", "current_drink_1_notes",
  "current_drink_2_name", "current_drink_2_price", "current_drink_2_notes",
  "current_drink_3_name", "current_drink_3_price", "current_drink_3_notes",

  // ── Happy Hour review — NEW (always blank on generation; filled in by hand
  //    during the manual Happy Hour certification pass. Structured to
  //    exactly mirror the CURRENT item columns above — not free text — so
  //    the future HH import tool can map these deterministically into
  //    hh_food_details/hh_drink_details without parsing reviewer prose.
  //    See header comment.) ──────────────────────────────────────────────
  "new_hh_schedule",
  "new_food_1_name", "new_food_1_price", "new_food_1_notes",
  "new_food_2_name", "new_food_2_price", "new_food_2_notes",
  "new_food_3_name", "new_food_3_price", "new_food_3_notes",
  "new_drink_1_name", "new_drink_1_price", "new_drink_1_notes",
  "new_drink_2_name", "new_drink_2_price", "new_drink_2_notes",
  "new_drink_3_name", "new_drink_3_price", "new_drink_3_notes",

  // ── Workflow ─────────────────────────────────────────────────────────────
  "manual_notes", "workflow_status",

  // ── Reference (secondary — system/operational context, not part of the
  //    primary review flow) ────────────────────────────────────────────────
  "google_place_id", "google_match_method", "google_types",
  "source", "is_published", "claimed", "apply_eligible",
];

function diffFor(report: VenueReport, field: string): FieldDiff | undefined {
  return report.diffs.find((d) => d.field === field);
}

function verificationStatusLabel(method: MatchMethod): string {
  switch (method) {
    case "confirmed_place_id": return "confirmed (place_id)";
    case "confirmed_text_search": return "confirmed (text search)";
    case "ambiguous": return "ambiguous — needs review";
    case "no_match": return "no match — needs review";
  }
}

function currentHhStatus(venue: VenueRow): string {
  if (venue.hh_times_needs_review) return "Flagged for review";
  if (!venue.hh_times?.trim()) return "Missing";
  return "OK";
}

function buildCsvRow(report: VenueReport, marketName: string): string {
  const v = report.venue;
  const food = parseHhItems(v.hh_food_details).slice(0, 3);
  const drink = parseHhItems(v.hh_drink_details).slice(0, 3);
  const currentFoodCols = [0, 1, 2].flatMap((i) => [food[i]?.name, food[i]?.price, food[i]?.notes]);
  const currentDrinkCols = [0, 1, 2].flatMap((i) => [drink[i]?.name, drink[i]?.price, drink[i]?.notes]);

  const phoneDiff = diffFor(report, "phone");
  const websiteDiff = diffFor(report, "website_url");
  const hoursDiff = diffFor(report, "business_hours");
  const estDiff = diffFor(report, "establishment_type");
  const statusDiff = diffFor(report, "google_business_status");

  const values = [
    // Identification
    v.id, v.name, marketName,

    // Google verification
    verificationStatusLabel(report.match.method),
    statusDiff?.google ?? "UNKNOWN",
    report.match.place?.rating ?? "",
    report.match.place?.reviewCount ?? "",

    // Venue verification
    v.phone ?? "", report.match.place?.phone ?? "", phoneDiff?.proposed ?? "no_google_data",
    v.website_url ?? "", report.match.place?.website ?? "", websiteDiff?.proposed ?? "no_google_data",
    formatHoursForDisplay(v.business_hours), formatHoursForDisplay(report.match.place?.businessHours ?? null),
    hoursDiff ? `${hoursDiff.proposed}` : "no_google_data",
    v.establishment_type ?? "",
    report.match.place?.primaryType ?? "",
    estDiff?.proposed === "flag_review" ? "REVIEW" : "",

    // Happy Hour review — current (unmodified, read-only)
    v.hh_times ?? "", currentHhStatus(v),
    ...currentFoodCols,
    ...currentDrinkCols,

    // Happy Hour review — NEW (always blank; see column comment above).
    // 1 new_hh_schedule + 3 food items × (name/price/notes) + 3 drink items ×
    // (name/price/notes) — kept as an explicit count rather than a magic
    // number of blanks so it stays obviously in sync with the CSV_COLUMNS
    // definition above if that ever changes.
    ...Array<string>(1 + 3 * 3 + 3 * 3).fill(""),

    // Workflow — always blank on generation (see column comment above)
    report.reviewFlags.join(" | "), "",

    // Reference
    report.match.place?.placeId ?? v.place_id ?? "",
    report.match.method,
    (report.match.place?.types ?? []).join("|"),
    v.source, v.is_published, !!v.claimed_at, report.applyEligible,
  ];

  return csvRow(values);
}

function writeCsv(reports: VenueReport[], market: MarketRow, csvPathOverride: string | null): string {
  const outDir = path.resolve(process.cwd(), "scripts", "output");
  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const defaultPath = path.join(outDir, `hh-review-${market.slug}-${timestamp}.csv`);
  const outPath = csvPathOverride ? path.resolve(process.cwd(), csvPathOverride) : defaultPath;

  const lines = [csvRow(CSV_COLUMNS), ...reports.map((r) => buildCsvRow(r, market.name))];
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
  return outPath;
}

// =============================================================================
// Console reporting
// =============================================================================

const DIVIDER = "─".repeat(78);
const BOLD_DIVIDER = "═".repeat(78);

function printVenueBlock(report: VenueReport, index: number, total: number) {
  const v = report.venue;
  const prefix = `${(index + 1).toString().padStart(3)}/${total}`;
  const claimedNote = v.claimed_at ? " [CLAIMED]" : "";
  const operatorNote = v.created_by_operator_id ? " [HAS OPERATOR]" : "";
  const eligNote = report.applyEligible ? "" : " — NOT apply-eligible (claimed/operator/non-seed)";

  console.log(`\n${prefix}  ${v.name}  (${v.id})${claimedNote}${operatorNote}`);
  console.log(`      match: ${report.match.method}${eligNote}`);
  console.log(`      ${report.match.detail}`);

  for (const d of report.diffs) {
    if (d.proposed === "no_change") continue; // keep the block focused on what needs attention
    const tag =
      d.proposed === "update" ? "UPDATE " :
      d.proposed === "flag_review" ? "REVIEW " :
      "NO-DATA";
    console.log(`      [${tag}] ${d.field}: "${d.current}" → "${d.google}"${d.note ? `  (${d.note})` : ""}`);
  }
  const unchangedCount = report.diffs.filter((d) => d.proposed === "no_change").length;
  if (unchangedCount > 0) {
    console.log(`      (${unchangedCount} field${unchangedCount === 1 ? "" : "s"} unchanged, not shown)`);
  }
  for (const flag of report.reviewFlags) {
    console.log(`      ⚠ ${flag}`);
  }
}

function printSummary(reports: VenueReport[], market: MarketRow) {
  console.log(`\n${BOLD_DIVIDER}`);
  console.log(`  SUMMARY — ${market.name} (${market.slug})`);
  console.log(BOLD_DIVIDER);

  const total = reports.length;
  const byMethod: Record<MatchMethod, number> = {
    confirmed_place_id: 0, confirmed_text_search: 0, ambiguous: 0, no_match: 0,
  };
  for (const r of reports) byMethod[r.match.method]++;

  console.log(`\n  Venues checked                 : ${total}`);
  console.log(`  Confident matches (place_id)   : ${byMethod.confirmed_place_id}`);
  console.log(`  Confident matches (text search): ${byMethod.confirmed_text_search}`);
  console.log(`  Ambiguous matches               : ${byMethod.ambiguous}`);
  console.log(`  No match                        : ${byMethod.no_match}`);

  const fieldsUnchanged = reports.reduce(
    (n, r) => n + r.diffs.filter((d) => d.proposed === "no_change").length, 0
  );
  const fieldsUpdate = reports.reduce(
    (n, r) => n + r.diffs.filter((d) => d.proposed === "update").length, 0
  );
  console.log(`\n  Fields unchanged (aggregate)    : ${fieldsUnchanged}`);
  console.log(`  Fields proposed for update      : ${fieldsUpdate}`);

  console.log(`\n  ── Proposed changes by field ──`);
  const byField = new Map<string, number>();
  for (const r of reports) {
    for (const d of r.diffs) {
      if (d.proposed !== "update") continue;
      byField.set(d.field, (byField.get(d.field) ?? 0) + 1);
    }
  }
  if (byField.size === 0) {
    console.log(`    (none)`);
  } else {
    for (const [field, count] of [...byField.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${field.padEnd(24)}: ${count}`);
    }
  }

  const needsReview = reports.filter(
    (r) => r.match.method === "ambiguous" || r.match.method === "no_match" || r.reviewFlags.length > 0
  );
  console.log(`\n  Venues requiring manual review  : ${needsReview.length}`);
  for (const r of needsReview) {
    console.log(`    - ${r.venue.name} (${r.venue.id})`);
    for (const flag of r.reviewFlags) console.log(`        ⚠ ${flag}`);
    if (r.match.method === "ambiguous" || r.match.method === "no_match") {
      console.log(`        ⚠ ${r.match.detail}`);
    }
  }

  const closures = reports.filter((r) => {
    const status = diffFor(r, "google_business_status")?.google;
    return status === "CLOSED_TEMPORARILY" || status === "CLOSED_PERMANENTLY";
  });
  if (closures.length > 0) {
    console.log(`\n  ⚠ Google reports possible closures (${closures.length}) — human review required, NOT auto-actioned:`);
    for (const r of closures) {
      const status = diffFor(r, "google_business_status")?.google;
      console.log(`    - ${r.venue.name} (${r.venue.id}): ${status}`);
    }
  }

  const notApplyEligible = reports.filter((r) => !r.applyEligible);
  console.log(
    `\n  Not apply-eligible (claimed / has operator / non-seed): ${notApplyEligible.length} ` +
      `— shown above for completeness, never written to.`
  );

  console.log(`\n${DIVIDER}`);
}

// =============================================================================
// Apply mode
// =============================================================================

// The only columns this tool is ever allowed to write. Anything not in this
// list — including every Happy Hour field and every protected field named in
// the header comment — is structurally impossible for --apply to touch,
// because applyPatch is only ever populated by buildVenueReport() above using
// these exact keys.
const WRITABLE_FIELDS = [
  "business_hours", "phone", "website_url",
  "google_rating", "google_review_count",
  "place_id", "google_primary_type", "google_types",
] as const;

async function applyUpdates(reports: VenueReport[]) {
  const eligible = reports.filter((r) => r.applyEligible && Object.keys(r.applyPatch).length > 0);

  console.log(`\n${BOLD_DIVIDER}`);
  console.log(`  APPLYING UPDATES`);
  console.log(BOLD_DIVIDER);
  console.log(`\n  ${eligible.length} venue(s) have an apply-eligible proposed change.\n`);

  let updated = 0;
  let failed = 0;

  for (const r of eligible) {
    const patch: Record<string, unknown> = {};
    for (const key of WRITABLE_FIELDS) {
      if (key in r.applyPatch) patch[key] = r.applyPatch[key];
    }

    // Defence in depth: repeat the eligibility guard as a WHERE clause so a
    // venue claimed between the read and this write is never touched.
    const { error, count } = await supabase
      .from("venues")
      .update(patch, { count: "exact" })
      .eq("id", r.venue.id)
      .eq("source", "seed")
      .is("claimed_at", null)
      .is("created_by_operator_id", null);

    if (error) {
      console.error(`  ERROR  ${r.venue.name} (${r.venue.id}): ${error.message}`);
      failed++;
    } else if ((count ?? 0) === 0) {
      console.log(`  SKIP   ${r.venue.name} (${r.venue.id}): no longer eligible (claimed/operator since read).`);
    } else {
      console.log(`  OK     ${r.venue.name} (${r.venue.id}): updated ${Object.keys(patch).join(", ")}`);
      updated++;
    }
  }

  console.log(`\n  Updated: ${updated}   Failed: ${failed}   Total eligible: ${eligible.length}\n`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log(`\n${BOLD_DIVIDER}`);
  console.log(`  Seeded Venue Refresh — Happy Hour Compass`);
  console.log(`  Mode: ${APPLY ? "APPLY (will write to Supabase)" : "DRY RUN (no database writes)"}`);
  console.log(`  Scope: Google Places verification only — Happy Hour data is out of scope.`);
  console.log(BOLD_DIVIDER);

  const market = await resolveMarket(MARKET_ARG);
  console.log(`\nMarket: ${market.name} (${market.slug}) [${market.status}]`);

  const { data: venues, error } = await supabase
    .from("venues")
    .select(
      "id, slug, name, address_line1, city, region, postal_code, lat, lng, phone, website_url, " +
        "place_id, google_rating, google_review_count, google_primary_type, google_types, " +
        "business_hours, establishment_type, is_published, source, claimed_at, claimed_by, " +
        "created_by_operator_id, hh_times, hh_times_needs_review, hh_food_details, hh_drink_details"
    )
    .eq("market_id", market.id)
    .order("name");

  if (error) {
    console.error("ERROR: Could not fetch venues:", error.message);
    process.exit(1);
  }

  let rows = (venues ?? []) as unknown as VenueRow[];
  console.log(`Venues found in market: ${rows.length}`);

  if (LIMIT != null && LIMIT > 0 && LIMIT < rows.length) {
    rows = rows.slice(0, LIMIT);
    console.log(`--limit=${LIMIT} applied — processing first ${rows.length} venue(s).`);
  }

  if (rows.length === 0) {
    console.log("No venues to process. Nothing to do.\n");
    return;
  }

  console.log(`\n${DIVIDER}`);
  console.log(`  PER-VENUE DETAIL`);
  console.log(DIVIDER);

  const reports: VenueReport[] = [];
  for (let i = 0; i < rows.length; i++) {
    const venue = rows[i];
    const match = await matchVenue(venue);
    const report = buildVenueReport(venue, match);
    reports.push(report);
    printVenueBlock(report, i, rows.length);
  }

  printSummary(reports, market);

  const csvPath = writeCsv(reports, market, CSV_ARG);
  console.log(`\nHappy Hour review worksheet written to:\n  ${csvPath}\n`);
  console.log(
    "This CSV is for the separate manual Happy Hour certification workflow.\n" +
      "It reflects existing hh_* data verbatim — nothing in it has been changed by this run.\n"
  );

  if (APPLY) {
    await applyUpdates(reports);
  } else {
    console.log("DRY RUN complete — no database writes were made.");
    console.log("Re-run with --apply once the proposed changes above have been reviewed.\n");
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
