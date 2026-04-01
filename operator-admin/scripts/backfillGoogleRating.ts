/**
 * scripts/backfillGoogleRating.ts
 *
 * Backfills google_rating and google_review_count on existing venues using the
 * Places API (New).
 *
 * Lookup strategy:
 *   1. Venues with an existing place_id → Places API (New) Get Place endpoint.
 *        If it returns 404 (stale place_id) → fall through to step 3.
 *   2. Venues without a place_id but with lat + lng → fallback search (step 3).
 *   3. Fallback search: Places API (New) Text Search (POST :searchText) using
 *        name + city, biased to lat/lng.  Candidate is validated for name
 *        similarity AND geographic proximity before being accepted.  On success
 *        the new place_id is also written back.
 *   4. Venues with no location data and no viable search result → skipped.
 *
 * Writes are limited to:
 *   • place_id             (only when recovering/resolving via fallback search)
 *   • google_rating
 *   • google_review_count
 *
 * Run from the operator-admin directory:
 *   npm run backfill:google-rating           ← dry-run (no DB writes)
 *   npm run backfill:google-rating -- --write ← apply updates to Supabase
 *
 * Prerequisites:
 *   1. Migration 012_venues_google_rating.sql must be applied first.
 *   2. GOOGLE_PLACES_API_KEY must be set in operator-admin/.env.local.
 *      The key must have the Places API (New) enabled in Google Cloud Console.
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

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

const DRY_RUN = !process.argv.includes("--write");

// ── Rate limiting ──────────────────────────────────────────────────────────────
// Google Places free tier: 5 QPS.  200 ms between requests keeps us safely under.

const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Validation helpers ─────────────────────────────────────────────────────────

/** Returns a validated decimal rating (0.0–5.0, rounded to 1 decimal) or null. */
function parseRating(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (isNaN(n) || n < 0 || n > 5) return null;
  return Math.round(n * 10) / 10;
}

/** Returns a validated non-negative integer review count or null. */
function parseReviewCount(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? Math.floor(raw) : parseInt(String(raw), 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}

// ── Name similarity ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "of", "at", "in", "on", "by"]);

/** Lowercases, strips punctuation, splits to tokens, drops stop words. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Conservative name match: at least 60 % of the venue's meaningful tokens must
 * appear in the candidate name.  Prevents accepting unrelated businesses that
 * happen to share one common word.
 */
function nameSimilarityOk(venueName: string, candidateName: string): boolean {
  const venueT = nameTokens(venueName);
  const candidateSet = new Set(nameTokens(candidateName));

  if (venueT.length === 0) return false;

  const matches = venueT.filter((t) => candidateSet.has(t)).length;
  return matches / venueT.length >= 0.6;
}

// ── Geographic distance ────────────────────────────────────────────────────────

/** Great-circle distance in metres (Haversine). */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Maximum distance (metres) to accept a fallback candidate.
// 300 m is intentionally conservative — the same block is fine, the next
// neighbourhood over is not.
const MAX_DISTANCE_METERS = 300;

// ── Places API (New) helpers ───────────────────────────────────────────────────
//
// All requests use header-based auth (X-Goog-Api-Key) and a FieldMask
// (X-Goog-FieldMask) instead of the legacy ?key= + ?fields= query params.

const PLACES_API_BASE = "https://places.googleapis.com/v1";

/** Shared headers for every Places API (New) request. */
function placesHeaders(fieldMask: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
    "X-Goog-FieldMask": fieldMask,
  };
}

/**
 * Places API (New) — Get Place by resource name.
 *
 * Endpoint: GET /v1/places/{id}
 * FieldMask: places.rating,places.userRatingCount
 *
 * Returns null when the place_id is stale (HTTP 404) or on any error.
 * The stored place_id may be either a legacy ID (ChIJ…) or a new resource
 * name (places/ChIJ…).  We normalise to the bare ID and pass it as the
 * resource name segment.
 */
async function getPlaceDetails(placeId: string): Promise<{
  rating: number | null;
  reviewCount: number | null;
} | null> {
  // Accept both "ChIJ..." and "places/ChIJ..." formats
  const resourceId = placeId.startsWith("places/") ? placeId : `places/${placeId}`;
  const url = `${PLACES_API_BASE}/${resourceId}`;

  let data: any;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: placesHeaders("rating,userRatingCount"),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  // The new API returns the place object directly (no wrapping status field)
  if (!data || data.error) return null;

  return {
    rating: parseRating(data.rating),
    reviewCount: parseReviewCount(data.userRatingCount),
  };
}

type FallbackResult = {
  placeId: string;
  rating: number | null;
  reviewCount: number | null;
  distanceMeters: number | null;
};

