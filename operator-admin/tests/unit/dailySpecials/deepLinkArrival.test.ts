import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parentSectionIdForHash } from "../../../src/app/(website)/[market]/[city]/[slug]/StickyNav";

/**
 * "Daily Specials — Final Deep-Link Arrival UX Fix" correction task.
 *
 * The prior venue-detail correction fixed the general scroll-spy reducer
 * (picking the section most recently entered, not the one scrolled
 * furthest past) and added hash-aware initial state — but real browser QA
 * on the actual Copper Brewing Company / Taco Tuesday Test case showed a
 * SECOND, more specific problem: right after a #daily-special-<uuid> deep
 * link's own forced scroll positioning, the "daily-specials" section's own
 * bounding top is left slightly NEGATIVE (its heading, above the pinned
 * card, scrolls off-screen) while the immediately-following short "info"
 * section is already positive-but-in-band — so the (correct, in general)
 * "greatest top wins" rule picks Info over Daily Specials on the very
 * first observer firing after arrival.
 *
 * This file covers the two changes that fix it:
 *   1. Arrival position — individual Daily Special cards reserve MORE
 *      scroll-margin than the section itself, so the "Daily Specials"
 *      heading (or, for a later card in a longer list, some leading
 *      context) stays visible above the clicked card.
 *   2. Active-section fix — an "initial hash lock" makes the deep link's
 *      resolved section authoritative until a genuine user scroll input
 *      (wheel/touch/key) proves the visitor has actually moved on,
 *      release() is unconditional at that point, not delayed by a timeout.
 *
 * Same conventions as the rest of this suite: parentSectionIdForHash() is
 * imported and exercised directly (real behavior, importable from a plain
 * Node test despite "use client" — the RSC boundary transform only applies
 * inside Next.js's own build); everything else is static source
 * verification, since there's no DOM available in this repo's node:test
 * runner to actually drive an IntersectionObserver or dispatch scroll
 * events against.
 */

const STICKY_NAV_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/StickyNav.tsx");
const STICKY_NAV_SOURCE = readFileSync(STICKY_NAV_PATH, "utf8");

const SECTION_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/DailySpecialsSection.tsx");
const SECTION_SOURCE = readFileSync(SECTION_PATH, "utf8");

const VENUE_PAGE_PATH = join(__dirname, "../../../src/app/(website)/[market]/[city]/[slug]/page.tsx");
const VENUE_PAGE_SOURCE = readFileSync(VENUE_PAGE_PATH, "utf8");

const DEEP_LINK_SCROLL_PATH = join(
  __dirname,
  "../../../src/app/(website)/[market]/[city]/[slug]/DailySpecialDeepLinkScroll.tsx"
);
const DEEP_LINK_SCROLL_SOURCE = readFileSync(DEEP_LINK_SCROLL_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// INITIAL DAILY SPECIAL HASH
// ─────────────────────────────────────────────────────────────────────────

test("#daily-special-<uuid> still maps to the 'daily-specials' parent section (unchanged real behavior)", () => {
  assert.equal(parentSectionIdForHash("daily-special-abc123"), "daily-specials");
});

test("the exact deep-link target is still the individual Special anchor, not the plain section anchor — the fix must not redirect the link itself to #daily-specials", () => {
  const CARD_PATH = join(__dirname, "../../../src/app/(website)/website-daily-specials/DailySpecialSearchCard.tsx");
  const CARD_SOURCE = readFileSync(CARD_PATH, "utf8");
  assert.match(CARD_SOURCE, /`\$\{venuePath\}#daily-special-\$\{special\.id\}`/);
});

test("a contextual scroll offset exists for individual Daily Special anchors — strictly more than the shared section scrollMargin, not equal to it", () => {
  assert.match(SECTION_SOURCE, /const DAILY_SPECIAL_ITEM_CONTEXT_OFFSET = \d+;/);
  assert.match(SECTION_SOURCE, /scrollMarginTop: scrollMargin \+ DAILY_SPECIAL_ITEM_CONTEXT_OFFSET/);
  const offsetMatch = SECTION_SOURCE.match(/const DAILY_SPECIAL_ITEM_CONTEXT_OFFSET = (\d+);/);
  assert.ok(offsetMatch);
  assert.ok(Number(offsetMatch![1]) > 0, "context offset must be a positive extra buffer");
});

test("the contextual offset is a fixed constant, not derived from a specific special's index/position — so it applies identically to the 1st or the Nth special", () => {
  // The style prop references only `scrollMargin` (the shared prop) and the
  // one module-level constant — nothing keyed off the special's own index
  // or position within the ordered list.
  const styleLine = SECTION_SOURCE.match(/style=\{\{ scrollMarginTop: ([^}]+) \}\}/);
  assert.ok(styleLine);
  assert.doesNotMatch(styleLine![1], /index|special\.|i \*/);
});

