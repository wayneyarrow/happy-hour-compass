import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getMarketById } from "../../../src/lib/markets";
import {
  isAssignedToMarket,
  isInWebsiteContentMarket,
  partitionVenuesByMarket,
  resolveSearchMarket,
} from "../../../src/lib/discover/marketScope";

/**
 * Homepage search (hero dropdown) and its "See all" listing pages search
 * only the selected market: venues by venues.market_id, Daily Specials and
 * Events through their venue's assigned market — never by distance from
 * the market centre, never with other markets' name matches. Ordinary map
 * panning to another market (no search query) is covered by the
 * partitionVenuesByMarket tests in greaterSanDiegoMarket/Geography.
 */

const CO = getMarketById("central-okanagan")!;
const SD = getMarketById("greater-san-diego")!;

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

// ─── Assigned market vs distance ────────────────────────────────────────────

test("search membership follows the assigned market when it disagrees with distance", () => {
  // Assigned to Greater San Diego but ~86 km from its centre (beyond 60 km).
  const borrego = { marketSlug: "greater-san-diego", lat: 33.2558, lng: -116.3747 };
  assert.equal(isInWebsiteContentMarket(borrego, SD, "assigned_market"), true);
  assert.equal(isInWebsiteContentMarket(borrego, SD, "radius"), false); // the old rule dropped it

  // Inside Central Okanagan's radius, but assigned to no market.
  const unassignedNearKelowna = { marketSlug: null, lat: 49.89, lng: -119.49 };
  assert.equal(isInWebsiteContentMarket(unassignedNearKelowna, CO, "assigned_market"), false);
  assert.equal(isInWebsiteContentMarket(unassignedNearKelowna, CO, "radius"), true);

  // Assigned to Central Okanagan, coordinates in San Diego (a data error).
  const misplaced = { marketSlug: "central-okanagan", lat: 32.85, lng: -117.15 };
  assert.equal(isInWebsiteContentMarket(misplaced, CO, "assigned_market"), true);
  assert.equal(isInWebsiteContentMarket(misplaced, SD, "assigned_market"), false);
  assert.equal(isInWebsiteContentMarket(misplaced, SD, "radius"), true);
});

test("records without coordinates belong only to their assigned market in search", () => {
  for (const coords of [{ lat: null, lng: null }, { lat: 0, lng: 0 }]) {
    const sdNoCoords = { marketSlug: "greater-san-diego", ...coords };
    assert.equal(isInWebsiteContentMarket(sdNoCoords, SD, "assigned_market"), true);
    assert.equal(isInWebsiteContentMarket(sdNoCoords, CO, "assigned_market"), false);
    // The radius rule let them into every market.
    assert.equal(isInWebsiteContentMarket(sdNoCoords, CO, "radius"), true);
  }
  // A standalone event (no venue → no market, no coordinates) matches no market.
  const standalone = { marketSlug: null, lat: null, lng: null };
  assert.equal(isInWebsiteContentMarket(standalone, CO, "assigned_market"), false);
  assert.equal(isInWebsiteContentMarket(standalone, SD, "assigned_market"), false);
});

test("radius scope is unchanged for in-market venues with coordinates", () => {
  assert.equal(isInWebsiteContentMarket({ marketSlug: "central-okanagan", lat: 49.886, lng: -119.494 }, CO, "radius"), true);
  assert.equal(isInWebsiteContentMarket({ marketSlug: "greater-san-diego", lat: 32.99, lng: -117.27 }, CO, "radius"), false);
});

test("isAssignedToMarket requires an exact assigned slug", () => {
  assert.equal(isAssignedToMarket("greater-san-diego", SD), true);
  assert.equal(isAssignedToMarket("central-okanagan", SD), false);
  assert.equal(isAssignedToMarket(null, SD), false);
  assert.equal(isAssignedToMarket(undefined, SD), false);
  assert.equal(isAssignedToMarket("", SD), false);
});

test("only active markets search", () => {
  assert.equal(resolveSearchMarket("greater-san-diego")?.id, "greater-san-diego");
  assert.equal(resolveSearchMarket("central-okanagan")?.id, "central-okanagan");
  assert.equal(resolveSearchMarket("greater-vancouver"), null); // coming soon
  assert.equal(resolveSearchMarket("nowhere"), null);
});

