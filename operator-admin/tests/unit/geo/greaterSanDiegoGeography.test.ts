import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GREATER_SAN_DIEGO_CITIES,
  GREATER_SAN_DIEGO_CITY_ALIASES,
  greaterSanDiegoLaunchTargetTotal,
} from "../../../src/lib/geo/rosters/greaterSanDiego";
import {
  buildCityGeographyLookup,
  resolveCityGeography,
  type CityLookupRow,
  type MarketProvinceRow,
} from "../../../src/lib/geo/venueGeographyResolver";
import { parsePlace } from "../../../src/lib/google/placesMatch";
import { computeVenueReadiness, computeOperatorImageCount } from "../../../src/lib/venueReadiness";
import { getMarketById, resolveMarketLocationLabel } from "../../../src/lib/markets";
import { partitionVenuesByMarket } from "../../../src/lib/discover/marketScope";

/**
 * Greater San Diego Step 2 geography: the full city/community roster, the
 * typed-name aliases, the exact resolution chain both Add Your Venue venue
 * creation paths run (Google match → city/province → market/city → publish
 * readiness), and assigned-market browsing. Fixtures only — no network, no
 * database. Places fixtures mirror the shape of real Places API (New)
 * responses observed in the 2026-11-13 read-only probe (addressComponents
 * of real addresses; names/ids are illustrative).
 */

// ─── Fixture DB: the cities/markets the Step 2 SQL would produce ───────────

const CO = { id: "co-id", slug: "central-okanagan", province: "BC" };
const GV = { id: "gv-id", slug: "greater-vancouver", province: "BC" };
const SD = { id: "sd-id", slug: "greater-san-diego", province: "CA" };
const MARKETS: MarketProvinceRow[] = [CO, GV, SD];

// Every non-San Diego city that exists in the shared DB today (seedGeography.ts).
const OTHER_MARKET_CITIES: CityLookupRow[] = [
  ...["Kelowna", "West Kelowna", "Lake Country", "Peachland"].map((n) => city(n, CO.id)),
  ...[
    "Vancouver", "Burnaby", "Richmond", "Surrey", "North Vancouver", "West Vancouver", "Coquitlam",
    "Port Moody", "New Westminster", "Delta", "Langley", "White Rock", "Port Coquitlam", "Pitt Meadows",
    "Maple Ridge",
  ].map((n) => city(n, GV.id)),
  city("Victoria", "vic-id"),
  city("Calgary", "cal-id"),
];
const SD_CITIES: CityLookupRow[] = GREATER_SAN_DIEGO_CITIES.map((c) => ({
  id: `${c.slug}-id`, slug: c.slug, name: c.name, market_id: SD.id,
}));
const LOOKUP = buildCityGeographyLookup([...OTHER_MARKET_CITIES, ...SD_CITIES], MARKETS);

function city(name: string, marketId: string): CityLookupRow {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return { id: `${slug}-id`, slug, name, market_id: marketId };
}

// ─── Roster ─────────────────────────────────────────────────────────────────

test("roster: 90 launch venues by geography, Solana Beach (Encore) already exists", () => {
  assert.equal(greaterSanDiegoLaunchTargetTotal(), 90);
  const bySubregion: Record<string, number> = {};
  for (const c of GREATER_SAN_DIEGO_CITIES) bySubregion[c.subregion] = (bySubregion[c.subregion] ?? 0) + c.launchTarget;
  assert.deepEqual(bySubregion, {
    "City of San Diego": 48,
    "North County Coastal": 16,
    "North County Inland": 9,
    "South Bay": 9,
    "East County": 8,
    Backcountry: 0,
  });
  const existing = GREATER_SAN_DIEGO_CITIES.filter((c) => c.existing).map((c) => c.slug);
  assert.deepEqual(existing, ["solana-beach"]);
  // Step 1 center is kept exactly (apply.sql) — never moved by the roster.
  const sb = GREATER_SAN_DIEGO_CITIES.find((c) => c.slug === "solana-beach")!;
  assert.deepEqual([sb.center_lat, sb.center_lng], [32.9912, -117.2711]);
});

