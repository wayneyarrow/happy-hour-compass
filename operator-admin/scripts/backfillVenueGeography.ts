/**
 * scripts/backfillVenueGeography.ts
 *
 * Backfills venues.market_id and venues.city_id from the existing
 * venues.city / venues.region / venues.country text fields, using the
 * seeded markets/cities rows as the lookup source.
 *
 * This script does NOT write neighbourhood_id — that column will remain NULL
 * for all venues until neighbourhood data is seeded in a future card.
 *
 * Matching strategy:
 *   • Normalize venue.city to lowercase + trimmed string.
 *   • Apply known alias map to handle legacy text variations
 *     (e.g. "langley township" → "langley", "kelowna" lowercase → "kelowna").
 *   • Match against seeded city names (also normalized).
 *   • Set market_id automatically from the matched city's market_id.
 *   • Venues whose city does not match any seeded city (Seattle, Toronto,
 *     blank, etc.) are left unchanged — see UNASSIGNABLE list printed at end.
 *
 * This script is safe to rerun. It only updates rows where both market_id AND
 * city_id are still NULL (does not overwrite previously assigned venues).
 * To reassign already-set venues, remove that filter or drop the WHERE clause.
 *
 * Prerequisites:
 *   1. Migration 048_geography_foundation_v1.sql must be applied first.
 *   2. scripts/seedGeography.ts must have been run with --apply first.
 *
 * Usage (from operator-admin/):
 *   npm run backfill:venue-geography              ← dry-run (no DB writes)
 *   npm run backfill:venue-geography -- --apply   ← write to Supabase
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const APPLY = process.argv.includes("--apply");

// ─────────────────────────────────────────────────────────────────────────────
// Known text aliases from legacy seeded data → canonical city slug
// ─────────────────────────────────────────────────────────────────────────────
const CITY_ALIASES: Record<string, string> = {
  "langley township": "langley",
  "district of west vancouver": "west-vancouver",
  "district of north vancouver": "north-vancouver",
  "city of north vancouver": "north-vancouver",
};

function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const mode = APPLY ? "APPLY" : "DRY-RUN";
  console.log(`\n=== backfillVenueGeography.ts [${mode}] ===\n`);
  if (!APPLY) console.log("Pass --apply to write to Supabase.\n");

  // ── 1. Load all seeded cities ─────────────────────────────────────────────
  const { data: cityRows, error: cityErr } = await supabase
    .from("cities")
    .select("id, slug, name, market_id");
  if (cityErr) {
    console.error("ERROR loading cities:", cityErr.message);
    console.error("→ Has migration 048 been applied and seedGeography run with --apply?");
    process.exit(1);
  }

  // Build lookup: normalized city name → { cityId, marketId, canonicalName }
  type CityEntry = { cityId: string; marketId: string; canonicalName: string };
  const cityLookup = new Map<string, CityEntry>();

  for (const c of cityRows!) {
    const key = normalize(c.name);
    cityLookup.set(key, { cityId: c.id, marketId: c.market_id, canonicalName: c.name });
    // Also register slug as an alternate key so "langley-township" (if it
    // ever appears as a slug variant) would resolve too.
    cityLookup.set(normalize(c.slug.replace(/-/g, " ")), {
      cityId: c.id,
      marketId: c.market_id,
      canonicalName: c.name,
    });
  }

  // Apply explicit alias overrides (highest priority).
  for (const [alias, targetSlug] of Object.entries(CITY_ALIASES)) {
    const target = cityRows!.find(c => c.slug === targetSlug);
    if (target) {
      cityLookup.set(normalize(alias), {
        cityId: target.id,
        marketId: target.market_id,
        canonicalName: target.name,
      });
    }
  }

  // ── 2. Load unassigned venues ─────────────────────────────────────────────
  // Only process venues where both FK columns are still NULL. Re-running the
  // script after --apply will be a no-op for already-assigned rows.
  const { data: venues, error: venueErr } = await supabase
    .from("venues")
    .select("id, slug, name, city, region, country, market_id, city_id")
    .is("market_id", null)
    .is("city_id", null);

  if (venueErr) {
    console.error("ERROR loading venues:", venueErr.message);
    process.exit(1);
  }

  console.log(`Unassigned venues to process: ${venues!.length}`);

  // ── 3. Build assignment plan ──────────────────────────────────────────────
  type AssignedVenue = {
    id: string;
    name: string;
    city: string | null;
    cityId: string;
    marketId: string;
    matchedAs: string;
  };
  type UnassignableVenue = {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    country: string | null;
    reason: string;
  };

  const toAssign: AssignedVenue[] = [];
  const unassignable: UnassignableVenue[] = [];

  for (const v of venues!) {
    const rawCity = v.city as string | null;

    if (!rawCity || rawCity.trim() === "") {
      unassignable.push({ id: v.id, name: v.name, city: rawCity, region: v.region, country: v.country, reason: "null or blank city field" });
      continue;
    }

    const normalized = normalize(rawCity);
    const entry = cityLookup.get(normalized);

    if (!entry) {
      unassignable.push({ id: v.id, name: v.name, city: rawCity, region: v.region, country: v.country, reason: "city not in seeded geography" });
      continue;
    }

    toAssign.push({
      id: v.id,
      name: v.name,
      city: rawCity,
      cityId: entry.cityId,
      marketId: entry.marketId,
      matchedAs: entry.canonicalName,
    });
  }

  // ── 4. Print plan ─────────────────────────────────────────────────────────
  // Group by matched city for a readable summary.
  const byCityName = new Map<string, number>();
  for (const a of toAssign) {
    byCityName.set(a.matchedAs, (byCityName.get(a.matchedAs) ?? 0) + 1);
  }

  console.log("\n── Venues to assign ──");
  for (const [cityName, count] of [...byCityName.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(3)} venues → ${cityName}`);
  }
  console.log(`  ─── Total: ${toAssign.length}`);

  // Group unassignable by reason/city.
  const unassignByCityCountry = new Map<string, number>();
  for (const u of unassignable) {
    const key = `${u.city ?? "(null)"} / ${u.country ?? "(null)"}`;
    unassignByCityCountry.set(key, (unassignByCityCountry.get(key) ?? 0) + 1);
  }

  console.log("\n── Unassignable venues (will be left unchanged) ──");
  for (const [key, count] of [...unassignByCityCountry.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(3)} venues  city/country: ${key}`);
  }
  console.log(`  ─── Total: ${unassignable.length}`);

  if (!APPLY) {
    console.log("\n(dry-run complete — no DB writes made)\n");
    return;
  }

  // ── 5. Apply updates in batches ───────────────────────────────────────────
  console.log("\n── Writing assignments ──");
  const BATCH_SIZE = 50;
  let updated = 0;

  for (let i = 0; i < toAssign.length; i += BATCH_SIZE) {
    const batch = toAssign.slice(i, i + BATCH_SIZE);
    for (const v of batch) {
      const { error } = await supabase
        .from("venues")
        .update({ market_id: v.marketId, city_id: v.cityId })
        .eq("id", v.id);
      if (error) {
        console.error(`  ERROR updating ${v.name} (${v.id}):`, error.message);
        process.exit(1);
      }
    }
    updated += batch.length;
    process.stdout.write(`  ${updated}/${toAssign.length} updated...\r`);
  }

  console.log(`\n✓ Updated ${updated} venues.`);
  console.log(`  ${unassignable.length} venues left unassigned (see list above).\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
