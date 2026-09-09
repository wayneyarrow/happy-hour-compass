import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parentSectionIdForHash } from "../../../src/app/(website)/[market]/[city]/[slug]/StickyNav";

/**
 * "Daily Specials — Phase 3 Venue Detail UX Correction" task.
 *
 * Covers the two problems manual QA surfaced clicking a Daily Special card
 * through to the venue detail page:
 *   1. Happy Hour Times and Food/Drink Offers were two separate top-level
 *      sections/StickyNav items ("Happy Hour" and "Offers") — now one
 *      merged "Happy Hour" section/item.
 *   2. A #daily-special-<uuid> deep link landed correctly but StickyNav
 *      kept showing "Happy Hour" active — both an initial-state gap (no
 *      hash-aware resolution) and a real algorithm bug in the
 *      IntersectionObserver "topmost visible section" reducer.
 *
 * parentSectionIdForHash() is directly imported and exercised — real
 * behavioral coverage, not just source-regex — importable from a plain
 * Node test despite StickyNav.tsx being "use client" for the same reason
 * established throughout this suite (e.g. managerState.test.ts importing
 * resolveAfterSave from DailySpecialsManager.tsx): the RSC client-boundary
 * transform only applies inside Next.js's own build, never to a direct
 * Node/tsx import. Everything else here (venue name in the nav, the
 * observer reducer fix, the merged Happy Hour markup) has no DOM to
 * exercise in this repo's plain node:test runner, so it stays static
 * source verification, matching the rest of this suite's convention.
 */

const STICKY_NAV_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/StickyNav.tsx");
const STICKY_NAV_SOURCE = readFileSync(STICKY_NAV_PATH, "utf8");

const VENUE_PAGE_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/page.tsx");
const VENUE_PAGE_SOURCE = readFileSync(VENUE_PAGE_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// HASH → PARENT SECTION MAPPING — real behavioral tests
// ─────────────────────────────────────────────────────────────────────────

test("an individual Daily Special hash maps to its parent 'daily-specials' section", () => {
  assert.equal(parentSectionIdForHash("daily-special-3f9a1b2c-1111-4444-8888-abcdefabcdef"), "daily-specials");
});

test("the plural section-level hash maps to itself", () => {
  assert.equal(parentSectionIdForHash("daily-specials"), "daily-specials");
});

test("a top-level section hash (e.g. happy-hour) maps to itself", () => {
  assert.equal(parentSectionIdForHash("happy-hour"), "happy-hour");
  assert.equal(parentSectionIdForHash("events"), "events");
  assert.equal(parentSectionIdForHash("info"), "info");
});

test("an empty hash fragment maps to null", () => {
  assert.equal(parentSectionIdForHash(""), null);
});

test("mapping is a prefix check on the id shape, not a lookup requiring the full specials list — any daily-special-* id resolves the same way", () => {
  assert.equal(parentSectionIdForHash("daily-special-anything-at-all"), "daily-specials");
  assert.equal(parentSectionIdForHash("daily-special-"), "daily-specials");
});

// ─────────────────────────────────────────────────────────────────────────
// HASH ACTIVE STATE — initial resolution + normal scroll remains authoritative
// ─────────────────────────────────────────────────────────────────────────

test("StickyNav resolves the initial hash to an active section BEFORE paint (useLayoutEffect, not useEffect) to avoid a visible wrong-tab flash", () => {
  const layoutEffectBlock = STICKY_NAV_SOURCE.match(/useLayoutEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[\]\);/);
  assert.ok(layoutEffectBlock, "initial-hash useLayoutEffect not found");
  assert.match(layoutEffectBlock![1], /window\.location\.hash/);
  assert.match(layoutEffectBlock![1], /parentSectionIdForHash\(/);
  assert.match(layoutEffectBlock![1], /setActiveSection\(mapped\);/);
});

test("the initial hash is only applied when it resolves to a section that actually exists in this venue's nav — never an arbitrary/stale hash", () => {
  const layoutEffectBlock = STICKY_NAV_SOURCE.match(/useLayoutEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[\]\);/);
  assert.ok(layoutEffectBlock);
  assert.match(layoutEffectBlock![1], /sectionsRef\.current\.some\(\(s\) => s\.id === mapped\)/);
});

