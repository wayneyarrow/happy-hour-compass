import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Daily Specials — Final Visual Polish Pass" correction task.
 *
 * Purely presentational: a thin HHC-brand (amber-500) top accent line,
 * slightly deeper resting/hover shadows, a restrained hover lift, and a
 * secondary "View venue →" destination cue on the consumer search card;
 * a CSS `:target`-driven highlight (Tailwind's `target:` variant, no new
 * React state/listeners) for the exact hash-targeted Daily Special on the
 * venue-detail page. No product architecture, data, filters, or navigation
 * behavior changed — see the REGRESSION section below for the checks that
 * pin exactly that.
 *
 * Same no-DOM static-source-verification convention as the rest of this
 * suite.
 */

const CARD_PATH = join(__dirname, "../../../src/app/(website)/website-daily-specials/DailySpecialSearchCard.tsx");
const CARD_SOURCE = readFileSync(CARD_PATH, "utf8");

const SECTION_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/DailySpecialsSection.tsx");
const SECTION_SOURCE = readFileSync(SECTION_PATH, "utf8");

const FORM_PATH = join(__dirname, "../../../src/app/admin/daily-specials/DailySpecialForm.tsx");
const FORM_SOURCE = readFileSync(FORM_PATH, "utf8");

const RESULTS_PATH = join(__dirname, "../../../src/app/(website)/website-daily-specials/DailySpecialSearchResults.tsx");
const RESULTS_SOURCE = readFileSync(RESULTS_PATH, "utf8");

const STICKY_NAV_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/StickyNav.tsx");
const STICKY_NAV_SOURCE = readFileSync(STICKY_NAV_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// SEARCH CARD — still no images
// ─────────────────────────────────────────────────────────────────────────

test("the search card still renders no <img> element and never reads an image field, after the polish pass", () => {
  assert.doesNotMatch(CARD_SOURCE, /<img/);
  assert.doesNotMatch(CARD_SOURCE, /imageUrl/);
});

// ─────────────────────────────────────────────────────────────────────────
// SEARCH CARD — brand accent
// ─────────────────────────────────────────────────────────────────────────

test("the card has a top accent line using the existing HHC brand amber token (amber-500) — not a newly introduced orange value", () => {
  assert.match(CARD_SOURCE, /<div className="h-1 bg-amber-500" aria-hidden="true" \/>/);
});

test("the accent line is a thin strip (Tailwind h-1 = 4px), consistent with the ~3-4px target, not a thick banner", () => {
  const accentMatch = CARD_SOURCE.match(/<div className="(h-\S+) bg-amber-500"/);
  assert.ok(accentMatch);
  assert.equal(accentMatch![1], "h-1");
});

test("the accent line sits above the padded content, spanning the full card width edge-to-edge (article has overflow-hidden for clean rounded corners, content padding lives on an inner wrapper, not the article itself)", () => {
  assert.match(CARD_SOURCE, /overflow-hidden/);
  const accentIdx = CARD_SOURCE.indexOf('bg-amber-500" aria-hidden');
  const paddedWrapperIdx = CARD_SOURCE.indexOf('className="px-5 py-5 space-y-2"');
  assert.ok(accentIdx > -1 && paddedWrapperIdx > -1 && accentIdx < paddedWrapperIdx);
});

// ─────────────────────────────────────────────────────────────────────────
// SEARCH CARD — shadow / hover
// ─────────────────────────────────────────────────────────────────────────

test("the resting shadow is present and distinct from a flat/no-shadow directory-list look", () => {
  assert.match(CARD_SOURCE, /shadow-\[0_1px_4px_rgba\(0,0,0,0\.05\),0_6px_18px_rgba\(0,0,0,0\.09\)\]/);
});

test("the hover shadow is stronger than the resting shadow but not dramatically so — a modest increase, not a heavy floating-card effect", () => {
  assert.match(CARD_SOURCE, /hover:shadow-\[0_3px_10px_rgba\(0,0,0,0\.06\),0_16px_32px_rgba\(0,0,0,0\.11\)\]/);
});

test("the hover lift is restrained — approximately 1-2px, not the more dramatic 3px used by sibling website cards", () => {
  assert.match(CARD_SOURCE, /hover:-translate-y-\[2px\]/);
  assert.doesNotMatch(CARD_SOURCE, /hover:-translate-y-\[3px\]/);
});

test("the hover transition is smooth and short (200ms), not instant or exaggerated", () => {
  assert.match(CARD_SOURCE, /transition-all duration-200/);
});

// ─────────────────────────────────────────────────────────────────────────
// SEARCH CARD — background / badge unchanged
// ─────────────────────────────────────────────────────────────────────────

test("the card background remains white — no category-colored card backgrounds were introduced", () => {
  assert.match(CARD_SOURCE, /bg-white rounded-2xl/);
  assert.doesNotMatch(CARD_SOURCE, /offerType === "food"[\s\S]*bg-|offerType === "drink"[\s\S]*bg-/);
});

test("the offer-type badge treatment (Food / Drink / Food & Drink) is unchanged", () => {
  assert.match(CARD_SOURCE, /bg-amber-50 border border-amber-100 text-\[11px\] font-semibold text-amber-700 tracking-wide uppercase/);
});

// ─────────────────────────────────────────────────────────────────────────
// SEARCH CARD — text hierarchy preserved
// ─────────────────────────────────────────────────────────────────────────

test("the full text hierarchy is preserved: badge, title, venue name, short summary, schedule/time — nothing was hidden or removed", () => {
  // Scoped to the rendered JSX only (from the article's content wrapper to
  // its closing tag) — the tokens also appear earlier as plain variable
  // declarations (e.g. `const offerLabel = ...`), which would corrupt an
  // order check against the whole file.
  const jsxStart = CARD_SOURCE.indexOf('className="px-5 py-5 space-y-2"');
  const jsxEnd = CARD_SOURCE.indexOf("</article>");
  const jsx = CARD_SOURCE.slice(jsxStart, jsxEnd);
  const order = ["offerLabel", "special.title", "special.venueName", "special.shortSummary", "scheduleTimeLine"];
  let lastIdx = -1;
  for (const token of order) {
    const idx = jsx.indexOf(token);
    assert.ok(idx > -1, `${token} not found in the rendered JSX`);
    assert.ok(idx > lastIdx, `${token} appears out of the expected hierarchy order`);
    lastIdx = idx;
  }
});

// ─────────────────────────────────────────────────────────────────────────
// SEARCH CARD — destination cue
// ─────────────────────────────────────────────────────────────────────────

test("a 'View venue →' destination cue exists, visually secondary (small, muted, distinct from the schedule/time line's styling)", () => {
  assert.match(CARD_SOURCE, /View venue →/);
  const cueMatch = CARD_SOURCE.match(/<p className="([^"]*)">\s*View venue →/);
  assert.ok(cueMatch);
  assert.match(cueMatch![1], /text-xs/);
  assert.match(cueMatch![1], /text-gray-400/);
});

