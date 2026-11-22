import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKETS } from "../../../src/lib/markets";
import {
  getPublicLegacyVenue,
  isVenueInLiveMarket,
} from "../../../src/app/(consumer)/venue/[id]/legacyVenueVisibility";

/**
 * The legacy consumer-app route /venue/[id] follows the public visibility
 * rule used everywhere else: published AND assigned to a live (MARKETS
 * "active") market. Unpublished venues, venues in unlaunched markets and
 * venues without a valid market are a 404 with no listing content or
 * metadata. Fixtures only — no venue or market data is read or changed.
 */

const ROUTE_DIR = join(__dirname, "../../../src/app/(consumer)/venue/[id]");
const activeSlugs = MARKETS.filter((m) => m.status === "active").map((m) => m.id);
const comingSoonSlugs = MARKETS.filter((m) => m.status === "coming_soon").map((m) => m.id);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Venue = any;
const venue = (marketSlug: string | null): Venue => ({ id: "v1", name: "Fixture Venue", marketSlug });

test("live markets are visible: Central Okanagan and Greater San Diego", () => {
  assert.ok(activeSlugs.includes("central-okanagan") && activeSlugs.includes("greater-san-diego"));
  assert.equal(isVenueInLiveMarket("central-okanagan"), true);
  assert.equal(isVenueInLiveMarket("greater-san-diego"), true);
});

test("unlaunched (coming-soon) markets are hidden: Greater Vancouver, Victoria, Calgary", () => {
  assert.ok(comingSoonSlugs.length > 0);
  for (const slug of comingSoonSlugs) assert.equal(isVenueInLiveMarket(slug), false, slug);
  assert.equal(isVenueInLiveMarket("greater-vancouver"), false);
  assert.equal(isVenueInLiveMarket("calgary"), false);
});

test("no market or an unknown market is hidden (e.g. Toronto seeds with market_id NULL)", () => {
  assert.equal(isVenueInLiveMarket(null), false);
  assert.equal(isVenueInLiveMarket(undefined), false);
  assert.equal(isVenueInLiveMarket(""), false);
  assert.equal(isVenueInLiveMarket("toronto"), false);
  assert.equal(isVenueInLiveMarket("Central-Okanagan"), false);
});

test("a PUBLISHED venue in an unlaunched market 404s (loader returned it; the gate hides it)", async () => {
  // The data loader only returns published venues, so a returned row here is
  // published. Greater Vancouver is a fixture: no Vancouver data is touched.
  const seen: string[] = [];
  const load = async (id: string) => { seen.push(id); return venue("greater-vancouver"); };
  assert.equal(await getPublicLegacyVenue("71c8805d-adca-4f09-9646-02952d86e166", load), null);
  assert.deepEqual(seen, ["71c8805d-adca-4f09-9646-02952d86e166"]);
});

test("published venues with no market, or in Calgary, 404; live-market venues load by id or slug", async () => {
  assert.equal(await getPublicLegacyVenue("toronto-id", async () => venue(null)), null);
  assert.equal(await getPublicLegacyVenue("calgary-id", async () => venue("calgary")), null);

  const co = venue("central-okanagan");
  assert.equal(await getPublicLegacyVenue("fef218bb-62e5-4ae1-93a7-95496d1f4b1e", async () => co), co);
  const gsd = venue("greater-san-diego");
  assert.equal(await getPublicLegacyVenue("la-mesa-aromi-italian", async () => gsd), gsd, "slug links still work");
});

test("unpublished or missing venues 404 (loader returns null)", async () => {
  assert.equal(await getPublicLegacyVenue("unpublished-id", async () => null), null);
});

test("the page and its metadata both go through the gate and 404 before rendering anything", () => {
  const src = readFileSync(join(ROUTE_DIR, "page.tsx"), "utf8");
  assert.ok(!src.includes("getVenueWithEventsForConsumerById"), "no ungated venue load remains in the route");

  const metaStart = src.indexOf("export async function generateMetadata");
  const pageStart = src.indexOf("export default async function VenuePage");
  const meta = src.slice(metaStart, src.indexOf("\n}\n", metaStart));
  assert.match(meta, /getPublicLegacyVenue\(id\)/);
  assert.match(meta, /if \(!venue\) notFound\(\)/);
  assert.ok(meta.indexOf("notFound()") < meta.indexOf("venue.name"), "title only from a visible venue");

  const page = src.slice(pageStart);
  const gate = page.indexOf("getPublicLegacyVenue(id)");
  const nf = page.indexOf("notFound()");
  assert.ok(gate > 0 && nf > gate, "gate then 404");
  assert.ok(page.indexOf("<VenueViewTracker") > nf, "no view is recorded for a hidden venue");
});

test("the gate reuses the public site's MARKETS active-status rule", () => {
  const src = readFileSync(join(ROUTE_DIR, "legacyVenueVisibility.ts"), "utf8");
  assert.match(src, /getMarketById\(marketSlug\)\?\.status === "active"/);
  assert.ok(!/\bgreater-vancouver\b|\bcalgary\b|\btoronto\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "no hard-coded markets");
});
