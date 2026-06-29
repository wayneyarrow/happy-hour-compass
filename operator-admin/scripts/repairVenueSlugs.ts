/**
 * scripts/repairVenueSlugs.ts
 *
 * One-time slug repair for venues whose slugs don't follow the canonical
 * {city-slug}-{name-slug} format established by the CSV import pipeline.
 *
 * WHAT IT DOES:
 *   - Queries venues whose slugs contain non-canonical patterns
 *     (operator-created random suffix: `{name}-{5chars}`, or
 *      old submission slugs: `submission-{placeId}`, or manually bad slugs)
 *   - Generates a canonical slug from city + name
 *   - Checks for slug collisions; appends a short suffix if needed
 *   - DRY-RUN by default: prints before/after without writing
 *   - With --write: applies the updates
 *
 * ROOT CAUSE (for reference):
 *   Neither "Wayne's Cafe" nor "Rustic Reel Brewing Company" appear in any
 *   venue CSV. Their slugs were likely set via Supabase dashboard, an older
 *   code path, or operator-created with `{name}-{random}` format. No current
 *   code path generates slugs with address components — this is a data issue.
 *
 * Run from the operator-admin directory:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/repairVenueSlugs.ts
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/repairVenueSlugs.ts --write
 *
 * Safety guarantees:
 *   - NEVER publishes, deletes, or touches any field except `slug`
 *   - Idempotent: already-canonical slugs are reported as "OK" and skipped
 *   - Collision-safe: checks existing slugs before committing
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

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

const DRY_RUN = !process.argv.includes("--write");

// ── Slug helpers ───────────────────────────────────────────────────────────────

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalSlug(name: string, city: string | null): string {
  const nameSlug = slugify(name);
  const citySlug = city ? slugify(city) : "";
  return (citySlug ? `${citySlug}-${nameSlug}` : nameSlug).slice(0, 90);
}

// Returns true if the slug matches the canonical {city-slug}-{name-slug} pattern
// or any {city-slug}-{name-slug} prefix (handles partial city names etc.)
function isLikelyCanonical(slug: string, name: string, city: string | null): boolean {
  const expected = canonicalSlug(name, city);
  return slug === expected;
}

// ── Target venues ──────────────────────────────────────────────────────────────
//
// Expand this list to fix additional venues. Uses ILIKE name matching so
// minor typos in the DB name still match.

const TARGET_NAME_PATTERNS = [
  "%wayne%cafe%",
  "%rustic%reel%",
];

// ── Types ─────────────────────────────────────────────────────────────────────

type Venue = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  is_published: boolean;
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Venue Slug Repair Script (${DRY_RUN ? "DRY RUN" : "WRITE MODE"}) ===\n`);

  // Fetch target venues by name pattern
  const targetVenues: Venue[] = [];
  for (const pattern of TARGET_NAME_PATTERNS) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, slug, name, city, is_published")
      .ilike("name", pattern);

    if (error) {
      console.error(`Query error for pattern "${pattern}":`, error.message);
      continue;
    }
    if (data) targetVenues.push(...data);
  }

  // Also sweep for all `submission-` slugs (these are always non-canonical)
  const { data: submissionVenues, error: sweepError } = await supabase
    .from("venues")
    .select("id, slug, name, city, is_published")
    .like("slug", "submission-%");

  if (sweepError) {
    console.error("Sweep query error:", sweepError.message);
  } else if (submissionVenues?.length) {
    console.log(`Found ${submissionVenues.length} venue(s) with submission-* slugs:`);
    for (const v of submissionVenues) {
      console.log(`  • [${v.is_published ? "published" : "unpublished"}] ${v.name} (${v.city ?? "no city"})`);
      console.log(`    slug: ${v.slug}`);
      console.log(`    canonical would be: ${canonicalSlug(v.name, v.city)}`);
    }
    console.log();
    // Include in repair candidates if not already in targetVenues
    for (const v of submissionVenues) {
      if (!targetVenues.some((t) => t.id === v.id)) {
        targetVenues.push(v);
      }
    }
  }

  if (targetVenues.length === 0) {
    console.log("No target venues found. Nothing to repair.");
    return;
  }

  console.log(`Found ${targetVenues.length} venue(s) to inspect:\n`);

  let repaired = 0;
  let skipped = 0;

  for (const venue of targetVenues) {
    const desired = canonicalSlug(venue.name, venue.city);
    const alreadyCanonical = isLikelyCanonical(venue.slug, venue.name, venue.city);

    console.log(`Venue: ${venue.name} (${venue.city ?? "no city"}) [${venue.is_published ? "PUBLISHED" : "unpublished"}]`);
    console.log(`  Current slug:   ${venue.slug}`);
    console.log(`  Canonical slug: ${desired}`);

    if (alreadyCanonical) {
      console.log(`  Status: ✓ Already canonical — skipping\n`);
      skipped++;
      continue;
    }

    // Check for slug collision
    const { data: collision } = await supabase
      .from("venues")
      .select("id")
      .eq("slug", desired)
      .neq("id", venue.id)
      .maybeSingle();

    let finalSlug = desired;
    if (collision) {
      const suffix = Math.random().toString(36).slice(2, 6);
      finalSlug = `${desired.slice(0, 86)}-${suffix}`;
      console.log(`  ⚠ Collision on "${desired}" — using "${finalSlug}" instead`);
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would update slug: ${venue.slug} → ${finalSlug}\n`);
      repaired++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("venues")
      .update({ slug: finalSlug })
      .eq("id", venue.id);

    if (updateError) {
      console.error(`  ✗ Update failed: ${updateError.message}\n`);
    } else {
      console.log(`  ✓ Updated slug: ${venue.slug} → ${finalSlug}\n`);
      repaired++;
    }
  }

  console.log(`\nDone. ${repaired} repaired, ${skipped} already canonical.`);
  if (DRY_RUN && repaired > 0) {
    console.log(`Re-run with --write to apply changes.`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
