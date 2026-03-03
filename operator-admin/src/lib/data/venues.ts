/**
 * Server-side venue data helpers for the consumer app.
 *
 * Two paths:
 *   getPublishedVenuesForConsumer() — Supabase (service-role client, bypasses RLS)
 *   getVenuesFromCsv()             — legacy CSV fallback (venues.beta.csv in repo root)
 *
 * Both return ConsumerVenue[], the same shape the static HTML app constructs
 * from loadVenuesFromCSV() in index.html.
 */

import fs from "fs";
import path from "path";
import { createAdminClient } from "@/lib/supabase/server";
import {
  type ConsumerEvent,
  getEventsForConsumerVenues,
} from "@/lib/data/events";

// ─────────────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The venue shape consumed by the consumer UI.
 * Matches the object constructed by loadVenuesFromCSV() in index.html.
 */
export type ConsumerVenue = {
  /** Venue slug (string ID used for lookups, e.g. "kelowna-the-keg") */
  id: string;
  name: string;
  /** Venue category — defaults to "Restaurant" (not stored in DB) */
  type: string;
  city: string;
  /** Neighbourhood / district — defaults to "" (not stored in DB) */
  area: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  phone: string;
  websiteUrl: string;
  menuUrl: string;
  /** Comma-separated payment methods, e.g. "Visa, Cash, Debit" */
  paymentMethods: string;
  happyHourTagline: string;
  /** Parsed weekly HH schedule keyed by day name */
  happyHourWeekly: Record<string, Array<{ start: string; end: string }>>;
  /** Business hours keyed by day name — "H:MM AM - H:MM PM" or "CLOSED" */
  hoursWeekly: Record<string, string>;
  specialsFood: string[];
  specialsDrinks: string[];
  events: ConsumerEvent[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

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
 * Converts a 12-hour time string ("4 PM", "6:30 PM") to 24-hour "HH:MM".
 * Returns null when the string can't be parsed.
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

/** Converts a 24-hour "HH:MM" string to "H:MM AM" / "H:MM PM". */
function hhmmTo12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Expands a day-part string to an array of full day names.
 * Handles single days ("Monday"), ranges ("Monday – Friday"), and "Daily".
 */
function expandDayRange(dayPart: string): Day[] {
  const t = dayPart.trim();
  if (t.toLowerCase() === "daily") return [...DAYS];

  // Range: "Monday – Friday" (EN dash) or "Monday - Friday" (hyphen)
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

  const result: Day[] = [];
  let i = startIdx;
  for (;;) {
    result.push(DAYS[i]);
    if (i === endIdx) break;
    i = (i + 1) % DAYS.length;
  }
  return result;
}

/**
 * Parses the hh_times plain-text weekly schedule into happyHourWeekly.
 *
 * Admin-generated format (one line per day):
 *   "Monday: 4 PM–6 PM, 9 PM–11 PM"
 *   "Sunday: No happy hour"
 *
 * Also handles legacy CSV formats with day ranges:
 *   "Monday – Friday: 4 PM–6 PM"
 */
function parseHhTimes(
  text: string | null
): Record<string, Array<{ start: string; end: string }>> {
  const weekly: Record<string, Array<{ start: string; end: string }>> = {};
  DAYS.forEach((d) => {
    weekly[d] = [];
  });

  if (!text?.trim()) return weekly;

  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    // Find the day/time separator colon — skip colons inside times like "2:30"
    let splitIdx = -1;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === ":") {
        const before = line.substring(0, j).trim();
        const after = line.substring(j + 1).trim();
        if (/\d$/.test(before) && /^\d/.test(after)) continue; // time colon
        splitIdx = j;
        break;
      }
    }
    if (splitIdx === -1) continue;

    const dayPart = line.substring(0, splitIdx).trim();
    const timePart = line.substring(splitIdx + 1).trim();

    if (!timePart || /^no\b/i.test(timePart)) continue;

    const days = expandDayRange(dayPart);

    // Multiple comma-separated slots: "4 PM–6 PM, 9 PM–11 PM"
    for (const slotStr of timePart.split(",").map((s) => s.trim())) {
      const m = slotStr.match(/^(.+?)\s*[\u2013\-]\s*(.+)$/);
      if (!m) continue;
      const start = parse12hToHHMM(m[1].trim());
      const end = parse12hToHHMM(m[2].trim());
      if (start && end) {
        for (const day of days) weekly[day].push({ start, end });
      }
    }
  }

  return weekly;
}