test("roster: unique slugs/names, URL-safe slugs, 18 incorporated cities", () => {
  const slugs = GREATER_SAN_DIEGO_CITIES.map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(GREATER_SAN_DIEGO_CITIES.map((c) => c.name.toLowerCase())).size, slugs.length);
  for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(GREATER_SAN_DIEGO_CITIES.filter((c) => c.kind === "city").length, 18);
  for (const c of GREATER_SAN_DIEGO_CITIES.filter((c) => c.kind === "community")) {
    assert.equal(c.launchTarget, 0, `${c.name} is submission-only`);
  }
});

test("roster: no San Diego city or alias collides with a city in another market", () => {
  const others = new Set(OTHER_MARKET_CITIES.map((c) => c.name.toLowerCase()));
  for (const c of GREATER_SAN_DIEGO_CITIES) assert.equal(others.has(c.name.toLowerCase()), false, c.name);
  for (const a of Object.keys(GREATER_SAN_DIEGO_CITY_ALIASES)) assert.equal(others.has(a), false, a);
});

test("roster: every alias targets a roster city and never shadows a real city name", () => {
  const slugs = new Set(GREATER_SAN_DIEGO_CITIES.map((c) => c.slug));
  const names = new Set(GREATER_SAN_DIEGO_CITIES.map((c) => c.name.toLowerCase()));
  for (const [alias, target] of Object.entries(GREATER_SAN_DIEGO_CITY_ALIASES)) {
    assert.ok(slugs.has(target), `${alias} → ${target}`);
    assert.equal(names.has(alias), false, `${alias} is a city name`);
    assert.equal(alias, alias.trim().toLowerCase());
  }
});

// ─── The Add Your Venue resolution chain ───────────────────────────────────
// (consumer)/suggest/owner/actions.ts and control-panel approval both call
// resolveVenueGeography({ city: match.city ?? typedCity,
//                         province: match.provinceShort ?? match.province ?? typedProvince })
// — pinned by the wiring test at the bottom of this file.

function placeResponse(opts: { locality: string; neighborhood?: string; postalTown?: string; zip: string; lat: number; lng: number }) {
  const components: Record<string, unknown>[] = [
    { longText: "123", shortText: "123", types: ["street_number"] },
    { longText: "Main Street", shortText: "Main St", types: ["route"] },
  ];
  if (opts.neighborhood) components.push({ longText: opts.neighborhood, shortText: opts.neighborhood, types: ["neighborhood", "political"] });
  components.push(
    { longText: opts.locality, shortText: opts.locality, types: ["locality", "political"] },
    { longText: "San Diego County", shortText: "San Diego County", types: ["administrative_area_level_2", "political"] },
    { longText: "California", shortText: "CA", types: ["administrative_area_level_1", "political"] },
    { longText: "United States", shortText: "US", types: ["country", "political"] },
    { longText: opts.zip, shortText: opts.zip, types: ["postal_code"] },
  );
  return {
    id: "ChIJ_fixture",
    displayName: { text: "Fixture Bar" },
    formattedAddress: `123 Main St, ${opts.postalTown ?? opts.locality}, CA ${opts.zip}, USA`,
    addressComponents: components,
    location: { latitude: opts.lat, longitude: opts.lng },
  };
}

/** Exactly what the submission action passes to resolveVenueGeography(). */
function resolveLikeSubmission(match: ReturnType<typeof parsePlace> | null, typed: { city: string; province: string }) {
  return resolveCityGeography(
    { city: match?.city ?? typed.city, province: match?.provinceShort ?? match?.province ?? typed.province },
    LOOKUP
  );
}

const SD_EXPECT = (slug: string, name: string) => ({ cityId: `${slug}-id`, marketId: SD.id, matchedCityName: name });

