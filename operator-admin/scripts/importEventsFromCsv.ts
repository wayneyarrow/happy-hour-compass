/**
 * scripts/importEventsFromCsv.ts
 *
 * Developer utility — imports events from events.beta.csv into the Supabase
 * events table following the mapping in docs/csv-to-supabase-mapping.md.
 *
 * Run from the operator-admin directory:
 *   npm run import:events
 *
 * Behaviour:
 *   - Fetches all venue slugs → UUIDs from Supabase before inserting events.
 *   - Skips any event whose slug already exists in the DB (idempotent).
 *   - Sets is_published = true for every imported row.
 *   - Maps event_frequency: "weekly" → recurrence="weekly",
 *                           "one-off"  → recurrence="none".
 *   - Parses start_time / end_time from event_time text.
 *   - Derives first_date from the slug (YYYY-MM-DD extraction) for one-off
 *     events, or from the next upcoming weekday for weekly events.
 *   - Logs all ambiguous mappings clearly instead of silently guessing.
 *
 * Ambiguity decisions (per docs/csv-to-supabase-mapping.md):
 *   1. first_date year (one-off): extract YYYY-MM-DD from slug when present
 *      (reliable for slugs like "…-2026-02-27"); otherwise extract 4-digit
 *      year from slug; otherwise default to the next calendar occurrence of
 *      the parsed month/day (from the runtime date). A notice is logged when
 *      the year is inferred.
 *   2. first_date (weekly): next upcoming occurrence of the day from the
 *      runtime date (i.e. today or later).
 *   3. Multi-day weekly (e.g. "Mondays & Wednesdays · 8:30 PM"): first day
 *      is used for first_date; the second day is not captured. Logged.
 *   4. end_time "close"/"closing": set to NULL (no fixed closing time). Logged.
 *   5. Unparseable times ("evening", "showtimes vary"): start/end = NULL. Logged.
 *
 * This script is intentionally self-contained — it does not import from the
 * Next.js app's @/lib paths because those modules depend on next/headers and
 * cannot run outside a Next.js request context. Helper functions are ported
 * from importVenuesFromCsv.ts so transformation logic stays identical.
 */

import * as fs from "fs";
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

// ── CSV parser ─────────────────────────────────────────────────────────────────
// Ported from parseCSV() in importVenuesFromCsv.ts (originally from index.html).
// Handles quoted fields containing embedded newlines and commas.

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
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((ch === "\r" || ch === "\n") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
    } else {
      currentField += ch;
    }
  }

  currentRow.push(currentField);
  if (currentRow.some((f) => f !== "")) rows.push(currentRow);

  return rows;
}

// ── Day / time constants ────────────────────────────────────────────────────────

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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// ── Time parsing helpers ────────────────────────────────────────────────────────

/**
 * Parses a single time token into a "H:MM AM/PM" display string.
 *
 * Handles:
 *   "4 PM", "6:30 PM", "9:00 PM", "2:00 PM"
 *   "Noon" / "noon" → "12:00 PM"
 *   Leading prefixes: "Doors open 2:00 PM" → "2:00 PM"
 *   Trailing suffixes: "4 PM start" → "4:00 PM"
 *
 * Returns null when the string cannot be parsed (e.g. "evening", "showtimes vary").
 * Returns the string "CLOSE" when the token is "close"/"closing" (caller handles).
 */
function parseTimeToken(raw: string): string | "CLOSE" | null {
  let t = raw.trim();

  if (/^noon$/i.test(t)) return "12:00 PM";
  if (/^clos(e|ing)$/i.test(t)) return "CLOSE";

  // Strip known leading prefixes
  t = t.replace(/^doors?\s+open\s+/i, "").trim();
  // Strip known trailing suffixes
  t = t.replace(/\s+(start|opens?)$/i, "").trim();

  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return null;

  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ispm = m[3].toLowerCase() === "pm";

  if (ispm && h !== 12) h += 12;
  if (!ispm && h === 12) h = 0;

  const displayAmpm = h >= 12 ? "PM" : "AM";
  let displayH = h % 12;
  if (displayH === 0) displayH = 12;

  return `${displayH}:${min.toString().padStart(2, "0")} ${displayAmpm}`;
}

