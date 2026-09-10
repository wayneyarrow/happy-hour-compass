import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  getArticleBySlug,
  getAllArticleSlugs,
  getRelatedArticles,
  articleUrl,
} from "../../../src/lib/helpCenter/articles";

/**
 * Help Centre — "Create a Daily Special" article + "Happy Hours, Specials &
 * Events" category rename.
 *
 * Help articles are plain data (src/lib/helpCenter/articles.ts) rendered
 * through the single shared route (src/app/admin/help/[slug]/page.tsx), so
 * most of what matters here is pinned by importing the registry directly
 * rather than rendering React — mirroring the existing
 * tests/unit/homepage/todaysSpecialsCmsIntegration.test.ts convention of
 * asserting on source content for the presentational pieces (landing-page
 * grouping, shared footer/tracking wiring) that only exist as JSX.
 */

const OPERATOR_ADMIN_ROOT = join(__dirname, "../../..");
const ARTICLE_SLUG = "create-a-daily-special";

// ── 1. Registry / 2. Title / 6. Route resolution ────────────────────────────

test("the new article exists in the How-To article registry", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  assert.ok(article, "expected create-a-daily-special to be a registered article");
});

test("the article's public title is exactly 'Create a Daily Special'", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  assert.equal(article?.title, "Create a Daily Special");
});

test("the article's slug resolves through getAllArticleSlugs() — the list generateStaticParams() prerenders", () => {
  assert.ok(getAllArticleSlugs().includes(ARTICLE_SLUG));
});

test("articleUrl() builds the expected route for the new article", () => {
  assert.equal(articleUrl(ARTICLE_SLUG), "/admin/help/create-a-daily-special");
});

test("the article is a real, non-placeholder how-to article", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  assert.equal(article?.type, "how-to");
  assert.equal(article?.isPlaceholder, undefined);
});

// ── 3 & 4. Category rename ───────────────────────────────────────────────────

test("the landing page's visible category label is now 'Happy Hours, Specials & Events'", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/page.tsx"), "utf8");
  assert.ok(source.includes("Happy Hours, Specials & Events"));
});

test("the old visible category label 'Happy Hours & Events' no longer appears anywhere in the app source", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/page.tsx"), "utf8");
  assert.ok(!source.includes("Happy Hours & Events"));
});

test("the new article is grouped under the renamed category, alongside the existing Happy Hour and Event articles", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/page.tsx"), "utf8");
  const groupMatch = source.match(
    /heading:\s*"Happy Hours, Specials & Events",\s*\n\s*slugs:\s*\[([^\]]+)\]/
  );
  assert.ok(groupMatch, "expected to find the renamed category's slugs array");
  const slugsList = groupMatch![1];
  assert.ok(slugsList.includes('"manage-happy-hours"'));
  assert.ok(slugsList.includes('"create-a-daily-special"'));
  assert.ok(slugsList.includes('"create-event"'));
  assert.ok(slugsList.includes('"manage-events"'));
});

test("no other Help category's slug list was disturbed by the rename", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/page.tsx"), "utf8");
  assert.ok(source.includes('"manage-venue-information", "manage-venue-images", "publish-unpublish-venue"'));
  assert.ok(source.includes('"understand-subscriptions-and-limits"'));
  assert.ok(source.includes('"manage-users"'));
  assert.ok(source.includes('"understand-analytics"'));
  assert.ok(source.includes('"manage-search-tags"'));
});

// ── 5. Existing articles preserved (not lost or duplicated) ─────────────────

const EXISTING_REAL_ARTICLE_SLUGS = [
  "manage-venue-information",
  "manage-venue-images",
  "publish-unpublish-venue",
  "manage-happy-hours",
  "create-event",
  "manage-events",
  "understand-subscriptions-and-limits",
  "manage-users",
  "understand-analytics",
  "manage-search-tags",
];

test("every pre-existing real How-To article is still registered", () => {
  for (const slug of EXISTING_REAL_ARTICLE_SLUGS) {
    assert.ok(getArticleBySlug(slug), `expected pre-existing article "${slug}" to still be registered`);
  }
});

test("no article slug (existing or new) is duplicated in the registry", () => {
  const slugs = getAllArticleSlugs();
  assert.equal(slugs.length, new Set(slugs).size, "expected every slug in the registry to be unique");
});

test("Create an event and Manage your events are unchanged in title/category", () => {
  const createEvent = getArticleBySlug("create-event");
  const manageEvents = getArticleBySlug("manage-events");
  assert.equal(createEvent?.title, "Create an event");
  assert.equal(manageEvents?.title, "Manage your events");
});

// ── 7 & 8. Screenshot assets ─────────────────────────────────────────────────

const EXPECTED_SCREENSHOTS = [
  "create-daily-special-01-start.png",
  "create-daily-special-02-details.png",
  "create-daily-special-03-schedule-time.png",
  "create-daily-special-04-publish.png",
];

