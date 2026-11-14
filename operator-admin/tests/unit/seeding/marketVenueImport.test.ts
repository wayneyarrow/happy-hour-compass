import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOOGLE_DERIVED_COLUMNS,
  SEED_CSV_COLUMNS,
  applyImportPlan,
  planImport,
  readSeedCsv,
  type ExistingState,
  type InsertResult,
  type VenueInsertRecord,
  type VenueInsertStore,
} from "../../../src/lib/seeding/marketVenueImport";
import { ESTABLISHMENT_TYPE_OPTIONS } from "../../../src/app/admin/venue/types";
import { generateSeededTags } from "../../../src/lib/seededTags";

/**
 * Market-aware seed importer: draft-only, insert-only, geography resolved
 * through the shared resolver, Google-derived columns refused, duplicates
 * flagged, and a re-run of the same batch inserting nothing. Uses an
 * in-memory store that enforces the same unique indexes as public.venues
 * (venues_slug_key, venues_place_id_key). No network, no database.
 */

const SD = { id: "sd-id", slug: "greater-san-diego", status: "active", country: "US", province: "CA", center_lat: 32.85, center_lng: -117.15, radius_km: 60 };
const CO = { id: "co-id", slug: "central-okanagan", status: "active", country: "CA", province: "BC", center_lat: 49.888, center_lng: -119.496, radius_km: 50 };
const city = (slug: string, name: string, market_id: string) => ({ id: `${slug}-id`, slug, name, market_id, status: "active" });
const ENCORE = {
  id: "4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840", slug: "solana-beach-encore-sushi", name: "Encore Sushi",
  place_id: "ChIJU5dttdkP3IARMh1SFCyw_YQ", address_line1: "112 South Cedros Avenue", city: "Solana Beach", is_published: true,
};

function baseState(): ExistingState {
  return {
    markets: [SD, CO],
    cities: [
      city("solana-beach", "Solana Beach", SD.id), city("san-diego", "San Diego", SD.id),
      city("encinitas", "Encinitas", SD.id), city("coronado", "Coronado", SD.id),
      city("borrego-springs", "Borrego Springs", SD.id), city("kelowna", "Kelowna", CO.id),
    ],
    venues: [ENCORE],
    historicalSlugs: ["san-diego-old-name"],
  };
}

const HEADER = [...SEED_CSV_COLUMNS];
type Row = Partial<Record<(typeof SEED_CSV_COLUMNS)[number], string>>;
const BH = JSON.stringify(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { open: "16:00", close: "22:00" }])));

function row(overrides: Row = {}): Row {
  return {
    slug: "san-diego-one-door-north", name: "One Door North", establishment_type: "Restaurant and Bar",
    address_line1: "3422 30th St", city: "San Diego", region: "CA", postal_code: "92104", country: "US",
    market_slug: "greater-san-diego", city_slug: "san-diego", lat: "32.741355", lng: "-117.130142",
    phone: "(619) 618-1285", website_url: "https://www.onedoornorthsd.com/", menu_url: "",
    business_hours: BH, hh_times: "Monday – Friday: 4 PM – 6 PM", hh_tagline: "",
    hh_food_details: '[{"name":"Truffle Fries","price":"8"}]', hh_drink_details: '[{"name":"Draft Beer","price":"6"}]',
    hh_times_needs_review: "false", place_id: "ChIJNdOaPYtU2YAR0jOK-CT-3Gk",
    placeholder_image_path: "images/venues/bar/venue-pic-bar-1.jpg", source: "seed", is_published: "false",
    business_hours_verified: "true", business_hours_source: "https://www.onedoornorthsd.com/",
    coordinates_source: "US Census Geocoder (address match)",
    ...overrides,
  };
}

function csv(rows: Row[], header: string[] = HEADER): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header.join(","), ...rows.map((r) => header.map((h) => esc((r as Record<string, string>)[h] ?? "")).join(","))].join("\n");
}

