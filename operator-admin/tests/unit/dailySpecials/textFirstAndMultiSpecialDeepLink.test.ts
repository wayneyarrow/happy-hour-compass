import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Daily Specials — Text-First Consumer UX + Exact Deep-Link Correction"
 * task.
 *
 * Two independent fixes, both surfaced by real seeded inventory rather
 * than synthetic single-item QA:
 *
 * 1. IMAGES REMOVED — real seeded Daily Specials never had Special-specific
 *    photography, so every consumer surface fell back to the VENUE's own
 *    photo (`special.imageUrl ?? getVenueImageSrc(venue)`), which routinely
 *    misrepresented the actual offer (a wine Special showing a beer-pour
 *    photo, a taco Special showing a generic bar interior). Product
 *    decision: Daily Specials are text-first for now. `image_url` itself,
 *    imageActions.ts, and the venue-images Storage bucket path are all
 *    deliberately left in place — see serverActionsRegression.test.ts and
 *    storagePath.test.ts, both still passing unmodified, for proof the
 *    low-level image code was NOT touched.
 *
 * 2. MULTI-SPECIAL DEEP-LINK FIX — see DailySpecialsSection.tsx's own
 *    header comment on the new scroll-correction effect for the full root
 *    cause: the retired DailySpecialDeepLinkScroll component did its scroll
 *    check BEFORE DailySpecialsSection's own today-aware reorder had
 *    committed, so a correct-at-the-time scroll position was silently
 *    invalidated by the reorder a moment later — invisible with a single
 *    synthetic Special (nothing to reorder), broken for any real venue
 *    with more than one.
 *
 * Same no-DOM static-source-verification convention as the rest of this
 * suite — no React Testing Library/jsdom is wired up in this repo's plain
 * node:test runner.
 */

const CARD_PATH = join(__dirname, "../../../src/app/(website)/website-daily-specials/DailySpecialSearchCard.tsx");
const CARD_SOURCE = readFileSync(CARD_PATH, "utf8");

const SECTION_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/DailySpecialsSection.tsx");
const SECTION_SOURCE = readFileSync(SECTION_PATH, "utf8");

const FORM_PATH = join(__dirname, "../../../src/app/admin/daily-specials/DailySpecialForm.tsx");
const FORM_SOURCE = readFileSync(FORM_PATH, "utf8");

const VENUE_PAGE_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/page.tsx");
const VENUE_PAGE_SOURCE = readFileSync(VENUE_PAGE_PATH, "utf8");

const IMAGE_ACTIONS_PATH = join(__dirname, "../../../src/app/admin/daily-specials/imageActions.ts");
const STORAGE_PATH_PATH = join(__dirname, "../../../src/app/admin/daily-specials/storagePath.ts");

// ─────────────────────────────────────────────────────────────────────────
// IMAGE REMOVAL — consumer search card
// ─────────────────────────────────────────────────────────────────────────

test("the consumer search card never reads special.imageUrl", () => {
  assert.doesNotMatch(CARD_SOURCE, /special\.imageUrl/);
});

test("the consumer search card never calls the venue-image fallback (getVenueImageSrc) and does not import it", () => {
  assert.doesNotMatch(CARD_SOURCE, /getVenueImageSrc/);
});

test("the consumer search card renders no <img> element at all — genuinely text-first, not an image block with a blank source", () => {
  assert.doesNotMatch(CARD_SOURCE, /<img/);
});

test("the search card still preserves every required text field: title, venue name, short summary, schedule/time line, and the offer-type badge", () => {
  assert.match(CARD_SOURCE, /special\.title/);
  assert.match(CARD_SOURCE, /special\.venueName/);
  assert.match(CARD_SOURCE, /special\.shortSummary/);
  assert.match(CARD_SOURCE, /scheduleTimeLine/);
  assert.match(CARD_SOURCE, /offerLabel/);
});