test("the article references exactly the four approved screenshots, in step order", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  const screenshotSrcs = article!.steps
    .map((step) => step.screenshot?.src)
    .filter((src): src is string => !!src);
  assert.deepEqual(
    screenshotSrcs,
    EXPECTED_SCREENSHOTS.map((name) => `/help/screenshots/${name}`)
  );
});

test("every referenced screenshot asset file actually exists under public/help/screenshots", () => {
  for (const name of EXPECTED_SCREENSHOTS) {
    const assetPath = join(OPERATOR_ADMIN_ROOT, "public/help/screenshots", name);
    assert.ok(existsSync(assetPath), `expected screenshot asset to exist: ${assetPath}`);
  }
});

test("every screenshot has a non-empty alt description and positive width/height (HelpScreenshot requires both for next/image)", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  for (const step of article!.steps) {
    if (!step.screenshot) continue;
    assert.ok(step.screenshot.alt.length > 10, `alt text too short for ${step.screenshot.src}`);
    assert.ok(step.screenshot.width > 0);
    assert.ok(step.screenshot.height > 0);
  }
});

// ── 9. Recurring-plan guidance ───────────────────────────────────────────────

test("Step 1 carries a Tip callout explaining how to make a Daily Special recurring", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  const firstStep = article!.steps[0];
  assert.ok(firstStep.note, "expected the first step to have a note (Tip callout)");
  assert.equal(firstStep.note?.heading, "Tip: Make a Daily Special recurring");
  assert.match(firstStep.note!.text, /Every week/);
  assert.match(firstStep.note!.text, /upgrade/i);
});

test("recurring guidance does not hardcode a plan name not clearly supported as more accurate", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  const tipText = article!.steps[0].note!.text;
  // The real entitlement (src/lib/plans.ts canUseRecurringDailySpecials) is
  // Pro/Premium/Enterprise — a two-plan "Pro and Premium" phrasing (as shown
  // in the in-app upsell copy) would UNDERSTATE that, so the article
  // deliberately uses the plan-agnostic phrasing instead.
  assert.ok(!/\bPro and Premium\b/.test(tipText));
});

// ── 10. Contact Support / shared footer ──────────────────────────────────────

test("the shared article route unconditionally renders HelpNeedSupport for every article, including the new one", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/[slug]/page.tsx"), "utf8");
  assert.ok(source.includes("<HelpNeedSupport"));
  // Not conditioned on article slug/type — a plain unconditional render.
  assert.ok(!source.includes('article.slug === "create-a-daily-special"'));
});

test("HelpNeedSupport still carries the established Contact Support copy", () => {
  const source = readFileSync(
    join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/components/HelpNeedSupport.tsx"),
    "utf8"
  );
  assert.ok(source.includes("Need help?"));
  assert.ok(source.includes("Contact Support"));
});

// ── 11. Analytics / tracking participation ───────────────────────────────────

test("the shared article route mounts HelpViewTracker with the article's own slug — no per-article registration needed", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/[slug]/page.tsx"), "utf8");
  assert.ok(source.includes("<HelpViewTracker articleSlug={article.slug} />"));
});

test("recordHelpCenterView() writes article_slug as free text — no allowlist a new slug must be added to", () => {
  const source = readFileSync(
    join(OPERATOR_ADMIN_ROOT, "src/lib/helpCenter/trackHelpCenterView.ts"),
    "utf8"
  );
  assert.ok(source.includes("article_slug: articleSlug"));
});

// ── Related Help handling ────────────────────────────────────────────────────

test("the new article has no Related Help links — mirrors Create an event, which also has none", () => {
  const dailySpecialArticle = getArticleBySlug(ARTICLE_SLUG)!;
  const createEventArticle = getArticleBySlug("create-event")!;
  assert.deepEqual(getRelatedArticles(dailySpecialArticle), []);
  assert.deepEqual(getRelatedArticles(createEventArticle), []);
});

test("no fabricated 'Manage your Daily Specials' article was created or linked", () => {
  assert.equal(getArticleBySlug("manage-daily-specials"), undefined);
  const dailySpecialArticle = getArticleBySlug(ARTICLE_SLUG)!;
  assert.ok(!(dailySpecialArticle.relatedSlugs ?? []).includes("manage-daily-specials"));
});

// ── Breadcrumb / structure sanity ────────────────────────────────────────────

test("the article has five numbered steps matching the approved structure", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  const titles = article!.steps.map((s) => s.title);
  assert.deepEqual(titles, [
    "Start a new Daily Special",
    "Add the offer details",
    "Confirm the schedule",
    "Set the time",
    "Publish the Daily Special",
  ]);
});

test("the article has a closing section reusing the established HelpSection pattern", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  assert.equal(article?.closingSection?.heading, "Keep your Daily Specials accurate");
  assert.equal(article?.closingSection?.body.length, 2);
});