/**
 * Places API (New) — Text Search fallback for stale or missing place_id.
 *
 * Endpoint: POST /v1/places:searchText
 * FieldMask: places.id,places.displayName,places.location,places.rating,places.userRatingCount
 *
 * The top candidate is accepted ONLY if:
 *   1. Name similarity passes the 60 % token-overlap threshold.
 *   2. The candidate is within MAX_DISTANCE_METERS of the venue's coordinates
 *      (when lat/lng is available — skips the distance check if coordinates are
 *      absent, but the name check is always applied).
 *
 * Returns null on no match or a low-confidence result.
 */
async function fallbackSearch(venue: VenueRow): Promise<FallbackResult | null> {
  // Build a richer query to reduce ambiguity
  const queryParts: string[] = [venue.name];
  if (venue.city) queryParts.push(venue.city);
  else if (venue.address_line1) queryParts.push(venue.address_line1);
  const textQuery = queryParts.join(", ");

  const body: Record<string, unknown> = { textQuery };

  if (venue.lat != null && venue.lng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: venue.lat, longitude: venue.lng },
        // Bias radius is 2× the acceptance threshold; actual distance validation
        // is done below with the stricter MAX_DISTANCE_METERS guard.
        radius: MAX_DISTANCE_METERS * 2,
      },
    };
  }

  let data: any;
  try {
    const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: placesHeaders(
        "places.id,places.displayName,places.location,places.rating,places.userRatingCount"
      ),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  if (!data?.places?.length) return null;

  const c = data.places[0];
  // Places API (New) response shape:
  //   c.id                  — bare place ID (no "places/" prefix)
  //   c.displayName.text    — human-readable name
  //   c.location.latitude   — geographic coords
  //   c.location.longitude
  //   c.rating              — number
  //   c.userRatingCount     — integer
  const candidateName: string = c.displayName?.text ?? "";
  const candidateLoc: { latitude: number; longitude: number } | null =
    c.location ?? null;

  // ── Guard 1: name similarity ────────────────────────────────────────────────
  if (!nameSimilarityOk(venue.name, candidateName)) {
    console.log(
      `         Fallback rejected (name mismatch): ` +
        `Google="${candidateName}" vs DB="${venue.name}"`
    );
    return null;
  }

  // ── Guard 2: geographic proximity ──────────────────────────────────────────
  let distanceMeters: number | null = null;
  if (venue.lat != null && venue.lng != null && candidateLoc != null) {
    distanceMeters = haversineMeters(
      venue.lat,
      venue.lng,
      candidateLoc.latitude,
      candidateLoc.longitude
    );
    if (distanceMeters > MAX_DISTANCE_METERS) {
      console.log(
        `         Fallback rejected (too far): ` +
          `${Math.round(distanceMeters)}m > ${MAX_DISTANCE_METERS}m — "${candidateName}"`
      );
      return null;
    }
  }

  const placeId: string = c.id ?? "";
  if (!placeId) return null;

  return {
    placeId,
    rating: parseRating(c.rating),
    reviewCount: parseReviewCount(c.userRatingCount),
    distanceMeters,
  };
}

// ── Types ──────────────────────────────────────────────────────────────────────

