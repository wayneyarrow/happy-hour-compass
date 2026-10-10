import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/** Source-wiring checks for the migration-110 tracking foundation. */
const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("the public website never writes load-based venue_discover_events any more", () => {
  const website = walk(join(SRC, "app/(website)"));
  for (const f of website) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /\/api\/track\/venue-discover/, relative(SRC, f));
    assert.doesNotMatch(s, /DiscoveryImpressionTracker|fireDiscoveryClick/, relative(SRC, f));
  }
  assert.equal(existsSync(join(SRC, "app/(website)/discoveryTracking.tsx")), false);
});

test("the consumer app's own venue_discover_events writer is untouched", () => {
  assert.match(read("app/(consumer)/home/ConsumerHome.tsx"), /\/api\/track\/venue-discover/);
});

test("every tracking route resolves environment server-side", () => {
  for (const r of ["venue-view", "event-view", "daily-special-click", "venue-discover", "website-search", "discovery"]) {
    assert.match(read(`app/api/track/${r}/route.ts`), /resolveAnalyticsEnvironment\(\)/, r);
  }
});

test("only the live homepage and live guide route open a discovery page view — previews never do", () => {
  assert.match(read("app/(website)/page.tsx"), /<DiscoveryPageTracking/);
  assert.match(read("app/(website)/[market]/guides/[slug]/GuideDetailView.tsx"), /enableDiscoveryTracking \?\s*\(\s*<DiscoveryPageTracking/);
  assert.match(read("app/(website)/[market]/guides/[slug]/page.tsx"), /enableDiscoveryTracking/);
  const homepagePreview = read("app/control-panel/homepages/[id]/preview/page.tsx");
  const guidePreview = read("app/control-panel/content-engine/[id]/preview/page.tsx");
  for (const s of [homepagePreview, guidePreview]) {
    assert.doesNotMatch(s, /DiscoveryPageTracking|enableDiscoveryTracking/);
  }
});

test("all three listing pages and the hero capture searches through useSearchCapture with their mode", () => {
  const cases: Array<[string, string]> = [
    ["app/(website)/website-happy-hours/HappyHoursSearchClient.tsx", 'mode: "happy_hours"'],
    ["app/(website)/website-daily-specials/DailySpecialSearchResults.tsx", 'mode: "daily_specials"'],
    ["app/(website)/website-events/EventSearchResults.tsx", 'mode: "events"'],
  ];
  for (const [file, mode] of cases) {
    const s = read(file);
    assert.match(s, /useSearchCapture\(/, file);
    assert.ok(s.includes(mode), file);
    assert.match(s, /detectInitialOrigin: true/, file);
    assert.match(s, /markSearchTyped\(\)/, file);
    assert.match(s, /captureSearchNow\("enter"\)/, file);
  }
  const hero = read("app/(website)/HeroDiscoverySearch.tsx");
  assert.match(hero, /useSearchCapture\(/);
  assert.match(hero, /captureNow\("selection"\)/);
  assert.match(hero, /captureNow\("see_all"\)/);
  assert.match(hero, /writeSearchHandoff\(/);
  // fireWebsiteSearch is only ever called by the capture hook.
  for (const f of walk(join(SRC, "app"))) {
    if (f.endsWith("useSearchCapture.ts") || f.endsWith("searchTracking.ts")) continue;
    assert.doesNotMatch(readFileSync(f, "utf8"), /fireWebsiteSearch\(/, relative(SRC, f));
  }
});

test("operator Discover Impressions never count load-based venue_discover_events impressions", () => {
  const s = read("lib/data/operatorAnalyticsV2.ts");
  assert.doesNotMatch(s, /\.eq\("event_type", "impression"\)/);
  assert.match(s, /\.from\("website_discovery_events"\)/);
  assert.match(s, /\.eq\("environment", "production"\)/);
});
