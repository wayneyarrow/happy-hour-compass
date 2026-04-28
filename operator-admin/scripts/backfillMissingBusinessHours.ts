/**
 * scripts/backfillMissingBusinessHours.ts
 *
 * Backfills venues.business_hours (JSONB) for all rows where the column is
 * NULL, using the Google Places API (New) regularOpeningHours field.
 *
 * Lookup strategy:
 *   1. Venues with an existing place_id → Places API (New) Get Place endpoint.
 *        If it returns 404 (stale place_id) → fall through to step 2.
 *   2. Venues without a valid place_id but with lat + lng → Text Search fallback
 *        (name + city), validated for name similarity AND geographic proximity.
 *   3. Venues with neither → skipped (no_place_id_and_no_coords).
 *
 * Writes are strictly limited to:
 *   • business_hours   (only when the column is currently NULL)
 *
 * Venues with existing non-null business_hours are excluded from the initial
 * query and are NEVER touched.
 *
 * DB format stored in business_hours JSONB:
 *   {
 *     "monday":    { "open": "HH:MM", "close": "HH:MM" },
 *     "tuesday":   null,   ← closed
 *     "wednesday": { "open": "09:00", "close": "22:00" },
 *     ...
 *   }
 *
 * Run from the operator-admin directory:
 *   npm run backfill:business-hours            ← dry-run (no DB writes)
 *   npm run backfill:business-hours -- --write ← apply updates to Supabase
 *
 * Prerequisites:
 *   GOOGLE_PLACES_API_KEY must be set in operator-admin/.env.local with the
 *   Places API (New) enabled in Google Cloud Console.
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
// Google Places free tier: 5 QPS.  250 ms between requests keeps us safely under.

const DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Types ──────────────────────────────────────────────────────────────────────

type DayOfWeek =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

type DayHours = { open: string; close: string };
type BusinessHours = { [K in DayOfWeek]?: DayHours | null };

// Google Places (New) regularOpeningHours shape
type GoogleTimePoint = { day: number; hour: number; minute: number };
type GooglePeriod = { open: GoogleTimePoint; close?: GoogleTimePoint };
type GoogleOpeningHours = { periods?: GooglePeriod[] };

type VenueRow = {
  id: string;
  name: string;
  address_line1: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
};

type SkipReason =
  | "no_place_id_and_no_coords"
  | "google_no_hours"
  | "google_api_error"
  | "no_confident_match"
  | "db_error";

// ── Places API (New) ──────────────────────────────────────────────────────────

const PLACES_API_BASE = "https://places.googleapis.com/v1";

// Day index: Google 0=Sunday, 1=Monday, ..., 6=Saturday
const DAYS_BY_INDEX: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function placesHeaders(fieldMask: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
    "X-Goog-FieldMask": fieldMask,
  };
}

function padTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Converts a Google Places regularOpeningHours object to the BusinessHours
 * format stored in venues.business_hours (JSONB).
 *
 * Rules applied:
 *   - All 7 days are initialised to null (closed).
 *   - Each period's open day index maps to a DayOfWeek key.
 *   - The open and close times are formatted as "HH:MM" (24-hour).
 *   - If a period has no close (24-hour venue), that day is skipped — we
 *     cannot represent "always open" in the HH:MM pair format.
 *   - If open === close after formatting, the period is skipped (matches the
 *     server action's validation rule).
 *   - When a day appears multiple times (split shifts), the first period wins.
 *   - Returns null when there are no usable open days (nothing to store).
 */
function convertGoogleHours(hours: GoogleOpeningHours): BusinessHours | null {
  if (!hours.periods?.length) return null;

  const result: BusinessHours = {};
  for (const day of DAYS_BY_INDEX) {
    result[day] = null; // closed until proven open
  }

  let hasAnyOpenDay = false;

  for (const period of hours.periods) {
    const openPoint = period.open;
    if (openPoint?.day == null) continue;

    const dayIdx = openPoint.day;
    if (dayIdx < 0 || dayIdx > 6) continue;

    const dayName = DAYS_BY_INDEX[dayIdx];

    // First period per day wins
    if (result[dayName] != null) continue;

    // 24-hour venue: no close point — can't represent in HH:MM format
    if (!period.close) continue;

    const openStr = padTime(openPoint.hour, openPoint.minute);
    const closeStr = padTime(period.close.hour, period.close.minute);

    // Identical open/close is invalid per server action validation
    if (openStr === closeStr) continue;

    result[dayName] = { open: openStr, close: closeStr };
    hasAnyOpenDay = true;
  }

  return hasAnyOpenDay ? result : null;
}

/**
 * Places API (New) — Get Place by resource name.
 * Returns the raw regularOpeningHours object, or null on error / 404 / no hours.
 */