type VenueRow = {
  id: string;
  name: string;
  address_line1: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
};

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\nGoogle rating backfill — ${
      DRY_RUN ? "DRY RUN (pass --write to apply)" : "WRITE MODE"
    }\n`
  );

  // ── Probe: confirm google_rating / google_review_count columns exist ─────────

  const { error: probeError } = await supabase
    .from("venues")
    .select("google_rating, google_review_count")
    .limit(1);

  if (probeError?.message?.includes("google_rating")) {
    console.error(
      "ERROR: Columns google_rating / google_review_count do not exist.\n\n" +
        "Apply migration 012 first via the Supabase dashboard → SQL Editor:\n\n" +
        "  ALTER TABLE venues\n" +
        "    ADD COLUMN IF NOT EXISTS google_rating NUMERIC(3,1)\n" +
        "      CHECK (google_rating IS NULL OR (google_rating >= 0 AND google_rating <= 5)),\n" +
        "    ADD COLUMN IF NOT EXISTS google_review_count INTEGER\n" +
        "      CHECK (google_review_count IS NULL OR google_review_count >= 0);\n"
    );
    process.exit(1);
  }

  // ── Fetch all venues ────────────────────────────────────────────────────────

  const { data: venues, error: fetchError } = (await supabase
    .from("venues")
    .select(
      "id, name, address_line1, city, lat, lng, place_id, google_rating, google_review_count"
    )
    .order("name")) as unknown as {
    data: VenueRow[] | null;
    error: { message: string } | null;
  };

  if (fetchError) {
    console.error("Failed to fetch venues:", fetchError.message);
    process.exit(1);
  }

  if (!venues || venues.length === 0) {
    console.log("No venues found. Nothing to do.");
    return;
  }

  console.log(`Fetched ${venues.length} venues.\n`);

  // ── Process each venue ──────────────────────────────────────────────────────

  let updatedDirect = 0;    // valid place_id → Details API success
  let updatedRecovered = 0; // stale/missing place_id → fallback search success
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    const prefix = `  ${(i + 1).toString().padStart(3)} / ${venues.length}`;

    // ── Case 1: venue has a stored place_id ────────────────────────────────────
    if (venue.place_id) {
      await sleep(DELAY_MS);
      const details = await getPlaceDetails(venue.place_id);

      if (details) {
        // Details API succeeded — straightforward update
        const { rating, reviewCount } = details;

        if (rating == null && reviewCount == null) {
          console.log(
            `${prefix}  SKIP     ${venue.name} (no rating/count in API response)`
          );
          skipped++;
          continue;
        }

        console.log(
          `${prefix}  UPDATE   ${venue.name}  ` +
            `rating=${rating ?? "—"}  reviews=${reviewCount ?? "—"}`
        );

        if (!DRY_RUN) {
          const { error } = await supabase
            .from("venues")
            .update({
              ...(rating != null ? { google_rating: rating } : {}),
              ...(reviewCount != null ? { google_review_count: reviewCount } : {}),
            })
            .eq("id", venue.id);

          if (error) {
            console.error(`         DB error: ${error.message}`);
            failed++;
            continue;
          }
        }

        updatedDirect++;
        continue;
      }

      // Details API failed — place_id is likely stale; attempt fallback search
      if (DRY_RUN) {
        console.log(
          `         place_id stale for "${venue.name}" — attempting fallback search`
        );
      }

      // Fall through to the shared fallback path below
    }

    // ── Case 2 / fallback: no valid place_id or stale one ─────────────────────
    if (venue.lat == null || venue.lng == null) {
      if (venue.place_id) {
        console.log(
          `${prefix}  SKIP     ${venue.name} (stale place_id, no lat/lng for fallback)`
        );
      } else {
        console.log(`${prefix}  SKIP     ${venue.name} (no place_id and no lat/lng)`);
      }
      skipped++;
      continue;
    }

    await sleep(DELAY_MS);
    const recovered = await fallbackSearch(venue);

    if (!recovered || !recovered.placeId) {
      if (venue.place_id) {
        console.log(
          `${prefix}  SKIP     ${venue.name} (stale place_id, fallback found no reliable match)`
        );
      } else {
        console.log(`${prefix}  SKIP     ${venue.name} (no Google Places match)`);
      }
      skipped++;
      continue;
    }

    const { placeId: newPlaceId, rating, reviewCount, distanceMeters } = recovered;

    if (rating == null && reviewCount == null) {
      console.log(
        `${prefix}  SKIP     ${venue.name} ` +
          `(match found but no rating/count — place_id=${newPlaceId})`
      );
      skipped++;
      continue;
    }

    const distStr =
      distanceMeters != null ? `  dist=${Math.round(distanceMeters)}m` : "";
    const label = venue.place_id ? "RECOVER" : "UPDATE  ";

    console.log(
      `${prefix}  ${label}  ${venue.name}  ` +
        `rating=${rating ?? "—"}  reviews=${reviewCount ?? "—"}  ` +
        `new_place_id=${newPlaceId}${distStr}`
    );

    if (!DRY_RUN) {
      const { error } = await supabase
        .from("venues")
        .update({
          place_id: newPlaceId,
          ...(rating != null ? { google_rating: rating } : {}),
          ...(reviewCount != null ? { google_review_count: reviewCount } : {}),
        })
        .eq("id", venue.id);

      if (error) {
        console.error(`         DB error: ${error.message}`);
        failed++;
        continue;
      }
    }

    if (venue.place_id) {
      updatedRecovered++;
    } else {
      updatedDirect++;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  console.log(`\n── Results ────────────────────────────────────────────────`);
  console.log(`  Updated (valid place_id)    : ${updatedDirect}`);
  console.log(`  Updated (fallback recovery) : ${updatedRecovered}`);
  console.log(`  Skipped (no reliable match) : ${skipped}`);
  console.log(`  Failed                      : ${failed}`);
  console.log(`  Total                       : ${venues.length}`);

  if (DRY_RUN) {
    const totalUpdates = updatedDirect + updatedRecovered;
    console.log(
      `\nDRY RUN complete — no changes written.\n` +
        `Run with --write to apply ${totalUpdates} update(s).\n`
    );
  } else {
    console.log(`\nDone.\n`);
    if (failed > 0) process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
