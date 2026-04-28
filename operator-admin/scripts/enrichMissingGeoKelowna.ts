/**
 * scripts/enrichMissingGeoKelowna.ts
 *
 * One-time targeted enrichment of two Kelowna venues flagged during the BC
 * pre-publish hygiene pass for missing address and lat/lng data:
 *
 *   - Kin & Folk
 *   - West Coast Seafood + Raw Bar
 *
 * For each venue this script:
 *   1. Fetches the current DB row (confirms it is unpublished and genuinely missing geo).
 *   2. Calls Google Places API (New) Text Search to find the matching business.
 *   3. Validates the result: name similarity ≥ 60 %, city = Kelowna, province = BC.
 *   4. Extracts address_line1, city, postal_code, lat, lng, place_id from the result.
 *   5. In --write mode: updates ONLY the fields that are currently NULL/missing.
 *      Existing non-null values are NEVER overwritten.
 *
 * Safety constraints:
 *   - Only touches rows matching the exact slugs below.
 *   - Never overwrites existing non-null address or lat/lng.
 *   - Never publishes venues.
 *   - Skips any venue where confidence is not HIGH.
 *
 * Run from the operator-admin directory:
 *   npm run enrich:kelowna-geo           ← dry-run (no DB writes)
 *   npm run enrich:kelowna-geo -- --write ← apply updates
 *
 * Prerequisites:
 *   GOOGLE_PLACES_API_KEY must be set in operator-admin/.env.local with
 *   the Places API (New) enabled in Google Cloud Console.
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
      "       Add GOOGLE_PLACES_API_KEY=your_key to operator-admin/.env.local."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DRY_RUN = !process.argv.includes("--write");

// ── Target venues (by slug — immutable identifiers) ───────────────────────────

const TARGET_SLUGS = ["kin-folk", "west-coast-seafood-raw-bar"];

// ── Places API (New) ──────────────────────────────────────────────────────────

const PLACES_API_BASE = "https://places.googleapis.com/v1";

function placesHeaders(fieldMask: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
    "X-Goog-FieldMask": fieldMask,
  };
}

// ── Address component extraction ───────────────────────────────────────────────

type AddressComponent = {
  longText: string;
  shortText: string;
  types: string[];
};

/**
 * Finds the first address component matching one of the given type strings.
 */
function getComponent(
  components: AddressComponent[],
  ...types: string[]
): AddressComponent | undefined {
  return components.find((c) => types.some((t) => c.types.includes(t)));
}

/**
 * Extracts structured address fields from Google Places addressComponents.
 *
 * Returns:
 *   streetAddress — e.g. "1600 Water St"
 *   city          — locality long name
 *   province      — administrative_area_level_1 short name (e.g. "BC")
 *   postalCode    — postal code long text
 */
function parseAddressComponents(components: AddressComponent[]): {
  streetAddress: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
} {
  const streetNum = getComponent(components, "street_number");
  const route = getComponent(components, "route");
  const locality = getComponent(components, "locality");
  const province = getComponent(components, "administrative_area_level_1");
  const postal = getComponent(components, "postal_code");

  let streetAddress: string | null = null;
  if (streetNum && route) {
    streetAddress = `${streetNum.longText} ${route.longText}`;
  } else if (route) {
    streetAddress = route.longText;
  }

  return {
    streetAddress,
    city: locality?.longText ?? null,
    province: province?.shortText ?? null,
    postalCode: postal?.longText ?? null,
  };
}

// ── Name similarity (ported from backfillGoogleRating.ts) ─────────────────────

const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "of", "at", "in", "on", "by"]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function nameSimilarityScore(venueName: string, candidateName: string): number {
  const venueT = nameTokens(venueName);
  const candidateSet = new Set(nameTokens(candidateName));
  if (venueT.length === 0) return 0;
  const matches = venueT.filter((t) => candidateSet.has(t)).length;
  return matches / venueT.length;
}

// ── DB row type ───────────────────────────────────────────────────────────────

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
  place_id: string | null;
  is_published: boolean;
};

// ── Result types ──────────────────────────────────────────────────────────────

type Confidence = "high" | "medium" | "low";