test("the destination cue is plain decorative text, not a second interactive element — no nested <a>/<button>/<Link> inside the card content", () => {
  const contentStart = CARD_SOURCE.indexOf('className="px-5 py-5 space-y-2"');
  const contentEnd = CARD_SOURCE.indexOf("</article>");
  const contentBlock = CARD_SOURCE.slice(contentStart, contentEnd);
  assert.doesNotMatch(contentBlock, /<a\s|<button|<Link/);
});

test("the whole card remains exactly one interactive element — a single <Link> wrapping the entire article", () => {
  const linkCount = (CARD_SOURCE.match(/<Link\b/g) ?? []).length;
  assert.equal(linkCount, 1);
});

// ─────────────────────────────────────────────────────────────────────────
// SEARCH CARD — focus state preserved
// ─────────────────────────────────────────────────────────────────────────

test("the visible keyboard focus ring is unchanged by the shadow/accent polish", () => {
  assert.match(CARD_SOURCE, /focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/);
});

// ─────────────────────────────────────────────────────────────────────────
// SEARCH CARD — exact href unchanged
// ─────────────────────────────────────────────────────────────────────────

test("the exact deep-link href shape is completely unchanged by the visual polish", () => {
  assert.match(CARD_SOURCE, /`\$\{venuePath\}#daily-special-\$\{special\.id\}`/);
});

// ─────────────────────────────────────────────────────────────────────────
// VENUE PAGE — target highlight approach
// ─────────────────────────────────────────────────────────────────────────