// ─────────────────────────────────────────────────────────────────────────
// INITIAL HASH INTENT CANNOT BE IMMEDIATELY OVERRIDDEN
// ─────────────────────────────────────────────────────────────────────────

test("the initial hash resolution arms a lock (initialHashLockRef) at the same time it sets the active section", () => {
  const layoutEffectBlock = STICKY_NAV_SOURCE.match(/useLayoutEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[\]\);/);
  assert.ok(layoutEffectBlock);
  assert.match(layoutEffectBlock![1], /setActiveSection\(mapped\);/);
  assert.match(layoutEffectBlock![1], /initialHashLockRef\.current = mapped;/);
  // Arming must happen, not merely be adjacent to, setting active section —
  // both statements inside the same guarded block.
  const setIdx = layoutEffectBlock![1].indexOf("setActiveSection(mapped);");
  const lockIdx = layoutEffectBlock![1].indexOf("initialHashLockRef.current = mapped;");
  assert.ok(setIdx > -1 && lockIdx > -1 && lockIdx > setIdx);
});

test("CRITICAL: the observer callback returns BEFORE calling setActiveSection whenever the lock is armed — this is what stops Info from immediately overriding Daily Specials on arrival", () => {
  const observerCallbackMatch = STICKY_NAV_SOURCE.match(
    /const topmost = visible\.reduce\([\s\S]*?\}\);([\s\S]*?)setActiveSection\(topmost\.id\);/
  );
  assert.ok(observerCallbackMatch, "observer callback body between reduce() and setActiveSection(topmost.id) not found");
  assert.match(observerCallbackMatch![1], /if \(initialHashLockRef\.current\) return;/);
});

test("the lock check applies regardless of which section 'topmost' resolves to — it is not narrowed to only suppress a specific id", () => {
  // i.e. the guard is a bare `if (initialHashLockRef.current) return;`, not
  // `if (initialHashLockRef.current && topmost.id !== initialHashLockRef.current)` —
  // simpler and sufficient: while armed, no observer-driven change happens at all.
  assert.match(STICKY_NAV_SOURCE, /if \(initialHashLockRef\.current\) return;\n\n {8}setActiveSection\(topmost\.id\);/);
});

// ─────────────────────────────────────────────────────────────────────────
// SHORT SECTION CASE — the actual reported Copper Brewing scenario
// ─────────────────────────────────────────────────────────────────────────

test("a venue with exactly one short Daily Special immediately followed by Info still initializes with Daily Specials locked active — the lock is unconditional on section content/size, not keyed to a minimum section height", () => {
  // The lock is armed purely from the RESOLVED HASH, never from any
  // geometry/height check — confirmed by the layout effect containing no
  // height/size-based condition at all.
  const layoutEffectBlock = STICKY_NAV_SOURCE.match(/useLayoutEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[\]\);/);
  assert.ok(layoutEffectBlock);
  assert.doesNotMatch(layoutEffectBlock![1], /offsetHeight|getBoundingClientRect|innerHeight/);
});

// ─────────────────────────────────────────────────────────────────────────
// NORMAL SCROLL AFTER ARRIVAL — release mechanism, no permanent lock
// ─────────────────────────────────────────────────────────────────────────

