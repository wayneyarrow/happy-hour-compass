import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Public website location is deferred: no page asks for browser location on
 * load. getCurrentPosition() may only be called from useBrowserLocation
 * (silent read when permission is already granted, or an explicit request)
 * and from WebsiteLocationSwitcher's explicit "Use my location" button.
 */

const WEBSITE = join(__dirname, "../../../src/app/(website)");
const read = (p: string) => readFileSync(join(WEBSITE, p), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("only useBrowserLocation and the location switcher call getCurrentPosition", () => {
  const callers = sourceFiles(WEBSITE)
    .filter((f) => /getCurrentPosition\s*\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(WEBSITE, f))
    .sort();
  assert.deepEqual(callers, ["WebsiteLocationSwitcher.tsx", "useBrowserLocation.ts"]);
});

test("useBrowserLocation only reads on mount when permission is already granted", () => {
  const src = read("useBrowserLocation.ts");
  assert.match(src, /permissions\s*\n?\s*\.query\(\{ name: "geolocation" \}\)/);
  assert.match(src, /if \(result\.state === "granted"\) void request\(\);/);
});

test("HeroSection makes no location request and no market auto-detect", () => {
  const src = read("HeroSection.tsx");
  assert.doesNotMatch(src, /geolocation/);
  assert.doesNotMatch(src, /setMarketAction|findNearestActiveMarket/);
});

test("Happy Hours requests location only from Near Me and an explicit Nearest choice", () => {
  const src = read("website-happy-hours/HappyHoursSearchClient.tsx");
  assert.match(src, /useBrowserLocation\(/);
  const callSites = src.match(/requestLocationExplicitly\("(nearMe|nearest)"\);/g) ?? [];
  assert.deepEqual(callSites, ['requestLocationExplicitly("nearMe");', 'requestLocationExplicitly("nearest");']);
  assert.match(src, /setNearMePending\("user"\);\s*requestLocationExplicitly\("nearMe"\);/);
  assert.match(src, /if \(s === "distance" && !userLocation\) \{/);
});

test("Near Me only counts as applied once a position exists", () => {
  const src = read("website-happy-hours/HappyHoursSearchClient.tsx");
  // Every setNearMeActive(true) is guarded by an existing position.
  const sets = src.match(/setNearMeActive\(true\)/g) ?? [];
  assert.equal(sets.length, 2);
  assert.match(src, /if \(userLocation\) \{\s*setNearMeActive\(true\);/);
  assert.match(src, /if \(!userLocation \|\| !nearMePending\) return;[\s\S]{0,200}setNearMeActive\(true\);/);
  // ?near=1 never switches Near Me on directly.
  assert.doesNotMatch(src, /setNearMeActive\(params\.get\("near"\)/);
  // The sort chip doesn't claim "Nearest" without a position.
  assert.match(src, /sortBy === "distance" && !hasLoc \? "Sort" : null/);
});

test("venue page distance never requests location itself", () => {
  const src = read("[market]/[city]/[slug]/VenueActionCard.tsx");
  assert.match(src, /useBrowserLocation\(/);
  assert.doesNotMatch(src, /requestLocation|\.request\(/);
});