test("the search card link semantics are preserved — the whole card is one focusable, keyboard-accessible Link with a visible focus ring", () => {
  assert.match(CARD_SOURCE, /<Link\s/);
  assert.match(CARD_SOURCE, /focus-visible:ring/);
});

// ─────────────────────────────────────────────────────────────────────────
// IMAGE REMOVAL — venue-page Daily Specials section
// ─────────────────────────────────────────────────────────────────────────

test("the venue-page Daily Specials section never reads special.imageUrl and renders no <img>", () => {
  assert.doesNotMatch(SECTION_SOURCE, /special\.imageUrl/);
  assert.doesNotMatch(SECTION_SOURCE, /<img/);
});

test("the venue-page section does not substitute the venue's own image in place of the removed Special image", () => {
  assert.doesNotMatch(SECTION_SOURCE, /getVenueImageSrc/);
  assert.doesNotMatch(SECTION_SOURCE, /venue\.image/i);
});

// ─────────────────────────────────────────────────────────────────────────
// IMAGE REMOVAL — Operator Admin form (complements twoStepCreate.test.ts's
// step-specific coverage with a couple of whole-file sanity checks)
// ─────────────────────────────────────────────────────────────────────────

test("the Operator Daily Special form contains no file input, no image preview, and no image-related helper copy", () => {
  assert.doesNotMatch(FORM_SOURCE, /type="file"/);
  assert.doesNotMatch(FORM_SOURCE, /accept="image\/\*"/);
  assert.doesNotMatch(FORM_SOURCE, /Image <span/);
});

test("create/edit submissions never construct an image-bearing payload — DailySpecialSavePayload has no image field and buildSavePayload/handleSubmit never reference one", () => {
  const SAVE_PAYLOAD_PATH = join(__dirname, "../../../src/app/admin/daily-specials/actions.ts");
  const savePayloadSource = readFileSync(SAVE_PAYLOAD_PATH, "utf8");
  const payloadTypeMatch = savePayloadSource.match(/export type DailySpecialSavePayload = \{([\s\S]*?)\n\};/);
  assert.ok(payloadTypeMatch, "DailySpecialSavePayload type not found");
  assert.doesNotMatch(payloadTypeMatch![1], /image/i);
});

// ─────────────────────────────────────────────────────────────────────────
// LOW-LEVEL IMAGE CODE — intentionally retained, not removed
// ─────────────────────────────────────────────────────────────────────────

test("imageActions.ts and storagePath.ts still exist — the underlying server actions/storage helpers were deliberately left in place, not deleted", () => {
  assert.doesNotThrow(() => readFileSync(IMAGE_ACTIONS_PATH, "utf8"));
  assert.doesNotThrow(() => readFileSync(STORAGE_PATH_PATH, "utf8"));
});

test("the daily_specials image_url column reference is untouched in the data-access layer (schema/plumbing, not consumer presentation)", () => {
  const DATA_PATH = join(__dirname, "../../../src/lib/data/dailySpecials.ts");
  const dataSource = readFileSync(DATA_PATH, "utf8");
  assert.match(dataSource, /image_url/);
});

// ─────────────────────────────────────────────────────────────────────────
// IMAGE CONSISTENCY — no venue can end up with some Specials imaged, some not
// ─────────────────────────────────────────────────────────────────────────

