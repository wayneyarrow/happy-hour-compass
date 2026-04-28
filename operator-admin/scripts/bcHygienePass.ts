/**
 * scripts/bcHygienePass.ts
 *
 * Pre-publish data hygiene pass for BC seeded venues.
 *
 * TARGET DATASET:
 *   venues WHERE region = 'BC' AND is_published = false
 *              AND created_by_operator_id IS NULL
 *
 * SAFE WRITES (specials only — with --write flag):
 *   - Trim hh_food_details / hh_drink_details to max 3 items each
 *   - Normalize ALL CAPS item names → sentence case
 *   - Trim whitespace from all item fields
 *   - Remove exact duplicate entries (same name + price + notes)
 *   - Remove entries with empty or blank names
 *
 * READ-ONLY ANALYSIS (no DB writes, always active):
 *   - HH Times: flagged (hh_times_needs_review), missing, malformed
 *   - Potential duplicates: same name+city or same place_id
 *   - Junk / invalid venues: missing geo, blank name, bad address
 *
 * Safety guarantees:
 *   - NEVER modifies hh_times
 *   - NEVER publishes, deletes, or merges any venue
 *   - NEVER touches venues outside the scoped dataset
 *   - Idempotent: running twice leaves data unchanged on second run
 *
 * Run from the operator-admin directory:
 *   npm run hygiene:bc           ← dry-run (no DB writes)
 *   npm run hygiene:bc -- --write ← apply specials normalization
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
const MAX_ITEMS = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

type HhItem = { name: string; price?: string; notes?: string };

type Venue = {
  id: string;
  slug: string;
  name: string;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  hh_times: string | null;
  hh_times_needs_review: boolean;
  hh_food_details: string | null;
  hh_drink_details: string | null;
  place_id: string | null;
  establishment_type: string | null;
};

// ── String normalization helpers ───────────────────────────────────────────────

/**
 * Returns true if the string consists entirely of uppercase alphabetic
 * characters (ignoring non-alpha chars like spaces and punctuation).
 * Strings that are already mixed-case are left alone.
 */
function isAllCaps(s: string): boolean {
  const alpha = s.replace(/[^a-zA-Z]/g, "");
  return (
    alpha.length > 0 &&
    alpha === alpha.toUpperCase() &&
    alpha !== alpha.toLowerCase()
  );
}

/**
 * Converts a string to sentence case: first character uppercase, rest lowercase.
 * Only called when isAllCaps() is true.
 */
function toSentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Normalizes a single HhItem:
 *   - Trims whitespace from all fields
 *   - Converts ALL CAPS name/notes to sentence case
 */
function normalizeItem(item: HhItem): HhItem {
  const normalized: HhItem = { name: item.name.trim() };

  if (item.price !== undefined) {
    const p = item.price.trim();
    if (p) normalized.price = p;
  }
  if (item.notes !== undefined) {
    const n = item.notes.trim();
    if (n) normalized.notes = isAllCaps(n) ? toSentenceCase(n) : n;
  }

  if (isAllCaps(normalized.name)) {
    normalized.name = toSentenceCase(normalized.name);
  }

  return normalized;
}

/**
 * Deduplication key for an HhItem — case-insensitive on name so that
 * "Nachos" and "NACHOS" (before normalization) are treated as the same item.
 */
function dedupKey(item: HhItem): string {
  return `${item.name.toLowerCase().trim()}|||${(item.price ?? "").trim()}|||${(item.notes ?? "").trim()}`;
}

/**
 * Parses raw specials text (JSON or legacy newline-delimited) into HhItem[].
 * Returns null for empty/null input.
 */
function parseSpecials(raw: string | null | undefined): HhItem[] | null {
  if (!raw?.trim()) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          typeof item === "object" && item !== null && typeof item.name === "string"
      )
    ) {
      return parsed as HhItem[];
    }
  } catch {
    // fall through to legacy text
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  return lines.map((l) => ({ name: l.trim() }));
}

function countItems(raw: string | null | undefined): number {
  return parseSpecials(raw)?.length ?? 0;
}

