import assert from "node:assert/strict";
import {
  generateGuideSeo,
  getPrimaryKeywordWarning,
  META_TITLE_MAX_LEN,
  OG_TITLE_MAX_LEN,
  META_DESCRIPTION_MAX_LEN,
  OG_DESCRIPTION_MAX_LEN,
} from "../src/lib/seo/contentGuideSeo";

/**
 * Targeted regression script for generateGuideSeo() (Phase 1 fix — see the
 * Content Guide SEO generator investigation/fix task). No unit test runner
 * (Jest/Vitest) exists in this project — only Playwright e2e — so this
 * follows the same ad hoc "tsx scripts/*.ts" pattern already used
 * throughout scripts/ rather than introducing a new test framework. Run
 * with: npx tsx scripts/testContentGuideSeo.ts
 *
 * Covers the two systemic bugs from the investigation, using the exact
 * real-world inputs that exposed them (Patios guide's 5-phrase
 * primary_keyword; North End guide's long title) plus a couple of guard
 * cases to confirm existing behaviour is preserved.
 */

let passed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

/**
 * The real invariant "truncation is word-aware" means: whatever text
 * precedes the ellipsis must be an exact prefix of the original string,
 * and the character immediately following that prefix in the original
 * must be whitespace (or nothing, i.e. no truncation happened at all).
 * This is stronger than checking against one hand-picked expected string —
 * it holds regardless of exactly which word the cap happens to land after.
 */
function assertWordBoundaryCut(original: string, truncated: string, label: string) {
  if (!truncated.endsWith("…")) {
    assert.equal(truncated, original, `${label}: no ellipsis, but doesn't equal the original`);
    return;
  }
  const cutText = truncated.slice(0, -1);
  assert.ok(original.startsWith(cutText), `${label}: truncated text must be a prefix of the original`);
  const nextChar = original[cutText.length];
  assert.ok(
    nextChar === undefined || /\s/.test(nextChar),
    `${label}: cut must land right before whitespace, got next char ${JSON.stringify(nextChar)} in ${JSON.stringify(truncated)}`
  );
}

console.log("generateGuideSeo() regression checks\n");

// ── 1. Patios guide — the exact primary_keyword that produced the
// mid-word-truncated, keyword-stuffed meta_title in production. ──────────
check("long comma-joined primary_keyword no longer truncates meta_title mid-word", () => {
  const primaryKeyword =
    "Kelowna patio happy hour, best patios Kelowna, Kelowna happy hour, outdoor dining Kelowna, Kelowna restaurants with patios";
  const seo = generateGuideSeo({
    guideType: "venue_guide",
    marketName: "Central Okanagan",
    marketSlug: "central-okanagan",
    cityName: "Kelowna",
    title: "Best Happy Hours with Patios in Kelowna",
    slug: "best-happy-hours-with-patios-in-kelowna",
    primaryKeyword,
    secondaryKeywords: [],
    intro: "When the weather warms up, there's no better place to unwind than a great patio.",
  });
  assert.ok(seo.meta_title.value.length <= META_TITLE_MAX_LEN, "meta_title must fit its cap");
  assert.ok(!seo.meta_title.value.endsWith("Happ…"), "must not cut mid-word ('Happ…')");
  // The capitalized form of the primary keyword is what's actually fed
  // into truncate() (see metaTitleSubject in contentGuideSeo.ts), so that's
  // the source string the word-boundary invariant must hold against.
  const capitalizedSubject = primaryKeyword.replace(/\b\w/g, (c) => c.toUpperCase());
  assertWordBoundaryCut(capitalizedSubject, seo.meta_title.value, "meta_title");
  console.log(`      meta_title: ${JSON.stringify(seo.meta_title.value)}`);
});

// ── 2. Duplicate-location suppression — title already ends with the city. ─
check('page_title does not duplicate "Kelowna" when title already contains it', () => {
  const seo = generateGuideSeo({
    guideType: "venue_guide",
    marketName: "Central Okanagan",
    marketSlug: "central-okanagan",
    cityName: "Kelowna",
    title: "Best Happy Hours with Patios in Kelowna",
    slug: "best-happy-hours-with-patios-in-kelowna",
    primaryKeyword: "Kelowna patio happy hour",
    secondaryKeywords: [],
  });
  const occurrences = (seo.page_title.value.match(/Kelowna/gi) ?? []).length;
  assert.equal(occurrences, 1, `expected exactly one "Kelowna", got: ${seo.page_title.value}`);
  assert.equal(
    seo.page_title.value,
    "Best Happy Hours with Patios in Kelowna | Happy Hour Compass"
  );
});

