/**
 * scripts/normalizeHhTimes.ts
 *
 * One-time bulk normalization of pipe-delimited hh_times values into the
 * standard newline/day-by-day format used by Operator Admin.
 *
 * Classification:
 *   AUTO_FIXABLE        — pipe-delimited, every segment has "DayName:" prefix
 *   MANUAL_REVIEW       — pipe-delimited, at least one segment lacks a day label
 *   SKIP                — already in newline format, null, or no pipe chars
 *
 * Run from the operator-admin directory:
 *   npm run normalize:hh-times           ← dry-run (no DB writes)
 *   npm run normalize:hh-times -- --write ← apply updates to Supabase
 *
 * Parsing/generation logic is ported verbatim from
 * src/app/admin/happy-hours/HhTimesForm.tsx — intentionally self-contained
 * so this script can run outside a Next.js request context.
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

const EN_DASH = "\u2013";

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

// ── Ported parser (from HhTimesForm.tsx) ──────────────────────────────────────

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

// ── Ported generator (from HhTimesForm.tsx) ───────────────────────────────────

function formatTime(hour: string, minute: string, period: string): string {
  return minute === "00" ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
}

function formatBlock(b: TimeBlock): string {
  return `${formatTime(b.startHour, b.startMinute, b.startPeriod)}${EN_DASH}${formatTime(b.endHour, b.endMinute, b.endPeriod)}`;
}

function generateHhTimesText(days: Record<Day, DayState>): string {
  return DAYS.map((day) => {
    const s = days[day];
    if (s.noHappyHour) return `${day}: No happy hour`;
    const blocks = [formatBlock(s.block1)];
    if (s.block2) blocks.push(formatBlock(s.block2));
    return `${day}: ${blocks.join(", ")}`;
  }).join("\n");
}

// ── Classification ─────────────────────────────────────────────────────────────

/**
 * AUTO_FIXABLE: no newlines, has pipe separator, every segment has a colon
 * (meaning a day label is present — deterministically convertible).
 */
function classifyHhTimes(hhTimes: string | null): "auto_fixable" | "manual_review" | "skip" {
  if (!hhTimes?.trim()) return "skip";
  if (hhTimes.includes("\n")) return "skip";     // already in newline format
  if (!hhTimes.includes("|")) return "skip";     // neither format — leave alone

  const segments = hhTimes.split("|").map((s) => s.trim()).filter(Boolean);
  const allHaveDayLabel = segments.every((s) => s.includes(":"));
  return allHaveDayLabel ? "auto_fixable" : "manual_review";
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nhh_times normalizer — ${DRY_RUN ? "DRY RUN (pass --write to apply)" : "WRITE MODE"}\n`);

  // Fetch all venues with a pipe char in hh_times.
  // Using ilike with %|% to let Postgres filter before we pull rows.
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, hh_times")
    .like("hh_times", "%|%");

  if (error) {
    console.error("Failed to fetch venues:", error.message);
    process.exit(1);
  }

  if (!venues || venues.length === 0) {
    console.log("No venues with pipe-delimited hh_times found. Nothing to do.");
    return;
  }

  console.log(`Fetched ${venues.length} venues with pipe-delimited hh_times.\n`);

  const autoFixable: Array<{ id: string; name: string; before: string; after: string }> = [];
  const manualReview: Array<{ id: string; name: string; hhTimes: string }> = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  for (const venue of venues) {
    const classification = classifyHhTimes(venue.hh_times);

    if (classification === "skip") {
      skipped.push({ id: venue.id, name: venue.name, reason: "no pipe or already newline-format" });
      continue;
    }

    if (classification === "manual_review") {
      manualReview.push({ id: venue.id, name: venue.name, hhTimes: venue.hh_times });
      continue;
    }

    // AUTO_FIXABLE — transform
    const parsed  = parseHhTimes(venue.hh_times);
    const after   = generateHhTimesText(parsed);

    // Safety: skip if conversion produced all "No happy hour" (parse failure)
    const allEmpty = DAYS.every((d) => parsed[d].noHappyHour);
    if (allEmpty) {
      manualReview.push({
        id: venue.id,
        name: venue.name,
        hhTimes: venue.hh_times + " [NOTE: parse produced all-empty — moved to manual review]",
      });
      continue;
    }

    autoFixable.push({ id: venue.id, name: venue.name, before: venue.hh_times, after });
  }

  // ── Print classification summary ────────────────────────────────────────────

  console.log(`AUTO_FIXABLE:    ${autoFixable.length}`);
  console.log(`MANUAL_REVIEW:   ${manualReview.length}`);
  console.log(`SKIP (no-op):    ${skipped.length}`);
  console.log(`─────────────────────────`);
  console.log(`TOTAL fetched:   ${venues.length}\n`);

  // ── Show before/after examples ──────────────────────────────────────────────

  const exampleCount = Math.min(5, autoFixable.length);
  if (exampleCount > 0) {
    console.log(`── Before/after examples (first ${exampleCount}) ──────────────────────────`);
    for (const ex of autoFixable.slice(0, exampleCount)) {
      console.log(`\n  Venue: ${ex.name} (${ex.id})`);
      console.log(`  BEFORE: ${ex.before}`);
      console.log(`  AFTER:\n${ex.after.split("\n").map((l) => `    ${l}`).join("\n")}`);
    }
    console.log();
  }

  if (manualReview.length > 0) {
    console.log(`── Manual review required (first 10) ──────────────────────────`);
    for (const m of manualReview.slice(0, 10)) {
      console.log(`  ${m.name} (${m.id}): ${m.hhTimes}`);
    }
    if (manualReview.length > 10) {
      console.log(`  ... and ${manualReview.length - 10} more`);
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("DRY RUN complete — no changes written.");
    console.log(`Run with --write to apply ${autoFixable.length} update(s).\n`);
    return;
  }

  // ── Apply updates ──────────────────────────────────────────────────────────

  if (autoFixable.length === 0) {
    console.log("Nothing to update.");
    return;
  }

  console.log(`Applying ${autoFixable.length} update(s)...`);

  let successCount = 0;
  let failCount = 0;
  const failures: Array<{ id: string; name: string; error: string }> = [];

  for (const venue of autoFixable) {
    const { error: updateError } = await supabase
      .from("venues")
      .update({ hh_times: venue.after })
      .eq("id", venue.id);

    if (updateError) {
      failCount++;
      failures.push({ id: venue.id, name: venue.name, error: updateError.message });
    } else {
      successCount++;
    }
  }

  console.log(`\n── Results ────────────────────────────────────────────────`);
  console.log(`  Updated:  ${successCount}`);
  console.log(`  Failed:   ${failCount}`);
  console.log(`  Skipped (manual review): ${manualReview.length}`);
  console.log(`  Skipped (already normalized / no-op): ${skipped.length}`);

  if (failures.length > 0) {
    console.log(`\n── Failures ───────────────────────────────────────────────`);
    for (const f of failures) {
      console.log(`  ${f.name} (${f.id}): ${f.error}`);
    }
  }

  console.log(`\nDone.\n`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
