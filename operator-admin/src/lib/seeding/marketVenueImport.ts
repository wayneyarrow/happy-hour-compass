/**
 * Market-aware seed venue import — planning + draft insertion.
 *
 * Shared by scripts/importMarketVenuesFromCsv.ts (the CLI) and its tests.
 * The CSV uses public.venues column names directly (plus market_slug /
 * city_slug, resolved to market_id / city_id here), so there is no legacy
 * column renaming as in scripts/importVenuesFromCsv.ts.
 *
 * Guarantees (each pinned by tests/unit/seeding/marketVenueImport.test.ts):
 *   • Draft-only: every inserted row has is_published = false and
 *     source = 'seed'. A row asking for is_published = true is rejected.
 *   • Insert-only: never updates or deletes. A row whose slug or Place ID
 *     already exists is skipped and the existing listing is left untouched
 *     (this is what makes re-running the same batch a no-op).
 *   • Geography is resolved, never guessed: market_slug must be an active
 *     market, city_slug a city of that market, and the row's own city text
 *     must resolve (venueGeographyResolver, same rules as Add Your Venue) to
 *     that same city.
 *   • Places storage terms: besides place_id, only google_rating and
 *     google_review_count may carry Google-sourced data — the same two stored
 *     fields every Kelowna seed already displays (Wayne approved storing them
 *     for seeds, 2026-11-14). They must come together, with a place_id and a
 *     google_rating_retrieved_at date, and are validated/rounded exactly as
 *     scripts/backfillGoogleRating.ts does. Every other Google-derived column
 *     (types, Google hours, maps URI, amenity flags, price level, editorial
 *     summary, seeded_tags…) in the CSV header still blocks the whole batch.
 *   • Discovery tags (platform-owned seeded_tags) are generated here from the
 *     row's verified specials with the existing generator (src/lib/seededTags),
 *     Google amenity inputs left unknown — never read from the CSV. The
 *     operator-owned search_tags column is never written (DB default []).
 *   • Duplicates are flagged before any write: Place ID / slug / address /
 *     name collisions within the batch or against existing venues and the
 *     slug history; missing coordinates are flagged (warning).
 *   • Complete, verified weekly business hours are REQUIRED for every seed
 *     row, draft or not: all seven days present (hours, or explicitly
 *     closed as null), business_hours_verified = true, a venue-owned
 *     business_hours_source URL, and every happy hour slot inside that day's
 *     opening hours (a happy hour that starts before the venue opens is a
 *     conflict, not something to infer around). A row failing any of these is
 *     "blocked" in dry run and apply alike, so apply never creates it.
 *   • Map pins need a recorded coordinates_source and must not be a city
 *     centre placeholder.
 *
 * Pure apart from `applyImportPlan`, which writes only through the
 * `VenueInsertStore` it is given.
 */

import { buildCityGeographyLookup, resolveCityGeography, normalizeGeographyText } from "@/lib/geo/venueGeographyResolver";
import { parseHhTimes } from "@/lib/data/venues";
import { generateSeededTags } from "@/lib/seededTags";

// ─────────────────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────────────────

/** Every column the seed CSV may contain (DB column names + two resolver helpers). */
export const SEED_CSV_COLUMNS = [
  "slug", "name", "establishment_type", "address_line1", "city", "region", "postal_code", "country",
  "market_slug", "city_slug", "lat", "lng", "phone", "website_url", "menu_url", "business_hours",
  "hh_times", "hh_tagline", "hh_food_details", "hh_drink_details", "hh_times_needs_review",
  "place_id", "placeholder_image_path", "source", "is_published",
  "google_rating", "google_review_count",
  // Review columns — validated, never written to venues.
  "business_hours_verified", "business_hours_source", "coordinates_source", "google_rating_retrieved_at",
] as const;
export type SeedCsvColumn = (typeof SEED_CSV_COLUMNS)[number];

export const REQUIRED_COLUMNS: readonly SeedCsvColumn[] = [
  "slug", "name", "address_line1", "city", "region", "country", "market_slug", "city_slug",
  "business_hours", "business_hours_verified", "business_hours_source",
];