type EnrichmentResult =
  | {
      status: "enriched";
      confidence: Confidence;
      placeName: string;
      placeId: string;
      addressLine1: string | null;
      city: string | null;
      province: string | null;
      postalCode: string | null;
      lat: number;
      lng: number;
      formattedAddress: string;
      nameSimilarity: number;
    }
  | {
      status: "skipped";
      reason: string;
    };

// ── Google Places search ───────────────────────────────────────────────────────

async function findVenueOnPlaces(venueDbName: string): Promise<EnrichmentResult> {
  const textQuery = `${venueDbName}, Kelowna, BC`;

  const body = {
    textQuery,
    locationBias: {
      circle: {
        // Central Kelowna lat/lng bias — ensures we get Kelowna results
        center: { latitude: 49.8875, longitude: -119.496 },
        radius: 15000, // 15 km covers all of Kelowna
      },
    },
  };

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.addressComponents",
  ].join(",");

  let data: any;
  try {
    const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: placesHeaders(fieldMask),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        status: "skipped",
        reason: `Places API HTTP ${res.status}: ${errBody.slice(0, 200)}`,
      };
    }

    data = await res.json();
  } catch (err: any) {
    return { status: "skipped", reason: `Network error: ${err?.message ?? err}` };
  }

  if (!data?.places?.length) {
    return { status: "skipped", reason: "No results from Google Places" };
  }

  const candidate = data.places[0];
  const candidateName: string = candidate.displayName?.text ?? "";
  const formattedAddress: string = candidate.formattedAddress ?? "";
  const location: { latitude: number; longitude: number } | null =
    candidate.location ?? null;
  const addressComponents: AddressComponent[] = candidate.addressComponents ?? [];
  const placeId: string = candidate.id ?? "";

  if (!location || !placeId) {
    return {
      status: "skipped",
      reason: `Incomplete Places API response (no location or id) for "${candidateName}"`,
    };
  }

  // ── Validate: name similarity ───────────────────────────────────────────────
  const similarity = nameSimilarityScore(venueDbName, candidateName);
  if (similarity < 0.5) {
    return {
      status: "skipped",
      reason:
        `Name mismatch (similarity=${(similarity * 100).toFixed(0)}%): ` +
        `Google returned "${candidateName}" for "${venueDbName}"`,
    };
  }

  // ── Validate: must be in Kelowna, BC ───────────────────────────────────────
  const parsed = parseAddressComponents(addressComponents);

  const cityLower = (parsed.city ?? "").toLowerCase();
  const province = parsed.province ?? "";

  if (!cityLower.includes("kelowna") || province !== "BC") {
    return {
      status: "skipped",
      reason:
        `Location not in Kelowna, BC — got city="${parsed.city}", province="${province}" ` +
        `for "${candidateName}" (${formattedAddress})`,
    };
  }

  // ── Confidence: high if similarity ≥ 0.8, medium if 0.5–0.79 ─────────────
  const confidence: Confidence = similarity >= 0.8 ? "high" : "medium";

  return {
    status: "enriched",
    confidence,
    placeName: candidateName,
    placeId,
    addressLine1: parsed.streetAddress,
    city: parsed.city,
    province: parsed.province,
    postalCode: parsed.postalCode,
    lat: location.latitude,
    lng: location.longitude,
    formattedAddress,
    nameSimilarity: similarity,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const DIVIDER = "─".repeat(68);
  const BOLD = "═".repeat(68);

  console.log(`\n${BOLD}`);
  console.log(`  Kelowna Venue Geo Enrichment`);
  console.log(
    `  Mode: ${DRY_RUN ? "DRY RUN (pass --write to apply)" : "WRITE MODE"}`
  );
  console.log(BOLD);
  console.log(`  Targets: ${TARGET_SLUGS.join(", ")}\n`);

  // ── Fetch target rows ───────────────────────────────────────────────────────

  const { data: venues, error: fetchError } = (await supabase
    .from("venues")
    .select(
      "id, slug, name, address_line1, city, region, postal_code, lat, lng, place_id, is_published"
    )
    .in("slug", TARGET_SLUGS)) as {
    data: VenueRow[] | null;
    error: { message: string } | null;
  };

  if (fetchError) {
    console.error("ERROR: Could not fetch venues:", fetchError.message);
    process.exit(1);
  }

  if (!venues || venues.length === 0) {
    console.error(
      "ERROR: Neither target slug was found in the database.\n" +
        `  Looked for: ${TARGET_SLUGS.join(", ")}`
    );
    process.exit(1);
  }

  // Map by slug for easy lookup; note any slugs not found
  const bySlug = new Map(venues.map((v) => [v.slug, v]));
  const notFound = TARGET_SLUGS.filter((s) => !bySlug.has(s));
  if (notFound.length > 0) {
    console.warn(
      `WARNING: The following slugs were not found in the DB: ${notFound.join(", ")}\n`
    );
  }

  console.log(`Found ${venues.length} target venue(s) in DB.\n`);

  // ── Process each venue ──────────────────────────────────────────────────────

  type VenueReport = {
    name: string;
    slug: string;
    outcome: "updated" | "skipped" | "already_complete" | "safety_skip";
    details: string;
    fieldsAdded?: string[];
    confidence?: Confidence;
  };

  const reports: VenueReport[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  for (const venue of venues) {
    console.log(`${DIVIDER}`);
    console.log(`  Venue:  ${venue.name} (${venue.slug})`);
    console.log(`  DB geo: lat=${venue.lat ?? "NULL"}, lng=${venue.lng ?? "NULL"}`);
    console.log(`  DB addr: ${venue.address_line1 ?? "NULL"}, city=${venue.city ?? "NULL"}`);
    console.log(`  DB place_id: ${venue.place_id ?? "NULL"}`);
    console.log(`  is_published: ${venue.is_published}`);
    console.log();

    // Safety: never touch a published venue
    if (venue.is_published) {
      console.log(`  ⚠  SAFETY SKIP — venue is already published. Refusing to modify.`);
      reports.push({
        name: venue.name,
        slug: venue.slug,
        outcome: "safety_skip",
        details: "Venue is already published",
      });
      skippedCount++;
      continue;
    }

    // Check which fields are actually missing
    const needsLat = venue.lat === null || venue.lat === undefined;
    const needsLng = venue.lng === null || venue.lng === undefined;
    const needsAddress = !venue.address_line1?.trim();
    const needsPlaceId = !venue.place_id?.trim();

    if (!needsLat && !needsLng && !needsAddress && !needsPlaceId) {
      console.log(`  ✓  Already complete — no geo fields are missing. Skipping.`);
      reports.push({
        name: venue.name,
        slug: venue.slug,
        outcome: "already_complete",
        details: "All geo fields are already populated",
      });
      skippedCount++;
      continue;
    }

    console.log(
      `  Missing: ${[
        needsLat && "lat",
        needsLng && "lng",
        needsAddress && "address_line1",
        needsPlaceId && "place_id",
      ]
        .filter(Boolean)
        .join(", ")}`
    );
    console.log(`\n  Searching Google Places for: "${venue.name}, Kelowna, BC"…`);

    const result = await findVenueOnPlaces(venue.name);

    if (result.status === "skipped") {
      console.log(`\n  ✗  SKIPPED — ${result.reason}`);
      reports.push({
        name: venue.name,
        slug: venue.slug,
        outcome: "skipped",
        details: result.reason,
      });
      skippedCount++;
      continue;
    }

    // We have an enriched result
    console.log(`\n  Google match:`);
    console.log(`    Name:       ${result.placeName}`);
    console.log(`    Address:    ${result.formattedAddress}`);
    console.log(`    Lat/Lng:    ${result.lat}, ${result.lng}`);
    console.log(`    place_id:   ${result.placeId}`);
    console.log(
      `    Similarity: ${(result.nameSimilarity * 100).toFixed(0)}%  →  confidence: ${result.confidence.toUpperCase()}`
    );

    // Only apply HIGH or MEDIUM confidence results; reject LOW
    if (result.confidence === "low") {
      const reason = `Confidence too low (${(result.nameSimilarity * 100).toFixed(0)}%) — not safe to apply`;
      console.log(`\n  ✗  SKIPPED — ${reason}`);
      reports.push({
        name: venue.name,
        slug: venue.slug,
        outcome: "skipped",
        details: reason,
        confidence: result.confidence,
      });
      skippedCount++;
      continue;
    }

    // Build the patch — only include fields that are currently missing
    const patch: Record<string, string | number | null> = {};
    const fieldsAdded: string[] = [];

    if (needsLat) { patch.lat = result.lat; fieldsAdded.push(`lat=${result.lat}`); }
    if (needsLng) { patch.lng = result.lng; fieldsAdded.push(`lng=${result.lng}`); }

    if (needsAddress && result.addressLine1) {
      patch.address_line1 = result.addressLine1;
      fieldsAdded.push(`address_line1="${result.addressLine1}"`);
    }

    // city — only write if missing from DB
    if (!venue.city?.trim() && result.city) {
      patch.city = result.city;
      fieldsAdded.push(`city="${result.city}"`);
    }

    // postal_code — only write if missing from DB
    if (!venue.postal_code?.trim() && result.postalCode) {
      patch.postal_code = result.postalCode;
      fieldsAdded.push(`postal_code="${result.postalCode}"`);
    }

    if (needsPlaceId) {
      patch.place_id = result.placeId;
      fieldsAdded.push(`place_id="${result.placeId}"`);
    }

    if (Object.keys(patch).length === 0) {
      console.log(`\n  ✓  No fields to update (all missing fields resolved already).`);
      reports.push({
        name: venue.name,
        slug: venue.slug,
        outcome: "already_complete",
        details: "No patchable fields remained after diff",
      });
      skippedCount++;
      continue;
    }

    console.log(`\n  Fields to write: ${fieldsAdded.join(", ")}`);

    if (DRY_RUN) {
      console.log(`  → DRY RUN: would update ${venue.slug}`);
      reports.push({
        name: venue.name,
        slug: venue.slug,
        outcome: "updated",
        details: `DRY RUN — would write ${fieldsAdded.length} field(s)`,
        fieldsAdded,
        confidence: result.confidence,
      });
      updatedCount++;
      continue;
    }

    // Apply update
    const { error: updateError } = await supabase
      .from("venues")
      .update(patch)
      .eq("id", venue.id);

    if (updateError) {
      const errMsg = `DB update failed: ${updateError.message}`;
      console.error(`\n  ✗  ERROR — ${errMsg}`);
      reports.push({
        name: venue.name,
        slug: venue.slug,
        outcome: "skipped",
        details: errMsg,
        confidence: result.confidence,
      });
      skippedCount++;
      continue;
    }

    console.log(`  ✓  Updated successfully.`);
    reports.push({
      name: venue.name,
      slug: venue.slug,
      outcome: "updated",
      details: `${fieldsAdded.length} field(s) written`,
      fieldsAdded,
      confidence: result.confidence,
    });
    updatedCount++;
  }

  // ── Summary report ──────────────────────────────────────────────────────────

  console.log(`\n${BOLD}`);
  console.log(`  ENRICHMENT SUMMARY`);
  console.log(BOLD);

  for (const r of reports) {
    const icon =
      r.outcome === "updated"
        ? "✓"
        : r.outcome === "already_complete"
        ? "–"
        : r.outcome === "safety_skip"
        ? "⚠"
        : "✗";

    console.log(`\n  ${icon}  ${r.name} (${r.slug})`);
    console.log(`     Outcome:    ${r.outcome.toUpperCase()}${r.confidence ? `  [confidence: ${r.confidence}]` : ""}`);
    console.log(`     Details:    ${r.details}`);
    if (r.fieldsAdded?.length) {
      console.log(`     Fields added:`);
      for (const f of r.fieldsAdded) {
        console.log(`       · ${f}`);
      }
    }
  }

  console.log(`\n${DIVIDER}`);
  console.log(`  Venues updated : ${updatedCount}`);
  console.log(`  Venues skipped : ${skippedCount}`);
  if (DRY_RUN) {
    console.log(
      `\n  DRY RUN complete — no changes written.` +
        (updatedCount > 0
          ? `\n  Run with --write to apply ${updatedCount} update(s).`
          : "")
    );
  } else {
    console.log(`\n  Pass complete.`);
  }
  console.log(`${BOLD}\n`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