test("Google-matched La Jolla address → San Diego (venue keeps city 'San Diego')", () => {
  const match = parsePlace(placeResponse({ locality: "San Diego", neighborhood: "La Jolla", postalTown: "La Jolla", zip: "92037", lat: 32.8473, lng: -117.2742 }));
  assert.equal(match.city, "San Diego");
  assert.equal(match.provinceShort, "CA");
  assert.deepEqual(resolveLikeSubmission(match, { city: "La Jolla", province: "California" }), SD_EXPECT("san-diego", "San Diego"));
});

test("Google-matched Cardiff address → Encinitas", () => {
  const match = parsePlace(placeResponse({ locality: "Encinitas", neighborhood: "Cardiff", postalTown: "Cardiff", zip: "92007", lat: 33.0158, lng: -117.2810 }));
  assert.deepEqual(resolveLikeSubmission(match, { city: "Cardiff", province: "CA" }), SD_EXPECT("encinitas", "Encinitas"));
});

test("zero-seed communities resolve on their own (Spring Valley, Fallbrook, Borrego Springs)", () => {
  for (const [locality, slug, lat, lng] of [
    ["Spring Valley", "spring-valley", 32.7447, -116.9989],
    ["Fallbrook", "fallbrook", 33.3833, -117.2510],
    ["Borrego Springs", "borrego-springs", 33.2558, -116.3747],
  ] as const) {
    const match = parsePlace(placeResponse({ locality, zip: "92000", lat, lng }));
    assert.deepEqual(resolveLikeSubmission(match, { city: locality, province: "CA" }), SD_EXPECT(slug, locality));
  }
});

test("typed-city fallback (no Google match): CA and California, neighbourhood and postal names", () => {
  const cases: [string, string, string][] = [
    ["La Jolla", "san-diego", "San Diego"],
    ["Pacific Beach", "san-diego", "San Diego"],
    ["North Park", "san-diego", "San Diego"],
    ["Cardiff", "encinitas", "Encinitas"],
    ["Cardiff-by-the-Sea", "encinitas", "Encinitas"],
    ["Leucadia", "encinitas", "Encinitas"],
    ["La Costa", "carlsbad", "Carlsbad"],
    ["Rancho San Diego", "el-cajon", "El Cajon"],
    ["Mt Laguna", "mount-laguna", "Mount Laguna"],
    ["Oceanside", "oceanside", "Oceanside"],
    ["  chula vista ", "chula-vista", "Chula Vista"],
    ["Spring Valley", "spring-valley", "Spring Valley"],
  ];
  for (const [typed, slug, name] of cases) {
    for (const province of ["CA", "California", "california", "ca"]) {
      assert.deepEqual(resolveLikeSubmission(null, { city: typed, province }), SD_EXPECT(slug, name), `${typed}/${province}`);
    }
  }
});

test("province veto: a San Diego name typed with another province never lands in Greater San Diego", () => {
  assert.equal(resolveLikeSubmission(null, { city: "La Jolla", province: "BC" }), null);
  assert.equal(resolveLikeSubmission(null, { city: "North Park", province: "Alberta" }), null);
  assert.equal(resolveLikeSubmission(null, { city: "Oceanside", province: "BC" }), null);
  // Unknown places stay unassigned (founder resolves) — never guessed.
  assert.equal(resolveLikeSubmission(null, { city: "Temecula", province: "CA" }), null);
  assert.equal(resolveLikeSubmission(null, { city: "Tijuana", province: "Baja California" }), null);
});

test("existing markets are unaffected: Kelowna and the BC aliases still resolve", () => {
  assert.deepEqual(resolveCityGeography({ city: "Kelowna", province: "BC" }, LOOKUP), {
    cityId: "kelowna-id", marketId: CO.id, matchedCityName: "Kelowna",
  });
  assert.deepEqual(resolveCityGeography({ city: "Langley Township", province: "BC" }, LOOKUP), {
    cityId: "langley-id", marketId: GV.id, matchedCityName: "Langley",
  });
  // Encore's existing assignment target is unchanged.
  assert.deepEqual(resolveCityGeography({ city: "Solana Beach", province: "CA" }, LOOKUP), SD_EXPECT("solana-beach", "Solana Beach"));
});