/** Issue codes that make a row ineligible on business-hours grounds (reported separately from geography). */
export const HOURS_ISSUE_CODES = new Set([
  "hours_missing", "invalid_business_hours", "hours_not_verified", "hours_source_missing",
  "hours_all_closed", "hh_outside_business_hours",
]);
/** Issue codes caused by the city/market assignment (e.g. Step 2 cities not yet applied). */
export const GEOGRAPHY_ISSUE_CODES = new Set([
  "unresolved_city", "city_mismatch", "wrong_market", "unknown_market", "inactive_market", "region_mismatch", "country_mismatch",
]);

/**
 * Google-derived venue columns. Storing these from Places content is the
 * unresolved Places-terms question (place_id alone is permitted indefinitely),
 * so their presence in a seed CSV blocks the batch.
 */
export const GOOGLE_DERIVED_COLUMNS = [
  "google_types", "google_primary_type", "google_business_hours",
  "google_maps_uri", "google_identity_status", "google_identity_reason", "price_level", "editorial_summary",
  "serves_beer", "serves_wine", "serves_cocktails", "outdoor_seating", "live_music", "allows_dogs",
  "good_for_watching_sports", "good_for_groups", "good_for_children", "serves_vegetarian_food",
  "reservable", "accepts_credit_cards", "accepts_cash_only", "seeded_tags",
] as const;

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// CSV parsing (RFC 4180: quoted fields with commas, quotes and newlines)
// ─────────────────────────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export type SeedCsvRow = { rowNumber: number; values: Record<string, string> };

