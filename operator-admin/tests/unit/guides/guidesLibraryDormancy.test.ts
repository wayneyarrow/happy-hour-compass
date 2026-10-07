import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyGuidesLibraryRobots,
  buildGuideLibrarySitemapPaths,
  getGuidesLibraryState,
  resolveDormantGuidesCta,
  type GuidesLibraryState,
} from "../../../src/lib/guidesLibraryState";
import { buildPageMetadata } from "../../../src/lib/seo/metadata";

/**
 * Dormant/active Guides Library (/{market}/guides). Dormant = the existing
 * library query returned zero guides: 200 + self-canonical, noindex/follow in
 * Production, excluded from sitemap.xml, dormant CTA instead of the grid.
 * Active = unchanged indexable library. Staging's noindex/nofollow must win.
 */

const ROOT = join(__dirname, "../../..");
const PAGE_SOURCE = readFileSync(join(ROOT, "src/app/(website)/[market]/guides/page.tsx"), "utf8");
const SITEMAP_SOURCE = readFileSync(join(ROOT, "src/app/sitemap.ts"), "utf8");

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const keys = ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_NOINDEX", "VERCEL_ENV"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const PRODUCTION = { NEXT_PUBLIC_SITE_URL: "https://happyhourcompass.com", VERCEL_ENV: "production" };
const STAGING = { NEXT_PUBLIC_SITE_URL: "https://staging.happyhourcompass.com", NEXT_PUBLIC_NOINDEX: "true", VERCEL_ENV: "preview" };

function libraryMetadata(state: GuidesLibraryState) {
  return applyGuidesLibraryRobots(
    buildPageMetadata({
      title: "Guides | Central Okanagan",
      description: "Editorial guides.",
      path: "/central-okanagan/guides",
    }),
    state
  );
}

test("state: zero library guides is dormant, one or more is active", () => {
  assert.equal(getGuidesLibraryState(0), "dormant");
  assert.equal(getGuidesLibraryState(1), "active");
  assert.equal(getGuidesLibraryState(8), "active");
});

test("production dormant: noindex/follow, self-canonical and Open Graph kept", () => {
  withEnv(PRODUCTION, () => {
    const meta = libraryMetadata("dormant");
    assert.deepEqual(meta.robots, { index: false, follow: true });
    assert.equal(meta.alternates?.canonical, "https://happyhourcompass.com/central-okanagan/guides");
    assert.equal(meta.openGraph?.url, "https://happyhourcompass.com/central-okanagan/guides");
  });
});

test("production active: indexable (no robots), canonical unchanged", () => {
  withEnv(PRODUCTION, () => {
    const meta = libraryMetadata("active");
    assert.equal(meta.robots, undefined);
    assert.equal(meta.alternates?.canonical, "https://happyhourcompass.com/central-okanagan/guides");
  });
});

test("staging noindex/nofollow wins in both states", () => {
  withEnv(STAGING, () => {
    assert.deepEqual(libraryMetadata("dormant").robots, { index: false, follow: false });
    assert.deepEqual(libraryMetadata("active").robots, { index: false, follow: false });
  });
});

test("sitemap: only active libraries are listed, independently per market", () => {
  const states = new Map<string, GuidesLibraryState>([
    ["central-okanagan", "active"],
    ["greater-vancouver", "dormant"],
    ["victoria", "active"],
  ]);
  assert.deepEqual(
    buildGuideLibrarySitemapPaths(["central-okanagan", "greater-vancouver", "victoria", "calgary"], states),
    ["/central-okanagan/guides", "/victoria/guides"]
  );
  // Today's state: Central Okanagan dormant → no library URL at all.
  assert.deepEqual(
    buildGuideLibrarySitemapPaths(["central-okanagan"], new Map([["central-okanagan", "dormant"]])),
    []
  );
});

test("dormant CTA: Featured Guides collection when it resolves, homepage otherwise", () => {
  assert.deepEqual(resolveDormantGuidesCta("central-okanagan", true), {
    href: "/central-okanagan/collections/featured-guides",
    label: "Browse featured guides",
  });
  assert.equal(resolveDormantGuidesCta("victoria", false).href, "/");
});

test("page wiring: metadata + render both derive state from getGuideLibraryForMarket", () => {
  assert.match(PAGE_SOURCE, /applyGuidesLibraryRobots\(\s*buildPageMetadata\(/);
  assert.equal((PAGE_SOURCE.match(/getGuidesLibraryState\(guides\.length\)/g) ?? []).length, 2);
  assert.match(PAGE_SOURCE, /getPublicCollectionModel\(market, FEATURED_GUIDES_COLLECTION_SLUG\)/);
  assert.doesNotMatch(PAGE_SOURCE, /No guides have been published/);
  // Active branch still renders the existing card grid.
  assert.match(PAGE_SOURCE, /<GuideCard[\s\S]*href=\{`\/\$\{market\}\/guides\/\$\{g\.slug\}`\}/);
});

test("sitemap wiring: library entries gated by state; other sources untouched", () => {
  assert.match(SITEMAP_SOURCE, /buildGuideLibrarySitemapPaths\(\s*activeMarketSlugs,\s*libraryStateByMarket\s*\)/);
  assert.doesNotMatch(SITEMAP_SOURCE, /activeMarketSlugs\.map\(\(marketSlug\) => \(\{\s*url: absoluteUrl\(`\/\$\{marketSlug\}\/guides`\)/);
  for (const section of ["staticPages", "venuePages", "eventPages", "collectionPages", "guidePages"]) {
    assert.match(SITEMAP_SOURCE, new RegExp(`\\.\\.\\.${section},`));
  }
});
