/**
 * scripts/importVenuesFromCsv.ts
 *
 * Developer utility — imports venues from venues.beta.csv into the Supabase
 * venues table following the mapping in docs/csv-to-supabase-mapping.md.
 *
 * Run from the operator-admin directory:
 *   npm run import:venues
 *
 * Behaviour:
 *   - Skips any venue whose slug already exists in the DB (idempotent).
 *   - Sets is_published = true for every imported row.
 *   - Stores country = "CA" (all beta venues are in BC, Canada).
 *   - business_hours is parsed from multi-line text → JSONB.
 *   - payment_types is serialised to a JSON array string.
 *   - hh_food_details / hh_drink_details are stored as plain text (parseSpecials
 *     in the consumer app handles both plain-text and JSON formats).
 *
 * This script is intentionally self-contained — it does not import from the
 * Next.js app's @/lib paths because those modules depend on next/headers and
 * cannot run outside a Next.js request context.  The helper functions below
 * are ported directly from operator-admin/src/lib/data/venues.ts and
 * index.html so the transformation logic stays identical.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// ── Environment ────────────────────────────────────────────────────────────────

// .env.local lives in the operator-admin directory (where npm is run from).
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

// ── CSV parser ─────────────────────────────────────────────────────────────────
// Ported from parseCSV() in index.html.
// Handles quoted fields containing embedded newlines and commas — critical for
// business_hours, hh_food_details, and hh_drink_details cells.

function parseCSV(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        // Escaped double-quote inside a quoted field ("" → ")
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((ch === "\r" || ch === "\n") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++; // CRLF → treat as one newline
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
    } else {
      currentField += ch;
    }
  }

  // Flush the final field / row
  currentRow.push(currentField);
  if (currentRow.some((f) => f !== "")) rows.push(currentRow);

  return rows;
}

// ── Day / time helpers ─────────────────────────────────────────────────────────
// Ported from parse12hToHHMM() and expandDayRange() in src/lib/data/venues.ts.
// These are the canonical transformations used by the consumer app — reusing
// them here guarantees the import produces exactly what the app expects.

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type Day = (typeof DAYS)[number];

/**
 * Parses a 12-hour time string ("4 PM", "6:30 PM") into 24-hour "HH:MM".
 * Maps "close" / "closing" to "23:00" (convention used throughout the app).
 * Returns null when the string cannot be parsed.
 */