test("the exact hash-targeted Special uses Tailwind's target: variant (plain CSS :target) — no new React state was added for this", () => {
  assert.match(SECTION_SOURCE, /target:border-amber-300/);
  assert.match(SECTION_SOURCE, /target:bg-amber-50\/70/);
  // No new useState was introduced in this file for highlighting purposes —
  // the only state remains todayIsoDate (pre-existing, unrelated). Counts
  // actual useState(...) call sites, not the "useState" identifier in the
  // import line.
  const useStateCallCount = (SECTION_SOURCE.match(/= useState[<(]/g) ?? []).length;
  assert.equal(useStateCallCount, 1);
});

test("target styling includes at least one structural cue beyond background color alone — a ring (stronger outline) and a border-color change, not color tint alone", () => {
  assert.match(SECTION_SOURCE, /target:ring-2 target:ring-amber-300\/70/);
  assert.match(SECTION_SOURCE, /target:border-amber-300/);
});

test("the ring-based structural cue uses a box-shadow-driven Tailwind ring (no border-width change), so the highlighted card causes no layout shift relative to its neutral siblings", () => {
  // The base border stays a plain 1px `border` the whole time — only its
  // color changes under :target, via `target:border-amber-300` — never a
  // border-width utility switch (e.g. border vs border-2) that would shift
  // the box size.
  assert.match(SECTION_SOURCE, /className="\s*p-5 rounded-xl border border-gray-100 bg-gray-50\/60/);
  assert.doesNotMatch(SECTION_SOURCE, /target:border-2/);
});

test("the target styling is attached to the individual Special's own div — the same element that carries its unique id — not a shared/ancestor wrapper", () => {
  const idIdx = SECTION_SOURCE.indexOf("id={`daily-special-${special.id}`}");
  const classIdx = SECTION_SOURCE.indexOf("target:border-amber-300");
  assert.ok(idIdx > -1 && classIdx > -1);
  // Both attributes belong to the same JSX element — no other `id=` or
  // `<div` boundary appears between them.
  const between = SECTION_SOURCE.slice(idIdx, classIdx);
  assert.doesNotMatch(between, /<div/);
});

test(":target is inherently exclusive — a URL fragment can only ever match one element's id, so only the exact requested Special can receive the highlighted treatment on any given page load, never multiple", () => {
  // This is a property of the CSS :target pseudo-class itself (structural
  // guarantee, not app logic to test) — pinned here by confirming the
  // component renders exactly one id per Special (already covered
  // elsewhere) and applies the SAME target: classes uniformly to every
  // card, rather than conditionally to a subset — i.e. there is no
  // per-item highlighting logic to get wrong.
  const targetClassOccurrences = (SECTION_SOURCE.match(/target:border-amber-300/g) ?? []).length;
  assert.equal(targetClassOccurrences, 1, "target: classes must be written once, applied uniformly via the shared card className, not per-item conditionally");
});

test("the target highlight requires no new scroll listener or timer — it coexists with the existing deterministic scroll-correction effect without touching it", () => {
  assert.doesNotMatch(SECTION_SOURCE, /addEventListener\("scroll"/);
  assert.doesNotMatch(SECTION_SOURCE, /setTimeout|setInterval/);
  // The pre-existing scroll-correction effect (from the prior deep-link
  // correction task) is still present, unmodified in mechanism.
  assert.match(SECTION_SOURCE, /useEffect\(\(\) => \{\s*if \(!todayIsoDate\) return;/);
});

// ─────────────────────────────────────────────────────────────────────────
// VENUE PAGE — still no images
// ─────────────────────────────────────────────────────────────────────────

test("no image rendering was reintroduced on the venue-page Daily Specials section by this polish pass", () => {
  assert.doesNotMatch(SECTION_SOURCE, /<img/);
  assert.doesNotMatch(SECTION_SOURCE, /getVenueImageSrc/);
});

// ─────────────────────────────────────────────────────────────────────────
// VENUE PAGE — exact item IDs unchanged
// ─────────────────────────────────────────────────────────────────────────

test("each Special's exact DOM id shape is unchanged: id=\"daily-special-<uuid>\"", () => {
  assert.match(SECTION_SOURCE, /id=\{`daily-special-\$\{special\.id\}`\}/);
});

// ─────────────────────────────────────────────────────────────────────────
// REGRESSION — filters, search, market scoping, deep link, StickyNav,
// Operator form image removal all unchanged
// ─────────────────────────────────────────────────────────────────────────

test("day filters, type filters, and text search logic in the results page are untouched by this visual-only pass", () => {
  assert.match(RESULTS_SOURCE, /dailySpecialMatchesWhenFilter/);
  assert.match(RESULTS_SOURCE, /dailySpecialMatchesSearch/);
  assert.match(RESULTS_SOURCE, /typeFilter/);
});

test("market scoping (the server query feeding the results page) is untouched — still filters is_published on both the Special and the venue", () => {
  const DATA_PATH = join(__dirname, "../../../src/lib/data/dailySpecials.ts");
  const dataSource = readFileSync(DATA_PATH, "utf8");
  const fnBlock = dataSource.slice(dataSource.indexOf("export async function getPublishedDailySpecialsForWebsite"));
  assert.match(fnBlock, /\.eq\("is_published", true\)/);
  assert.match(fnBlock, /\.eq\("venues\.is_published", true\)/);
});

test("the StickyNav hash-to-parent mapping and initial-hash lock mechanism are untouched by this visual pass", () => {
  assert.match(STICKY_NAV_SOURCE, /export function parentSectionIdForHash/);
  assert.match(STICKY_NAV_SOURCE, /initialHashLockRef/);
});

test("Operator Admin image controls remain fully removed — no upload/replace/remove UI was reintroduced", () => {
  assert.doesNotMatch(FORM_SOURCE, /Upload image/);
  assert.doesNotMatch(FORM_SOURCE, /Replace image/);
  assert.doesNotMatch(FORM_SOURCE, /Remove image/);
  assert.doesNotMatch(FORM_SOURCE, /type="file"/);
});

test("no database/schema/migration references appear in any file touched by this visual polish pass", () => {
  for (const source of [CARD_SOURCE, SECTION_SOURCE]) {
    assert.doesNotMatch(source, /ALTER TABLE|CREATE TABLE|migration/i);
  }
});