test("normal scroll-driven active-section updates are NOT gated behind whether an initial hash was resolved — the IntersectionObserver effect runs unconditionally on mount, same as before this correction", () => {
  const observerEffectIdx = STICKY_NAV_SOURCE.indexOf("useEffect(() => {\n    const secs = sectionsRef.current;");
  assert.ok(observerEffectIdx > -1);
  const observerEffectBlock = STICKY_NAV_SOURCE.slice(observerEffectIdx, STICKY_NAV_SOURCE.indexOf("function handleClick"));
  // No flag gating this effect on "did we already resolve an initial hash" —
  // it always sets up the observer and always calls setActiveSection from
  // real intersection data once it fires, exactly like pre-correction code.
  assert.doesNotMatch(observerEffectBlock, /hasResolvedInitialHash|initialHashApplied|skipObserver/);
  assert.match(observerEffectBlock, /setActiveSection\(topmost\.id\);/);
});

test("CRITICAL FIX: the 'topmost visible section' reducer picks the section with the GREATEST (least negative) top among intersecting entries, not the smallest — this was the actual bug behind Happy Hour staying highlighted while positioned at a Daily Special", () => {
  const reducerMatch = STICKY_NAV_SOURCE.match(
    /const topmost = visible\.reduce\(\(prev, curr\) => \{([\s\S]*?)\n {8}\}\);/
  );
  assert.ok(reducerMatch, "topmost reducer not found");
  assert.match(reducerMatch![1], /currTop > prevTop \? curr : prev/);
  // The old (buggy) inverted comparison must not be present anywhere.
  assert.doesNotMatch(STICKY_NAV_SOURCE, /currTop < prevTop \? curr : prev/);
});

// ─────────────────────────────────────────────────────────────────────────
// VENUE NAME IN STICKY NAV
// ─────────────────────────────────────────────────────────────────────────

test("StickyNav accepts a venueName prop and renders it as plain, readable (not aria-hidden) text", () => {
  assert.match(STICKY_NAV_SOURCE, /venueName\?: string;/);
  const venueNameBlock = STICKY_NAV_SOURCE.match(/\{venueName && \(([\s\S]*?)\n {8}\)\}/);
  assert.ok(venueNameBlock);
  assert.match(venueNameBlock![1], /\{venueName\}/);
  assert.doesNotMatch(venueNameBlock![1], /aria-hidden="true"[\s\S]*\{venueName\}/);
});

test("the venue name is styled distinctly from a section tab — no border-b-2/active-tab classes on it", () => {
  const venueNameBlock = STICKY_NAV_SOURCE.match(/\{venueName && \(([\s\S]*?)\n {8}\)\}/);
  assert.ok(venueNameBlock);
  assert.doesNotMatch(venueNameBlock![1], /border-b-2/);
});