async function getPlaceHours(placeId: string): Promise<GoogleOpeningHours | null> {
  const resourceId = placeId.startsWith("places/") ? placeId : `places/${placeId}`;

  let data: any;
  try {
    const res = await fetch(`${PLACES_API_BASE}/${resourceId}`, {
      method: "GET",
      headers: placesHeaders("regularOpeningHours"),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  if (!data || data.error) return null;
  return (data.regularOpeningHours as GoogleOpeningHours) ?? null;
}

// ── Name similarity ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "of", "at", "in", "on", "by"]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function nameSimilarityOk(venueName: string, candidateName: string): boolean {
  const venueT = nameTokens(venueName);
  const candidateSet = new Set(nameTokens(candidateName));
  if (venueT.length === 0) return false;
  const matches = venueT.filter((t) => candidateSet.has(t)).length;
  return matches / venueT.length >= 0.6;
}

// ── Geographic distance ────────────────────────────────────────────────────────

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

const MAX_DISTANCE_METERS = 300;

type FallbackResult = {
  hours: GoogleOpeningHours | null;
  newPlaceId: string | null;
  distanceMeters: number | null;
};

/**
 * Places API (New) — Text Search fallback for venues with no valid place_id.
 *
 * The top candidate is accepted only if:
 *   1. Name similarity ≥ 60 % token overlap.
 *   2. The candidate is within MAX_DISTANCE_METERS of the venue's coordinates
 *      (distance check is skipped when coords are unavailable, but the name
 *      check always applies).
 *
 * Returns null when no confident match is found.
 */
async function fallbackSearchHours(venue: VenueRow): Promise<FallbackResult | null> {
  const queryParts: string[] = [venue.name];
  if (venue.city) queryParts.push(venue.city);
  else if (venue.address_line1) queryParts.push(venue.address_line1);
  const textQuery = queryParts.join(", ");

  const body: Record<string, unknown> = { textQuery };

  if (venue.lat != null && venue.lng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: venue.lat, longitude: venue.lng },
        radius: MAX_DISTANCE_METERS * 2,
      },
    };
  }

  let data: any;
  try {
    const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: placesHeaders(
        "places.id,places.displayName,places.location,places.regularOpeningHours"
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
  const candidateName: string = c.displayName?.text ?? "";
  const candidateLoc: { latitude: number; longitude: number } | null = c.location ?? null;

  // Guard 1: name similarity
  if (!nameSimilarityOk(venue.name, candidateName)) {
    console.log(
      `         Fallback rejected (name mismatch): ` +
        `Google="${candidateName}" vs DB="${venue.name}"`
    );
    return null;
  }

  // Guard 2: geographic proximity (when coords available on both sides)
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

  const newPlaceId: string | null = c.id || null;
  const hours: GoogleOpeningHours | null = c.regularOpeningHours ?? null;

  return { hours, newPlaceId, distanceMeters };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const BOLD = "═".repeat(68);
  const DIVIDER = "─".repeat(68);

  console.log(`\n${BOLD}`);
  console.log(`  Business Hours Backfill — Happy Hour Compass`);
  console.log(
    `  Mode: ${DRY_RUN ? "DRY RUN (pass --write to apply)" : "WRITE MODE"}`
  );
  console.log(`${BOLD}\n`);

  // ── Fetch venues with NULL business_hours ─────────────────────────────────────

  const { data: venues, error: fetchError } = (await supabase
    .from("venues")
    .select("id, name, address_line1, city, lat, lng, place_id")
    .is("business_hours", null)
    .order("name")) as unknown as {
    data: VenueRow[] | null;
    error: { message: string } | null;
  };

  if (fetchError) {
    console.error("ERROR: Failed to fetch venues:", fetchError.message);
    process.exit(1);
  }

  if (!venues || venues.length === 0) {
    console.log("No venues with missing business hours. Nothing to do.\n");
    return;
  }

  // Count total venues for context
  const { count: totalCount } = await supabase
    .from("venues")
    .select("id", { count: "exact", head: true });

  console.log(
    `Total venues in DB         : ${totalCount ?? "?"}\n` +
      `Venues with NULL hours     : ${venues.length}\n` +
      `(Venues with existing hours are excluded from this run.)\n`
  );

  // ── Counters ──────────────────────────────────────────────────────────────────

  let backfilled = 0;
  let dbErrors = 0;

  const skipCounts: Record<SkipReason, string[]> = {
    no_place_id_and_no_coords: [],
    google_no_hours: [],
    google_api_error: [],
    no_confident_match: [],
    db_error: [],
  };

  function recordSkip(reason: SkipReason, name: string) {
    skipCounts[reason].push(name);
  }

  // ── Process each venue ────────────────────────────────────────────────────────

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    const prefix = `  ${(i + 1).toString().padStart(3)} / ${venues.length}`;

    const placeIdShort = venue.place_id
      ? venue.place_id.slice(0, 14) + "…"
      : "none";
    const hasCoords = venue.lat != null && venue.lng != null;

    console.log(
      `${prefix}  ${venue.name}` +
        `  (city=${venue.city ?? "—"}, place_id=${placeIdShort}, coords=${hasCoords ? "yes" : "no"})`
    );

    let googleHours: GoogleOpeningHours | null = null;
    let usedFallback = false;
    let newPlaceId: string | null = null;

    // ── Strategy 1: place_id → Get Place ──────────────────────────────────────
    if (venue.place_id) {
      await sleep(DELAY_MS);
      googleHours = await getPlaceHours(venue.place_id);

      if (!googleHours) {
        // place_id may be stale — try text search if we have coordinates
        console.log(
          `         place_id returned no hours — attempting text search fallback`
        );
      }
    }

    // ── Strategy 2: text search fallback ──────────────────────────────────────
    if (!googleHours) {
      if (!hasCoords) {
        const reason = venue.place_id
          ? "stale place_id and no coordinates for fallback"
          : "no place_id and no coordinates";
        console.log(`         SKIP — ${reason}`);
        recordSkip("no_place_id_and_no_coords", venue.name);
        continue;
      }

      await sleep(DELAY_MS);
      const fallback = await fallbackSearchHours(venue);

      if (fallback === null) {
        console.log(`         SKIP — no confident Google Places match`);
        recordSkip("no_confident_match", venue.name);
        continue;
      }

      googleHours = fallback.hours;
      newPlaceId = fallback.newPlaceId;
      usedFallback = true;

      if (fallback.distanceMeters != null) {
        console.log(
          `         Fallback match accepted — dist=${Math.round(fallback.distanceMeters)}m` +
            (newPlaceId ? `  place_id=${newPlaceId.slice(0, 14)}…` : "")
        );
      }
    }

    // ── Parse Google hours ────────────────────────────────────────────────────
    if (!googleHours) {
      const label = usedFallback ? "match found but no opening hours from Google" : "no opening hours from Google";
      console.log(`         SKIP — ${label}`);
      recordSkip("google_no_hours", venue.name);
      continue;
    }

    const converted = convertGoogleHours(googleHours);
    if (!converted) {
      console.log(`         SKIP — Google returned periods but no usable open days`);
      recordSkip("google_no_hours", venue.name);
      continue;
    }

    // ── Log what we'd write ───────────────────────────────────────────────────
    const openDays = Object.entries(converted)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${v!.open}–${v!.close}`)
      .join(", ");

    console.log(`         UPDATE   hours: ${openDays || "(all closed)"}`);

    if (DRY_RUN) {
      backfilled++;
      continue;
    }

    // ── Write to DB ───────────────────────────────────────────────────────────
    const { error: updateError } = await supabase
      .from("venues")
      .update({ business_hours: converted })
      .eq("id", venue.id)
      .is("business_hours", null); // safety guard: only update if still NULL

    if (updateError) {
      console.error(`         DB error: ${updateError.message}`);
      recordSkip("db_error", venue.name);
      dbErrors++;
      continue;
    }

    backfilled++;
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  const totalSkipped = Object.values(skipCounts).reduce((n, arr) => n + arr.length, 0);

  console.log(`\n${BOLD}`);
  console.log(`  RESULTS SUMMARY`);
  console.log(BOLD);
  console.log(`\n  Total venues checked             : ${venues.length}`);
  console.log(
    `  ${DRY_RUN ? "Would be backfilled (dry-run)" : "Backfilled"}               : ${backfilled}`
  );
  console.log(`  Skipped                          : ${totalSkipped}`);

  if (totalSkipped > 0) {
    console.log(`\n  Skip breakdown:`);

    const labels: Record<SkipReason, string> = {
      no_place_id_and_no_coords: "No place_id / no coords",
      no_confident_match:        "No confident Google match",
      google_no_hours:           "Google returned no hours",
      google_api_error:          "Google API error",
      db_error:                  "DB write error",
    };

    for (const [reason, names] of Object.entries(skipCounts) as [SkipReason, string[]][]) {
      if (names.length === 0) continue;
      console.log(`    ${labels[reason].padEnd(30)}: ${names.length}`);
      for (const n of names) {
        console.log(`      · ${n}`);
      }
    }
  }

  console.log(`\n${DIVIDER}`);

  if (DRY_RUN) {
    console.log(
      `\n  DRY RUN complete — no changes written.\n` +
        (backfilled > 0
          ? `  Run with --write to apply ${backfilled} update(s).\n`
          : `  Nothing to apply.\n`)
    );
  } else {
    if (dbErrors > 0) {
      console.log(`\n  WARNING: ${dbErrors} DB write(s) failed.\n`);
      process.exit(1);
    }
    console.log(`\n  Done.\n`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