type DbDayHours = { open: string; close: string } | null;

/**
 * Maps the business_hours JSONB column to the hoursWeekly shape.
 * DB keys are lowercase ("monday"); consumer keys are title-case ("Monday").
 */
function mapBusinessHours(
  dbHours: Record<string, DbDayHours> | null
): Record<string, string> {
  const weekly: Record<string, string> = {};
  DAYS.forEach((d) => {
    weekly[d] = "CLOSED";
  });

  if (!dbHours) return weekly;

  for (const [dayLower, slot] of Object.entries(dbHours)) {
    const day =
      dayLower.charAt(0).toUpperCase() + dayLower.slice(1);
    if (!DAYS.includes(day as Day)) continue;
    weekly[day] = slot
      ? `${hhmmTo12h(slot.open)} - ${hhmmTo12h(slot.close)}`
      : "CLOSED";
  }

  return weekly;
}

type SpecialItem = { name: string; price?: string; notes?: string };

/**
 * Parses hh_food_details / hh_drink_details from the DB.
 * DB format: JSON array [{name, price?, notes?}]
 * Falls back to newline-split plain text for legacy/CSV data.
 */
function parseSpecials(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const items = JSON.parse(raw) as SpecialItem[];
    if (!Array.isArray(items))
      return raw.split("\n").map((s) => s.trim()).filter(Boolean);
    return items
      .filter((it) => it?.name)
      .map((it) => {
        let s = it.name;
        if (it.price) s += ` — ${it.price}`;
        if (it.notes) s += ` (${it.notes})`;
        return s;
      });
  } catch {
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  }
}

/** Maps a raw Supabase venue row to ConsumerVenue. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToConsumerVenue(row: Record<string, any>): ConsumerVenue {
  let paymentMethods = "";
  if (row.payment_types) {
    try {
      const parsed: unknown = JSON.parse(row.payment_types as string);
      paymentMethods = Array.isArray(parsed)
        ? (parsed as string[]).join(", ")
        : String(row.payment_types);
    } catch {
      paymentMethods = String(row.payment_types);
    }
  }

  return {
    id: (row.slug as string) ?? "",
    name: (row.name as string) ?? "",
    type: "Restaurant",
    city: (row.city as string) ?? "",
    area: "",
    latitude: typeof row.lat === "number" ? row.lat : null,
    longitude: typeof row.lng === "number" ? row.lng : null,
    address: (row.address_line1 as string) ?? "",
    phone: (row.phone as string) ?? "",
    websiteUrl: (row.website_url as string) ?? "",
    menuUrl: (row.menu_url as string) ?? "",
    paymentMethods,
    happyHourTagline: (row.hh_tagline as string) ?? "",
    happyHourWeekly: parseHhTimes(row.hh_times as string | null),
    hoursWeekly: mapBusinessHours(
      row.business_hours as Record<string, DbDayHours> | null
    ),
    specialsFood: parseSpecials(row.hh_food_details as string | null),
    specialsDrinks: parseSpecials(row.hh_drink_details as string | null),
    events: [], // populated by getPublishedVenuesForConsumer after event fetch
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all published venues from Supabase.
 *
 * Uses the service-role (admin) client to bypass RLS — the consumer app has
 * no authenticated session, and the current "venues: authenticated read" RLS
 * policy requires auth.  A public-read policy will be added in a future
 * migration; until then the service role is the safe server-side option.
 *
 * Returns an empty array on any error so the page never hard-crashes.
 */
export async function getPublishedVenuesForConsumer(): Promise<ConsumerVenue[]> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("venues")
      .select(
        "id, slug, name, address_line1, city, phone, website_url, menu_url, lat, lng, " +
          "payment_types, hh_times, hh_tagline, hh_food_details, hh_drink_details, business_hours"
      )
      .eq("is_published", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[getPublishedVenuesForConsumer] Supabase error:", error);
      return [];
    }

    const rows = data ?? [];

    // Map venue rows to ConsumerVenue (events: [] initially)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const venues = rows.map((row: Record<string, any>) =>
      rowToConsumerVenue(row)
    );

    // Collect DB UUIDs (venues.id) — distinct from the consumer-facing slug
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const venueUuids = rows.map((r: Record<string, any>) => r.id as string);

    // Fetch all published events for these venues in a single query
    const allEvents = await getEventsForConsumerVenues(venueUuids);

    // Build a UUID → venue-array-index map for O(1) attachment
    const uuidToIdx: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.forEach((r: Record<string, any>, i: number) => {
      uuidToIdx[r.id as string] = i;
    });

    for (const event of allEvents) {
      const idx = uuidToIdx[event.venueId];
      if (idx !== undefined) venues[idx].events.push(event);
    }

    return venues;
  } catch (err) {
    console.error("[getPublishedVenuesForConsumer] Unexpected error:", err);
    return [];
  }
}