check('meta_title does not duplicate "Kelowna" when the keyword already contains it', () => {
  const seo = generateGuideSeo({
    guideType: "venue_guide",
    marketName: "Central Okanagan",
    marketSlug: "central-okanagan",
    cityName: "Kelowna",
    title: "Best Happy Hours with Patios in Kelowna",
    slug: "best-happy-hours-with-patios-in-kelowna",
    primaryKeyword: "Kelowna patio happy hour",
    secondaryKeywords: [],
  });
  const occurrences = (seo.meta_title.value.match(/Kelowna/gi) ?? []).length;
  assert.equal(occurrences, 1, `expected exactly one "Kelowna", got: ${seo.meta_title.value}`);
});

// ── 3. North End guide — long title that overflows OG_TITLE_MAX_LEN. ─────
// This title is 77 characters on its own — longer than OG_TITLE_MAX_LEN
// (70) even with the redundant "| Kelowna" correctly suppressed (fix B),
// so *some* truncation of the title itself is unavoidable here. The bar
// this checks is narrower: whatever gets dropped must be whole trailing
// words (the earlier report's "…District" being dropped is expected and
// fine), never a word sliced in half.
check("og_title truncates on a word boundary, never mid-word, and stays within cap", () => {
  const title = "Why Kelowna's North End Has Become the City's Hottest Food & Brewery District";
  const seo = generateGuideSeo({
    guideType: "venue_guide",
    marketName: "Central Okanagan",
    marketSlug: "central-okanagan",
    cityName: "Kelowna",
    title,
    slug: "why-kelowna-s-north-end-has-become-the-city-s-hottest-food-brewery-district",
    primaryKeyword: "Kelowna North End",
    secondaryKeywords: [],
  });
  assert.ok(seo.og_title.value.length <= OG_TITLE_MAX_LEN, "og_title must fit its cap");
  assertWordBoundaryCut(title, seo.og_title.value, "og_title");
  console.log(`      og_title: ${JSON.stringify(seo.og_title.value)}`);
});

// ── 4. Preserved behaviour — location IS appended when genuinely absent. ─
check("location is still appended when not already present in the title", () => {
  const seo = generateGuideSeo({
    guideType: "venue_guide",
    marketName: "Central Okanagan",
    marketSlug: "central-okanagan",
    cityName: "Kelowna",
    title: "Date Night Happy Hours",
    slug: "date-night-happy-hours",
    primaryKeyword: "happy hour kelowna",
    secondaryKeywords: [],
  });
  assert.equal(seo.page_title.value, "Date Night Happy Hours | Kelowna | Happy Hour Compass");
});

// ── 5. Generic truncate() word-boundary behaviour via meta_description. ──
check("meta_description never ends mid-word and stays within its cap", () => {
  const longIntro =
    "Once an industrial corner of the city, Kelowna's North End has transformed into one " +
    "of the Okanagan's most exciting places to eat, drink, and explore. Home to award-winning " +
    "breweries, creative restaurants, local distilleries, and a growing arts scene.";
  const seo = generateGuideSeo({
    guideType: "venue_guide",
    marketName: "Central Okanagan",
    marketSlug: "central-okanagan",
    cityName: "Kelowna",
    title: "Why Kelowna's North End Has Become the City's Hottest Food & Brewery District",
    slug: "why-kelowna-s-north-end-has-become-the-city-s-hottest-food-brewery-district",
    intro: longIntro,
  });
  assert.ok(seo.meta_description.value.length <= META_DESCRIPTION_MAX_LEN);
  assert.ok(seo.og_description.value.length <= OG_DESCRIPTION_MAX_LEN);
  assertWordBoundaryCut(longIntro, seo.meta_description.value, "meta_description");
  assertWordBoundaryCut(longIntro, seo.og_description.value, "og_description");
  console.log(`      og_description: ${JSON.stringify(seo.og_description.value)}`);
});

// ── 6. Truncate never exceeds the max even with no spaces at all. ────────
check("a single very long word without spaces still falls back to a safe hard cut", () => {
  const seo = generateGuideSeo({
    guideType: "venue_guide",
    marketName: "Central Okanagan",
    marketSlug: "central-okanagan",
    cityName: "Kelowna",
    title: "X".repeat(100),
    slug: "x",
  });
  assert.ok(seo.page_title.value.length >= 0); // page_title is uncapped by design
  assert.ok(seo.meta_title.value.length <= META_TITLE_MAX_LEN);
});

// ── 7. Primary Keyword comma warning (non-blocking UI nudge). ────────────
check("getPrimaryKeywordWarning flags a comma-separated value", () => {
  assert.ok(getPrimaryKeywordWarning("kelowna patio happy hour, best patios kelowna") !== null);
});

check("getPrimaryKeywordWarning is silent for a single phrase", () => {
  assert.equal(getPrimaryKeywordWarning("kelowna patio happy hour"), null);
});

check("getPrimaryKeywordWarning is silent for an empty value", () => {
  assert.equal(getPrimaryKeywordWarning(""), null);
});

console.log(`\n${passed} check(s) passed${process.exitCode ? ", with failures above" : ""}.`);
