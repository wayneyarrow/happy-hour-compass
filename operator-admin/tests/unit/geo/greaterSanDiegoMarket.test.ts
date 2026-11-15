import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  MARKETS,
  findNearestActiveMarket,
  getDefaultMarketForCountry,
  getMarketById,
} from "../../../src/lib/markets";
import {
  partitionVenuesByMarket,
  venueLocationLabel,
} from "../../../src/lib/discover/marketScope";
import { buildCityGeographyLookup, resolveCityGeography } from "../../../src/lib/geo/venueGeographyResolver";
import { computeVenueReadiness, computeOperatorImageCount } from "../../../src/lib/venueReadiness";

/**
 * Greater San Diego market setup: country defaults, market scoping for
 * browse vs. map panning, geography resolution, and Encore
 * Sushi's publish readiness before/after assignment. Fixtures only — the
 * Encore row mirrors the fields of its existing draft that readiness reads
 * (public listing data; no secrets).
 */

// ─── Market config ───────────────────────────────────────────────────────────

test("Greater San Diego is an open US market with Pacific coordinates", () => {
  const sd = getMarketById("greater-san-diego");
  assert.ok(sd);
  assert.equal(sd.status, "active");
  assert.equal(sd.country, "US");
  assert.equal(sd.regionCode, "CA");
  assert.equal(getMarketById("central-okanagan")?.status, "active");
  assert.deepEqual(
    MARKETS.filter((m) => m.status === "active").map((m) => m.id),
    ["central-okanagan", "greater-san-diego"]
  );
});

test("first-visit default by country: US → Greater San Diego; Canada, elsewhere, unknown → Central Okanagan", () => {
  assert.equal(getDefaultMarketForCountry("US").id, "greater-san-diego");
  assert.equal(getDefaultMarketForCountry("us").id, "greater-san-diego");
  assert.equal(getDefaultMarketForCountry("CA").id, "central-okanagan");
  assert.equal(getDefaultMarketForCountry("GB").id, "central-okanagan");
  assert.equal(getDefaultMarketForCountry("MX").id, "central-okanagan");
  assert.equal(getDefaultMarketForCountry(null).id, "central-okanagan");
  assert.equal(getDefaultMarketForCountry("").id, "central-okanagan");
});

test("'Use my location' near Solana Beach now finds Greater San Diego; Kelowna unchanged", () => {
  assert.equal(findNearestActiveMarket(32.9918, -117.2704).id, "greater-san-diego");
  assert.equal(findNearestActiveMarket(49.888, -119.496).id, "central-okanagan");
});

// ─── Market scoping ──────────────────────────────────────────────────────────

const venue = (name: string, lat: number | null, lng: number | null, marketSlug: string | null, city = "") => ({
  name, latitude: lat, longitude: lng, marketSlug, city,
});
const ENCORE = venue("Encore Sushi", 32.9918017, -117.270417, "greater-san-diego", "Solana Beach");
const KELOWNA = venue("Kelowna Taphouse", 49.886, -119.494, "central-okanagan", "Kelowna");
const VANCOUVER = venue("Gastown Bar", 49.2836, -123.1086, "greater-vancouver", "Vancouver"); // coming soon
const TORONTO = venue("Toronto Pub", 43.65, -79.38, null, "Toronto"); // published, unassigned
const ALL = [ENCORE, KELOWNA, VANCOUVER, TORONTO];

test("browsing Central Okanagan: Encore is another market's venue, never in-market", () => {
  const { inMarket, otherMarket } = partitionVenuesByMarket(ALL, getMarketById("central-okanagan")!);
  assert.deepEqual(inMarket.map((v) => v.name), ["Kelowna Taphouse"]);
  // Only venues of other *active* markets — not coming-soon Vancouver, not unassigned Toronto.
  assert.deepEqual(otherMarket.map((v) => v.name), ["Encore Sushi"]);
});

test("browsing Greater San Diego: Encore is in-market; Kelowna reachable only as another market", () => {
  const { inMarket, otherMarket } = partitionVenuesByMarket(ALL, getMarketById("greater-san-diego")!);
  assert.deepEqual(inMarket.map((v) => v.name), ["Encore Sushi"]);
  assert.deepEqual(otherMarket.map((v) => v.name), ["Kelowna Taphouse"]);
});

test("location label identifies the venue's city and state", () => {
  assert.equal(venueLocationLabel(ENCORE), "Solana Beach, CA");
  assert.equal(venueLocationLabel(KELOWNA), "Kelowna, BC");
});

// ─── Geography resolution (live Add Your Venue paths + backfill) ────────────

const LOOKUP = buildCityGeographyLookup(
  [
    { id: "kelowna-id", slug: "kelowna", name: "Kelowna", market_id: "co-id" },
    { id: "solana-id", slug: "solana-beach", name: "Solana Beach", market_id: "sd-id" },
  ],
  [
    { id: "co-id", province: "BC" },
    { id: "sd-id", province: "CA" },
  ]
);