function parse12hToHHMM(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (t === "close" || t === "closing") return "23:00";
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "pm" && h !== 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

/**
 * Expands a day-part string into an array of full day names.
 * Handles: single day ("Monday"), ranges ("Monday – Friday"), "Daily".
 * Uses first-3-char prefix matching so "Mon", "Monday" both work.
 */
function expandDayRange(dayPart: string): Day[] {
  const t = dayPart.trim();
  if (t.toLowerCase() === "daily") return [...DAYS];

  // Range with EN dash or ASCII hyphen: "Monday – Friday", "Mon - Fri"
  const rangeMatch = t.match(/^(.+?)\s*[\u2013\-]\s*(.+)$/);
  if (!rangeMatch) {
    const found = DAYS.find((d) =>
      d.toLowerCase().startsWith(t.toLowerCase().substring(0, 3))
    );
    return found ? [found] : [];
  }

  const startAbbr = rangeMatch[1].trim().toLowerCase().substring(0, 3);
  const endAbbr = rangeMatch[2].trim().toLowerCase().substring(0, 3);
  const startIdx = DAYS.findIndex((d) => d.toLowerCase().startsWith(startAbbr));
  const endIdx = DAYS.findIndex((d) => d.toLowerCase().startsWith(endAbbr));
  if (startIdx === -1 || endIdx === -1) return [];

  // Walk forward (wrapping through Sunday) from start to end
  const result: Day[] = [];
  let i = startIdx;
  for (;;) {
    result.push(DAYS[i]);
    if (i === endIdx) break;
    i = (i + 1) % DAYS.length;
  }
  return result;
}

// ── business_hours transformation ──────────────────────────────────────────────
// Converts the CSV multi-line plain-text schedule into the JSONB shape
// required by migration 003:
//   { "monday": { "open": "HH:MM", "close": "HH:MM" } | null, ... }
//
// Days absent from the text default to null (closed).
// Keys are lowercase to match the migration 003 spec.

type DayHours = { open: string; close: string } | null;
type BusinessHoursJson = Record<string, DayHours>;

function parseBusinessHoursText(text: string | null): BusinessHoursJson | null {
  if (!text?.trim()) return null;

  // Initialise all days to null (closed by default)
  const result: BusinessHoursJson = {};
  for (const d of DAYS) result[d.toLowerCase()] = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Find the separator colon that divides the day part from the time part.
    // Skip colons that are part of a time value (e.g. "2:30") — same logic
    // as parseBusinessHours() in index.html and parseHhTimes() in venues.ts.
    let splitIdx = -1;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === ":") {
        const before = line.substring(0, j).trim();
        const after = line.substring(j + 1).trim();
        // A colon is a time colon when the char before is a digit AND the char
        // after is also a digit (e.g. "2:30").
        if (/\d$/.test(before) && /^\d/.test(after)) continue;
        splitIdx = j;
        break;
      }
    }
    if (splitIdx === -1) continue;

    const dayPart = line.substring(0, splitIdx).trim();
    const timePart = line.substring(splitIdx + 1).trim();

    const days = expandDayRange(dayPart);
    if (days.length === 0) continue;

    if (!timePart || timePart.toLowerCase() === "closed") {
      // Explicit "Closed" — already null by default; nothing to do.
      continue;
    }

    // Parse a time range: "4 PM – 10 PM", "2:30 PM – 11 PM", "9 PM – Close"
    const timeMatch = timePart.match(/^(.+?)\s*[\u2013\-]\s*(.+)$/);
    if (!timeMatch) continue;

    const open = parse12hToHHMM(timeMatch[1].trim());
    const close = parse12hToHHMM(timeMatch[2].trim());
    if (!open || !close) continue;

    for (const day of days) {
      result[day.toLowerCase()] = { open, close };
    }
  }

  return result;
}

// ── payment_types transformation ───────────────────────────────────────────────
// CSV: "Cash, Debit, Credit Cards"  →  DB TEXT: '["Cash","Debit","Credit Cards"]'
//
// The consumer app calls JSON.parse() on this column; plain comma-separated
// text breaks the parse and produces a single-element array of the full string.

function parsePaymentTypes(raw: string): string | null {
  if (!raw.trim()) return null;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? JSON.stringify(items) : null;
}

// ── Specials guardrail ─────────────────────────────────────────────────────────
// Enforces the free-plan limit of 3 food specials and 3 drink specials.
// The plain-text format stores one item per newline; trimming to 3 lines
// before insert prevents seeded venues from ever exceeding the admin UI limit.

const MAX_SPECIALS = 3;

function trimSpecialsToThree(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length <= MAX_SPECIALS) return raw.trim();
  return lines.slice(0, MAX_SPECIALS).join("\n");
}

// ── Coordinate helper ──────────────────────────────────────────────────────────