function plan(rows: Row[], state = baseState(), header: string[] = HEADER) {
  const { header: h, rows: parsed } = readSeedCsv(csv(rows, header));
  return planImport(h, parsed, state, { marketSlug: "greater-san-diego", placeholderExists: () => true });
}

const codes = (p: ReturnType<typeof plan>, i = 0) => p.rows[i].issues.map((x) => x.code);

/** In-memory venues table with the real unique indexes. */
class MemoryStore implements VenueInsertStore {
  rows: (VenueInsertRecord & { id: string })[] = [];
  constructor(private state: ExistingState) {}
  async insertVenue(r: VenueInsertRecord): Promise<InsertResult> {
    const all = [...this.state.venues, ...this.rows];
    if (all.some((v) => v.slug === r.slug) || (r.place_id && all.some((v) => v.place_id === r.place_id))) {
      return { ok: false, uniqueViolation: true, message: "duplicate key" };
    }
    const id = `new-${this.rows.length + 1}`;
    this.rows.push({ ...r, id });
    return { ok: true, id };
  }
  /** What a fresh dry run would read back after this apply. */
  snapshot(): ExistingState {
    return { ...this.state, venues: [...this.state.venues, ...this.rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, place_id: r.place_id, address_line1: r.address_line1, city: r.city, is_published: r.is_published }))] };
  }
}

// ─── Happy path ──────────────────────────────────────────────────────────────

