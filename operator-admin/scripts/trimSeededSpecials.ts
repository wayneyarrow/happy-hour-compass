/**
 * scripts/trimSeededSpecials.ts
 *
 * One-time cleanup script — trims all venue hh_food_details and
 * hh_drink_details in the database to a maximum of 3 items each, and
 * normalises the stored value to JSON format.
 *
 * Run from the operator-admin directory:
 *   npm run trim:specials
 *
 * Behaviour:
 *   - Reads every venue that has non-null food or drink specials.
 *   - Parses both JSON (admin-saved) and plain-text (CSV-imported) formats.
 *   - Keeps only the first 3 items; extracts price and notes from plain text.
 *   - Writes the trimmed JSON value back only when the stored value changed.
 *   - Idempotent: running it twice leaves the data unchanged on the second run.
 *
 * Self-contained — no imports from the Next.js app (those depend on
 * next/headers and can't run outside a request context).
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

// ── Types ─────────────────────────────────────────────────────────────────────

type HhItem = { name: string; price?: string; notes?: string };

// ── Parsing helpers ───────────────────────────────────────────────────────────
// Ported from src/app/admin/happy-hours/page.tsx so this script stays
// self-contained.  Keep in sync if the admin parsing logic changes.

/**
 * Parses one line of legacy plain-text specials into a structured HhItem.
 *
 * Handles the formats found in seeded CSV data:
 *   Leading price:  "$13 Smash Burger (GF)"  → { name: "Smash Burger", price: "13", notes: "GF" }
 *   Trailing price: "Chips + Salsa $6"        → { name: "Chips + Salsa", price: "6" }
 *   Price + notes:  "Fries $5 (French or Truffle)" → { name: "Fries", price: "5", notes: "French or Truffle" }
 *   No price:       "Select appetizers discounted"  → { name: "Select appetizers discounted" }
 */
function parseLegacySpecialLine(line: string): HhItem {
  const raw = line.trim();

  // Step 1: strip trailing parenthetical into notes
  let notes: string | undefined;
  let text = raw;
  const parenMatch = raw.match(/\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const candidate = parenMatch[1].trim();
    if (candidate) notes = candidate;
    text = raw.slice(0, parenMatch.index!).trim();
  }

  // Step 2: trailing price token — "Item name $9.50"
  const trailing = text.match(/^(.+?)\s+\$(\d+(?:\.\d+)?)$/);
  if (trailing) {
    return {
      name: trailing[1].trim(),
      price: trailing[2],
      ...(notes ? { notes } : {}),
    };
  }

  // Step 3: leading price token — "$9.50 Item name"
  const leading = text.match(/^\$(\d+(?:\.\d+)?)\s+(.+)$/);
  if (leading) {
    return {
      name: leading[2].trim(),
      price: leading[1],
      ...(notes ? { notes } : {}),
    };
  }

  // Step 4: no price — full text is the name; re-absorb parens
  return { name: notes ? `${text} (${notes})` : text };
}

/**
 * Parses raw specials text into a structured array, then trims to MAX_ITEMS.
 *
 * Returns null for empty/null input (preserves NULL in the DB rather than
 * writing an empty JSON array).
 *
 * Returns a serialised JSON string so it can be directly compared with the
 * existing DB value to detect whether an update is needed.
 */
const MAX_ITEMS = 3;

function parseAndSerialise(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;

  let items: HhItem[];

  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          typeof item === "object" && item !== null && typeof item.name === "string"
      )
    ) {
      // Already JSON — just trim
      items = (parsed as HhItem[]).slice(0, MAX_ITEMS);
    } else {
      // Valid JSON but unexpected shape — treat as plain text
      items = raw
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, MAX_ITEMS)
        .map(parseLegacySpecialLine);
    }
  } catch {
    // Legacy plain text
    items = raw
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, MAX_ITEMS)
      .map(parseLegacySpecialLine);
  }

  if (items.length === 0) return null;
  return JSON.stringify(items);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nFetching venues with happy hour specials data…\n");

  const { data: venues, error: fetchError } = await supabase
    .from("venues")
    .select("id, slug, hh_food_details, hh_drink_details")
    .or("hh_food_details.not.is.null,hh_drink_details.not.is.null");

  if (fetchError) {
    console.error("ERROR: Could not fetch venues:", fetchError.message);
    process.exit(1);
  }

  const rows = venues ?? [];
  console.log(`Found ${rows.length} venue(s) with specials data.\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const newFood = parseAndSerialise(row.hh_food_details as string | null);
    const newDrink = parseAndSerialise(row.hh_drink_details as string | null);

    const foodChanged = newFood !== (row.hh_food_details ?? null);
    const drinkChanged = newDrink !== (row.hh_drink_details ?? null);

    if (!foodChanged && !drinkChanged) {
      console.log(`  SKIP     ${row.slug} (already trimmed)`);
      skipped++;
      continue;
    }

    const patch: Record<string, string | null> = {};
    if (foodChanged) patch.hh_food_details = newFood;
    if (drinkChanged) patch.hh_drink_details = newDrink;

    const { error: updateError } = await supabase
      .from("venues")
      .update(patch)
      .eq("id", row.id);

    if (updateError) {
      console.error(`  ERROR    ${row.slug}: ${updateError.message}`);
      errors++;
    } else {
      const countItems = (raw: string | null): number => {
        if (!raw?.trim()) return 0;
        try {
          const p = JSON.parse(raw);
          return Array.isArray(p) ? p.length : raw.split("\n").filter((l) => l.trim()).length;
        } catch {
          return raw.split("\n").filter((l) => l.trim()).length;
        }
      };
      const details: string[] = [];
      if (foodChanged) {
        details.push(`food ${countItems(row.hh_food_details as string | null)} → ${countItems(newFood)}`);
      }
      if (drinkChanged) {
        details.push(`drink ${countItems(row.hh_drink_details as string | null)} → ${countItems(newDrink)}`);
      }
      console.log(`  UPDATED  ${row.slug}  (${details.join(", ")})`);
      updated++;
    }
  }

  console.log(`\nCompleted.`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}`);
  if (errors > 0) {
    console.log(`  Errors  : ${errors}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
