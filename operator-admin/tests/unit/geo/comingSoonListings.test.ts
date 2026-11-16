import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMING_SOON_MARKET_LISTINGS, MARKETS, getMarketById } from "../../../src/lib/markets";

/**
 * The website's "Coming soon" market list (footer + header location
 * switcher) comes from COMING_SOON_MARKET_LISTINGS, a display-only listing
 * separate from MARKETS. MARKETS' own coming_soon entries (Greater
 * Vancouver, Victoria, Calgary) stay for routing only.
 */

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

test("the website advertises Palm Springs, Los Angeles and San Francisco, in that order", () => {
  assert.deepEqual(
    COMING_SOON_MARKET_LISTINGS.map((m) => m.name),
    ["Palm Springs", "Los Angeles", "San Francisco"]
  );
});

test("listing ids are unique and never collide with a real market", () => {
  const ids = COMING_SOON_MARKET_LISTINGS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(getMarketById(id), undefined, id);
});

test("routing-only coming_soon markets stay in MARKETS so their URLs keep the Coming Soon page", () => {
  for (const id of ["greater-vancouver", "victoria", "calgary"]) {
    assert.equal(getMarketById(id)?.status, "coming_soon", id);
  }
  assert.deepEqual(
    MARKETS.filter((m) => m.status === "active").map((m) => m.id),
    ["central-okanagan", "greater-san-diego"]
  );
});

test("footer and location switcher list upcoming markets from the shared listing only", () => {
  const footer = read("app/(website)/WebsiteFooter.tsx");
  assert.match(footer, /COMING_SOON_MARKET_LISTINGS\.map\(/);
  assert.match(footer, /MARKETS\.filter\(\(market\) => market\.status === "active"\)\.map\(/);
  assert.doesNotMatch(footer, /\{MARKETS\.map\(/);

  const switcher = read("app/(website)/WebsiteLocationSwitcher.tsx");
  assert.match(switcher, /const comingSoonRegions = COMING_SOON_MARKET_LISTINGS;/);
  assert.match(switcher, /const activeRegions = MARKETS\.filter\(\(m\) => m\.status === "active"\);/);
  assert.doesNotMatch(switcher, /MARKETS\.filter\(\(m\) => m\.status === "coming_soon"\)/);
});