test("a clean row plans one draft insert with market + city resolved", () => {
  const p = plan([row()]);
  assert.equal(p.rows[0].decision, "insert");
  assert.deepEqual(codes(p), []);
  const r = p.rows[0].record!;
  assert.equal(r.market_id, SD.id);
  assert.equal(r.city_id, "san-diego-id");
  assert.equal(r.is_published, false);
  assert.equal(r.source, "seed");
  assert.equal(r.google_identity_status, "matched");
  assert.deepEqual(r.business_hours?.monday, { open: "16:00", close: "22:00" });
  assert.deepEqual(JSON.parse(r.hh_food_details!), [{ name: "Truffle Fries", price: "8" }]);
  assert.deepEqual(p.rows[0].summary.hhDays, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
});

test("apply inserts drafts; re-running the same batch inserts nothing and creates no duplicates", async () => {
  const state = baseState();
  const store = new MemoryStore(state);
  const batch = [row(), row({ slug: "encinitas-herb-sea", name: "Herb & Sea", address_line1: "131 W D St", city: "Encinitas", city_slug: "encinitas", postal_code: "92024", place_id: "ChIJsYpjlBMN3IARN86hE1LRUvM" })];

  const first = await applyImportPlan(plan(batch, state), store);
  assert.deepEqual(first.map((r) => r.outcome), ["inserted", "inserted"]);
  assert.equal(store.rows.length, 2);
  assert.ok(store.rows.every((r) => r.is_published === false && r.source === "seed"));

  const rerunPlan = plan(batch, store.snapshot());
  assert.deepEqual(rerunPlan.rows.map((r) => r.decision), ["skip_existing", "skip_existing"]);
  const second = await applyImportPlan(rerunPlan, store);
  assert.deepEqual(second.map((r) => r.outcome), ["skipped", "skipped"]);
  assert.equal(store.rows.length, 2);
});

test("a concurrent insert that wins the unique index is reported as skipped, not failed", async () => {
  const state = baseState();
  const p = plan([row()], state);
  const store = new MemoryStore(state);
  await store.insertVenue(p.rows[0].record!); // someone else got there first
  const res = await applyImportPlan(p, store);
  assert.equal(res[0].outcome, "skipped");
  assert.equal(store.rows.length, 1);
});

// ─── Existing listings are never touched ────────────────────────────────────

test("Encore Sushi: its Place ID in a batch is a skip — the live listing is left untouched", async () => {
  const state = baseState();
  const p = plan([row({ slug: "solana-beach-encore-sushi-2", name: "Encore Sushi", address_line1: "112 S Cedros Ave", city: "Solana Beach", city_slug: "solana-beach", postal_code: "92075", place_id: ENCORE.place_id })], state);
  assert.equal(p.rows[0].decision, "skip_existing");
  assert.equal(p.rows[0].existingVenue?.id, ENCORE.id);
  assert.ok(codes(p).includes("duplicate_place_id"));
  const store = new MemoryStore(state);
  const res = await applyImportPlan(p, store);
  assert.equal(res[0].outcome, "skipped");
  assert.equal(store.rows.length, 0);
  assert.deepEqual(state.venues[0], ENCORE);
});

test("the importer has no update or delete path", () => {
  const src = readFileSync(join(__dirname, "../../../scripts/importMarketVenuesFromCsv.ts"), "utf8");
  const lib = readFileSync(join(__dirname, "../../../src/lib/seeding/marketVenueImport.ts"), "utf8");
  for (const s of [src, lib]) {
    assert.equal(/\.(update|upsert|delete)\(/.test(s), false);
  }
  assert.match(src, /from\("venues"\)\.insert\(record\)/);
  assert.match(src, /const APPLY = process\.argv\.includes\("--apply"\)/);
});

// ─── Flags ──────────────────────────────────────────────────────────────────

test("duplicate Place ID / slug / address / name within the batch blocks the later row", () => {
  const p = plan([row(), row({ slug: "san-diego-one-door-north-2" })]);
  assert.equal(p.rows[0].decision, "insert");
  assert.equal(p.rows[1].decision, "blocked");
  assert.ok(codes(p, 1).includes("duplicate_in_batch"));
});

test("conflicting address or name with an existing venue blocks the row", () => {
  const state = baseState();
  state.venues.push({ id: "x", slug: "san-diego-odn", name: "One Door North", place_id: null, address_line1: "3422 30th Street", city: "San Diego", is_published: false });
  const p = plan([row()], state);
  assert.equal(p.rows[0].decision, "blocked");
  assert.ok(codes(p).includes("address_conflict"));
  assert.ok(codes(p).includes("name_conflict"));
});

test("slug owned by a different place, or a former slug, blocks the row", () => {
  const state = baseState();
  state.venues.push({ id: "y", slug: "san-diego-one-door-north", name: "Other", place_id: "ChIJ_other", address_line1: "1 Other St", city: "San Diego", is_published: true });
  assert.ok(codes(plan([row()], state)).includes("slug_conflict"));
  assert.ok(codes(plan([row({ slug: "san-diego-old-name" })])).includes("slug_in_history"));
});

test("missing coordinates are flagged (warning) but still allowed as a draft", () => {
  const p = plan([row({ lat: "", lng: "" })]);
  assert.equal(p.rows[0].decision, "insert");
  assert.ok(codes(p).includes("missing_coordinates"));
  assert.ok(codes(plan([row({ lat: "32.7", lng: "" })])).includes("invalid_coordinates"));
});

test("unresolved or mismatched cities block the row", () => {
  assert.ok(codes(plan([row({ city_slug: "la-jolla" })])).includes("unresolved_city"));
  assert.ok(codes(plan([row({ city: "Temecula" })])).includes("unresolved_city"));
  assert.ok(codes(plan([row({ city: "Encinitas" })])).includes("city_mismatch"));
  assert.ok(codes(plan([row({ market_slug: "central-okanagan", city_slug: "kelowna" })])).includes("wrong_market"));
  assert.ok(codes(plan([row({ region: "BC" })])).includes("unresolved_city"));
  // A neighbourhood alias resolves but is flagged: the listing keeps its real city.
  const alias = plan([row({ city: "La Jolla" })]);
  assert.equal(alias.rows[0].decision, "insert");
  assert.ok(codes(alias).includes("city_text_alias"));
});

test("assigned venues beyond the 60 km radius import with a location warning only", () => {
  const p = plan([row({ slug: "borrego-springs-x", name: "X", address_line1: "1 Palm Canyon Dr", city: "Borrego Springs", city_slug: "borrego-springs", postal_code: "92004", place_id: "", lat: "33.2558", lng: "-116.3747" })]);
  assert.equal(p.rows[0].decision, "insert");
  assert.ok(codes(p).includes("beyond_market_radius"));
});

test("draft-only: is_published=true and a non-seed source are refused", () => {
  assert.ok(codes(plan([row({ is_published: "true" })])).includes("publish_not_allowed"));
  assert.ok(codes(plan([row({ source: "operator_submission" })])).includes("invalid_source"));
});

test("Google-derived columns block the whole batch (Places storage terms)", () => {
  for (const col of ["google_types", "google_business_hours", "outdoor_seating", "price_level", "seeded_tags", "search_tags"]) {
    assert.ok((GOOGLE_DERIVED_COLUMNS as readonly string[]).includes(col) || col === "search_tags");
    const p = plan([row()], baseState(), [...HEADER, col]);
    assert.ok(p.headerIssues.some((i) => i.code === "google_derived_column" || i.code === "unknown_column"), col);
    assert.equal(p.rows[0].decision, "blocked");
  }
  const unknown = plan([row()], baseState(), [...HEADER, "neighbourhood"]);
  assert.ok(unknown.headerIssues.some((i) => i.code === "unknown_column"));
});

test("schedule and offer validation uses the app's own parsing rules", () => {
  assert.ok(codes(plan([row({ hh_times: "Happy hour most weekdays" })])).includes("unparseable_hh_times"));
  assert.ok(codes(plan([row({ hh_food_details: '[{"name":"A"},{"name":"B"},{"name":"C"},{"name":"D"}]' })])).includes("too_many_specials"));
  assert.ok(codes(plan([row({ hh_drink_details: '[{"name":"Wine","price":"$8"}]' })])).includes("invalid_price"));
  assert.ok(codes(plan([row({ hh_drink_details: '[{"name":"Wine","cost":"8"}]' })])).includes("invalid_specials"));
  assert.ok(codes(plan([row({ business_hours: '{"monday":{"open":"4 PM","close":"10 PM"}}' })])).includes("invalid_business_hours"));
  const blank = plan([row({ hh_times: "", hh_food_details: "", hh_drink_details: "" })]);
  assert.ok(codes(blank).includes("missing_hh_times"));
  assert.ok(codes(blank).includes("no_specials"));
  // Multi-line schedules and en dashes (the seed format) parse cleanly.
  const BH15 = JSON.stringify(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { open: "15:00", close: "22:00" }])));
  const multi = plan([row({ business_hours: BH15, hh_times: "Tuesday – Wednesday: 5 PM – 6 PM\nThursday: 5 PM – 9 PM\nFriday – Sunday: 3 PM – 6 PM" })]);
  assert.deepEqual(codes(multi), []);
  assert.deepEqual(multi.rows[0].summary.hhDays, ["Sunday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
});

test("establishment_type must be an Operator Admin option", () => {
  const { header, rows } = readSeedCsv(csv([row({ establishment_type: "Speakeasy" }), row({ slug: "x-wine", name: "X", address_line1: "1 A St", place_id: "", establishment_type: "Wine Bar" })]));
  const p = planImport(header, rows, baseState(), { marketSlug: "greater-san-diego", placeholderExists: () => true, establishmentTypes: ESTABLISHMENT_TYPE_OPTIONS });
  assert.ok(p.rows[0].issues.some((i) => i.code === "unknown_establishment_type" && i.level === "error"));
  assert.equal(p.rows[1].issues.some((i) => i.code === "unknown_establishment_type"), false);
});

test("CSV parsing handles quoted JSON with commas, quotes and newlines", () => {
  const text = 'slug,hh_times,hh_food_details\r\na,"Monday: 4 PM – 6 PM\nTuesday: 4 PM – 6 PM","[{""name"":""Fries, truffle"",""price"":""8""}]"\r\n';
  const { header, rows } = readSeedCsv(text);
  assert.deepEqual(header, ["slug", "hh_times", "hh_food_details"]);
  assert.equal(rows[0].values.hh_times, "Monday: 4 PM – 6 PM\nTuesday: 4 PM – 6 PM");
  assert.deepEqual(JSON.parse(rows[0].values.hh_food_details), [{ name: "Fries, truffle", price: "8" }]);
});

// ─── Business hours: complete, verified, consistent with happy hour ────────

const hoursCodes = (p: ReturnType<typeof plan>) => p.rows[0].eligibility.businessHoursReasons;

test("complete verified hours (closed days explicit as null) are eligible", () => {
  const closedMonday = JSON.stringify({ ...JSON.parse(BH), monday: null });
  const p = plan([row({ business_hours: closedMonday, hh_times: "Tuesday – Friday: 4 PM – 6 PM" })]);
  assert.equal(p.rows[0].decision, "insert");
  assert.equal(p.rows[0].eligibility.businessHours, "eligible");
});

test("missing, unverified, unsourced or incomplete hours make the row ineligible", () => {
  for (const [overrides, code] of [
    [{ business_hours: "" }, "hours_missing"],
    [{ business_hours_verified: "" }, "hours_not_verified"],
    [{ business_hours_verified: "false" }, "hours_not_verified"],
    [{ business_hours_source: "" }, "hours_source_missing"],
    [{ business_hours_source: "venue website" }, "hours_source_missing"],
    [{ business_hours: JSON.stringify({ monday: { open: "16:00", close: "22:00" } }) }, "invalid_business_hours"],
    [{ business_hours: JSON.stringify(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, null]))) }, "hours_all_closed"],
  ] as [Row, string][]) {
    const p = plan([row(overrides)]);
    assert.equal(p.rows[0].decision, "blocked", code);
    assert.equal(p.rows[0].eligibility.businessHours, "ineligible", code);
    assert.ok(p.rows[0].issues.some((i) => i.code === code && i.level === "error"), code);
    assert.ok(hoursCodes(p).length > 0);
  }
});