/**
 * Parses the time portion of an event_time string (the part after " · ") into
 * start_time and end_time display strings.
 *
 * Handles:
 *   "2–4 PM"         → { start: "2:00 PM",  end: "4:00 PM" }
 *   "Noon–2 PM"      → { start: "12:00 PM", end: "2:00 PM" }
 *   "7:30–10 PM"     → { start: "7:30 PM",  end: "10:00 PM" }
 *   "5 PM–close"     → { start: "5:00 PM",  end: null }    [logged]
 *   "6:30 PM"        → { start: "6:30 PM",  end: null }
 *   "4 PM start"     → { start: "4:00 PM",  end: null }
 *   "Doors open 2 PM"→ { start: "2:00 PM",  end: null }
 *   "showtimes vary" → { start: null,        end: null }    [logged]
 *   "evening"        → { start: null,        end: null }    [logged]
 */
function parseEventTimePart(
  timePart: string,
  slug: string
): { start: string | null; end: string | null } {
  // Normalize "Noon" in the string before range splitting
  let t = timePart.replace(/\bNoon\b/gi, "12 PM").trim();

  // Detect range: EN dash (U+2013) is the standard delimiter in the CSV.
  // Also handle plain hyphen when followed by a digit or "close".
  const rangeMatch =
    t.match(/^(.+?)\s*\u2013\s*(.+)$/) ||
    t.match(/^(.+?)\s*-\s*(?=\d|close|closing)(.+)$/i);

  if (rangeMatch) {
    let startRaw = rangeMatch[1].trim();
    let endRaw = rangeMatch[2].trim();

    // Shared AM/PM: "2–4 PM" → startRaw="2", endRaw="4 PM"
    // Propagate the trailing AM/PM to the start token when it has none.
    const endAmpm = endRaw.match(/\s*(am|pm)\s*$/i);
    if (endAmpm && !/am|pm/i.test(startRaw)) {
      startRaw = `${startRaw} ${endAmpm[1]}`;
    }

    const startResult = parseTimeToken(startRaw);
    const endResult = parseTimeToken(endRaw);

    if (endResult === "CLOSE") {
      console.log(
        `  NOTE [${slug}]: end_time "close" has no fixed time — setting end_time = NULL`
      );
      return {
        start: startResult === "CLOSE" ? null : startResult,
        end: null,
      };
    }

    return {
      start: startResult === "CLOSE" ? null : startResult,
      end: endResult,
    };
  }

  // Single time (or unparseable)
  const result = parseTimeToken(t);

  if (result === null) {
    console.log(
      `  NOTE [${slug}]: event_time part "${timePart}" is not a parseable time — setting start_time = end_time = NULL`
    );
    return { start: null, end: null };
  }

  if (result === "CLOSE") {
    console.log(
      `  NOTE [${slug}]: event_time part "${timePart}" resolved to "close" — setting start_time = end_time = NULL`
    );
    return { start: null, end: null };
  }

  return { start: result, end: null };
}

/**
 * Splits event_time on the middle-dot separator " · " (U+00B7) and returns
 * [dayPart, timePart]. Returns [eventTime, null] if no separator is found.
 */
function splitEventTime(eventTime: string): [string, string | null] {
  // U+00B7 MIDDLE DOT is the standard separator in the CSV
  const idx = eventTime.indexOf(" \u00B7 ");
  if (idx !== -1) {
    return [
      eventTime.substring(0, idx).trim(),
      eventTime.substring(idx + 3).trim(),
    ];
  }
  // Fallback: bullet "•" (U+2022) or plain "·" without surrounding spaces
  const idx2 = eventTime.search(/\s*[\u00B7\u2022]\s*/);
  if (idx2 !== -1) {
    const parts = eventTime.split(/\s*[\u00B7\u2022]\s*/);
    return [parts[0].trim(), parts.slice(1).join(" · ").trim()];
  }
  return [eventTime, null];
}

// ── Day-of-week helpers ─────────────────────────────────────────────────────────

/**
 * Normalises a day-name token to a canonical Day string.
 * Handles plural forms ("Sundays" → "Sunday") and 3-char prefixes ("Mon").
 */
function parseDayName(token: string): Day | null {
  // Strip trailing 's' for plurals: "Sundays" → "Sunday"
  const t = token.trim().replace(/s$/i, "");
  const found = DAYS.find((d) =>
    d.toLowerCase().startsWith(t.toLowerCase().substring(0, 3))
  );
  return found ?? null;
}

