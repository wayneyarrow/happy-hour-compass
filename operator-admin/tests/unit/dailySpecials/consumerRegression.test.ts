import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static source verification for Phase 3 consumer-facing pieces that have
 * no DOM available to exercise in this repo's plain node:test runner —
 * same no-DOM convention as the Operator Admin form regression tests.
 */

const CARD_PATH = join(
  __dirname,
  "../../../src/app/(website)/website-daily-specials/DailySpecialSearchCard.tsx"
);
const CARD_SOURCE = readFileSync(CARD_PATH, "utf8");

const VENUE_PAGE_PATH = join(
  __dirname,
  "../../../src/app/(website)/[market]/[city]/[slug]/page.tsx"
);
const VENUE_PAGE_SOURCE = readFileSync(VENUE_PAGE_PATH, "utf8");

const SECTION_PATH = join(
  __dirname,
  "../../../src/app/(website)/[market]/[city]/[slug]/DailySpecialsSection.tsx"
);
const SECTION_SOURCE = readFileSync(SECTION_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// LINKING — card URL contains the exact Special anchor
// ─────────────────────────────────────────────────────────────────────────

test("card links to the venue detail path with #daily-special-<id>, never a standalone Special page", () => {
  assert.match(CARD_SOURCE, /`\$\{venuePath\}#daily-special-\$\{special\.id\}`/);
  assert.doesNotMatch(CARD_SOURCE, /\/daily-specials\/\$\{/);
  assert.doesNotMatch(CARD_SOURCE, /special\.slug/);
});

test("card never links to the top of the venue page or a generic section anchor — the exact Special id is the destination", () => {
  assert.doesNotMatch(CARD_SOURCE, /#daily-specials`/); // the plural SECTION id, not a specific special
  assert.match(CARD_SOURCE, /#daily-special-/); // singular, id-specific
});

// ─────────────────────────────────────────────────────────────────────────
// VENUE DETAIL — section/nav visibility and stable anchors
// ─────────────────────────────────────────────────────────────────────────

test("Daily Specials nav entry only appears when the venue has published Daily Specials", () => {
  assert.match(VENUE_PAGE_SOURCE, /hasDailySpecials \? \[\{ id: "daily-specials", label: "Daily Specials" \}\] : \[\]/);
});

test("hasDailySpecials is derived from venue.dailySpecials.length, not a hardcoded true", () => {
  assert.match(VENUE_PAGE_SOURCE, /const hasDailySpecials = venue\.dailySpecials\.length > 0;/);
});

test("Daily Specials section only renders when hasDailySpecials is true", () => {
  const sectionBlockIdx = VENUE_PAGE_SOURCE.indexOf('id="daily-specials"');
  assert.ok(sectionBlockIdx > -1);
  const before = VENUE_PAGE_SOURCE.slice(Math.max(0, sectionBlockIdx - 200), sectionBlockIdx);
  assert.match(before, /\{hasDailySpecials && \(/);
});

test("Daily Specials section uses the same SCROLL_MARGIN convention as every other venue-detail section", () => {
  const sectionBlockIdx = VENUE_PAGE_SOURCE.indexOf('id="daily-specials"');
  const nearby = VENUE_PAGE_SOURCE.slice(sectionBlockIdx, sectionBlockIdx + 200);
  assert.match(nearby, /scrollMarginTop: SCROLL_MARGIN/);
});

test("each Daily Special gets a stable DOM anchor: daily-special-<id>", () => {
  assert.match(SECTION_SOURCE, /id=\{`daily-special-\$\{special\.id\}`\}/);
});

test("each Daily Special anchor also carries scrollMarginTop, so a direct hash load lands below the sticky header", () => {
  const idIdx = SECTION_SOURCE.indexOf("id={`daily-special-${special.id}`}");
  const nearby = SECTION_SOURCE.slice(idIdx, idIdx + 150);
  assert.match(nearby, /scrollMarginTop: scrollMargin/);
});

// DailySpecialDeepLinkScroll was retired (Text-First + Deep-Link correction
// task): its one-time, mount-only scroll check ran BEFORE
// DailySpecialsSection's own today-aware re-sort for a multi-Special venue,
// so a correct-at-the-time scroll position was invalidated the instant the
// re-sort reflowed the surrounding cards — invisible with a single
// synthetic Special, but wrong for any real multi-Special venue. The
// correction now lives inside DailySpecialsSection itself, in an effect
// keyed on `todayIsoDate` so it only runs after that reorder has already
// committed — see deepLinkArrival.test.ts for the direct coverage.
test("the standalone DailySpecialDeepLinkScroll component no longer exists or is rendered — deep-link scroll correction now lives inside DailySpecialsSection, after its own reorder settles", () => {
  assert.doesNotMatch(VENUE_PAGE_SOURCE, /DailySpecialDeepLinkScroll/);
});

test("Daily Specials section presentation is a flat list, not per-weekday duplicated sections — no per-day grouping headers", () => {
  assert.doesNotMatch(SECTION_SOURCE, /MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY/);
});

// ─────────────────────────────────────────────────────────────────────────
// NO SPECIAL DETAIL PAGE
// ─────────────────────────────────────────────────────────────────────────

test("no Daily Special slug/detail route exists anywhere in the new consumer files", () => {
  for (const source of [CARD_SOURCE, VENUE_PAGE_SOURCE, SECTION_SOURCE]) {
    assert.doesNotMatch(source, /\/daily-specials\/\[id\]/);
    assert.doesNotMatch(source, /\/daily-specials\/\[slug\]/);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// HAPPY HOUR TERMINOLOGY CLEANUP
// ─────────────────────────────────────────────────────────────────────────

test("venue detail no longer uses \"Happy Hour Specials\" / bare \"Food\" / bare \"Drinks\" headings — uses Food Offers / Drink Offers", () => {
  // Scoped to the actual rendered heading text (">Happy Hour Specials<"),
  // not the bare phrase anywhere in the file — this file's own comments
  // legitimately explain what the OLD copy used to say as prose.
  assert.doesNotMatch(VENUE_PAGE_SOURCE, />Happy Hour Specials</);
  assert.match(VENUE_PAGE_SOURCE, />\s*Food Offers\s*</);
  assert.match(VENUE_PAGE_SOURCE, />\s*Drink Offers\s*</);
});

// Venue-detail UX correction: Happy Hour Times and Food/Drink Offers were
// merged into ONE top-level "Happy Hour" section/nav item — the separate
// "Food & Drink Offers" top-level heading and its own id="specials" anchor
// are retired along with the old two-nav-item split (see StickyNav's own
// tests below for the nav-item side of this).
test("no separate top-level \"Food & Drink Offers\" heading exists — Food/Drink Offers are subheadings inside Happy Hour, not their own section", () => {
  assert.doesNotMatch(VENUE_PAGE_SOURCE, /Food &amp;? ?Drink Offers|Food & Drink Offers/);
});

test("id=\"specials\" no longer exists as a real DOM anchor — Food/Drink Offers have no section-level anchor of their own", () => {
  // Excludes this file's own explanatory comment text (which legitimately
  // mentions the retired id in prose) — scoped to an actual JSX id
  // attribute usage: `id="specials"` immediately followed by a scroll-margin
  // style prop, the shape every real section anchor in this file uses.
  assert.doesNotMatch(VENUE_PAGE_SOURCE, /id="specials" style=\{\{ scrollMarginTop/);
});

test("Food Offers and Drink Offers render inside the single id=\"happy-hour\" section, not a separate section element", () => {
  const happyHourIdx = VENUE_PAGE_SOURCE.indexOf('id="happy-hour"');
  const foodOffersMatch = />\s*Food Offers\s*</.exec(VENUE_PAGE_SOURCE);
  const nextSectionIdx = VENUE_PAGE_SOURCE.indexOf("<section id=", happyHourIdx + 1);
  assert.ok(happyHourIdx > -1 && foodOffersMatch, "happy-hour section or Food Offers heading not found");
  const foodOffersIdx = foodOffersMatch!.index;
  assert.ok(foodOffersIdx > happyHourIdx, "Food Offers must be inside (after) the happy-hour section start");
  // Whatever the NEXT <section id=...> in the file is (Daily Specials, or
  // Events if there are no Daily Specials), Food Offers must appear before
  // it — i.e. still nested inside Happy Hour, not a sibling section after it.
  if (nextSectionIdx > -1) {
    assert.ok(foodOffersIdx < nextSectionIdx, "Food Offers must appear before the next top-level section");
  }
});

test("the underlying hh_food_details/hh_drink_details-backed fields are untouched by the terminology cleanup — copy only, no data/field rename", () => {
  assert.match(VENUE_PAGE_SOURCE, /venue\.specialsFood/);
  assert.match(VENUE_PAGE_SOURCE, /venue\.specialsDrinks/);
});

// ─────────────────────────────────────────────────────────────────────────
// VISIBILITY — no draft/unpublished/ineligible content in consumer paths
// ─────────────────────────────────────────────────────────────────────────

const DATA_HELPER_PATH = join(__dirname, "../../../src/lib/data/dailySpecials.ts");
const DATA_HELPER_SOURCE = readFileSync(DATA_HELPER_PATH, "utf8");

test("the website market query filters on both the Special's own published flag and the venue's published flag", () => {
  const fnBlock = DATA_HELPER_SOURCE.slice(
    DATA_HELPER_SOURCE.indexOf("export async function getPublishedDailySpecialsForWebsite")
  );
  assert.match(fnBlock, /\.eq\("is_published", true\)/);
  assert.match(fnBlock, /\.eq\("venues\.is_published", true\)/);
  assert.match(fnBlock, /venues!inner\(/);
});