/**
 * Full normalization pipeline for one specials field:
 *   1. Parse
 *   2. Normalize each item (trim + caps fix)
 *   3. Remove entries with empty names
 *   4. Remove exact duplicates
 *   5. Trim to MAX_ITEMS
 *   6. Serialize back to JSON
 *
 * Returns null when the result would be empty (preserves DB NULL).
 * Returns the serialized JSON string for comparison with the stored value.
 */
function normalizeSpecials(raw: string | null | undefined): string | null {
  const items = parseSpecials(raw);
  if (!items) return null;

  const seen = new Set<string>();
  const result: HhItem[] = [];

  for (const item of items) {
    const norm = normalizeItem(item);

    if (!norm.name) continue; // discard blank entries

    const key = dedupKey(norm);
    if (seen.has(key)) continue; // discard exact duplicates
    seen.add(key);

    result.push(norm);
    if (result.length >= MAX_ITEMS) break;
  }

  if (result.length === 0) return null;
  return JSON.stringify(result);
}

// ── HH Times analysis (ported from backfillHhReviewFlag.ts) ──────────────────

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

function parseTimeStr(
  s: string
): { hour: string; minute: string; period: "AM" | "PM" } | null {
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
    const endName = dayPart.slice(dashIdx + 1).trim();
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

  const normalized = text.replace(/[–—−]/g, "-");
  const textToSplit =
    !normalized.trim().includes("\n") && normalized.includes("|")
      ? normalized
          .trim()
          .split("|")
          .map((b) => b.trim())
          .filter(Boolean)
          .join("\n")
      : normalized;

  const dayBlocks: Partial<Record<Day, TimeBlock[]>> = {};

  for (const rawLine of textToSplit.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const dayPart = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
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

/**
 * Returns true for a non-empty hh_times value that cannot be parsed into any
 * meaningful schedule (all 7 days resolve to "No happy hour").
 */
function hhTimesIsMalformed(hhTimes: string | null | undefined): boolean {
  if (!hhTimes?.trim()) return false;
  const parsed = parseHhTimes(hhTimes);
  return DAYS.every((d) => parsed[d].noHappyHour);
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

const DIVIDER = "─".repeat(68);
const BOLD_DIVIDER = "═".repeat(68);

function header(title: string) {
  console.log(`\n${title}`);
  console.log(DIVIDER);
}

function indent(s: string, n = 2) {
  return " ".repeat(n) + s;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD_DIVIDER}`);
  console.log(`  BC Seeded Venues — Pre-Publish Hygiene Pass`);
  console.log(
    `  Mode: ${DRY_RUN ? "DRY RUN (pass --write to apply specials changes)" : "WRITE MODE — specials normalization active"}`
  );
  console.log(BOLD_DIVIDER);

  // ── 1. Fetch target dataset ─────────────────────────────────────────────────

  console.log(
    "\nFetching BC seeded unpublished venues (region=BC, is_published=false, created_by_operator_id IS NULL)…"
  );

  const { data: venues, error: fetchError } = (await supabase
    .from("venues")
    .select(
      "id, slug, name, address_line1, city, region, lat, lng, " +
        "hh_times, hh_times_needs_review, hh_food_details, hh_drink_details, " +
        "place_id, establishment_type"
    )
    .eq("region", "BC")
    .eq("is_published", false)
    .is("created_by_operator_id", null)) as {
    data: Venue[] | null;
    error: { message: string } | null;
  };

  if (fetchError) {
    console.error("ERROR: Could not fetch venues:", fetchError.message);
    process.exit(1);
  }

  const rows = venues ?? [];
  console.log(`Found ${rows.length} venue(s) in target dataset.\n`);

  if (rows.length === 0) {
    console.log("No venues match the criteria. Nothing to do.");
    return;
  }

  // ── 2. Phase A: HH Times analysis (READ-ONLY) ──────────────────────────────

  const hhFlagged: Array<{ name: string; slug: string; hhTimes: string }> = [];
  const hhMalformed: Array<{ name: string; slug: string; hhTimes: string }> = [];
  const hhMissing: Array<{ name: string; slug: string }> = [];

  for (const v of rows) {
    if (v.hh_times_needs_review) {
      hhFlagged.push({
        name: v.name,
        slug: v.slug,
        hhTimes: v.hh_times ?? "(empty)",
      });
    } else if (!v.hh_times?.trim()) {
      hhMissing.push({ name: v.name, slug: v.slug });
    } else if (hhTimesIsMalformed(v.hh_times)) {
      hhMalformed.push({ name: v.name, slug: v.slug, hhTimes: v.hh_times });
    }
  }

  // ── 3. Phase B: Specials normalization ─────────────────────────────────────

  type SpecialsChange = {
    name: string;
    slug: string;
    foodBefore: number;
    foodAfter: number;
    drinkBefore: number;
    drinkAfter: number;
    capsFixed: boolean;
    dupeRemoved: boolean;
    blankRemoved: boolean;
  };

  const venuesNoSpecials: Array<{ name: string; slug: string }> = [];
  const specialsChanges: SpecialsChange[] = [];
  let specialsUpdated = 0;
  let specialsAlreadyClean = 0;
  let specialsErrors = 0;
  let totalItemsRemoved = 0;

  for (const v of rows) {
    const hasFood = !!v.hh_food_details?.trim();
    const hasDrink = !!v.hh_drink_details?.trim();

    if (!hasFood && !hasDrink) {
      venuesNoSpecials.push({ name: v.name, slug: v.slug });
      continue;
    }

    const newFood = normalizeSpecials(v.hh_food_details);
    const newDrink = normalizeSpecials(v.hh_drink_details);

    const foodChanged = newFood !== (v.hh_food_details ?? null);
    const drinkChanged = newDrink !== (v.hh_drink_details ?? null);

    if (!foodChanged && !drinkChanged) {
      specialsAlreadyClean++;
      continue;
    }

    // Collect per-venue change metadata for the report
    const foodBefore = countItems(v.hh_food_details);
    const foodAfter = countItems(newFood);
    const drinkBefore = countItems(v.hh_drink_details);
    const drinkAfter = countItems(newDrink);
    const removed = (foodBefore - foodAfter) + (drinkBefore - drinkAfter);
    totalItemsRemoved += removed;

    // Detect what kind of normalization happened
    const allItems = [
      ...(parseSpecials(v.hh_food_details) ?? []),
      ...(parseSpecials(v.hh_drink_details) ?? []),
    ];
    const capsFixed = allItems.some((item) => isAllCaps(item.name));
    const blankRemoved = allItems.some((item) => !item.name.trim());

    // Dedup detection: check for items with duplicate keys before normalization
    const seenKeys = new Set<string>();
    let dupeRemoved = false;
    for (const item of allItems) {
      const k = dedupKey(item);
      if (seenKeys.has(k)) { dupeRemoved = true; break; }
      seenKeys.add(k);
    }

    specialsChanges.push({
      name: v.name,
      slug: v.slug,
      foodBefore,
      foodAfter,
      drinkBefore,
      drinkAfter,
      capsFixed,
      dupeRemoved,
      blankRemoved,
    });

    if (DRY_RUN) {
      specialsUpdated++;
      continue;
    }

    // Write mode
    const patch: Record<string, string | null> = {};
    if (foodChanged) patch.hh_food_details = newFood;
    if (drinkChanged) patch.hh_drink_details = newDrink;

    const { error: updateError } = await supabase
      .from("venues")
      .update(patch)
      .eq("id", v.id);

    if (updateError) {
      console.error(`  ERROR  ${v.slug}: ${updateError.message}`);
      specialsErrors++;
    } else {
      specialsUpdated++;
    }
  }

  // ── 4. Phase C: Duplicate detection (detect only) ──────────────────────────

  type DuplicateGroup = {
    reason: string;
    venues: Array<{ name: string; slug: string; city: string | null }>;
  };

  const byNameCity = new Map<string, Venue[]>();
  const byPlaceId = new Map<string, Venue[]>();

  for (const v of rows) {
    const nameKey = `${(v.name ?? "").toLowerCase().trim()}|${(v.city ?? "").toLowerCase().trim()}`;
    if (!byNameCity.has(nameKey)) byNameCity.set(nameKey, []);
    byNameCity.get(nameKey)!.push(v);

    if (v.place_id?.trim()) {
      if (!byPlaceId.has(v.place_id)) byPlaceId.set(v.place_id, []);
      byPlaceId.get(v.place_id)!.push(v);
    }
  }

  const duplicateGroups: DuplicateGroup[] = [];

  for (const [key, group] of byNameCity.entries()) {
    if (group.length > 1) {
      const [namePart, cityPart] = key.split("|");
      duplicateGroups.push({
        reason: `Same name + city: "${namePart}" in "${cityPart || "(no city)"}"`,
        venues: group.map((v) => ({ name: v.name, slug: v.slug, city: v.city })),
      });
    }
  }

  for (const [placeId, group] of byPlaceId.entries()) {
    if (group.length > 1) {
      duplicateGroups.push({
        reason: `Same place_id: ${placeId}`,
        venues: group.map((v) => ({ name: v.name, slug: v.slug, city: v.city })),
      });
    }
  }

  // ── 5. Phase D: Junk / invalid detection (detect only) ─────────────────────

  const KNOWN_VENUE_KEYWORDS = [
    "restaurant",
    "bar",
    "pub",
    "lounge",
    "brewery",
    "grill",
    "bistro",
    "tavern",
    "eatery",
    "kitchen",
    "grille",
    "taphouse",
    "tap house",
    "alehouse",
    "ale house",
    "gastropub",
    "cantina",
    "diner",
    "chophouse",
  ];

  type JunkVenue = { name: string; slug: string; issues: string[] };
  const junkVenues: JunkVenue[] = [];

  for (const v of rows) {
    const issues: string[] = [];

    if (!v.name?.trim() || v.name.trim().length < 2) {
      issues.push("Empty or very short name");
    }

    if (v.lat === null || v.lat === undefined || v.lng === null || v.lng === undefined) {
      issues.push("Missing lat/lng");
    } else if (v.lat === 0 && v.lng === 0) {
      issues.push("lat/lng is 0,0 (likely unfilled)");
    }

    if (!v.address_line1?.trim()) {
      issues.push("Missing address_line1");
    }

    if (!v.city?.trim()) {
      issues.push("Missing city");
    }

    if (v.establishment_type) {
      const typeNorm = v.establishment_type.toLowerCase();
      const isKnown = KNOWN_VENUE_KEYWORDS.some((kw) => typeNorm.includes(kw));
      if (!isKnown) {
        issues.push(`Unusual establishment type: "${v.establishment_type}"`);
      }
    }

    if (issues.length > 0) {
      junkVenues.push({ name: v.name, slug: v.slug, issues });
    }
  }

  // ── 6. Print report ─────────────────────────────────────────────────────────

  console.log(`\n${BOLD_DIVIDER}`);
  console.log(`  HYGIENE PASS REPORT — BC Seeded Venues`);
  if (!DRY_RUN) console.log(`  Specials normalization APPLIED`);
  console.log(BOLD_DIVIDER);

  // Summary counts
  header("SUMMARY");
  console.log(indent(`Total venues reviewed             : ${rows.length}`));
  console.log(indent(`hh_times_needs_review (flagged)   : ${hhFlagged.length}`));
  console.log(indent(`Malformed hh_times (unflagged)    : ${hhMalformed.length}`));
  console.log(indent(`Missing hh_times                  : ${hhMissing.length}`));
  console.log(indent(`Venues with no specials           : ${venuesNoSpecials.length}`));
  console.log(indent(`Potential duplicate groups        : ${duplicateGroups.length}`));
  console.log(indent(`Junk / invalid venues             : ${junkVenues.length}`));

  // Specials normalization summary
  header(`SPECIALS CHANGES — ${DRY_RUN ? "DRY RUN (not written)" : "APPLIED"}`);
  console.log(indent(`Venues updated                    : ${specialsUpdated}`));
  console.log(indent(`Venues already clean (skipped)    : ${specialsAlreadyClean}`));
  console.log(indent(`Total items removed               : ${totalItemsRemoved}`));
  if (specialsErrors > 0) {
    console.log(indent(`Errors                            : ${specialsErrors}`));
  }

  if (specialsChanges.length > 0) {
    console.log();
    for (const c of specialsChanges) {
      const tags: string[] = [];
      if (c.foodBefore !== c.foodAfter) tags.push(`food ${c.foodBefore}→${c.foodAfter}`);
      if (c.drinkBefore !== c.drinkAfter) tags.push(`drink ${c.drinkBefore}→${c.drinkAfter}`);
      if (c.capsFixed) tags.push("caps→sentence case");
      if (c.dupeRemoved) tags.push("deduped");
      if (c.blankRemoved) tags.push("blank removed");
      console.log(indent(`${c.name} (${c.slug})`));
      console.log(indent(`  ${tags.join(", ")}`, 4));
    }
  }

  // HH Times — flagged
  if (hhFlagged.length > 0) {
    header(`HH TIMES — FLAGGED (hh_times_needs_review = true) [${hhFlagged.length}]`);
    for (const v of hhFlagged) {
      console.log(indent(`${v.name} (${v.slug})`));
      const display = v.hhTimes.replace(/\n/g, " | ").slice(0, 100);
      console.log(indent(`  ${display}`, 4));
    }
  }

  // HH Times — malformed (not yet flagged)
  if (hhMalformed.length > 0) {
    header(`HH TIMES — MALFORMED, NOT FLAGGED [${hhMalformed.length}]`);
    console.log(indent("These venues have non-empty hh_times that parse to all 'No happy hour'."));
    console.log(indent("Consider running: npm run backfill:hh-review -- --write"));
    console.log();
    for (const v of hhMalformed) {
      console.log(indent(`${v.name} (${v.slug})`));
      const display = v.hhTimes.replace(/\n/g, " | ").slice(0, 100);
      console.log(indent(`  ${display}`, 4));
    }
  }

  // HH Times — missing
  if (hhMissing.length > 0) {
    header(`HH TIMES — MISSING [${hhMissing.length}]`);
    const showCount = Math.min(30, hhMissing.length);
    for (const v of hhMissing.slice(0, showCount)) {
      console.log(indent(`${v.name} (${v.slug})`));
    }
    if (hhMissing.length > showCount) {
      console.log(indent(`… and ${hhMissing.length - showCount} more`));
    }
  }

  // Potential duplicates
  if (duplicateGroups.length > 0) {
    header(`POTENTIAL DUPLICATES — DETECT ONLY, NO ACTION [${duplicateGroups.length} groups]`);
    for (const group of duplicateGroups) {
      console.log(indent(`${group.reason}`));
      for (const v of group.venues) {
        console.log(indent(`  • ${v.name} (${v.slug}) — ${v.city ?? "no city"}`, 4));
      }
      console.log();
    }
  }

  // Junk / invalid
  if (junkVenues.length > 0) {
    header(`JUNK / INVALID — DETECT ONLY, NO ACTION [${junkVenues.length}]`);
    for (const v of junkVenues) {
      console.log(indent(`${v.name} (${v.slug})`));
      for (const issue of v.issues) {
        console.log(indent(`  ! ${issue}`, 4));
      }
    }
  }

  // Venues with no specials (informational only)
  if (venuesNoSpecials.length > 0) {
    header(`VENUES WITH NO SPECIALS (informational) [${venuesNoSpecials.length}]`);
    const showCount = Math.min(30, venuesNoSpecials.length);
    for (const v of venuesNoSpecials.slice(0, showCount)) {
      console.log(indent(`${v.name} (${v.slug})`));
    }
    if (venuesNoSpecials.length > showCount) {
      console.log(indent(`… and ${venuesNoSpecials.length - showCount} more`));
    }
  }

  // Footer
  console.log(`\n${BOLD_DIVIDER}`);
  if (DRY_RUN) {
    console.log(`  DRY RUN complete — no changes written to the database.`);
    if (specialsUpdated > 0) {
      console.log(`  Run with --write to apply ${specialsUpdated} specials update(s).`);
    } else {
      console.log(`  All specials are already clean. No updates needed.`);
    }
  } else {
    const outcome = specialsErrors > 0
      ? `${specialsUpdated} updated, ${specialsErrors} failed.`
      : `${specialsUpdated} updated successfully.`;
    console.log(`  Pass complete — ${outcome}`);
  }
  console.log(BOLD_DIVIDER);
  console.log();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