test("happy hour before opening or on a closed day is a conflict (Roppongi / Stake pattern)", () => {
  const dinnerOnly = JSON.stringify(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { open: "17:00", close: "21:00" }])));
  const p = plan([row({ business_hours: dinnerOnly, hh_times: "Monday: 3 PM – 9 PM\nTuesday – Sunday: 3 PM – 5 PM" })]);
  assert.equal(p.rows[0].decision, "blocked");
  assert.ok(p.rows[0].issues.some((i) => i.code === "hh_outside_business_hours"));
  const closedDay = JSON.stringify({ ...JSON.parse(BH), friday: null });
  assert.ok(plan([row({ business_hours: closedDay })]).rows[0].issues.some((i) => i.code === "hh_outside_business_hours"));
  // Overnight closes wrap past midnight: a late-night HH to 1 AM fits a 2 AM close.
  const late = JSON.stringify(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { open: "16:00", close: "02:00" }])));
  assert.equal(plan([row({ business_hours: late, hh_times: "Friday – Saturday: 10 PM – 1 AM" })]).rows[0].decision, "insert");
});

test("hours eligibility is reported separately from a pending city assignment", () => {
  const p = plan([row({ city_slug: "la-mesa", city: "La Mesa" }), row({ slug: "x-bad-hours", name: "X", address_line1: "9 Z St", place_id: "", business_hours_verified: "false" })]);
  assert.deepEqual([p.rows[0].eligibility.businessHours, p.rows[0].eligibility.geography], ["eligible", "blocked"]);
  assert.deepEqual([p.rows[1].eligibility.businessHours, p.rows[1].eligibility.geography], ["ineligible", "resolved"]);
});