/**
 * Returns the next calendar date (from today inclusive) that falls on the
 * given weekday index (0=Sunday … 6=Saturday).
 * Result is formatted as "YYYY-MM-DD".
 */
function nextWeekday(weekdayIndex: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (weekdayIndex - today.getDay() + 7) % 7;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  const y = target.getFullYear();
  const m = (target.getMonth() + 1).toString().padStart(2, "0");
  const d = target.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── first_date derivation ───────────────────────────────────────────────────────

/**
 * Derives first_date for a weekly event from its event_time day part.
 *
 * Ambiguity #2: uses next upcoming occurrence from the runtime date.
 * Ambiguity #3: multi-day ("Mondays & Wednesdays") uses the first day only.
 */
function deriveFirstDateWeekly(
  dayPart: string,
  slug: string
): string | null {
  // Multi-day: "Mondays & Wednesdays" — split on "&" or "and"
  const parts = dayPart.split(/\s*(?:&|and)\s*/i);
  if (parts.length > 1) {
    console.log(
      `  NOTE [${slug}]: multi-day weekly event "${dayPart}" — using first day` +
        ` ("${parts[0].trim()}") for first_date; second day is not captured`
    );
  }

  const day = parseDayName(parts[0].trim());
  if (!day) {
    console.log(
      `  NOTE [${slug}]: could not parse day name from "${dayPart}" — setting first_date = NULL`
    );
    return null;
  }

  return nextWeekday(DAYS.indexOf(day));
}

/**
 * Derives first_date for a one-off event.
 *
 * Ambiguity #1 strategy:
 *   1. Extract YYYY-MM-DD directly from the slug (most reliable).
 *   2. Extract YYYY from the slug, then parse month/day from event_time.
 *   3. Parse month/day from event_time and pick the next calendar occurrence
 *      of that date (from today), logging a notice.
 */
function deriveFirstDateOneOff(
  slug: string,
  dayPart: string
): string | null {
  // Strategy 1: slug contains YYYY-MM-DD
  const fullDateMatch = slug.match(/(\d{4}-\d{2}-\d{2})/);
  if (fullDateMatch) {
    return fullDateMatch[1];
  }

  // Parse month and day from dayPart: "Friday, Feb 27", "Saturday, Jan 24"
  const monthDayMatch = dayPart.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/i
  );

  let month: number | null = null;
  let day: number | null = null;
  if (monthDayMatch) {
    month = MONTHS[monthDayMatch[1].toLowerCase().substring(0, 3)] ?? null;
    day = parseInt(monthDayMatch[2], 10);
  }

  if (month === null || day === null) {
    console.log(
      `  NOTE [${slug}]: could not parse month/day from "${dayPart}" — setting first_date = NULL`
    );
    return null;
  }

  // Strategy 2: extract YYYY from slug (e.g. "superbowl-2026")
  const yearInSlug = slug.match(/\b(20\d{2})\b/);
  if (yearInSlug) {
    const year = parseInt(yearInSlug[1], 10);
    const mm = month.toString().padStart(2, "0");
    const dd = day.toString().padStart(2, "0");
    console.log(
      `  NOTE [${slug}]: year ${year} inferred from slug — first_date = ${year}-${mm}-${dd}`
    );
    return `${year}-${mm}-${dd}`;
  }

  // Strategy 3: pick the next calendar occurrence of month/day from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  if (candidate < today) year++;

  const mm = month.toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  console.log(
    `  NOTE [${slug}]: no year found in slug — first_date year inferred as ${year} from next occurrence of ${mm}-${dd}`
  );
  return `${year}-${mm}-${dd}`;
}

// ── recurrence mapping ──────────────────────────────────────────────────────────

