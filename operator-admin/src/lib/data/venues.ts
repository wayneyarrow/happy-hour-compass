/**
 * Server-side venue data helpers for the consumer app.
 *
 * All data is loaded from Supabase using the service-role client, which
 * bypasses RLS. The consumer app has no authenticated session; a public-read
 * policy will be added in a future migration.
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  type ConsumerEvent,
  getEventsForConsumerVenues,
} from "@/lib/data/events";
import { resolvePlanCodeFromJoinedField, VENUE_SUBSCRIPTION_JOIN_FRAGMENT } from "@/lib/discover/venuePlanSource";

// ─────────────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────────────

/** A single venue image ordered by sort_order from the media table. */
export type ConsumerVenueImage = {
  url: string;
};

/**
 * The venue shape consumed by the consumer UI.
 * Matches the object constructed by loadVenuesFromCSV() in index.html.
 */
export type ConsumerVenue = {
  /** Venue slug (string ID used for lookups, e.g. "kelowna-the-keg") */
  id: string;
  /**
   * Raw Supabase UUID for this venue row.
   * Used by the Discover Engine to cross-reference rail overrides
   * (discover_rail_overrides.venue_id) and by the Control Panel for mutations.
   * Not rendered in consumer UI.
   */
  venueUuid: string;
  name: string;
  /** Venue category — defaults to "Restaurant" (not stored in DB) */
  type: string;
  /** Operator-selected establishment type, e.g. "Pub", "Cocktail Bar". */
  establishmentType: string;
  /**
   * Assigned seeded placeholder image path (venues.placeholder_image_path,
   * migration 073) — relative path under images/venues/, no leading slash,
   * e.g. "images/venues/pub/venue-pic-pub-4.jpg". Null when no placeholder
   * has been assigned. Only consulted by getVenueImageSrc() when the venue
   * has no uploaded images — see src/lib/venuePlaceholderImage.ts.
   */
  placeholderImagePath: string | null;
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
  /** True if any happy hour food or drink item has a numeric price strictly below $10. */
  hasUnderTenItem: boolean;
  events: ConsumerEvent[];
  /**
   * Ordered venue images from the media table (type = 'venue_image').
   * First element is the hero image. Populated only by single-venue fetches;
   * the list fetch leaves this as [] to avoid N+1 queries on the home page.
   * Future plan limits can be applied by slicing this array before rendering.
   */
  images: ConsumerVenueImage[];
  /**
   * Timestamp (ISO string) when a claim was approved and operator access was
   * granted.  Null means the venue is unclaimed and the claim flow is available.
   * Only populated by single-venue fetches (getVenueWithEventsForConsumerById).
   * List fetches leave this as null to avoid widening the listing query.
   */
  claimedAt: string | null;
  /** Google Maps aggregate rating (e.g. 4.5). Null when not available. */
  googleRating: number | null;
  /** Total number of Google reviews. Null when not available. */
  googleReviewCount: number | null;
  /** Google Places place_id for direct business listing links. Null when not available. */
  placeId: string | null;
  /**
   * True when the venue has been verified through an approved claim or operator
   * submission.  Drives the "Verified Venue ✓" consumer badge.
   */
  isVerified: boolean;
  /**
   * Canonical market slug, joined from venues.market_id -> markets.slug.
   * Null when the venue has no assigned market (see migration
   * 048_geography_foundation_v1.sql — market_id/city_id are nullable by
   * design; backfillVenueGeography.ts only assigns venues whose `city` text
   * field matches a seeded city). A null value means this venue has no
   * canonical public URL under /{market}/{city}/{slug} yet.
   */
  marketSlug: string | null;
  /** Canonical city slug, joined from venues.city_id -> cities.slug. Null under the same conditions as marketSlug. */
  citySlug: string | null;
  /**
   * Operator-selected search tags from the controlled catalog (paid feature).
   * Empty array for free-plan venues and all seeded/imported venues.
   * Powers keyword search matching and the future Discover Page.
   */
  searchTags: string[];
  /**
   * Platform-generated discovery tags from Google Places metadata and HH
   * specials content.  See src/lib/seededTags.ts and migration 032.
   * Empty array until the backfill script has been run.
   */
  seededTags: string[];
  /**
   * Operator-authored editorial description for the public Venue Detail page.
   * NULL/blank → the public "About" section must be hidden entirely.
   * Max 750 characters enforced by the operator admin form.
   */
  aboutYourVenue: string | null;
  /** Optional, short (~one sentence) editorial teaser for Homepage Feature sections (migration 061) — distinct from aboutYourVenue's longer description. Null if not authored; only selected/populated by queries that need it (currently getPublishedVenuesByUuids). */
  teaser: string | null;
  /** ISO timestamp when the venue row was created in Supabase. */
  createdAt: string;
  /** ISO timestamp when the venue row was last updated in Supabase. */
  updatedAt: string;

  // ── Discover Engine controls (migration 033) ────────────────────────────────
  /**
   * Internal ranking boost (0–100).  Higher values increase likelihood of
   * better placement across all discovery rails without bypassing eligibility.
   * Managed by internal team only; no operator UI.
   */
  internalBoost: number;
  /**
   * When true the venue is in the primary Spotlight pool.
   * When false the venue may still appear via the isVerified fallback while
   * the spotlight_eligible pool is being built out.
   */
  spotlightEligible: boolean;
  /**
   * When true the venue is hidden from all Consumer Home rails and browse
   * collections.  Events from an excluded venue are also excluded from
   * Featured Events.
   */
  excludeFromDiscover: boolean;
  /**
   * Phase 2B: this venue's OWN plan tier, joined from venue_subscriptions
   * (not the operator's — a sibling venue under the same operator may hold
   * a different plan). Defaults to "free" when no venue_subscriptions row
   * exists (never on a paid plan) — including all seeded/unclaimed venues,
   * which have no row by construction. Field name kept as `operatorPlan`
   * to avoid a repo-wide rename of every consumer of this type; the value
   * itself is venue-scoped. Used by the Discover Engine for plan-based
   * weighting (not guaranteed placement).
   */
  operatorPlan: "free" | "pro" | "premium" | "enterprise";
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
 * Handles single days ("Monday"), ranges ("Monday – Friday"), "Daily", "Everyday", and "Weekdays".
 */
function expandDayRange(dayPart: string): Day[] {
  const t = dayPart.trim();
  // "Daily" / "Everyday" → all 7 days (matches admin HhTimesForm.parseDayRange)
  if (/^(daily|everyday)$/i.test(t)) return [...DAYS];
  // "Weekdays" → Monday – Friday
  if (/^weekdays?$/i.test(t)) return DAYS.filter((d) => d !== "Saturday" && d !== "Sunday");

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
 * Expands the scraper-seeded compact hh_times format into line-per-day text
 * that parseHhTimes can consume without modification.
 *
 * Scraper compact format (single line, two blocks separated by "|"):
 *   "3pm - 6pm & 8pm - close | 3pm - 5pm & 9pm - close"
 *
 * Assumed day mapping (beta convention, matches Kin and Folk import):
 *   block 0 → Sunday–Thursday
 *   block 1 → Friday–Saturday
 *
 * Within each block, "&" separates time slots (equivalent to "," in admin format).
 */
function expandScraperCompactHhTimes(text: string): string {
  const blocks = text.split("|").map((b) => b.trim());
  const dayGroups: Day[][] = [
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],
    ["Friday", "Saturday"],
  ];
  const lines: string[] = [];
  blocks.forEach((block, i) => {
    if (i >= dayGroups.length) return;
    // Replace "&" with "," so multi-slot parsing in parseHhTimes works as-is
    const slots = block
      .split("&")
      .map((s) => s.trim())
      .join(", ");
    for (const day of dayGroups[i]) {
      lines.push(`${day}: ${slots}`);
    }
  });
  return lines.join("\n");
}

/**
 * Expands the scraper-seeded grouped-day hh_times format into line-per-day text.
 *
 * Grouped-day format (single line, pipe-separated blocks with explicit day labels):
 *   "Sunday–Thursday: 3pm - 6pm & 8pm - close | Friday & Saturday: 3pm - 5pm & 9pm - close"
 *
 * Each block has the form "DaySpec: timeSlots" where:
 *   - DaySpec may be a range ("Sunday–Thursday"), a "&"-joined list ("Friday & Saturday"),
 *     or a single day name.
 *   - timeSlots uses "&" as the slot separator (converted to "," for parseHhTimes).
 */
function expandScraperGroupedHhTimes(text: string): string {
  const lines: string[] = [];
  for (const block of text.split("|").map((b) => b.trim())) {
    const colonIdx = block.indexOf(":");
    if (colonIdx === -1) continue;
    const daySpec = block.substring(0, colonIdx).trim();
    const timeStr = block.substring(colonIdx + 1).trim();
    // Convert "&"-separated slots to "," for parseHhTimes slot splitting
    const slots = timeStr
      .split("&")
      .map((s) => s.trim())
      .join(", ");
    // Day spec may be "&"-joined (e.g. "Friday & Saturday") — expand each part
    for (const part of daySpec.split("&").map((s) => s.trim())) {
      for (const day of expandDayRange(part)) {
        lines.push(`${day}: ${slots}`);
      }
    }
  }
  return lines.join("\n");
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
 *
 * Also handles scraper compact format (single line, pipe-separated blocks):
 *   "3pm - 6pm & 8pm - close | 3pm - 5pm & 9pm - close"
 */
export function parseHhTimes(
  text: string | null
): Record<string, Array<{ start: string; end: string }>> {
  const weekly: Record<string, Array<{ start: string; end: string }>> = {};
  DAYS.forEach((d) => {
    weekly[d] = [];
  });

  if (!text?.trim()) return weekly;

  // Normalize Unicode space variants to ASCII space, strip CR characters, and trim
  // leading/trailing whitespace (including any trailing newline that Supabase appends
  // to text fields).  Without the trim, a trailing \n makes text.includes("\n") true
  // and bypasses the pipe-expansion branch, causing the entire pipe-delimited string
  // to be treated as one malformed line and all days to fall back to "No happy hour".
  text = text.replace(/[\u00A0\u202F\u2009\u2007]/g, " ").replace(/\r/g, "").trim();

  // Scraper format: single line with pipe-separated blocks (no newlines)
  // Grouped-day format has explicit day labels before each block's colon
  // (e.g. "Sunday–Thursday: 3pm - 6pm & 8pm - close | Friday & Saturday: 3pm - 5pm & 9pm - close").
  // Compact format has no day labels (e.g. "3pm - 6pm & 8pm - close | 3pm - 5pm & 9pm - close").
  if (!text.includes("\n") && text.includes("|")) {
    const firstBlock = text.split("|")[0].trim();
    if (/^(sun|mon|tue|wed|thu|fri|sat|daily|everyday|weekday)/i.test(firstBlock)) {
      text = expandScraperGroupedHhTimes(text);
    } else {
      text = expandScraperCompactHhTimes(text);
    }
  }

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

    // Multiple comma- or &-separated slots: "4 PM–6 PM, 9 PM–11 PM" or "4 PM–6 PM & 9 PM–11 PM"
    for (const slotStr of timePart.split(/[,&]/).map((s) => s.trim()).filter(Boolean)) {
      const m = slotStr.match(/^(.+?)\s*[\u2013\-]\s*(.+)$/);
      if (!m) continue;
      const rawStart = m[1].trim();
      const rawEnd = m[2].trim();
      // Import pipeline uses trailing-period notation: "3:00 - 5:00 PM" means 3:00 PM – 5:00 PM.
      // If start has no am/pm suffix but end does, inherit the end's period for the start.
      const startForParse = /\s*(am|pm)\s*$/i.test(rawStart)
        ? rawStart
        : (() => {
            const p = rawEnd.match(/\s*(am|pm)\s*$/i)?.[1];
            return p ? `${rawStart} ${p}` : rawStart;
          })();
      const start = parse12hToHHMM(startForParse);
      const end = parse12hToHHMM(rawEnd);
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
 * Returns true if any item in the raw specials data has a numeric price < 10.
 *
 * Handles three formats — must mirror parseSpecials() so the filter agrees with
 * what the detail page actually renders:
 *   1. JSON object array  [{name, price?, notes?}]  — current admin format
 *   2. JSON string array  ["Wings — $8", ...]       — some enrichment outputs
 *   3. Legacy newline-split plain text               — pre-JSON import data
 */
function rawSpecialsHaveUnderTen(raw: string | null): boolean {
  if (!raw?.trim()) return false;

  // ── JSON path (current format) ───────────────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = JSON.parse(raw) as any[];
    if (Array.isArray(items)) {
      return items.some((it) => {
        if (typeof it === "string") {
          // String item: extract price from "Name — $8" or "Name — 8"
          const m = it.match(/(?:[\u2014\u2013\-]\s*|\$)(\d+(?:\.\d+)?)/);
          return m ? parseFloat(m[1]) < 10 : false;
        }
        // Object item: use String() in case a legacy import stored price as a number
        const price = parseFloat(String((it as SpecialItem).price ?? "").replace(/^\$/, ""));
        return !isNaN(price) && price < 10;
      });
    }
    // Valid JSON but not an array — fall through to plain-text check
  } catch {
    // Not valid JSON — fall through to plain-text check
  }

  // ── Legacy plain-text path (mirrors parseSpecials fallback) ──────────────
  // Items are one per line; prices appear as "Name — 8", "Name — $8 (GF)", etc.
  return raw.split("\n").some((line) => {
    const t = line.trim();
    if (!t) return false;
    // Match a price value after: " — ", " - ", or a leading "$"
    const m = t.match(/(?:[\u2014\u2013\-]\s*|\$)(\d+(?:\.\d+)?)/);
    if (!m) return false;
    return parseFloat(m[1]) < 10;
  });
}

/**
 * Splits plain-text specials by the appropriate delimiter.
 * Scraper-seeded data uses pipe ("|"); legacy data uses newlines.
 */
function splitSpecialsText(raw: string): string[] {
  const delimiter = raw.includes("|") ? "|" : "\n";
  return raw.split(delimiter).map((s) => s.trim()).filter(Boolean);
}

/**
 * Prefixes a bare numeric price string with "$" (e.g. "9" → "$9", "7.25" → "$7.25").
 * Strings already starting with "$" or containing non-numeric content are returned as-is.
 */
function normalizePriceForDisplay(price: string): string {
  return /^\d+(?:\.\d+)?$/.test(price.trim()) ? `$${price.trim()}` : price;
}

/**
 * Applies Title Case to a string only when it contains no uppercase letters.
 * Preserves intentional casing: brand names, acronyms ("IPA", "BBQ"), and
 * already-capitalised items are returned unchanged.
 */
function safeToTitleCase(s: string): string {
  if (s === s.toLowerCase()) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return s;
}

/**
 * Parses hh_food_details / hh_drink_details from the DB.
 * DB formats:
 *   1. JSON object array  [{name, price?, notes?}]  — current admin format
 *   2. JSON string array  ["Wings — $8", ...]       — some enrichment outputs
 *   3. Legacy pipe- or newline-split plain text      — pre-JSON import data
 */
function parseSpecials(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = JSON.parse(raw) as any[];
    if (!Array.isArray(items)) return splitSpecialsText(raw);
    return items
      .filter((it) => it != null)
      .map((it): string | null => {
        // String item (e.g. from some enrichment outputs): normalise casing then use.
        if (typeof it === "string") return safeToTitleCase(it.trim()) || null;
        // Object item: format with optional price and notes.
        // Price is stored as a bare number by the admin form; add "$" for display.
        const obj = it as SpecialItem;
        if (!obj.name) return null;
        let s = safeToTitleCase(obj.name);
        if (obj.price) s += ` — ${normalizePriceForDisplay(obj.price)}`;
        if (obj.notes) s += ` (${obj.notes})`;
        return s;
      })
      .filter((s): s is string => s !== null && s.length > 0);
  } catch {
    return splitSpecialsText(raw).map(safeToTitleCase);
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
    venueUuid: (row.id as string) ?? "",
    name: (row.name as string) ?? "",
    type: "Restaurant",
    establishmentType: (row.establishment_type as string) ?? "Restaurant and Bar",
    placeholderImagePath:
      typeof row.placeholder_image_path === "string" && row.placeholder_image_path.trim()
        ? row.placeholder_image_path
        : null,
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
    hasUnderTenItem:
      rawSpecialsHaveUnderTen(row.hh_food_details as string | null) ||
      rawSpecialsHaveUnderTen(row.hh_drink_details as string | null),
    events: [],  // populated by callers after event fetch
    images: [],  // populated by getVenueWithEventsForConsumerById after image fetch
    claimedAt: (row.claimed_at as string | null) ?? null,
    googleRating: typeof row.google_rating === "number" ? row.google_rating : null,
    googleReviewCount: typeof row.google_review_count === "number" ? row.google_review_count : null,
    placeId: typeof row.place_id === "string" ? row.place_id : null,
    isVerified: row.is_verified === true,
    marketSlug: (row.market_geo as { slug?: string } | null)?.slug ?? null,
    citySlug: (row.city_geo as { slug?: string } | null)?.slug ?? null,
    searchTags: Array.isArray(row.search_tags) ? (row.search_tags as string[]) : [],
    seededTags: Array.isArray(row.seeded_tags) ? (row.seeded_tags as string[]) : [],
    aboutYourVenue: typeof row.about_your_venue === "string" && row.about_your_venue.trim()
      ? row.about_your_venue
      : null,
    teaser: typeof row.teaser === "string" && row.teaser.trim() ? row.teaser : null,
    createdAt: (row.created_at as string) ?? "",
    updatedAt: (row.updated_at as string) ?? "",
    internalBoost: typeof row.internal_boost === "number" ? row.internal_boost : 0,
    spotlightEligible: row.spotlight_eligible === true,
    excludeFromDiscover: row.exclude_from_discover === true,
    // Phase 2B: venue_subscriptions is a nested object from the joined
    // venue_subscriptions table — null when the venue has no row (Free, or
    // never on a paid plan, including every seeded/unclaimed venue).
    operatorPlan: resolvePlanCodeFromJoinedField(
      row.venue_subscriptions as { plan_code?: unknown } | null
    ),
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
          "payment_types, hh_times, hh_tagline, hh_food_details, hh_drink_details, business_hours, " +
          "establishment_type, placeholder_image_path, is_verified, google_rating, google_review_count, search_tags, seeded_tags, created_at, updated_at, " +
          "internal_boost, spotlight_eligible, exclude_from_discover, " +
          // Phase 2B: join this venue's OWN plan (venue_subscriptions), not
          // the operator's — used by Discover Engine for plan-based
          // weighting. No row means Free, including every seeded/unclaimed
          // venue (venue_subscriptions is a nullable outer relationship
          // here, same as the operators join it replaces — a venue with no
          // row is never excluded from the result set).
          `${VENUE_SUBSCRIPTION_JOIN_FRAGMENT}, ` +
          // Canonical market/city slugs for the public /{market}/{city}/{slug}
          // venue URL. Aliased (market_geo/city_geo) to avoid colliding with
          // the plain `city` text column already selected above.
          "market_geo:markets!market_id(slug), city_geo:cities!city_id(slug)"
      )
      .eq("is_published", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[getPublishedVenuesForConsumer] Supabase error:", error);
      return [];
    }

    const rows = data ?? [];

    // Map venue rows to ConsumerVenue (events: [] and images: [] initially)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const venues = rows.map((row: Record<string, any>) =>
      rowToConsumerVenue(row)
    );

    // Collect DB UUIDs (venues.id) — distinct from the consumer-facing slug
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const venueUuids = rows.map((r: Record<string, any>) => r.id as string);

    // Build a UUID → venue-array-index map for O(1) attachment
    const uuidToIdx: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.forEach((r: Record<string, any>, i: number) => {
      uuidToIdx[r.id as string] = i;
    });

    // TODO(HHC Scaling):
    // Current implementation performs one bulk media query using
    // WHERE venue_id IN (...) and selects the first image
    // (sort_order=0 equivalent) per venue.
    //
    // Fine for beta and early launch volumes.
    //
    // If venue counts grow substantially (ex: 1,000+ published venues),
    // consider denormalizing primary_image_url onto venues and updating it
    // whenever images are uploaded, reordered, deleted, or primary changes.
    //
    // Reason:
    // Avoid growing IN clauses and reduce query complexity on consumer listing pages.

    // Fetch events and primary images in parallel — single query each, no N+1.
    // Media ordered by sort_order ASC so the first row per venue_id is the primary image.
    const [allEvents, mediaResult] = await Promise.all([
      getEventsForConsumerVenues(venueUuids),
      venueUuids.length > 0
        ? supabase
            .from("media")
            .select("venue_id, url")
            .in("venue_id", venueUuids)
            .eq("type", "venue_image")
            .order("sort_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    // Attach events
    for (const event of allEvents) {
      const idx = uuidToIdx[event.venueId];
      if (idx !== undefined) venues[idx].events.push(event);
    }

    // Attach primary image (lowest sort_order) per venue to the images array.
    // Because the media query is ordered ASC, the first occurrence of each venue_id
    // is the primary image — subsequent images for the same venue are skipped.
    const primaryByVenueId: Record<string, string> = {};
    for (const m of (mediaResult.data ?? [])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vid = (m as Record<string, any>).venue_id as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const url = (m as Record<string, any>).url as string;
      if (!primaryByVenueId[vid]) primaryByVenueId[vid] = url;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.forEach((r: Record<string, any>, i: number) => {
      const url = primaryByVenueId[r.id as string];
      if (url) venues[i].images = [{ url }];
    });

    return venues;
  } catch (err) {
    console.error("[getPublishedVenuesForConsumer] Unexpected error:", err);
    return [];
  }
}

const VENUE_DETAIL_SELECT =
  "id, slug, name, address_line1, city, phone, website_url, menu_url, lat, lng, " +
  "payment_types, hh_times, hh_tagline, hh_food_details, hh_drink_details, business_hours, " +
  "establishment_type, placeholder_image_path, claimed_at, google_rating, google_review_count, place_id, is_verified, " +
  "search_tags, about_your_venue, updated_at, " +
  // Canonical market/city slugs for the public /{market}/{city}/{slug} venue
  // URL — see ConsumerVenue.marketSlug/citySlug.
  "market_geo:markets!market_id(slug), city_geo:cities!city_id(slug)";

/**
 * Fetches a single venue by route param from Supabase, with optional preview.
 *
 * Resolution order:
 *   1. Try slug lookup (matches the consumer-facing URL format).
 *   2. Fall back to raw id (UUID) lookup for direct / legacy URLs.
 *
 * In normal mode (includeUnpublished = false / unset) only published venues
 * are returned.  In preview mode (includeUnpublished = true) unpublished
 * venues are also returned — this is intended for the operator preview flow.
 *
 * Always uses the service-role client to bypass RLS.
 * Returns null on any error or when the venue is not found.
 */
export async function getVenueWithEventsForConsumerById(
  routeParam: string,
  options?: { includeUnpublished?: boolean }
): Promise<ConsumerVenue | null> {
  try {
    const supabase = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function queryVenue(field: "slug" | "id"): Promise<Record<string, any> | null> {
      let q = supabase
        .from("venues")
        .select(VENUE_DETAIL_SELECT)
        .eq(field, routeParam);
      if (!options?.includeUnpublished) {
        q = q.eq("is_published", true);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (q as any).maybeSingle();
      if (error) {
        console.error(
          `[getVenueWithEventsForConsumerById] Supabase error (${field}):`,
          error
        );
        return null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as Record<string, any>) ?? null;
    }

    const row = (await queryVenue("slug")) ?? (await queryVenue("id"));

    if (!row) return null;

    const venue = rowToConsumerVenue(row);

    // Fetch events and images using the DB UUID (row.id), not the slug
    const venueUuid = row.id as string;

    const [events, imageData] = await Promise.all([
      getEventsForConsumerVenues([venueUuid]),
      supabase
        .from("media")
        .select("url")
        .eq("venue_id", venueUuid)
        .eq("type", "venue_image")
        .order("sort_order", { ascending: true }),
    ]);

    venue.events = events;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    venue.images = (imageData.data ?? []).map((r: Record<string, any>) => ({
      url: r.url as string,
    }));

    return venue;
  } catch (err) {
    console.error(
      "[getVenueWithEventsForConsumerById] Unexpected error:",
      err
    );
    return null;
  }
}

/**
 * Resolves a retired venue slug (venue_slug_history.old_slug) to that
 * venue's CURRENT ConsumerVenue record, for the canonical venue route's
 * permanent-redirect fallback (see (website)/[market]/[city]/[slug]/page.tsx).
 *
 * History resolves to venue_id only, never a "new slug" — the venue's live
 * slug/market/city are always read fresh via
 * getVenueWithEventsForConsumerById, which also enforces the same
 * is_published visibility rule the canonical route already relies on. A null
 * return means "no redirect": the old slug is unknown, or its venue no
 * longer exists / isn't publicly visible.
 */
export async function getVenueByHistoricalSlug(
  oldSlug: string
): Promise<ConsumerVenue | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("venue_slug_history")
      .select("venue_id")
      .eq("old_slug", oldSlug)
      .maybeSingle();

    if (error) {
      console.error("[getVenueByHistoricalSlug] Supabase error:", error);
      return null;
    }
    if (!data) return null;

    return await getVenueWithEventsForConsumerById(data.venue_id as string);
  } catch (err) {
    console.error("[getVenueByHistoricalSlug] Unexpected error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved items preview
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal venue data needed to render a saved-items dropdown row. */
export type VenuePreview = {
  /** Venue UUID — matches the ID stored by savedItems.ts. */
  id: string;
  /** Venue slug — used to build the public URL /{market}/{city}/{slug}. */
  slug: string;
  name: string;
  city: string;
  imageUrl: string | null;
  /** Canonical market slug for the public venue URL. Null if unassigned — see ConsumerVenue.marketSlug. */
  marketSlug: string | null;
  /** Canonical city slug for the public venue URL. Null if unassigned — see ConsumerVenue.citySlug. */
  citySlug: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetches lightweight preview data for a list of venue identifiers.
 *
 * Accepts both UUIDs (current format) and slugs (legacy format from before the
 * UUID migration). UUID-shaped IDs are fetched by `id`; anything else is tried
 * by `slug`. This lets the Saved dropdown display and normalise saved items that
 * were stored before the identifier migration without requiring a manual cache
 * clear. Always returns `id` as the DB UUID so callers can normalise storage.
 */
export async function getVenuePreviewsByIds(
  ids: string[]
): Promise<VenuePreview[]> {
  if (ids.length === 0) return [];
  try {
    const supabase = createAdminClient();

    const uuidIds = ids.filter((id) => UUID_PATTERN.test(id));
    const slugIds = ids.filter((id) => !UUID_PATTERN.test(id));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRows: Record<string, any>[] = [];

    const PREVIEW_SELECT =
      "id, slug, name, city, market_geo:markets!market_id(slug), city_geo:cities!city_id(slug)";

    if (uuidIds.length > 0) {
      const { data } = await supabase
        .from("venues")
        .select(PREVIEW_SELECT)
        .in("id", uuidIds)
        .eq("is_published", true);
      if (data) allRows.push(...data);
    }

    if (slugIds.length > 0) {
      const { data } = await supabase
        .from("venues")
        .select(PREVIEW_SELECT)
        .in("slug", slugIds)
        .eq("is_published", true);
      if (data) allRows.push(...data);
    }

    if (allRows.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uuids = allRows.map((r: Record<string, any>) => r.id as string);

    // Fetch primary image per venue (first by sort_order).
    const { data: mediaRows } = await supabase
      .from("media")
      .select("venue_id, url")
      .in("venue_id", uuids)
      .eq("type", "venue_image")
      .order("sort_order", { ascending: true });

    // Build UUID → first image URL map.
    const imageByUuid: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of (mediaRows ?? []) as Record<string, any>[]) {
      const vid = m.venue_id as string;
      if (!imageByUuid[vid]) imageByUuid[vid] = m.url as string;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return allRows.map((r: Record<string, any>): VenuePreview => ({
      id: r.id as string,
      slug: r.slug as string,
      name: r.name as string,
      city: r.city as string,
      imageUrl: imageByUuid[r.id as string] ?? null,
      marketSlug: (r.market_geo as { slug?: string } | null)?.slug ?? null,
      citySlug: (r.city_geo as { slug?: string } | null)?.slug ?? null,
    }));
  } catch (err) {
    console.error("[getVenuePreviewsByIds] Unexpected error:", err);
    return [];
  }
}

/**
 * Fetches a subset of published venues by their DB UUIDs.
 * Returns ConsumerVenue[] — same shape as getPublishedVenuesForConsumer but
 * scoped to specific IDs. Used by the /saved page to load full card data
 * for saved venues without fetching the entire dataset.
 * Includes primary images; events are not fetched (not needed for card display).
 */
export async function getPublishedVenuesByUuids(
  uuids: string[]
): Promise<ConsumerVenue[]> {
  if (uuids.length === 0) return [];
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("venues")
      .select(
        "id, slug, name, address_line1, city, phone, website_url, menu_url, lat, lng, " +
          "payment_types, hh_times, hh_tagline, hh_food_details, hh_drink_details, business_hours, " +
          "establishment_type, placeholder_image_path, is_verified, google_rating, google_review_count, search_tags, seeded_tags, created_at, " +
          "internal_boost, spotlight_eligible, exclude_from_discover, teaser, " +
          // Phase 2B: this venue's OWN plan (venue_subscriptions), not the
          // operator's — see the other query in this file for full rationale.
          `${VENUE_SUBSCRIPTION_JOIN_FRAGMENT}, ` +
          "market_geo:markets!market_id(slug), city_geo:cities!city_id(slug)"
      )
      .eq("is_published", true)
      .in("id", uuids);

    if (error || !data || data.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const venues = (data as Record<string, any>[]).map(rowToConsumerVenue);

    // Fetch primary image per venue (first by sort_order).
    const { data: mediaRows } = await supabase
      .from("media")
      .select("venue_id, url")
      .in("venue_id", uuids)
      .eq("type", "venue_image")
      .order("sort_order", { ascending: true });

    const primaryByVenueId: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of (mediaRows ?? []) as Record<string, any>[]) {
      const vid = m.venue_id as string;
      if (!primaryByVenueId[vid]) primaryByVenueId[vid] = m.url as string;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data as Record<string, any>[]).forEach((r, i) => {
      const url = primaryByVenueId[r.id as string];
      if (url) venues[i].images = [{ url }];
    });

    return venues;
  } catch (err) {
    console.error("[getPublishedVenuesByUuids] Unexpected error:", err);
    return [];
  }
}