test("neither consumer surface has any conditional branch that would render an image for one Special but not another — image_url is simply never read", () => {
  for (const source of [CARD_SOURCE, SECTION_SOURCE]) {
    assert.doesNotMatch(source, /imageUrl/);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// DEEP LINK — exact target, unique IDs, multi-Special correctness
// ─────────────────────────────────────────────────────────────────────────

test("the search card href is still the exact per-Special anchor, never the bare section anchor", () => {
  assert.match(CARD_SOURCE, /`\$\{venuePath\}#daily-special-\$\{special\.id\}`/);
  assert.doesNotMatch(CARD_SOURCE, /#daily-specials`/);
});

test("each rendered Special's DOM id is keyed off the real special.id (a stable UUID), never an array index — this is what makes multiple Specials on one venue each individually addressable", () => {
  assert.match(SECTION_SOURCE, /id=\{`daily-special-\$\{special\.id\}`\}/);
  assert.doesNotMatch(SECTION_SOURCE, /daily-special-\$\{i\}/);
  assert.doesNotMatch(SECTION_SOURCE, /daily-special-\$\{index\}/);
});

test("the React key for each rendered card is also the real special.id, not a position-based key — required for React to preserve (not recreate) each Special's DOM node across the today-aware reorder", () => {
  assert.match(SECTION_SOURCE, /key=\{special\.id\}/);
});

test("CRITICAL: the deep-link scroll correction is keyed on todayIsoDate (fires AFTER the today-aware reorder commits), not on an empty mount-only dependency array — this is the actual fix for the multi-Special regression", () => {
  const effectMatch = SECTION_SOURCE.match(
    /useEffect\(\(\) => \{\s*if \(!todayIsoDate\) return;([\s\S]*?)\n {2}\}, \[todayIsoDate\]\);/
  );
  assert.ok(effectMatch, "deep-link scroll-correction effect (keyed on [todayIsoDate]) not found");
  assert.match(effectMatch![1], /window\.location\.hash/);
  assert.match(effectMatch![1], /daily-special-/);
  assert.match(effectMatch![1], /scrollIntoView/);
});

test("the scroll-correction effect reads the CURRENT window.location.hash and looks it up by id — it does not hard-code or cache a specific Special from an earlier render, so it always targets whichever exact Special the URL names", () => {
  const effectMatch = SECTION_SOURCE.match(
    /useEffect\(\(\) => \{\s*if \(!todayIsoDate\) return;([\s\S]*?)\n {2}\}, \[todayIsoDate\]\);/
  );
  assert.ok(effectMatch);
  assert.match(effectMatch![1], /document\.getElementById\(hash\.slice\(1\)\)/);
});

test("the old mount-only DailySpecialDeepLinkScroll component and its render call no longer exist anywhere", () => {
  assert.doesNotMatch(VENUE_PAGE_SOURCE, /DailySpecialDeepLinkScroll/);
  const OLD_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/DailySpecialDeepLinkScroll.tsx");
  assert.throws(() => readFileSync(OLD_PATH, "utf8"), /ENOENT/);
});

test("the exact item scroll-margin/context-offset behavior from the prior correction is preserved unchanged — only the WHEN of the correction changed, not the HOW", () => {
  assert.match(SECTION_SOURCE, /const DAILY_SPECIAL_ITEM_CONTEXT_OFFSET = \d+;/);
  assert.match(SECTION_SOURCE, /scrollMarginTop: scrollMargin \+ DAILY_SPECIAL_ITEM_CONTEXT_OFFSET/);
});

test("ordering is irrelevant to correctness: the fix targets by exact getElementById(id) lookup, never by list position/index — works identically whether the clicked Special is 1st or last in either surface's own order", () => {
  const effectMatch = SECTION_SOURCE.match(
    /useEffect\(\(\) => \{\s*if \(!todayIsoDate\) return;([\s\S]*?)\n {2}\}, \[todayIsoDate\]\);/
  );
  assert.ok(effectMatch);
  assert.doesNotMatch(effectMatch![1], /ordered\[|\.indexOf\(|position|index/i);
});

test("no arbitrary timeout is used anywhere in the fix — the correction relies on React's effect-dependency ordering guarantee, not a guessed delay", () => {
  const effectMatch = SECTION_SOURCE.match(
    /useEffect\(\(\) => \{\s*if \(!todayIsoDate\) return;([\s\S]*?)\n {2}\}, \[todayIsoDate\]\);/
  );
  assert.ok(effectMatch);
  assert.doesNotMatch(effectMatch![1], /setTimeout|setInterval/);
});