test("apply skips an hours-ineligible row without creating anything", async () => {
  const state = baseState();
  const store = new MemoryStore(state);
  let calls = 0;
  const counting: VenueInsertStore = { insertVenue: async (r) => { calls++; return store.insertVenue(r); } };
  const p = plan([row({ business_hours_verified: "false" }), row({ slug: "encinitas-herb-sea", name: "Herb & Sea", address_line1: "131 W D St", city: "Encinitas", city_slug: "encinitas", postal_code: "92024", place_id: "ChIJsYpjlBMN3IARN86hE1LRUvM" })], state);
  const res = await applyImportPlan(p, counting);
  assert.deepEqual(res.map((r) => r.outcome), ["blocked", "inserted"]);
  assert.equal(calls, 1);
  assert.deepEqual(store.rows.map((r) => r.slug), ["encinitas-herb-sea"]);
});

test("map pins need a source and must not be a city-centre placeholder", () => {
  assert.ok(plan([row({ coordinates_source: "" })]).rows[0].issues.some((i) => i.code === "coordinates_source_missing"));
  const state = baseState();
  state.cities = state.cities.map((c) => (c.slug === "san-diego" ? { ...c, center_lat: 32.815, center_lng: -117.1356 } : c));
  const p = plan([row({ lat: "32.815", lng: "-117.1356" })], state);
  assert.ok(p.rows[0].issues.some((i) => i.code === "pin_is_city_centre"));
  // Review columns never reach the venues row.
  const ok = plan([row()]).rows[0].record! as Record<string, unknown>;
  for (const k of ["business_hours_verified", "business_hours_source", "coordinates_source"]) assert.equal(k in ok, false);
});