test("aliases work without market slugs (backfill script) when the target slug is unique", () => {
  const lookup = buildCityGeographyLookup([...OTHER_MARKET_CITIES, ...SD_CITIES], []);
  assert.equal(resolveCityGeography({ city: "La Jolla" }, lookup)?.cityId, "san-diego-id");
  assert.equal(resolveCityGeography({ city: "District of West Vancouver" }, lookup)?.cityId, "west-vancouver-id");
});

test("a city name shared by two markets is disambiguated by province, else left unassigned", () => {
  const lookup = buildCityGeographyLookup(
    [city("Richmond", GV.id), { id: "richmond-ca-id", slug: "richmond", name: "Richmond", market_id: SD.id }],
    MARKETS
  );
  assert.equal(resolveCityGeography({ city: "Richmond", province: "BC" }, lookup)?.cityId, "richmond-id");
  assert.equal(resolveCityGeography({ city: "Richmond", province: "California" }, lookup)?.cityId, "richmond-ca-id");
  assert.equal(resolveCityGeography({ city: "Richmond" }, lookup), null);
});

// ─── Publish readiness after automatic assignment ──────────────────────────

test("a new La Jolla submission clears the geography requirement once resolved", () => {
  const match = parsePlace(placeResponse({ locality: "San Diego", neighborhood: "La Jolla", postalTown: "La Jolla", zip: "92037", lat: 32.8473, lng: -117.2742 }));
  const geography = resolveLikeSubmission(match, { city: "La Jolla", province: "California" });
  const base = {
    name: "Fixture Bar", address_line1: match.streetAddress, city: match.city,
    region: match.provinceShort, postal_code: match.postalCode, phone: "(858) 555-0100",
    website_url: "https://example.com", menu_url: null, establishment_type: "Restaurant and Bar",
    lat: match.lat, lng: match.lng,
    hh_times: "Monday – Friday: 3 PM – 6 PM", hh_tagline: null,
    hh_food_details: '[{"name":"Fries","price":"6"}]', hh_drink_details: '[{"name":"Draft Beer","price":"6"}]',
    business_hours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { open: "11:00", close: "22:00" }])),
    payment_types: null, claimed_at: null,
  };
  const images = [{ url: "https://example.supabase.co/storage/v1/object/public/venue-images/venues/x/p.jpg" }];
  const ready = (row: typeof base & { market_id: string | null; city_id: string | null }) =>
    computeVenueReadiness({ ...row, imageCount: 1, operatorImageCount: computeOperatorImageCount(images, "https://example.supabase.co") });

  const unresolved = ready({ ...base, market_id: null, city_id: null });
  assert.ok(unresolved.missingRequired.some((i) => i.label === "Market & city assignment"));

  const resolved = ready({ ...base, market_id: geography?.marketId ?? null, city_id: geography?.cityId ?? null });
  assert.equal(resolved.missingRequired.some((i) => i.label === "Market & city assignment"), false);
  assert.deepEqual(resolved.missingRequired, []);
});

// ─── Header label ──────────────────────────────────────────────────────────

test("header shows 'Greater San Diego' for the region; Central Okanagan keeps its default city", () => {
  assert.equal(resolveMarketLocationLabel(getMarketById("greater-san-diego")!, "Solana Beach"), "Greater San Diego");
  assert.equal(resolveMarketLocationLabel(getMarketById("greater-san-diego")!, null), "Greater San Diego");
  assert.equal(resolveMarketLocationLabel(getMarketById("central-okanagan")!, "Kelowna"), "Kelowna");
  assert.equal(resolveMarketLocationLabel(getMarketById("central-okanagan")!, null), "Central Okanagan");
});

// ─── Assigned-market browsing ──────────────────────────────────────────────