test("scoping happens before the limit: another market's exact name match can't take a slot", () => {
  const venues = [
    { name: "Moxies", marketSlug: "central-okanagan" },
    { name: "Moxies Grill", marketSlug: "central-okanagan" },
    { name: "Galley at the Marina", marketSlug: "greater-san-diego" },
  ];
  const fromSd = partitionVenuesByMarket(venues, SD).inMarket.filter((v) => /moxies/i.test(v.name));
  assert.deepEqual(fromSd, []);
  const fromCo = partitionVenuesByMarket(venues, CO).inMarket.filter((v) => /galley/i.test(v.name));
  assert.deepEqual(fromCo, []);
  assert.equal(partitionVenuesByMarket(venues, CO).inMarket.filter((v) => /moxies/i.test(v.name)).length, 2);
  assert.equal(partitionVenuesByMarket(venues, SD).inMarket.filter((v) => /galley/i.test(v.name)).length, 1);
});

// ─── Wiring ─────────────────────────────────────────────────────────────────

test("hero venue suggestions search the selected market only", () => {
  const src = read("lib/data/venueSuggestions.ts");
  assert.match(src, /const \{ inMarket \} = partitionVenuesByMarket\(allVenues, market\)/);
  assert.match(src, /rankVenuesByTextSearch\(inMarket, rawQuery\)/);
  assert.doesNotMatch(src, /otherMarket/);
});

test("every website search entry point uses assigned-market scope", () => {
  for (const f of [
    "app/(website)/dailySpecialSuggestions.ts",
    "app/(website)/website-daily-specials/page.tsx",
  ]) {
    assert.match(read(f), /getPublishedDailySpecialsForWebsite\(market, \{ scope: "assigned_market" \}\)/, f);
  }
  for (const f of ["app/(website)/eventSuggestions.ts", "app/(website)/website-events/page.tsx"]) {
    assert.match(read(f), /getPublishedEventsForWebsite\(market, \{ scope: "assigned_market" \}\)/, f);
  }
  const actions = read("app/(website)/suggestActions.ts");
  assert.equal((actions.match(/resolveSearchMarket\(marketId\)/g) ?? []).length, 3);
  assert.doesNotMatch(actions, /getMarketById/);
});

test("both website loaders apply the shared per-record market rule", () => {
  for (const f of ["lib/data/dailySpecials.ts", "lib/data/events.ts"]) {
    assert.match(read(f), /isInWebsiteContentMarket\(\{ marketSlug: venueMarketSlug, lat: vLat, lng: vLng \}, market, scope\)/, f);
  }
});

test("homepage rails and Collections keep the default (radius) scope", () => {
  assert.match(read("lib/data/todaysSpecialsHomepage.ts"), /getPublishedDailySpecialsForWebsite\(market\);/);
  assert.match(read("lib/data/homepagesRendering.ts"), /getPublishedDailySpecialsForWebsite\(staticMarket\);/);
});

test("Happy Hours listing: a search drops other markets' venues (cards and pins); panning without one keeps them", () => {
  const src = read("app/(website)/website-happy-hours/HappyHoursSearchClient.tsx");
  assert.match(src, /filteredOtherCards: trimmedQuery \? NO_CARDS : otherMarketCards\.filter\(passes\)/);
  // Other-market pins come only from filteredOtherCards; the camera frames in-market results only.
  assert.match(src, /cardsToMapMarkers\(sortedOtherCards, visitorTimeZone\)/);
  assert.match(src, /const fitMarkers = inMarketMarkers;/);
  assert.doesNotMatch(src, /OtherMarketMatches|NameMatchesElsewhere|isVenueNameMatchTier/);
  // The page still passes other markets' venues for panning.
  assert.match(read("app/(website)/website-happy-hours/page.tsx"), /otherMarketCards=\{otherMarketCards\}/);
});

test("hero search never shows or selects a previous market's results", () => {
  const src = read("app/(website)/HeroDiscoverySearch.tsx");
  assert.match(src, /const staleMarket = resultsMarketId !== market\.id;/);
  assert.match(src, /const results = staleMarket \? NO_RESULTS : fetchedResults;/);
  assert.match(src, /setResultsFor\(`\$\{requestMarketId\}\|\$\{mode\}\|\$\{trimmed\}`\)/);
  assert.match(src, /\}, \[market\.id\]\);/);
  assert.doesNotMatch(src, /locationLabel/);
});