// ─── Stored Google rating + platform discovery tags (Kelowna seed standard) ──

const RATED = { google_rating: "4.56", google_review_count: "1857", google_rating_retrieved_at: "2026-11-14T16:14:26Z" };

test("a Google rating + review count is stored in the existing fields, rounded like the backfill", () => {
  const p = plan([row(RATED)]);
  assert.equal(p.rows[0].decision, "insert");
  assert.equal(p.rows[0].record!.google_rating, 4.6);
  assert.equal(p.rows[0].record!.google_review_count, 1857);
  // Without a rating the fields stay null (badge hidden), as before.
  const none = plan([row()]).rows[0].record!;
  assert.equal(none.google_rating, null);
  assert.equal(none.google_review_count, null);
});

test("a Google rating must be complete, valid, tied to a place_id and dated", () => {
  for (const o of [
    { google_rating: "4.5" },
    { google_review_count: "10" },
    { ...RATED, google_rating: "5.5" },
    { ...RATED, google_review_count: "-1" },
    { ...RATED, google_review_count: "1.5" },
    { ...RATED, google_rating_retrieved_at: "" },
    { ...RATED, place_id: "" },
  ] as Row[]) {
    const p = plan([row(o)]);
    assert.equal(p.rows[0].decision, "blocked", JSON.stringify(o));
    assert.ok(p.rows[0].issues.some((i) => i.code === "invalid_google_rating"), JSON.stringify(o));
  }
});

test("discovery tags come from the verified specials via the existing generator; Search Tags are never written", () => {
  const food = '[{"name":"Chicharrones","price":"9"},{"name":"Truffle Fries","price":"10"},{"name":"Buffalo Wings","price":"12"}]';
  const drink = '[{"name":"Happy Hour Cocktails","price":"10"},{"name":"House Wine","price":"10"}]';
  const r = plan([row({ hh_food_details: food, hh_drink_details: drink })]).rows[0].record! as Record<string, unknown>;
  const expected = generateSeededTags({ outdoor_seating: null, live_music: null, good_for_watching_sports: null, good_for_children: null, good_for_groups: null, allows_dogs: null, serves_vegetarian_food: null, hh_food_details: food, hh_drink_details: drink });
  assert.deepEqual(r.seeded_tags, expected);
  assert.ok((r.seeded_tags as string[]).includes("Wings") && (r.seeded_tags as string[]).includes("Cocktails"));
  // No Google-amenity tags without Google amenity data.
  for (const t of ["Patio", "Live Music", "Sports Viewing", "Family Friendly", "Group Friendly", "Dog Friendly", "Vegetarian Friendly"]) {
    assert.equal((r.seeded_tags as string[]).includes(t), false, t);
  }
  assert.equal("search_tags" in r, false);
  // Plan: the importer never creates subscription/grant rows — a seed with none resolves to Free.
  assert.equal(/venue_subscriptions|venue_plan_grants/.test(readFileSync(join(__dirname, "../../../src/lib/seeding/marketVenueImport.ts"), "utf8")), false);
});