const v = (name: string, lat: number | null, lng: number | null, marketSlug: string | null) => ({ name, latitude: lat, longitude: lng, marketSlug });
const VENUES = [
  v("Encore Sushi", 32.9918, -117.2704, "greater-san-diego"),
  v("Borrego Bar", 33.2558, -116.3747, "greater-san-diego"),       // ~86 km — beyond the old 60 km radius
  v("Jacumba Saloon", 32.6178, -116.1880, "greater-san-diego"),    // ~93 km
  v("San Diego No Coords", null, null, "greater-san-diego"),
  v("Kelowna Taphouse", 49.886, -119.494, "central-okanagan"),
  v("Kelowna No Coords", null, null, "central-okanagan"),
  v("Gastown Bar", 49.2836, -123.1086, "greater-vancouver"),        // coming soon in MARKETS
  v("Unassigned No Coords", null, null, null),
  v("Unassigned Near Kelowna", 49.89, -119.49, null),
];

test("Greater San Diego browsing includes every assigned venue, including those beyond 60 km", () => {
  const { inMarket, otherMarket } = partitionVenuesByMarket(VENUES, getMarketById("greater-san-diego")!);
  assert.deepEqual(inMarket.map((x) => x.name), ["Encore Sushi", "Borrego Bar", "Jacumba Saloon", "San Diego No Coords"]);
  assert.deepEqual(otherMarket.map((x) => x.name), ["Kelowna Taphouse", "Kelowna No Coords"]);
});

test("Central Okanagan browsing never includes San Diego venues — even without coordinates", () => {
  const { inMarket, otherMarket } = partitionVenuesByMarket(VENUES, getMarketById("central-okanagan")!);
  assert.deepEqual(inMarket.map((x) => x.name), ["Kelowna Taphouse", "Kelowna No Coords"]);
  // San Diego venues are only reachable cross-market (name search / map panning).
  assert.deepEqual(otherMarket.map((x) => x.name), ["Encore Sushi", "Borrego Bar", "Jacumba Saloon", "San Diego No Coords"]);
  // Unassigned venues (no public URL) and coming-soon markets are in neither list.
  for (const name of ["Gastown Bar", "Unassigned No Coords", "Unassigned Near Kelowna"]) {
    assert.equal([...inMarket, ...otherMarket].some((x) => x.name === name), false, name);
  }
});

// ─── Wiring ────────────────────────────────────────────────────────────────

const APP = join(__dirname, "../../../src/app");

test("both venue-creation paths resolve geography from Google locality, then the typed city/province", () => {
  const consumer = readFileSync(join(APP, "(consumer)/suggest/owner/actions.ts"), "utf8");
  assert.match(consumer, /resolveVenueGeography\(supabase, \{\s*city:\s*match\.city \?\? formValues\.city,\s*province: match\.provinceShort \?\? match\.province \?\? formValues\.province,/);
  const cp = readFileSync(join(APP, "control-panel/operator-submissions/[id]/actions.ts"), "utf8");
  assert.match(cp, /resolvedCity\s*=\s*\(gm\?\.city\s+as string \| null\) \?\? \(sub\.city/);
  assert.match(cp, /resolveVenueGeography\(supabase, \{\s*city:\s*resolvedCity,\s*province: resolvedProvince,/);
});

test("the live lookup fetches market slugs, so aliases are market-scoped in production", () => {
  const src = readFileSync(join(__dirname, "../../../src/lib/geo/venueGeographyResolver.ts"), "utf8");
  assert.match(src, /from\("markets"\)\.select\("id, province, slug"\)/);
});

test("website listings and hero search scope by assigned market, not by radius", () => {
  const scope = readFileSync(join(__dirname, "../../../src/lib/discover/marketScope.ts"), "utf8");
  assert.equal(/import[^;]*isNearMarket/.test(scope), false);
  for (const f of ["(website)/website-happy-hours/page.tsx"]) {
    assert.match(readFileSync(join(APP, f), "utf8"), /partitionVenuesByMarket\(allVenues, market\)/);
  }
  assert.match(readFileSync(join(__dirname, "../../../src/lib/data/venueSuggestions.ts"), "utf8"), /partitionVenuesByMarket\(allVenues, market\)/);
});