test("the venue name truncates rather than causing overflow — bounded max-width plus truncate, and can shrink (not shrink-0)", () => {
  const venueNameBlock = STICKY_NAV_SOURCE.match(/\{venueName && \(([\s\S]*?)\n {8}\)\}/);
  assert.ok(venueNameBlock);
  assert.match(venueNameBlock![1], /truncate/);
  assert.match(venueNameBlock![1], /max-w-\[/);
  assert.doesNotMatch(venueNameBlock![1], /shrink-0 min-w-0 max-w-/); // must be able to shrink, not shrink-0
});

test("the section tabs row keeps its own overflow-x-auto scrolling, independent of the venue name", () => {
  assert.match(STICKY_NAV_SOURCE, /overflow-x-auto scrollbar-hide/);
});

test("page.tsx passes the real venue name into StickyNav", () => {
  assert.match(VENUE_PAGE_SOURCE, /<StickyNav sections=\{sections\} venueName=\{venue\.name\} \/>/);
});

// ─────────────────────────────────────────────────────────────────────────
// HAPPY HOUR MERGE — one section, one nav item, no empty Offers subheadings
// ─────────────────────────────────────────────────────────────────────────

test("there is exactly one top-level Happy Hour section/anchor — no separate 'specials'/'Offers' anchor remains", () => {
  const happyHourSectionMatches = VENUE_PAGE_SOURCE.match(/<section id="happy-hour"/g) ?? [];
  assert.equal(happyHourSectionMatches.length, 1);
  assert.doesNotMatch(VENUE_PAGE_SOURCE, /<section id="specials"/);
});

test("the sections/nav array has no 'Offers' or 'specials' entry", () => {
  const sectionsBlock = VENUE_PAGE_SOURCE.match(/const sections = \[([\s\S]*?)\n {2}\];/);
  assert.ok(sectionsBlock);
  assert.doesNotMatch(sectionsBlock![1], /"specials"/);
  assert.doesNotMatch(sectionsBlock![1], /Offers/);
});

test("the Happy Hour nav item is gated on hasHappyHour, which is true for either a weekly schedule OR food/drink offers — not hardcoded present", () => {
  assert.match(VENUE_PAGE_SOURCE, /const hasHappyHour = hasHappyHourWeekly \|\| hasSpecials;/);
  const sectionsBlock = VENUE_PAGE_SOURCE.match(/const sections = \[([\s\S]*?)\n {2}\];/);
  assert.ok(sectionsBlock);
  assert.match(sectionsBlock![1], /\.\.\.\(hasHappyHour \? \[\{ id: "happy-hour", label: "Happy Hour" \}\] : \[\]\),/);
});

test("Happy Hour Times has its own subheading inside the merged section", () => {
  assert.match(VENUE_PAGE_SOURCE, />\s*Happy Hour Times\s*</);
});

test("Food Offers and Drink Offers subsections are still individually conditional — no empty heading renders when one is absent", () => {
  const happyHourIdx = VENUE_PAGE_SOURCE.indexOf('id="happy-hour"');
  const nextSectionIdx = VENUE_PAGE_SOURCE.indexOf("<section id=", happyHourIdx + 1);
  const happyHourBlock = VENUE_PAGE_SOURCE.slice(happyHourIdx, nextSectionIdx > -1 ? nextSectionIdx : undefined);
  assert.match(happyHourBlock, /\{hasFood && \(/);
  assert.match(happyHourBlock, /\{hasDrinks && \(/);
  assert.match(happyHourBlock, /\{hasSpecials && \(/);
});

test("sections still conditionally render: hasEvents/hasAbout gating and the unconditional Info tab are unchanged", () => {
  const sectionsBlock = VENUE_PAGE_SOURCE.match(/const sections = \[([\s\S]*?)\n {2}\];/);
  assert.ok(sectionsBlock);
  assert.match(sectionsBlock![1], /\.\.\.\(hasEvents \? \[\{ id: "events", label: "Events" \}\] : \[\]\),/);
  assert.match(sectionsBlock![1], /\.\.\.\(hasAbout \? \[\{ id: "about", label: "About" \}\] : \[\]\),/);
  assert.match(sectionsBlock![1], /\{ id: "info", label: "Info" \},/);
});

// ─────────────────────────────────────────────────────────────────────────
// DEEP LINK — existing successful behavior is preserved
// ─────────────────────────────────────────────────────────────────────────

test("the exact daily-special-<id> anchor and its scroll-margin are unchanged by this correction", () => {
  const SECTION_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/DailySpecialsSection.tsx");
  const SECTION_SOURCE = readFileSync(SECTION_PATH, "utf8");
  assert.match(SECTION_SOURCE, /id=\{`daily-special-\$\{special\.id\}`\}/);
  assert.match(SECTION_SOURCE, /scrollMarginTop: scrollMargin/);
});

test("no standalone Daily Special detail page/route was introduced by this correction", () => {
  assert.doesNotMatch(VENUE_PAGE_SOURCE, /\/daily-specials\/\[id\]/);
  assert.doesNotMatch(VENUE_PAGE_SOURCE, /\/daily-specials\/\[slug\]/);
});

test("SCROLL_MARGIN is unchanged (132px) — no adjustment was found necessary for the revised StickyNav height", () => {
  assert.match(VENUE_PAGE_SOURCE, /const SCROLL_MARGIN = 132;/);
});
