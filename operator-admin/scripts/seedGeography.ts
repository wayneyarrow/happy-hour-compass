/**
 * scripts/seedGeography.ts
 *
 * Seeds the markets, cities, and markets.default_city_id columns introduced
 * by migration 048_geography_foundation_v1.sql.
 *
 * This script is idempotent — re-running it will update any changed fields
 * via upsert (on slug conflict). It will NOT delete rows.
 *
 * Markets seeded:
 *   • Central Okanagan (active)   — Kelowna, West Kelowna, Lake Country, Peachland
 *   • Greater Vancouver (active)  — Vancouver, Burnaby, Richmond, Surrey,
 *                                   North Vancouver, West Vancouver, Coquitlam,
 *                                   Port Moody, New Westminster, Delta, Langley,
 *                                   White Rock, Port Coquitlam, Pitt Meadows,
 *                                   Maple Ridge
 *   • Victoria (coming_soon)      — Victoria  (stub; no full city breakdown yet)
 *   • Calgary (coming_soon)       — Calgary   (stub; 1 seeded venue exists)
 *
 * Note: White Rock, Port Coquitlam, Pitt Meadows, and Maple Ridge were added
 * beyond the task's "at minimum" list because seeded venue data already
 * contains them. Omitting them would leave real venues unassignable.
 *
 * Prerequisites:
 *   Migration 048_geography_foundation_v1.sql must be applied before running
 *   this script.
 *
 * Usage (from operator-admin/):
 *   npm run seed:geography              ← dry-run (no DB writes)
 *   npm run seed:geography -- --apply   ← write to Supabase
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
// Seed data
// market.center_* and radius_km intentionally match MARKETS in src/lib/markets.ts
// so the two sources stay in sync until the config is retired.
// ─────────────────────────────────────────────────────────────────────────────

type MarketSeed = {
  slug: string;
  name: string;
  province: string;
  country: string;
  status: "active" | "coming_soon";
  center_lat: number;
  center_lng: number;
  radius_km: number;
  display_order: number;
  defaultCitySlug: string;
  cities: CitySeed[];
};

type CitySeed = {
  slug: string;
  name: string;
  status: "active" | "coming_soon";
  supports_neighbourhoods: boolean;
  display_order: number;
  center_lat: number | null;
  center_lng: number | null;
};

const MARKETS: MarketSeed[] = [
  {
    slug: "central-okanagan",
    name: "Central Okanagan",
    province: "BC",
    country: "CA",
    status: "active",
    center_lat: 49.888,
    center_lng: -119.496,
    radius_km: 50,
    display_order: 1,
    defaultCitySlug: "kelowna",
    cities: [
      { slug: "kelowna",      name: "Kelowna",      status: "active", supports_neighbourhoods: false, display_order: 1, center_lat: 49.8880,  center_lng: -119.4960 },
      { slug: "west-kelowna", name: "West Kelowna", status: "active", supports_neighbourhoods: false, display_order: 2, center_lat: 49.8641,  center_lng: -119.5854 },
      { slug: "lake-country", name: "Lake Country", status: "active", supports_neighbourhoods: false, display_order: 3, center_lat: 50.0464,  center_lng: -119.3912 },
      { slug: "peachland",    name: "Peachland",    status: "active", supports_neighbourhoods: false, display_order: 4, center_lat: 49.7748,  center_lng: -119.7308 },
    ],
  },
  {
    slug: "greater-vancouver",
    name: "Greater Vancouver",
    province: "BC",
    country: "CA",
    status: "active",
    center_lat: 49.2827,
    center_lng: -123.1207,
    radius_km: 50,
    display_order: 2,
    defaultCitySlug: "vancouver",
    cities: [
      // Core list (per task requirements)
      { slug: "vancouver",       name: "Vancouver",       status: "active", supports_neighbourhoods: true,  display_order: 1,  center_lat: 49.2827,  center_lng: -123.1207 },
      { slug: "burnaby",         name: "Burnaby",         status: "active", supports_neighbourhoods: false, display_order: 2,  center_lat: 49.2488,  center_lng: -122.9805 },
      { slug: "richmond",        name: "Richmond",        status: "active", supports_neighbourhoods: false, display_order: 3,  center_lat: 49.1666,  center_lng: -123.1336 },
      { slug: "surrey",          name: "Surrey",          status: "active", supports_neighbourhoods: false, display_order: 4,  center_lat: 49.1045,  center_lng: -122.8011 },
      { slug: "north-vancouver", name: "North Vancouver", status: "active", supports_neighbourhoods: false, display_order: 5,  center_lat: 49.3253,  center_lng: -123.0688 },
      { slug: "west-vancouver",  name: "West Vancouver",  status: "active", supports_neighbourhoods: false, display_order: 6,  center_lat: 49.3608,  center_lng: -123.1673 },
      { slug: "coquitlam",       name: "Coquitlam",       status: "active", supports_neighbourhoods: false, display_order: 7,  center_lat: 49.2838,  center_lng: -122.7932 },
      { slug: "port-moody",      name: "Port Moody",      status: "active", supports_neighbourhoods: false, display_order: 8,  center_lat: 49.2838,  center_lng: -122.8554 },
      { slug: "new-westminster", name: "New Westminster", status: "active", supports_neighbourhoods: false, display_order: 9,  center_lat: 49.2057,  center_lng: -122.9110 },
      { slug: "delta",           name: "Delta",           status: "active", supports_neighbourhoods: false, display_order: 10, center_lat: 49.0849,  center_lng: -123.0586 },
      { slug: "langley",         name: "Langley",         status: "active", supports_neighbourhoods: false, display_order: 11, center_lat: 49.1040,  center_lng: -122.6604 },
      // Extended — present in seeded venue data; added for backfill coverage
      { slug: "white-rock",      name: "White Rock",      status: "active", supports_neighbourhoods: false, display_order: 12, center_lat: 49.0255,  center_lng: -122.8025 },
      { slug: "port-coquitlam",  name: "Port Coquitlam",  status: "active", supports_neighbourhoods: false, display_order: 13, center_lat: 49.2625,  center_lng: -122.7811 },
      { slug: "pitt-meadows",    name: "Pitt Meadows",    status: "active", supports_neighbourhoods: false, display_order: 14, center_lat: 49.2257,  center_lng: -122.6890 },
      { slug: "maple-ridge",     name: "Maple Ridge",     status: "active", supports_neighbourhoods: false, display_order: 15, center_lat: 49.2193,  center_lng: -122.5994 },
    ],
  },
  {
    // coming_soon — mirrors MARKETS config. Full city breakdown deferred.
    // Single default city seeded so default_city_id can be set.
    slug: "victoria",
    name: "Victoria",
    province: "BC",
    country: "CA",
    status: "coming_soon",
    center_lat: 48.4284,
    center_lng: -123.3656,
    radius_km: 25,
    display_order: 3,
    defaultCitySlug: "victoria",
    cities: [
      { slug: "victoria", name: "Victoria", status: "coming_soon", supports_neighbourhoods: false, display_order: 1, center_lat: 48.4284, center_lng: -123.3656 },
    ],
  },
  {
    // coming_soon — mirrors MARKETS config. 1 seeded Calgary venue exists.
    slug: "calgary",
    name: "Calgary",
    province: "AB",
    country: "CA",
    status: "coming_soon",
    center_lat: 51.0447,
    center_lng: -114.0719,
    radius_km: 40,
    display_order: 4,
    defaultCitySlug: "calgary",
    cities: [
      { slug: "calgary", name: "Calgary", status: "coming_soon", supports_neighbourhoods: false, display_order: 1, center_lat: 51.0447, center_lng: -114.0719 },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const mode = APPLY ? "APPLY" : "DRY-RUN";
  console.log(`\n=== seedGeography.ts [${mode}] ===\n`);
  if (!APPLY) {
    console.log("Pass --apply to write to Supabase.\n");
  }

  const marketIds: Record<string, string> = {}; // slug → uuid
  const cityIds: Record<string, string> = {};   // `${marketSlug}/${citySlug}` → uuid

  // ── 1. Upsert markets ────────────────────────────────────────────────────
  console.log("── Markets ──");
  for (const m of MARKETS) {
    const payload = {
      slug: m.slug,
      name: m.name,
      province: m.province,
      country: m.country,
      status: m.status,
      center_lat: m.center_lat,
      center_lng: m.center_lng,
      radius_km: m.radius_km,
      display_order: m.display_order,
    };
    console.log(`  [${m.status}] ${m.name} (${m.slug})`);
    if (APPLY) {
      const { data, error } = await supabase
        .from("markets")
        .upsert(payload, { onConflict: "slug" })
        .select("id")
        .single();
      if (error) {
        console.error(`    ERROR upserting market ${m.slug}:`, error.message);
        process.exit(1);
      }
      marketIds[m.slug] = data!.id;
    }
  }

  if (!APPLY) {
    console.log("\n  (dry-run: no writes)");
    console.log("\n── Cities ──");
    for (const m of MARKETS) {
      for (const c of m.cities) {
        const flag = c.supports_neighbourhoods ? " [neighbourhoods enabled]" : "";
        console.log(`  [${m.slug}] ${c.name} (${c.slug})${flag}`);
      }
    }
    console.log(`\nTotal: ${MARKETS.length} markets, ${MARKETS.flatMap(m=>m.cities).length} cities`);
    console.log("Run with --apply to write.\n");
    return;
  }

  // ── 2. Upsert cities ─────────────────────────────────────────────────────
  console.log("\n── Cities ──");
  for (const m of MARKETS) {
    const marketId = marketIds[m.slug];
    for (const c of m.cities) {
      const payload = {
        market_id: marketId,
        slug: c.slug,
        name: c.name,
        status: c.status,
        supports_neighbourhoods: c.supports_neighbourhoods,
        display_order: c.display_order,
        center_lat: c.center_lat,
        center_lng: c.center_lng,
      };
      const { data, error } = await supabase
        .from("cities")
        .upsert(payload, { onConflict: "market_id,slug" })
        .select("id")
        .single();
      if (error) {
        console.error(`    ERROR upserting city ${m.slug}/${c.slug}:`, error.message);
        process.exit(1);
      }
      const key = `${m.slug}/${c.slug}`;
      cityIds[key] = data!.id;
      console.log(`  [${m.slug}] ${c.name}`);
    }
  }

  // ── 3. Set default_city_id on each market ─────────────────────────────────
  console.log("\n── Default cities ──");
  for (const m of MARKETS) {
    const marketId = marketIds[m.slug];
    const defaultCityId = cityIds[`${m.slug}/${m.defaultCitySlug}`];
    if (!defaultCityId) {
      console.warn(`  WARN: default city not found for ${m.slug} (${m.defaultCitySlug}) — skipping`);
      continue;
    }
    const { error } = await supabase
      .from("markets")
      .update({ default_city_id: defaultCityId })
      .eq("id", marketId);
    if (error) {
      console.error(`    ERROR setting default_city_id for ${m.slug}:`, error.message);
      process.exit(1);
    }
    console.log(`  ${m.name} → default city: ${m.defaultCitySlug}`);
  }

  const totalCities = MARKETS.flatMap(m => m.cities).length;
  console.log(`\n✓ Seeded ${MARKETS.length} markets and ${totalCities} cities.\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