test("the lock releases on genuine user scroll input: wheel, touchmove, and scroll-relevant keydown — never on a bare 'scroll' event", () => {
  assert.match(STICKY_NAV_SOURCE, /window\.addEventListener\("wheel", release, \{ passive: true \}\);/);
  assert.match(STICKY_NAV_SOURCE, /window\.addEventListener\("touchmove", release, \{ passive: true \}\);/);
  assert.match(STICKY_NAV_SOURCE, /window\.addEventListener\("keydown", onKeyDown\);/);
  // A bare "scroll" listener would also fire from the deep-link's OWN
  // programmatic positioning, releasing the lock before it protects
  // anything — must not be present as the release trigger.
  assert.doesNotMatch(STICKY_NAV_SOURCE, /addEventListener\("scroll"/);
});

test("release sets the lock ref back to null — a real no-timeout, deterministic release, not a delayed/guessed settle", () => {
  const releaseBlock = STICKY_NAV_SOURCE.match(/function release\(\) \{([\s\S]*?)\n {4}\}/);
  assert.ok(releaseBlock);
  assert.match(releaseBlock![1], /initialHashLockRef\.current = null;/);
  assert.doesNotMatch(STICKY_NAV_SOURCE, /setTimeout/);
});

test("the release effect cleans up all three listeners on unmount", () => {
  const cleanupBlock = STICKY_NAV_SOURCE.match(/return \(\) => \{\s*window\.removeEventListener\("wheel"[\s\S]*?\};/);
  assert.ok(cleanupBlock);
  assert.match(cleanupBlock![0], /removeEventListener\("wheel", release\);/);
  assert.match(cleanupBlock![0], /removeEventListener\("touchmove", release\);/);
  assert.match(cleanupBlock![0], /removeEventListener\("keydown", onKeyDown\);/);
});

test("an explicit nav-tab click also releases the lock — clicking is itself unambiguous user intent, same as scrolling", () => {
  const handleClickBlock = STICKY_NAV_SOURCE.match(/function handleClick\([\s\S]*?\n  \}/);
  assert.ok(handleClickBlock);
  assert.match(handleClickBlock![0], /initialHashLockRef\.current = null;/);
});

test("once released (lock cleared), the observer's normal 'greatest top wins' logic is unconditionally back in control — no other gating variable was introduced", () => {
  // The observer effect body has exactly one lock check (`if
  // (initialHashLockRef.current) return;`) and no secondary flag guarding
  // setActiveSection — once the ref is null, this is byte-for-byte the
  // pre-existing scroll-spy behavior from the prior correction.
  const observerEffectStart = STICKY_NAV_SOURCE.indexOf("const observer = new IntersectionObserver(");
  const observerEffectEnd = STICKY_NAV_SOURCE.indexOf("secs.forEach(({ id })");
  const observerBody = STICKY_NAV_SOURCE.slice(observerEffectStart, observerEffectEnd);
  const lockChecks = (observerBody.match(/initialHashLockRef\.current/g) ?? []).length;
  assert.equal(lockChecks, 1);
});

// ─────────────────────────────────────────────────────────────────────────
// DIRECT LOAD
// ─────────────────────────────────────────────────────────────────────────

test("DailySpecialDeepLinkScroll (the direct-load / navigation-timing fallback) is unchanged by this correction — it still only nudges scroll position, no active-state logic was duplicated into it", () => {
  assert.match(DEEP_LINK_SCROLL_SOURCE, /el\.scrollIntoView\(\{ behavior: "auto", block: "start" \}\);/);
  assert.doesNotMatch(DEEP_LINK_SCROLL_SOURCE, /activeSection|StickyNav/);
});

test("the individual Special anchor id and its presence in the DOM are unaffected by the new context offset — only the scrollMarginTop value changed", () => {
  assert.match(SECTION_SOURCE, /id=\{`daily-special-\$\{special\.id\}`\}/);
});

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURE — untouched by this correction (regression guard)
// ─────────────────────────────────────────────────────────────────────────

test("venue name remains wired into StickyNav", () => {
  assert.match(VENUE_PAGE_SOURCE, /<StickyNav sections=\{sections\} venueName=\{venue\.name\} \/>/);
  assert.match(STICKY_NAV_SOURCE, /venueName\?: string;/);
});

test("no Offers nav item was reintroduced", () => {
  const sectionsBlock = VENUE_PAGE_SOURCE.match(/const sections = \[([\s\S]*?)\n {2}\];/);
  assert.ok(sectionsBlock);
  assert.doesNotMatch(sectionsBlock![1], /Offers/);
  assert.doesNotMatch(sectionsBlock![1], /"specials"/);
});

test("the combined Happy Hour section remains intact — one section, Happy Hour Times + Food/Drink Offers subheadings, no separate top-level Food & Drink Offers heading", () => {
  const happyHourSectionMatches = VENUE_PAGE_SOURCE.match(/<section id="happy-hour"/g) ?? [];
  assert.equal(happyHourSectionMatches.length, 1);
  assert.match(VENUE_PAGE_SOURCE, />\s*Happy Hour Times\s*</);
  assert.doesNotMatch(VENUE_PAGE_SOURCE, /Food &amp;? ?Drink Offers|Food & Drink Offers/);
});

test("SCROLL_MARGIN (the shared section-level constant) is unchanged — only the per-item Daily Special offset is new", () => {
  assert.match(VENUE_PAGE_SOURCE, /const SCROLL_MARGIN = 132;/);
});

test("the Daily Specials search page / card / filter files were not touched by this correction — only venue-detail files changed", () => {
  const CARD_PATH = join(__dirname, "../../../src/app/(website)/website-daily-specials/DailySpecialSearchCard.tsx");
  const RESULTS_PATH = join(__dirname, "../../../src/app/(website)/website-daily-specials/DailySpecialSearchResults.tsx");
  // Sanity: these files still exist and still point at the same deep-link
  // shape — a full content diff isn't meaningful in a source-text test, but
  // asserting the link shape is untouched is the load-bearing fact for
  // this correction specifically (it must not have redirected the link).
  const cardSource = readFileSync(CARD_PATH, "utf8");
  const resultsSource = readFileSync(RESULTS_PATH, "utf8");
  assert.match(cardSource, /#daily-special-\$\{special\.id\}/);
  assert.ok(resultsSource.length > 0);
});
