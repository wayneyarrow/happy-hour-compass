/**
 * scripts/backfillHhReviewFlag.ts
 *
 * Sets hh_times_needs_review = TRUE on venues whose hh_times value cannot be
 * deterministically converted into the standard newline/day-by-day format —
 * i.e. venues that were skipped as MANUAL_REVIEW during the Step 2 bulk
 * normalization pass.
 *
 * Classification logic (identical to normalizeHhTimes.ts):
 *   - Parse hh_times through the same parseHhTimes() used by Operator Admin.
 *   - If ALL 7 days resolve to "No happy hour" → value is unparseable → flag.
 *   - If at least one day has HH times → value is parseable → do NOT flag.
 *   - Null / empty hh_times → skip (valid "no data" state).
 *
 * Run from the operator-admin directory:
 *   npm run backfill:hh-review           ← dry-run (no DB writes)
 *   npm run backfill:hh-review -- --write ← apply updates to Supabase
 *
 * Prerequisites:
 *   Migration 011_venues_hh_review_flag.sql must be applied first.
 *   If the column is missing the script will print the migration SQL and exit.
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

// ── Ported constants & types (from HhTimesForm.tsx) ────────────────────────────

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

const MINUTES = ["00", "15", "30", "45"];

type TimeBlock = {
  startHour: string;
  startMinute: string;
  startPeriod: "AM" | "PM";
  endHour: string;
  endMinute: string;
  endPeriod: "AM" | "PM";
};

type DayState = {
  noHappyHour: boolean;
  block1: TimeBlock;
  block2: TimeBlock | null;
};

const DEFAULT_BLOCK: TimeBlock = {
  startHour: "4",
  startMinute: "00",
  startPeriod: "PM",
  endHour: "6",
  endMinute: "00",
  endPeriod: "PM",
};

function getDefaultDayStates(): Record<Day, DayState> {
  const result = {} as Record<Day, DayState>;
  for (const day of DAYS) {
    result[day] = { noHappyHour: true, block1: { ...DEFAULT_BLOCK }, block2: null };
  }
  return result;
}

function parseTimeStr(s: string): { hour: string; minute: string; period: "AM" | "PM" } | null {
  const trimmed = s.trim().toLowerCase();
  if (trimmed === "close" || trimmed === "closing") {
    return { hour: "11", minute: "00", period: "PM" };
  }
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  const raw = (m[2] ?? "0").padStart(2, "0");
  const minute = (MINUTES as readonly string[]).includes(raw) ? raw : "00";
  return { hour: m[1], minute, period: m[3].toUpperCase() as "AM" | "PM" };
}

function parseTimeRange(range: string): TimeBlock | null {
  const parts = range.trim().split(/\s*-\s*/);
  if (parts.length < 2) return null;
  const end = parseTimeStr(parts[parts.length - 1]);
  if (!end) return null;
  let start = parseTimeStr(parts[0]);
  if (!start) {
    const p = parts[parts.length - 1].match(/\s*(am|pm)\s*$/i)?.[1];
    if (p) start = parseTimeStr(`${parts[0].trim()} ${p}`);
  }
  if (!start) return null;
  return {
    startHour: start.hour,
    startMinute: start.minute,
    startPeriod: start.period,
    endHour: end.hour,
    endMinute: end.minute,
    endPeriod: end.period,
  };
}

function parseDayRange(rawDayPart: string): Day[] {
  const dayPart = rawDayPart.trim();
  if (/^(daily|everyday)$/i.test(dayPart)) return [...DAYS];
  if (/^weekdays$/i.test(dayPart)) {
    return DAYS.filter((d) => d !== "Saturday" && d !== "Sunday");
  }
  const dashIdx = dayPart.indexOf("-");
  if (dashIdx !== -1) {
    const startName = dayPart.slice(0, dashIdx).trim();
    const endName   = dayPart.slice(dashIdx + 1).trim();
    const si = (DAYS as readonly string[]).indexOf(startName);
    const ei = (DAYS as readonly string[]).indexOf(endName);
    if (si !== -1 && ei !== -1) {
      if (si <= ei) return DAYS.slice(si, ei + 1) as Day[];
      return [...DAYS.slice(si), ...DAYS.slice(0, ei + 1)] as Day[];
    }
  }
  if ((DAYS as readonly string[]).includes(dayPart)) return [dayPart as Day];
  return [];
}

function parseHhTimes(text: string | null | undefined): Record<Day, DayState> {
  const states = getDefaultDayStates();
  if (!text?.trim()) return states;

  const normalized = text.replace(/[\u2013\u2014\u2212]/g, "-");

  const textToSplit =
    !normalized.trim().includes("\n") && normalized.includes("|")
      ? normalized.trim().split("|").map((b) => b.trim()).filter(Boolean).join("\n")
      : normalized;

  const dayBlocks: Partial<Record<Day, TimeBlock[]>> = {};

  for (const rawLine of textToSplit.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const dayPart = line.slice(0, colonIdx).trim();
    const value   = line.slice(colonIdx + 1).trim();
    const days = parseDayRange(dayPart);
    if (days.length === 0) continue;
    if (/^no happy hour$/i.test(value)) {
      for (const day of days) dayBlocks[day] = [];
      continue;
    }
    const timeBlocks: TimeBlock[] = [];
    for (const part of value.split(",")) {
      const tb = parseTimeRange(part.trim());
      if (tb) timeBlocks.push(tb);
    }
    if (timeBlocks.length > 0) {
      for (const day of days) {
        if (!dayBlocks[day]) dayBlocks[day] = [];
        dayBlocks[day]!.push(...timeBlocks);
      }
    }
  }

  for (const [day, blocks] of Object.entries(dayBlocks) as [Day, TimeBlock[]][]) {
    if (!blocks || blocks.length === 0) {
      states[day].noHappyHour = true;
    } else {
      states[day].noHappyHour = false;
      states[day].block1 = blocks[0];
      states[day].block2 = blocks[1] ?? null;
    }
  }

  return states;
}