function mapRecurrence(eventFrequency: string): string {
  if (eventFrequency === "weekly") return "weekly";
  if (eventFrequency === "one-off") return "none";
  // Unexpected value — log and default to "none"
  console.log(
    `  WARN: unknown event_frequency "${eventFrequency}" — mapping recurrence to "none"`
  );
  return "none";
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = path.resolve(process.cwd(), "../events.beta.csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`ERROR: CSV not found at ${csvPath}`);
    console.error(
      "       Run this script from the operator-admin directory (npm run import:events)."
    );
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCSV(csvText);

  // Find header row (first row whose first column is "id")
  const headerIdx = rows.findIndex((r) => r[0]?.trim() === "id");
  if (headerIdx === -1) {
    console.error("ERROR: Could not locate header row in events.beta.csv.");
    process.exit(1);
  }

  const headers = rows[headerIdx].map((h) => h.trim());
  const col: Record<string, number> = {};
  headers.forEach((h, i) => { col[h] = i; });

  const get = (row: string[], name: string): string =>
    col[name] !== undefined ? (row[col[name]] ?? "").trim() : "";

  const dataRows = rows
    .slice(headerIdx + 1)
    .filter((r) => r.some((f) => f.trim() !== ""));

  const total = dataRows.length;

  console.log(`\nImporting events from events.beta.csv...`);
  console.log(`Found ${total} event rows.\n`);

  // ── Step 1: Build venue slug → UUID map ──────────────────────────────────────
  console.log("Building venue slug → UUID map from Supabase...");

  const { data: venueRows, error: venueError } = await supabase
    .from("venues")
    .select("id, slug");

  if (venueError) {
    console.error(
      "ERROR: Could not fetch venues from Supabase:",
      venueError.message
    );
    process.exit(1);
  }

  const venueSlugToUuid = new Map<string, string>(
    (venueRows ?? []).map((r: { id: string; slug: string }) => [r.slug, r.id])
  );

  console.log(`  Found ${venueSlugToUuid.size} venues in Supabase.\n`);

  // ── Step 2: Fetch existing event slugs (for idempotency) ─────────────────────
  const { data: existingEvents, error: fetchError } = await supabase
    .from("events")
    .select("slug");

  if (fetchError) {
    console.error(
      "ERROR: Could not fetch existing events:",
      fetchError.message
    );
    process.exit(1);
  }

  const existingSlugs = new Set(
    (existingEvents ?? []).map((r: { slug: string }) => r.slug)
  );

  // ── Step 3: Import events ─────────────────────────────────────────────────────
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

    const venueSlug = get(row, "venue_id");
    const venueUuid = venueSlugToUuid.get(venueSlug);

    if (!venueUuid) {
      console.error(
        `  ${i + 1} / ${total}  ERROR    ${slug}: venue slug "${venueSlug}" not found in Supabase — skipping`
      );
      errors++;
      continue;
    }

    const title = get(row, "title");
    const eventTime = get(row, "event_time");
    const eventFrequency = get(row, "event_frequency");
    const description = get(row, "description");

    // ── event_time → day part + time part ──────────────────────────────────
    const [dayPart, timePart] = splitEventTime(eventTime);

    // ── start_time / end_time ───────────────────────────────────────────────
    let start_time: string | null = null;
    let end_time: string | null = null;

    if (timePart) {
      const parsed = parseEventTimePart(timePart, slug);
      start_time = parsed.start;
      end_time = parsed.end;
    } else {
      console.log(
        `  NOTE [${slug}]: no " · " separator found in event_time "${eventTime}" — start_time = end_time = NULL`
      );
    }

    // ── first_date ──────────────────────────────────────────────────────────
    let first_date: string | null = null;

    if (eventFrequency === "weekly") {
      first_date = deriveFirstDateWeekly(dayPart, slug);
    } else if (eventFrequency === "one-off") {
      first_date = deriveFirstDateOneOff(slug, dayPart);
    }

    // ── recurrence ──────────────────────────────────────────────────────────
    const recurrence = mapRecurrence(eventFrequency);

    // ── Assemble record ─────────────────────────────────────────────────────
    const record = {
      slug,
      venue_id: venueUuid,
      title,
      event_time: eventTime || null,          // legacy plain-text field, verbatim
      event_frequency: eventFrequency || null, // legacy plain-text field, verbatim
      recurrence,
      description: description || null,
      start_time,
      end_time,
      first_date,
      image_url: null,                         // not in CSV
      is_published: true,
      // created_by_operator_id / updated_by_operator_id: NULL for CSV imports
    };

    const { error: insertError } = await supabase.from("events").insert(record);

    if (insertError) {
      console.error(
        `  ${i + 1} / ${total}  ERROR    ${slug}: ${insertError.message}`
      );
      errors++;
    } else {
      imported++;
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