test("Solana Beach, CA resolves to Greater San Diego (Google short code or typed state name)", () => {
  for (const province of ["CA", "California", "california", undefined]) {
    assert.deepEqual(resolveCityGeography({ city: "Solana Beach", province }, LOOKUP), {
      cityId: "solana-id", marketId: "sd-id", matchedCityName: "Solana Beach",
    });
  }
  // A clearly different state is still vetoed; unseeded cities stay unassigned.
  assert.equal(resolveCityGeography({ city: "Solana Beach", province: "BC" }, LOOKUP), null);
  assert.equal(resolveCityGeography({ city: "Del Mar", province: "CA" }, LOOKUP), null);
  assert.equal(resolveCityGeography({ city: "Seattle", province: "WA" }, LOOKUP), null);
});

// ─── Encore Sushi publish readiness ──────────────────────────────────────────

const SUPABASE_URL = "https://example.supabase.co";
const ENCORE_DRAFT = {
  name: "Encore Sushi",
  address_line1: "112 South Cedros Avenue",
  city: "Solana Beach",
  region: "CA",
  postal_code: "92075",
  phone: "8589257052",
  website_url: "https://encoresushi.com",
  menu_url: null,
  establishment_type: "Restaurant and Bar",
  market_id: null as string | null,
  city_id: null as string | null,
  lat: 32.9918017,
  lng: -117.270417,
  hh_times:
    "Sunday: 3 PM–5:30 PM\r\nMonday: No happy hour\r\nTuesday: 3 PM–5:30 PM\r\nWednesday: 3 PM–5:30 PM\r\nThursday: 3 PM–5:30 PM\r\nFriday: 3 PM–5:30 PM\r\nSaturday: 3 PM–5:30 PM",
  hh_tagline: null,
  hh_food_details: '[{"name":"rolls","price":"5"}]',
  hh_drink_details: '[{"name":"draft beer","price":"5"},{"name":"wine","price":"5"},{"name":"sake","price":"5"}]',
  business_hours: {
    monday: null,
    tuesday: { open: "15:00", close: "21:00" },
    wednesday: { open: "15:00", close: "21:00" },
    thursday: { open: "15:00", close: "21:00" },
    friday: { open: "12:00", close: "22:00" },
    saturday: { open: "12:00", close: "22:00" },
    sunday: { open: "12:00", close: "21:00" },
  },
  payment_types: null,
  claimed_at: "2026-11-05 15:13:03.046+00",
};
// Its one photo is an operator upload in the venue-images bucket.
const IMAGES = [{ url: `${SUPABASE_URL}/storage/v1/object/public/venue-images/venues/4ecc0d2c/photo.jpg` }];

function readiness(row: typeof ENCORE_DRAFT) {
  return computeVenueReadiness({
    ...row,
    imageCount: IMAGES.length,
    operatorImageCount: computeOperatorImageCount(IMAGES, SUPABASE_URL),
  });
}

test("Encore's draft today: market & city assignment is the only publish blocker", () => {
  const r = readiness(ENCORE_DRAFT);
  assert.equal(r.publishReady, false);
  assert.deepEqual(r.missingRequired.map((i) => i.label), ["Market & city assignment"]);
});

test("after the targeted assignment, Encore is publish-ready with everything else unchanged", () => {
  const r = readiness({ ...ENCORE_DRAFT, market_id: "sd-market-uuid", city_id: "solana-beach-uuid" });
  assert.equal(r.publishReady, true);
  assert.deepEqual(r.missingRequired, []);
});

// ─── Wiring ──────────────────────────────────────────────────────────────────

const SRC = join(__dirname, "../../../src/app");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("public website pages resolve the market with country defaults; the consumer app does not", () => {
  const website = sourceFiles(join(SRC, "(website)"));
  const usesPlain = website.filter((f) => /\bgetActiveMarket\s*\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(usesPlain.map((f) => relative(SRC, f)), []);
  const usesWebsite = website
    .filter((f) => /\bgetWebsiteActiveMarket\s*\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(join(SRC, "(website)"), f))
    .sort();
  assert.deepEqual(usesWebsite, [
    "layout.tsx",
    "page.tsx",
    "saved/page.tsx",
    "website-daily-specials/page.tsx",
    "website-events/page.tsx",
    "website-happy-hours/page.tsx",
  ]);
  const consumer = sourceFiles(join(SRC, "(consumer)"));
  assert.equal(consumer.some((f) => readFileSync(f, "utf8").includes("getWebsiteActiveMarket")), false);
});

test("only an explicit choice writes the market cookie", () => {
  const writers = sourceFiles(SRC)
    .filter((f) => /cookieStore\.set\(\s*MARKET_COOKIE/.test(readFileSync(f, "utf8")))
    .map((f) => relative(SRC, f));
  assert.deepEqual(writers, ["(consumer)/marketActions.ts"]);
});

test("every MARKETS entry has a timezone (no silent America/Vancouver fallback)", () => {
  const src = readFileSync(join(__dirname, "../../../src/lib/marketLocalDate.ts"), "utf8");
  for (const m of MARKETS) assert.ok(src.includes(`"${m.id}":`), `missing timezone for ${m.id}`);
});

// ─── Newsletter ──────────────────────────────────────────────────────────────
// Per-market newsletter availability and routing: tests/unit/weeklyPicks/newsletterMarkets.test.ts.