// ── Classification ─────────────────────────────────────────────────────────────

/**
 * Returns true if the hh_times value cannot be parsed into a meaningful
 * schedule — i.e. it's non-empty but parseHhTimes produces all "No happy hour".
 */
function needsReview(hhTimes: string | null | undefined): boolean {
  if (!hhTimes?.trim()) return false;        // null/empty = valid "no data"
  if (hhTimes.includes("\n")) return false;  // canonical newline format = always safe
  const parsed = parseHhTimes(hhTimes);
  return DAYS.every((d) => parsed[d].noHappyHour);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nhh_times review-flag backfill — ${DRY_RUN ? "DRY RUN (pass --write to apply)" : "WRITE MODE"}\n`);

  // ── Probe: confirm the column exists (only required for --write) ─────────────

  const { error: probeError } = await supabase
    .from("venues")
    .select("hh_times_needs_review")
    .limit(1);

  const columnMissing = !!probeError?.message?.includes("hh_times_needs_review");

  if (columnMissing && !DRY_RUN) {
    console.error("ERROR: Column 'hh_times_needs_review' does not exist.\n");
    console.error("Apply migration 011 first via the Supabase dashboard → SQL Editor:\n");
    console.error(
      "  ALTER TABLE venues\n" +
      "    ADD COLUMN IF NOT EXISTS hh_times_needs_review BOOLEAN NOT NULL DEFAULT FALSE;\n\n" +
      "  CREATE INDEX IF NOT EXISTS venues_hh_times_needs_review_idx\n" +
      "    ON venues (hh_times_needs_review)\n" +
      "    WHERE hh_times_needs_review = TRUE;\n"
    );
    process.exit(1);
  }

  if (columnMissing) {
    console.log("NOTE: Column 'hh_times_needs_review' does not exist yet — dry-run only.\n");
    console.log("Migration SQL to apply in Supabase dashboard → SQL Editor:");
    console.log(
      "  ALTER TABLE venues\n" +
      "    ADD COLUMN IF NOT EXISTS hh_times_needs_review BOOLEAN NOT NULL DEFAULT FALSE;\n\n" +
      "  CREATE INDEX IF NOT EXISTS venues_hh_times_needs_review_idx\n" +
      "    ON venues (hh_times_needs_review)\n" +
      "    WHERE hh_times_needs_review = TRUE;\n"
    );
  }

  // ── Fetch all venues with non-null hh_times ────────────────────────────────

  // When column is missing (dry-run only) we skip the hh_times_needs_review field.
  const selectFields = columnMissing
    ? "id, name, hh_times"
    : "id, name, hh_times, hh_times_needs_review";

  const { data: venues, error: fetchError } = await supabase
    .from("venues")
    .select(selectFields)
    .not("hh_times", "is", null) as unknown as {
      data: Array<{ id: string; name: string; hh_times: string; hh_times_needs_review?: boolean }> | null;
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

  console.log(`Fetched ${venues.length} venues with non-null hh_times.\n`);

  // ── Classify ───────────────────────────────────────────────────────────────

  const toFlag: Array<{ id: string; name: string; hhTimes: string }> = [];
  const alreadyFlagged: Array<{ id: string; name: string }> = [];
  const safe: Array<{ id: string; name: string }> = [];

  for (const venue of venues) {
    if (needsReview(venue.hh_times)) {
      if (venue.hh_times_needs_review) {
        alreadyFlagged.push({ id: venue.id, name: venue.name });
      } else {
        toFlag.push({ id: venue.id, name: venue.name, hhTimes: venue.hh_times });
      }
    } else {
      safe.push({ id: venue.id, name: venue.name });
    }
  }

  console.log(`Needs review (to flag):    ${toFlag.length}`);
  console.log(`Already flagged:           ${alreadyFlagged.length}`);
  console.log(`Safe (parseable):          ${safe.length}`);
  console.log(`─────────────────────────`);
  console.log(`TOTAL:                     ${venues.length}\n`);

  if (toFlag.length > 0) {
    const showCount = Math.min(20, toFlag.length);
    console.log(`── Venues being flagged (first ${showCount}) ─────────────────────────`);
    for (const v of toFlag.slice(0, showCount)) {
      console.log(`  ${v.name}`);
      console.log(`    hh_times: ${v.hhTimes}`);
    }
    if (toFlag.length > showCount) {
      console.log(`  ... and ${toFlag.length - showCount} more`);
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("DRY RUN complete — no changes written.");
    console.log(`Run with --write to flag ${toFlag.length} venue(s).\n`);
    return;
  }

  if (toFlag.length === 0) {
    console.log("Nothing to update.");
    return;
  }

  // ── Apply flags ────────────────────────────────────────────────────────────

  console.log(`Flagging ${toFlag.length} venue(s)...`);

  const ids = toFlag.map((v) => v.id);
  const { error: updateError } = await supabase
    .from("venues")
    .update({ hh_times_needs_review: true })
    .in("id", ids);

  if (updateError) {
    console.error("Update failed:", updateError.message);
    process.exit(1);
  }

  console.log(`\n── Results ────────────────────────────────────────────────`);
  console.log(`  Flagged:           ${toFlag.length}`);
  console.log(`  Already flagged:   ${alreadyFlagged.length}`);
  console.log(`  Safe (untouched):  ${safe.length}`);
  console.log(`\nDone.\n`);
  console.log(`To query flagged venues:`);
  console.log(`  SELECT id, name, hh_times FROM venues WHERE hh_times_needs_review = true ORDER BY name;\n`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