/**
 * Fetches a single venue by its slug from Supabase, with optional preview.
 *
 * In normal mode (includeUnpublished = false / unset) only published venues
 * are returned.  In preview mode (includeUnpublished = true) unpublished
 * venues are also returned — this is intended for the operator preview flow.
 *
 * Always uses the service-role client to bypass RLS.
 * Returns null on any error or when the venue is not found.
 */
export async function getVenueWithEventsForConsumerById(
  id: string,
  options?: { includeUnpublished?: boolean }
): Promise<ConsumerVenue | null> {
  try {
    const supabase = createAdminClient();
    let query = supabase
      .from("venues")
      .select(
        "id, slug, name, address_line1, city, phone, website_url, menu_url, lat, lng, " +
          "payment_types, hh_times, hh_tagline, hh_food_details, hh_drink_details, business_hours"
      )
      .eq("slug", id);

    if (!options?.includeUnpublished) {
      query = query.eq("is_published", true);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (query as any).maybeSingle();

    if (error) {
      console.error(
        "[getVenueWithEventsForConsumerById] Supabase error:",
        error
      );
      return null;
    }

    if (!data) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = data as Record<string, any>;
    const venue = rowToConsumerVenue(row);

    // Fetch events using the DB UUID (row.id), not the slug
    const venueUuid = row.id as string;
    venue.events = await getEventsForConsumerVenues([venueUuid]);

    return venue;
  } catch (err) {
    console.error(
      "[getVenueWithEventsForConsumerById] Unexpected error:",
      err
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV fallback path
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal RFC-4180 CSV parser sufficient for venues.beta.csv. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        if (ch === "\r") i++;
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  // Flush trailing content
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Reads venues from venues.beta.csv located one level above the Next.js
 * project root (i.e. in the happy-hour-compass repo root).
 *
 * Only used when USE_SUPABASE_VENUES is false.
 */
export function getVenuesFromCsv(): ConsumerVenue[] {
  try {
    const csvPath = path.join(process.cwd(), "..", "venues.beta.csv");
    const csvText = fs.readFileSync(csvPath, "utf-8");
    const rows = parseCSV(csvText);
    if (rows.length < 2) return [];

    const headerIdx = rows.findIndex((r) => r[0].trim() === "id");
    if (headerIdx === -1) return [];

    const headers = rows[headerIdx].map((h) => h.trim());
    const col: Record<string, number> = {};
    headers.forEach((h, i) => {
      col[h] = i;
    });

    const get = (row: string[], name: string) =>
      col[name] !== undefined ? (row[col[name]] ?? "").trim() : "";

    const venues: ConsumerVenue[] = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const id = get(row, "id");
      if (!id) continue;

      venues.push({
        id,
        name: get(row, "name"),
        type: get(row, "type") || "Restaurant",
        city: get(row, "city"),
        area: get(row, "area"),
        latitude: parseFloat(get(row, "latitude")) || null,
        longitude: parseFloat(get(row, "longitude")) || null,
        address: get(row, "address"),
        phone: get(row, "phone"),
        websiteUrl: get(row, "url"),
        menuUrl: get(row, "menu_url"),
        paymentMethods: get(row, "payment_types"),
        happyHourTagline: get(row, "happy_hour_tagline"),
        happyHourWeekly: parseHhTimes(get(row, "happy_hour_times")),
        hoursWeekly: {}, // CSV does not carry business_hours in beta file
        specialsFood: get(row, "happy_hour_food_details")
          ? get(row, "happy_hour_food_details")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        specialsDrinks: get(row, "happy_hour_drink_details")
          ? get(row, "happy_hour_drink_details")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        events: [], // CSV path does not provide structured event data
      });
    }

    return venues;
  } catch (err) {
    console.error("[getVenuesFromCsv] Failed to read CSV:", err);
    return [];
  }
}
