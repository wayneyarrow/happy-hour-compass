/**
 * scripts/backfillSeededTags.ts
 *
 * Generates and writes Seeded Tags for all venues in the Happy Hour Compass DB.
 *
 * Seeded Tags are PLATFORM-OWNED discovery tags generated from:
 *   A. Google Places metadata (outdoor_seating, live_music, etc.)
 *   B. HH specials content (hh_food_details, hh_drink_details)
 *
 * This script is safe to rerun — it regenerates seeded_tags from current
 * venue data on every run. In dry-run mode it shows proposed changes without
 * writing anything.
 *
 * Writes are strictly limited to:
 *   • seeded_tags   (the platform-generated column)
 *
 * This script NEVER touches:
 *   • search_tags   (operator-owned)
 *   • Any other venue field
 *
 * Usage (from operator-admin/):
 *   npm run backfill:seeded-tags              ← dry-run (no DB writes)
 *   npm run backfill:seeded-tags -- --apply   ← write to Supabase
 *
 * Prerequisites:
 *   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { generateSeededTags } from "../src/lib/seededTags";
import type { SeededTagInput } from "../src/lib/seededTags";

// ── Environment ────────────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    "ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.\n" +
      "       Make sure operator-admin/.env.local is populated."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const APPLY_MODE = process.argv.includes("--apply");
const DRY_RUN = !APPLY_MODE;

// ── Venue row type ─────────────────────────────────────────────────────────────

type VenueRow = SeededTagInput & {
  id: string;
  name: string;
  city: string | null;
  is_published: boolean;
  seeded_tags: string[];    // current value in DB
  search_tags: string[];    // operator-owned — read for display only, never written
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function formatTags(tags: string[]): string {
  return tags.length === 0 ? "(none)" : tags.join(", ");
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const BOLD    = "═".repeat(72);
  const DIVIDER = "─".repeat(72);

  console.log(`\n${BOLD}`);
  console.log(`  Seeded Tags Backfill — Happy Hour Compass`);
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN (pass --apply to write to DB)" : "APPLY MODE — writing to Supabase"}`);
  console.log(`${BOLD}\n`);

  // ── Fetch all venues ────────────────────────────────────────────────────────

  const SELECT_COLS = [
    "id", "name", "city", "is_published",
    "seeded_tags", "search_tags",
    // Google metadata (Source A)
    "outdoor_seating", "live_music", "good_for_watching_sports",
    "good_for_children", "good_for_groups", "allows_dogs",
    "serves_vegetarian_food",
    // HH specials (Source B)
    "hh_food_details", "hh_drink_details",
  ].join(", ");

  const { data: venues, error: fetchError } = await supabase
    .from("venues")
    .select(SELECT_COLS)
    .order("name") as unknown as { data: VenueRow[] | null; error: { message: string } | null };

  if (fetchError) {
    const msg = fetchError.message ?? "";
    if (msg.includes("seeded_tags") && msg.includes("does not exist")) {
      console.error(
        "ERROR: The seeded_tags column does not exist yet.\n\n" +
        "  Apply the migration first:\n" +
        "    supabase/migrations/032_venues_seeded_tags.sql\n\n" +
        "  You can run it in the Supabase dashboard:\n" +
        "    https://supabase.com/dashboard/project/juphyhxdmcvseeufbiay/sql/new\n\n" +
        "  Paste the contents of 032_venues_seeded_tags.sql and click Run.\n" +
        "  Then re-run this script.\n"
      );
    } else {
      console.error("ERROR: Failed to fetch venues:", msg);
    }
    process.exit(1);
  }

  if (!venues) {
    console.error("ERROR: No data returned from Supabase.");
    process.exit(1);
  }

  console.log(`Venues found: ${venues.length}\n`);

  // ── Process each venue ──────────────────────────────────────────────────────

  let changed   = 0;   // venues where proposed !== current
  let unchanged = 0;   // venues where proposed === current
  let errors    = 0;

  const tagFrequency: Record<string, number> = {};
  const tagExamples:  Record<string, string[]> = {};
  const changeLog: Array<{ name: string; city: string; current: string[]; proposed: string[] }> = [];

  for (const venue of venues) {
    const proposed = generateSeededTags(venue);
    const current  = Array.isArray(venue.seeded_tags) ? venue.seeded_tags : [];

    const isChanged = !arraysEqual(current, proposed);

    if (!isChanged) {
      unchanged++;
      // Still count tags for the frequency table
      for (const t of proposed) {
        tagFrequency[t] = (tagFrequency[t] ?? 0) + 1;
        if (!tagExamples[t]) tagExamples[t] = [];
        if (tagExamples[t].length < 3) {
          tagExamples[t].push(`${venue.name} (${venue.city ?? "?"})`);
        }
      }
      continue;
    }

    changed++;
    changeLog.push({ name: venue.name, city: venue.city ?? "?", current, proposed });

    for (const t of proposed) {
      tagFrequency[t] = (tagFrequency[t] ?? 0) + 1;
      if (!tagExamples[t]) tagExamples[t] = [];
      if (tagExamples[t].length < 3) {
        tagExamples[t].push(`${venue.name} (${venue.city ?? "?"})`);
      }
    }

    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from("venues")
        .update({ seeded_tags: proposed })
        .eq("id", venue.id);

      if (updateError) {
        console.error(`  ERROR updating ${venue.name}: ${updateError.message}`);
        errors++;
      }
    }
  }

  // ── Change log (dry-run) ────────────────────────────────────────────────────

  if (changeLog.length > 0) {
    console.log(`${DIVIDER}`);
    console.log(`  PROPOSED CHANGES (${changeLog.length} venue${changeLog.length === 1 ? "" : "s"})`);
    console.log(`${DIVIDER}\n`);
    for (const { name, city, current, proposed } of changeLog) {
      console.log(`  ${name} (${city})`);
      console.log(`    current:  ${formatTags(current)}`);
      console.log(`    proposed: ${formatTags(proposed)}`);
    }
    console.log();
  }

  // ── Tag frequency table ─────────────────────────────────────────────────────

  console.log(`${DIVIDER}`);
  console.log(`  TAGS GENERATED — FREQUENCY`);
  console.log(`${DIVIDER}\n`);

  const sortedTags = Object.entries(tagFrequency).sort((a, b) => b[1] - a[1]);

  if (sortedTags.length === 0) {
    console.log("  (no tags would be generated)\n");
  } else {
    for (const [tag, count] of sortedTags) {
      const pct = ((count / venues.length) * 100).toFixed(1);
      console.log(`  ${tag.padEnd(24)}  ${count.toString().padStart(3)} venues  (${pct}%)`);
      const examples = tagExamples[tag] ?? [];
      for (const ex of examples) {
        console.log(`    · ${ex}`);
      }
    }
    console.log();
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  const withTags    = venues.filter((v) => generateSeededTags(v).length > 0).length;
  const withoutTags = venues.length - withTags;

  console.log(`${BOLD}`);
  console.log(`  SUMMARY`);
  console.log(BOLD);
  console.log(`\n  Total venues examined   : ${venues.length}`);
  console.log(`  Venues with ≥1 seeded tag : ${withTags}`);
  console.log(`  Venues with 0 seeded tags  : ${withoutTags}`);
  console.log(`  Venues already up-to-date  : ${unchanged}`);
  console.log(`  Venues with proposed changes: ${changed}`);
  if (!DRY_RUN) {
    console.log(`  DB write errors            : ${errors}`);
  }
  console.log();

  // ── Recommendation ──────────────────────────────────────────────────────────

  console.log(`${DIVIDER}`);
  console.log(`  RECOMMENDATION`);
  console.log(`${DIVIDER}`);

  if (DRY_RUN) {
    if (withTags === 0) {
      console.log(`\n  ⚠  No tags were generated. Check that Google metadata and specials`);
      console.log(`     data are populated in the DB before applying.`);
    } else if (withTags < 10) {
      console.log(`\n  ⚠  Only ${withTags} venue(s) received tags. Coverage is lower than expected.`);
      console.log(`     Review the data quality before applying.`);
    } else {
      console.log(`\n  ✓  Results look healthy.`);
      console.log(`     Run with --apply when ready to write to Supabase:`);
      console.log(`     npm run backfill:seeded-tags -- --apply`);
    }
  } else {
    if (errors > 0) {
      console.log(`\n  ⚠  ${errors} venue(s) failed to update. Check errors above.`);
      process.exit(1);
    } else {
      console.log(`\n  ✓  Seeded tags written successfully for all venues.`);
    }
  }

  console.log();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