export function readSeedCsv(text: string): { header: string[]; rows: SeedCsvRow[] } {
  const all = parseCsv(text);
  if (all.length === 0) return { header: [], rows: [] };
  const header = all[0].map((h) => h.trim());
  const rows = all.slice(1).map((r, i) => ({
    rowNumber: i + 2, // 1-based, header is row 1
    values: Object.fromEntries(header.map((h, j) => [h, (r[j] ?? "").trim()])),
  }));
  return { header, rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing state the planner checks against
// ─────────────────────────────────────────────────────────────────────────────

export type ExistingMarket = { id: string; slug: string; status: string; country: string | null; province: string | null; center_lat: number | null; center_lng: number | null; radius_km: number | null };
export type ExistingCity = { id: string; slug: string; name: string; market_id: string; status: string; center_lat?: number | null; center_lng?: number | null };
export type ExistingVenue = { id: string; slug: string; name: string; place_id: string | null; address_line1: string | null; city: string | null; is_published: boolean };

export type ExistingState = {
  markets: ExistingMarket[];
  cities: ExistingCity[];
  /** Venues sharing a slug, Place ID, or normalized address/name with any row (the store pre-filters). */
  venues: ExistingVenue[];
  /** venue_slug_history.old_slug values matching any row slug. */
  historicalSlugs: string[];
};

export type ImportOptions = {
  /** The one market this batch is for (CLI --market). Rows for any other market are blocked. */
  marketSlug: string;
  /** Returns true when a placeholder image path exists under public/. Omit to skip the check. */
  placeholderExists?: (relativePath: string) => boolean;
  /** The Operator Admin establishment-type options (ESTABLISHMENT_TYPE_OPTIONS); anything else is refused. */
  establishmentTypes?: readonly string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

export type IssueLevel = "error" | "warning";
export type Issue = { level: IssueLevel; code: string; message: string };

export type VenueInsertRecord = {
  slug: string; name: string; establishment_type: string;
  address_line1: string; city: string; region: string; postal_code: string | null; country: string;
  market_id: string; city_id: string; lat: number | null; lng: number | null;
  phone: string | null; website_url: string | null; menu_url: string | null;
  business_hours: Record<string, { open: string; close: string } | null> | null;
  hh_times: string | null; hh_tagline: string | null; hh_food_details: string | null; hh_drink_details: string | null;
  hh_times_needs_review: boolean; place_id: string | null; placeholder_image_path: string | null;
  google_identity_status: "matched" | "unmatched";
  /** Stored Google rating (0–5, 1 decimal) + review count — read by the existing GoogleRatingBadge. */
  google_rating: number | null; google_review_count: number | null;
  /** Platform-owned discovery tags generated from the verified specials. */
  seeded_tags: string[];
  source: "seed"; is_published: false;
};

export type RowDecision = "insert" | "skip_existing" | "blocked";

export type RowPlan = {
  rowNumber: number;
  slug: string;
  name: string;
  decision: RowDecision;
  issues: Issue[];
  /** Present only when decision === "insert". */
  record?: VenueInsertRecord;
  /** Existing listing this row matched (skip_existing), left untouched. */
  existingVenue?: { id: string; slug: string; name: string; matchedOn: "place_id" | "slug" };
  summary: { city: string; hhDays: string[]; foodItems: number; drinkItems: number; hasCoordinates: boolean };
  /** Business-hours eligibility and geography status, reported separately. */
  eligibility: {
    businessHours: "eligible" | "ineligible";
    businessHoursReasons: string[];
    geography: "resolved" | "blocked";
    geographyReasons: string[];
  };
};

export type ImportPlan = {
  marketSlug: string;
  headerIssues: Issue[];
  rows: RowPlan[];
  counts: Record<RowDecision, number>;
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const US_PHONE_RE = /^\(\d{3}\) \d{3}-\d{4}$/;

export function normalizeAddressKey(address: string | null | undefined, city: string | null | undefined): string {
  const a = normalizeGeographyText(address)
    .replace(/[.,#]/g, " ")
    .replace(/\b(suite|ste|unit|upper level|level)\b.*$/, "")
    .replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave").replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr").replace(/\bhighway\b/g, "hwy").replace(/\broad\b/g, "rd")
    .replace(/\bsouth\b/g, "s").replace(/\bnorth\b/g, "n").replace(/\beast\b/g, "e").replace(/\bwest\b/g, "w")
    .replace(/\s+/g, " ").trim();
  return a ? `${a}|${normalizeGeographyText(city)}` : "";
}

export function normalizeNameKey(name: string | null | undefined, city: string | null | undefined): string {
  const n = normalizeGeographyText(name).replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
  return n ? `${n}|${normalizeGeographyText(city)}` : "";
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function parseUrl(raw: string, issues: Issue[], field: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
    return raw;
  } catch {
    issues.push({ level: "error", code: "invalid_url", message: `${field} is not a valid http(s) URL` });
    return null;
  }
}

function parseSpecials(raw: string, field: string, issues: Issue[]): { json: string | null; count: number } {
  if (!raw) return { json: null, count: 0 };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    issues.push({ level: "error", code: "invalid_specials", message: `${field} is not valid JSON` });
    return { json: null, count: 0 };
  }
  if (!Array.isArray(parsed)) {
    issues.push({ level: "error", code: "invalid_specials", message: `${field} must be a JSON array of {name, price?, notes?}` });
    return { json: null, count: 0 };
  }
  if (parsed.length > 3) issues.push({ level: "error", code: "too_many_specials", message: `${field} has ${parsed.length} items (max 3)` });
  const items: { name: string; price?: string; notes?: string }[] = [];
  parsed.forEach((it, i) => {
    const o = it as Record<string, unknown>;
    const extra = it && typeof it === "object" ? Object.keys(o).filter((k) => !["name", "price", "notes"].includes(k)) : [];
    if (!it || typeof it !== "object" || typeof o.name !== "string" || !o.name.trim() || extra.length) {
      issues.push({ level: "error", code: "invalid_specials", message: `${field}[${i}] needs a non-empty name and only name/price/notes` });
      return;
    }
    if (o.price !== undefined && (typeof o.price !== "string" || !PRICE_RE.test(o.price))) {
      issues.push({ level: "error", code: "invalid_price", message: `${field}[${i}] price must be a plain number string like "12" or "9.50"` });
      return;
    }
    if (o.notes !== undefined && typeof o.notes !== "string") {
      issues.push({ level: "error", code: "invalid_specials", message: `${field}[${i}] notes must be a string` });
      return;
    }
    items.push({ name: o.name.trim(), ...(o.price ? { price: o.price } : {}), ...(o.notes ? { notes: (o.notes as string).trim() } : {}) });
  });
  return { json: items.length ? JSON.stringify(items) : null, count: items.length };
}

function parseBusinessHours(raw: string, issues: Issue[]): VenueInsertRecord["business_hours"] {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    issues.push({ level: "error", code: "invalid_business_hours", message: "business_hours is not valid JSON" });
    return null;
  }
  const o = parsed as Record<string, unknown>;
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(o) : null;
  if (!keys || keys.length !== 7 || !DAYS.every((d) => d in o)) {
    issues.push({ level: "error", code: "invalid_business_hours", message: "business_hours must have exactly monday…sunday keys" });
    return null;
  }
  const out: Record<string, { open: string; close: string } | null> = {};
  for (const d of DAYS) {
    const v = o[d] as { open?: unknown; close?: unknown } | null;
    if (v === null) { out[d] = null; continue; }
    if (!v || typeof v.open !== "string" || typeof v.close !== "string" || !HHMM_RE.test(v.open) || !HHMM_RE.test(v.close)) {
      issues.push({ level: "error", code: "invalid_business_hours", message: `business_hours.${d} must be null or {open,close} in HH:MM` });
      return null;
    }
    if (v.open === v.close) {
      issues.push({ level: "error", code: "invalid_business_hours", message: `business_hours.${d} opens and closes at the same time` });
      return null;
    }
    out[d] = { open: v.open, close: v.close };
  }
  if (DAYS.every((d) => out[d] === null)) {
    issues.push({ level: "error", code: "hours_all_closed", message: "business_hours marks every day closed" });
    return null;
  }
  return out;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Every happy hour slot must sit inside that day's opening hours (overnight closes wrap past midnight). */
function checkHhWithinBusinessHours(
  hhTimes: string,
  hours: NonNullable<VenueInsertRecord["business_hours"]>,
  issues: Issue[]
) {
  const weekly = parseHhTimes(hhTimes);
  for (const [day, slots] of Object.entries(weekly)) {
    const bh = hours[day.toLowerCase()];
    for (const slot of slots) {
      if (!bh) {
        issues.push({ level: "error", code: "hh_outside_business_hours", message: `${day}: happy hour ${slot.start}–${slot.end} but the venue is marked closed` });
        continue;
      }
      const open = toMin(bh.open);
      let close = toMin(bh.close);
      if (close <= open) close += 1440;
      const start = toMin(slot.start);
      let end = toMin(slot.end);
      if (end <= start) end += 1440;
      if (start < open || end > close) {
        issues.push({ level: "error", code: "hh_outside_business_hours", message: `${day}: happy hour ${slot.start}–${slot.end} falls outside opening hours ${bh.open}–${bh.close}` });
      }
    }
  }
}

/** Validates hh_times line by line with the app's own parser; returns the days with a slot. */
function validateHhTimes(raw: string, issues: Issue[]): string[] {
  if (!raw) return [];
  for (const line of raw.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const slots = Object.values(parseHhTimes(line)).some((s) => s.length > 0);
    if (!slots) issues.push({ level: "error", code: "unparseable_hh_times", message: `hh_times line not understood by the app: "${line}"` });
  }
  const weekly = parseHhTimes(raw);
  return Object.entries(weekly).filter(([, s]) => s.length > 0).map(([d]) => d);
}

/** Same validation/rounding as scripts/backfillGoogleRating.ts parseRating/parseReviewCount. */
function parseGoogleRating(g: (c: SeedCsvColumn) => string, placeId: string | null, issues: Issue[]): { rating: number | null; count: number | null } {
  const rRaw = g("google_rating"), cRaw = g("google_review_count");
  if (!rRaw && !cRaw) return { rating: null, count: null };
  const rating = Number(rRaw), count = Number(cRaw);
  let ok = true;
  if (!rRaw || !cRaw) { issues.push({ level: "error", code: "invalid_google_rating", message: "google_rating and google_review_count must be set together" }); ok = false; }
  if (rRaw && (!Number.isFinite(rating) || rating < 0 || rating > 5)) { issues.push({ level: "error", code: "invalid_google_rating", message: "google_rating must be a number from 0 to 5" }); ok = false; }
  if (cRaw && (!Number.isInteger(count) || count < 0)) { issues.push({ level: "error", code: "invalid_google_rating", message: "google_review_count must be a non-negative whole number" }); ok = false; }
  if (!placeId) { issues.push({ level: "error", code: "invalid_google_rating", message: "a Google rating needs the place_id it was read from" }); ok = false; }
  if (!/^\d{4}-\d{2}-\d{2}/.test(g("google_rating_retrieved_at"))) { issues.push({ level: "error", code: "invalid_google_rating", message: "google_rating_retrieved_at (ISO date) is required with a Google rating" }); ok = false; }
  if (!ok) return { rating: null, count: null };
  return { rating: Math.round(rating * 10) / 10, count };
}

function parseBool(raw: string, field: string, issues: Issue[], fallback: boolean): boolean {
  if (!raw) return fallback;
  const v = raw.toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  issues.push({ level: "error", code: "invalid_boolean", message: `${field} must be true or false` });
  return fallback;
}

function parseCoord(raw: string, field: string, min: number, max: number, issues: Issue[]): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    issues.push({ level: "error", code: "invalid_coordinates", message: `${field} must be a number between ${min} and ${max}` });
    return null;
  }
  return n;
}

export function planImport(
  header: string[],
  rows: SeedCsvRow[],
  existing: ExistingState,
  options: ImportOptions
): ImportPlan {
  const headerIssues: Issue[] = [];
  const allowed = new Set<string>(SEED_CSV_COLUMNS);
  const google = new Set<string>(GOOGLE_DERIVED_COLUMNS);
  for (const h of header) {
    if (google.has(h)) headerIssues.push({ level: "error", code: "google_derived_column", message: `Column "${h}" holds Google-derived data — omitted until the Places storage terms are resolved` });
    else if (!allowed.has(h)) headerIssues.push({ level: "error", code: "unknown_column", message: `Column "${h}" is not a supported seed column` });
  }
  for (const r of REQUIRED_COLUMNS) {
    if (!header.includes(r)) headerIssues.push({ level: "error", code: "missing_column", message: `Required column "${r}" is missing` });
  }
  const headerBlocks = headerIssues.some((i) => i.level === "error");

  const market = existing.markets.find((m) => m.slug === options.marketSlug) ?? null;
  const citiesInMarket = market ? existing.cities.filter((c) => c.market_id === market.id) : [];
  const lookup = buildCityGeographyLookup(
    existing.cities,
    existing.markets.map((m) => ({ id: m.id, province: m.province ?? "", slug: m.slug }))
  );

  const bySlug = new Map(existing.venues.map((v) => [v.slug, v]));
  const byPlaceId = new Map(existing.venues.filter((v) => v.place_id).map((v) => [v.place_id as string, v]));
  const byAddress = new Map(existing.venues.map((v) => [normalizeAddressKey(v.address_line1, v.city), v]).filter(([k]) => k) as [string, ExistingVenue][]);
  const byName = new Map(existing.venues.map((v) => [normalizeNameKey(v.name, v.city), v]).filter(([k]) => k) as [string, ExistingVenue][]);
  const history = new Set(existing.historicalSlugs);

  // Within-batch duplicate detection (first occurrence wins; later ones blocked).
  const seen = { slug: new Map<string, number>(), place: new Map<string, number>(), address: new Map<string, number>(), name: new Map<string, number>() };

  const planned: RowPlan[] = rows.map((row) => {
    const g = (c: SeedCsvColumn) => row.values[c] ?? "";
    const issues: Issue[] = [];
    const slug = g("slug");
    const name = g("name");
    const cityText = g("city");

    if (headerBlocks) issues.push({ level: "error", code: "header_invalid", message: "Batch header is invalid — no row is imported" });
    // Hours columns are reported by their own codes (hours_missing / hours_not_verified / hours_source_missing).
    const HOURS_COLUMNS = new Set<string>(["business_hours", "business_hours_verified", "business_hours_source"]);
    for (const c of REQUIRED_COLUMNS) if (!HOURS_COLUMNS.has(c) && !g(c)) issues.push({ level: "error", code: "missing_value", message: `${c} is required` });
    if (slug && !SLUG_RE.test(slug)) issues.push({ level: "error", code: "invalid_slug", message: "slug must be lowercase letters, digits and single dashes" });

    // Draft-only + provenance.
    if (parseBool(g("is_published"), "is_published", issues, false)) {
      issues.push({ level: "error", code: "publish_not_allowed", message: "This importer only creates drafts — is_published must be false" });
    }
    if (g("source") && g("source") !== "seed") issues.push({ level: "error", code: "invalid_source", message: `source must be "seed" (got "${g("source")}")` });

    // Market / city.
    let marketId: string | null = null;
    let cityId: string | null = null;
    if (g("market_slug") && g("market_slug") !== options.marketSlug) {
      issues.push({ level: "error", code: "wrong_market", message: `market_slug "${g("market_slug")}" is not this batch's market (${options.marketSlug})` });
    } else if (!market) {
      issues.push({ level: "error", code: "unknown_market", message: `Market "${options.marketSlug}" does not exist` });
    } else if (market.status !== "active") {
      issues.push({ level: "error", code: "inactive_market", message: `Market "${market.slug}" is ${market.status}` });
    } else {
      marketId = market.id;
      const city = citiesInMarket.find((c) => c.slug === g("city_slug"));
      if (!city) {
        issues.push({ level: "error", code: "unresolved_city", message: `city_slug "${g("city_slug")}" is not a city of ${market.slug} — apply the city roster first` });
      } else {
        cityId = city.id;
        if (city.status !== "active") issues.push({ level: "warning", code: "inactive_city", message: `City ${city.slug} is ${city.status}` });
        const resolved = resolveCityGeography({ city: cityText, province: g("region") }, lookup);
        if (!resolved) {
          issues.push({ level: "error", code: "unresolved_city", message: `city "${cityText}" (${g("region")}) does not resolve to a seeded city` });
        } else if (resolved.cityId !== city.id) {
          issues.push({ level: "error", code: "city_mismatch", message: `city "${cityText}" resolves to ${resolved.matchedCityName}, not city_slug ${city.slug}` });
        } else if (resolved.matchedCityName !== cityText) {
          issues.push({ level: "warning", code: "city_text_alias", message: `city "${cityText}" is an alias of ${resolved.matchedCityName} — store the real city name` });
        }
      }
      if (market.province && g("region") && normalizeGeographyText(g("region")) !== normalizeGeographyText(market.province)) {
        issues.push({ level: "error", code: "region_mismatch", message: `region must be ${market.province}` });
      }
      if (market.country && g("country") && g("country") !== market.country) {
        issues.push({ level: "error", code: "country_mismatch", message: `country must be "${market.country}" (got "${g("country")}")` });
      }
    }

    // Coordinates.
    const lat = parseCoord(g("lat"), "lat", -90, 90, issues);
    const lng = parseCoord(g("lng"), "lng", -180, 180, issues);
    if ((lat === null) !== (lng === null)) issues.push({ level: "error", code: "invalid_coordinates", message: "lat and lng must both be set or both blank" });
    const hasCoordinates = lat !== null && lng !== null;
    if (hasCoordinates) {
      if (!g("coordinates_source")) issues.push({ level: "error", code: "coordinates_source_missing", message: "coordinates_source is required when lat/lng are set" });
      const rowCity = citiesInMarket.find((c) => c.slug === g("city_slug"));
      if (rowCity?.center_lat != null && rowCity.center_lng != null && haversineKm(rowCity.center_lat, rowCity.center_lng, lat as number, lng as number) < 0.025) {
        issues.push({ level: "error", code: "pin_is_city_centre", message: `lat/lng is the ${rowCity.slug} city centre, not the venue's address` });
      }
    }
    if (!hasCoordinates) {
      issues.push({ level: "warning", code: "missing_coordinates", message: "No coordinates — draft can't publish (Venue location) and has no map pin" });
    } else if (market?.center_lat != null && market.center_lng != null && market.radius_km != null) {
      const km = haversineKm(market.center_lat, market.center_lng, lat as number, lng as number);
      if (km > market.radius_km) issues.push({ level: "warning", code: "beyond_market_radius", message: `${km.toFixed(1)} km from the market centre (radius ${market.radius_km} km) — listed by assignment, check the location` });
    }

    // Content.
    const hhDays = validateHhTimes(g("hh_times"), issues);
    if (!g("hh_times")) issues.push({ level: "warning", code: "missing_hh_times", message: "No happy hour times — draft can't publish until confirmed" });
    const food = parseSpecials(g("hh_food_details"), "hh_food_details", issues);
    const drink = parseSpecials(g("hh_drink_details"), "hh_drink_details", issues);
    if (food.count + drink.count === 0) issues.push({ level: "warning", code: "no_specials", message: "No happy hour food or drink offers" });
    const businessHours = parseBusinessHours(g("business_hours"), issues);
    if (!g("business_hours")) issues.push({ level: "error", code: "hours_missing", message: "Complete weekly business hours are required (all 7 days: hours or closed)" });
    if (g("business_hours_verified").toLowerCase() !== "true") {
      issues.push({ level: "error", code: "hours_not_verified", message: "business_hours_verified must be true — missing, conflicting or inferred hours are held" });
    }
    const hourSources = g("business_hours_source").split(/\s*;\s*/).filter(Boolean);
    if (!hourSources.length || hourSources.some((u) => !/^https?:\/\/\S+$/.test(u))) {
      issues.push({ level: "error", code: "hours_source_missing", message: "business_hours_source must be the venue-owned URL(s) the hours came from" });
    }
    if (businessHours && g("hh_times")) checkHhWithinBusinessHours(g("hh_times"), businessHours, issues);
    const website = parseUrl(g("website_url"), issues, "website_url");
    const menu = parseUrl(g("menu_url"), issues, "menu_url");
    const needsReview = parseBool(g("hh_times_needs_review"), "hh_times_needs_review", issues, false);
    if (g("phone") && !US_PHONE_RE.test(g("phone"))) issues.push({ level: "warning", code: "phone_format", message: `phone "${g("phone")}" is not (ddd) ddd-dddd` });
    if (g("postal_code") && g("country") === "US" && !/^\d{5}(-\d{4})?$/.test(g("postal_code"))) {
      issues.push({ level: "error", code: "invalid_postal_code", message: "postal_code must be a US ZIP" });
    }
    const placeholder = g("placeholder_image_path");
    if (placeholder) {
      if (!/^images\/venues\/[a-z-]+\/[\w.-]+\.(jpg|jpeg|png|webp)$/.test(placeholder)) {
        issues.push({ level: "error", code: "invalid_placeholder", message: "placeholder_image_path must be images/venues/<category>/<file>" });
      } else if (options.placeholderExists && !options.placeholderExists(placeholder)) {
        issues.push({ level: "error", code: "invalid_placeholder", message: `placeholder image not found: public/${placeholder}` });
      }
    } else {
      issues.push({ level: "warning", code: "no_image", message: "No placeholder image assigned" });
    }
    const type = g("establishment_type") || "Restaurant and Bar";
    if (options.establishmentTypes && !options.establishmentTypes.includes(type)) {
      issues.push({ level: "error", code: "unknown_establishment_type", message: `establishment_type "${type}" is not an Operator Admin option` });
    }

    // Duplicates — against existing listings (skip, untouched) and within the batch (block).
    const placeId = g("place_id") || null;
    const googleRating = parseGoogleRating(g, placeId, issues);
    let existingVenue: RowPlan["existingVenue"];
    if (placeId && byPlaceId.has(placeId)) {
      const v = byPlaceId.get(placeId)!;
      existingVenue = { id: v.id, slug: v.slug, name: v.name, matchedOn: "place_id" };
      issues.push({ level: "warning", code: "duplicate_place_id", message: `Place ID already belongs to "${v.name}" (${v.slug}) — existing listing left untouched` });
      if (v.slug !== slug && bySlug.has(slug)) issues.push({ level: "error", code: "slug_conflict", message: `slug ${slug} also belongs to another venue` });
    } else if (slug && bySlug.has(slug)) {
      const v = bySlug.get(slug)!;
      if (placeId && v.place_id && v.place_id !== placeId) {
        issues.push({ level: "error", code: "slug_conflict", message: `slug ${slug} belongs to a different place ("${v.name}")` });
      } else {
        existingVenue = { id: v.id, slug: v.slug, name: v.name, matchedOn: "slug" };
        issues.push({ level: "warning", code: "duplicate_slug", message: `slug already exists ("${v.name}") — existing listing left untouched` });
      }
    }
    if (!existingVenue) {
      if (slug && history.has(slug)) issues.push({ level: "error", code: "slug_in_history", message: `slug ${slug} is a former slug of another venue (redirects there)` });
      const addrKey = normalizeAddressKey(g("address_line1"), cityText);
      const addrHit = addrKey ? byAddress.get(addrKey) : undefined;
      if (addrHit) issues.push({ level: "error", code: "address_conflict", message: `Same address as existing "${addrHit.name}" (${addrHit.slug}) with a different Place ID/slug` });
      const nameKey = normalizeNameKey(name, cityText);
      const nameHit = nameKey ? byName.get(nameKey) : undefined;
      if (nameHit) issues.push({ level: "error", code: "name_conflict", message: `An existing venue in ${cityText} has the same name ("${nameHit.name}", ${nameHit.slug})` });
    }
    const batchChecks: [keyof typeof seen, string, string][] = [
      ["slug", slug, "slug"],
      ["place", placeId ?? "", "Place ID"],
      ["address", normalizeAddressKey(g("address_line1"), cityText), "address"],
      ["name", normalizeNameKey(name, cityText), "name + city"],
    ];
    for (const [k, key, label] of batchChecks) {
      if (!key) continue;
      const first = seen[k].get(key);
      if (first !== undefined) issues.push({ level: "error", code: "duplicate_in_batch", message: `Same ${label} as row ${first} in this batch` });
      else seen[k].set(key, row.rowNumber);
    }

    const hasError = issues.some((i) => i.level === "error");
    const decision: RowDecision = hasError ? "blocked" : existingVenue ? "skip_existing" : "insert";
    const summary = { city: cityText, hhDays, foodItems: food.count, drinkItems: drink.count, hasCoordinates };
    const hoursReasons = issues.filter((i) => i.level === "error" && HOURS_ISSUE_CODES.has(i.code)).map((i) => i.message);
    const geoReasons = issues.filter((i) => i.level === "error" && GEOGRAPHY_ISSUE_CODES.has(i.code)).map((i) => i.message);
    const eligibility: RowPlan["eligibility"] = {
      businessHours: hoursReasons.length ? "ineligible" : "eligible",
      businessHoursReasons: hoursReasons,
      geography: geoReasons.length ? "blocked" : "resolved",
      geographyReasons: geoReasons,
    };

    if (decision !== "insert") return { rowNumber: row.rowNumber, slug, name, decision, issues, existingVenue, summary, eligibility };

    const record: VenueInsertRecord = {
      slug, name, establishment_type: type,
      address_line1: g("address_line1"), city: cityText, region: g("region"), postal_code: g("postal_code") || null,
      country: g("country"), market_id: marketId as string, city_id: cityId as string, lat, lng,
      phone: g("phone") || null, website_url: website, menu_url: menu, business_hours: businessHours,
      hh_times: g("hh_times") || null, hh_tagline: g("hh_tagline") || null,
      hh_food_details: food.json, hh_drink_details: drink.json, hh_times_needs_review: needsReview,
      place_id: placeId, placeholder_image_path: placeholder || null,
      google_identity_status: placeId ? "matched" : "unmatched",
      google_rating: googleRating.rating, google_review_count: googleRating.count,
      // Specials-only: Google amenity flags are unknown for seeds, so no Patio/Group/… tags.
      seeded_tags: generateSeededTags({
        outdoor_seating: null, live_music: null, good_for_watching_sports: null, good_for_children: null,
        good_for_groups: null, allows_dogs: null, serves_vegetarian_food: null,
        hh_food_details: food.json, hh_drink_details: drink.json,
      }),
      source: "seed", is_published: false,
    };
    return { rowNumber: row.rowNumber, slug, name, decision, issues, record, summary, eligibility };
  });

  const counts: Record<RowDecision, number> = { insert: 0, skip_existing: 0, blocked: 0 };
  for (const p of planned) counts[p.decision]++;
  return { marketSlug: options.marketSlug, headerIssues, rows: planned, counts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Applying (draft inserts only)
// ─────────────────────────────────────────────────────────────────────────────

export type InsertResult = { ok: true; id: string } | { ok: false; uniqueViolation: boolean; message: string };

/** The only write surface the importer has: one INSERT per venue. No update/delete exists. */
export interface VenueInsertStore {
  insertVenue(record: VenueInsertRecord): Promise<InsertResult>;
}

export type ApplyResult = { rowNumber: number; slug: string; outcome: "inserted" | "skipped" | "blocked" | "failed"; id?: string; message?: string };

export async function applyImportPlan(plan: ImportPlan, store: VenueInsertStore): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const row of plan.rows) {
    if (row.decision === "blocked") { results.push({ rowNumber: row.rowNumber, slug: row.slug, outcome: "blocked" }); continue; }
    if (row.decision === "skip_existing" || !row.record) { results.push({ rowNumber: row.rowNumber, slug: row.slug, outcome: "skipped", message: "already exists — untouched" }); continue; }
    // Belt and braces: the planner already guarantees these.
    if (row.record.is_published !== false || row.record.source !== "seed") throw new Error(`refusing non-draft insert for ${row.slug}`);
    const res = await store.insertVenue(row.record);
    if (res.ok) results.push({ rowNumber: row.rowNumber, slug: row.slug, outcome: "inserted", id: res.id });
    else if (res.uniqueViolation) results.push({ rowNumber: row.rowNumber, slug: row.slug, outcome: "skipped", message: `unique constraint (concurrent insert?) — ${res.message}` });
    else results.push({ rowNumber: row.rowNumber, slug: row.slug, outcome: "failed", message: res.message });
  }
  return results;
}