function parseCoord(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // CSV lives in original-app/ (one level up from operator-admin, then into original-app)
  const csvPath = path.resolve(process.cwd(), "../original-app/venues.beta.csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`ERROR: CSV not found at ${csvPath}`);
    console.error(
      "       Run this script from the operator-admin directory (npm run import:venues)."
    );
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCSV(csvText);

  // The CSV has a few blank lines before the header row — find it by looking
  // for the first row whose first column is "id" (same logic as index.html).
  const headerIdx = rows.findIndex((r) => r[0]?.trim() === "id");
  if (headerIdx === -1) {
    console.error("ERROR: Could not locate header row in venues.beta.csv.");
    process.exit(1);
  }

  const headers = rows[headerIdx].map((h) => h.trim());
  const col: Record<string, number> = {};
  headers.forEach((h, i) => {
    col[h] = i;
  });

  // Convenience getter — returns empty string when column is absent
  const get = (row: string[], name: string): string =>
    col[name] !== undefined ? (row[col[name]] ?? "").trim() : "";

  const dataRows = rows
    .slice(headerIdx + 1)
    .filter((r) => r.some((f) => f.trim() !== ""));

  const total = dataRows.length;

  console.log(`\nImporting venues from venues.beta.csv...`);
  console.log(`Found ${total} venue rows.\n`);

  // Fetch all existing slugs up-front so we can skip duplicates without an
  // extra round-trip per row.
  const { data: existingRows, error: fetchError } = await supabase
    .from("venues")
    .select("slug");

  if (fetchError) {
    console.error("ERROR: Could not fetch existing venues:", fetchError.message);
    process.exit(1);
  }

  const existingSlugs = new Set(
    (existingRows ?? []).map((r: { slug: string }) => r.slug)
  );

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const slug = get(row, "id");

    if (!slug) {
      console.log(`  Row ${i + 1}: skipped (empty id)`);
      skipped++;
      continue;
    }

    if (existingSlugs.has(slug)) {
      console.log(`  ${i + 1} / ${total}  SKIP     ${slug}`);
      skipped++;
      continue;
    }

    // ── Field mapping (per docs/csv-to-supabase-mapping.md) ─────────────────

    const businessHoursJson = parseBusinessHoursText(
      get(row, "business_hours") || null
    );

    const paymentTypesJson = parsePaymentTypes(get(row, "payment_types"));

    const lat = parseCoord(get(row, "latitude"));
    const lng = parseCoord(get(row, "longitude"));

    // Blank string → null for optional text fields
    const orNull = (s: string) => s || null;

    const record = {
      // id is auto-generated (UUID); slug comes from CSV id column
      slug,
      name: get(row, "name"),
      address_line1: orNull(get(row, "address")),
      city: orNull(get(row, "city")),
      // region, postal_code: not in CSV — leave NULL (see mapping doc)
      country: "CA", // all beta venues are in BC, Canada
      phone: orNull(get(row, "phone")),
      website_url: orNull(get(row, "url")),     // CSV col "url" → DB "website_url"
      menu_url: orNull(get(row, "menu_url")),
      lat,
      lng,
      establishment_type: get(row, "type") || "Restaurant and Bar",
      payment_types: paymentTypesJson,          // serialised JSON array string
      business_hours: businessHoursJson,         // parsed JSONB object
      hh_times: orNull(get(row, "happy_hour_times")),       // plain text as-is
      hh_tagline: orNull(get(row, "happy_hour_tagline")),
      hh_food_details: trimSpecialsToThree(get(row, "happy_hour_food_details")),   // capped at 3
      hh_drink_details: trimSpecialsToThree(get(row, "happy_hour_drink_details")), // capped at 3
      // hours: legacy TEXT column — intentionally omitted (see mapping doc)
      is_published: true,
      // created_by_operator_id / updated_by_operator_id: NULL for CSV imports
    };

    const { error: insertError } = await supabase.from("venues").insert(record);

    if (insertError) {
      console.error(
        `  ${i + 1} / ${total}  ERROR    ${slug}: ${insertError.message}`
      );
      errors++;
    } else {
      imported++;
      // Mark as seen so a duplicate slug later in the same CSV doesn't re-insert
      existingSlugs.add(slug);
      console.log(`  Imported ${imported} / ${total}  ${slug}`);
    }
  }

  console.log(`\nCompleted.`);
  console.log(`  Imported : ${imported}`);
  console.log(`  Skipped  : ${skipped}`);
  if (errors > 0) {
    console.log(`  Errors   : ${errors}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
