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
 * Help Centre — "Manage your Daily Specials" article, the companion to
 * "Create a Daily Special" (see createDailySpecialArticle.test.ts),
 * mirroring the established "Manage your events" pattern.
 *
 * Same convention as createDailySpecialArticle.test.ts: import the plain
 * data registry directly for everything pinnable that way, and assert on
 * source content only for the presentational pieces (landing-page grouping)
 * that exist purely as JSX.
 */

const OPERATOR_ADMIN_ROOT = join(__dirname, "../../..");
const ARTICLE_SLUG = "manage-daily-specials";

// ── 1-3. Registry / slug / title ─────────────────────────────────────────────

test("the article exists in the How-To article registry", () => {
  assert.ok(getArticleBySlug(ARTICLE_SLUG), "expected manage-daily-specials to be registered");
});

test("the article's slug is exactly 'manage-daily-specials'", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  assert.equal(article?.slug, "manage-daily-specials");
});

test("the article's public title is exactly 'Manage your Daily Specials'", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  assert.equal(article?.title, "Manage your Daily Specials");
});

test("the article resolves through getAllArticleSlugs() — the list generateStaticParams() prerenders", () => {
  assert.ok(getAllArticleSlugs().includes(ARTICLE_SLUG));
});

test("articleUrl() builds the expected route", () => {
  assert.equal(articleUrl(ARTICLE_SLUG), "/admin/help/manage-daily-specials");
});

test("the article is a real, non-placeholder how-to article", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  assert.equal(article?.type, "how-to");
  assert.equal(article?.isPlaceholder, undefined);
});

// ── 4 & 5. Category + landing-page order ─────────────────────────────────────

test("the article is grouped under 'Happy Hours, Specials & Events' on the landing page", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/page.tsx"), "utf8");
  const groupMatch = source.match(
    /heading:\s*"Happy Hours, Specials & Events",\s*\n\s*slugs:\s*\[([^\]]+)\]/
  );
  assert.ok(groupMatch, "expected to find the category's slugs array");
  assert.ok(groupMatch![1].includes('"manage-daily-specials"'));
});

test("the landing-page order is Manage Happy Hours, Create a Daily Special, Manage your Daily Specials, Create an event, Manage your events", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/page.tsx"), "utf8");
  const groupMatch = source.match(
    /heading:\s*"Happy Hours, Specials & Events",\s*\n\s*slugs:\s*\[([\s\S]*?)\]/
  );
  assert.ok(groupMatch, "expected to find the category's slugs array");
  const slugs = groupMatch![1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  assert.deepEqual(slugs, [
    "manage-happy-hours",
    "create-a-daily-special",
    "manage-daily-specials",
    "create-event",
    "manage-events",
  ]);
});

test("no other Help category's slug list was disturbed", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/page.tsx"), "utf8");
  assert.ok(source.includes('"manage-venue-information", "manage-venue-images", "publish-unpublish-venue"'));
  assert.ok(source.includes('"understand-subscriptions-and-limits"'));
  assert.ok(source.includes('"manage-users"'));
  assert.ok(source.includes('"understand-analytics"'));
  assert.ok(source.includes('"manage-search-tags"'));
});

// ── 14 / regression. Existing Event/Happy Hour/Daily Special articles preserved ──

const EXISTING_REAL_ARTICLE_SLUGS = [
  "manage-venue-information",
  "manage-venue-images",
  "publish-unpublish-venue",
  "manage-happy-hours",
  "create-a-daily-special",
  "create-event",
  "manage-events",
  "understand-subscriptions-and-limits",
  "manage-users",
  "understand-analytics",
  "manage-search-tags",
];

test("every pre-existing real How-To article is still registered and unchanged in title", () => {
  for (const slug of EXISTING_REAL_ARTICLE_SLUGS) {
    assert.ok(getArticleBySlug(slug), `expected pre-existing article "${slug}" to still be registered`);
  }
  assert.equal(getArticleBySlug("create-event")?.title, "Create an event");
  assert.equal(getArticleBySlug("manage-events")?.title, "Manage your events");
  assert.equal(getArticleBySlug("create-a-daily-special")?.title, "Create a Daily Special");
  assert.equal(getArticleBySlug("manage-happy-hours")?.title, "Manage your Happy Hours");
});

test("no article slug is duplicated in the registry", () => {
  const slugs = getAllArticleSlugs();
  assert.equal(slugs.length, new Set(slugs).size, "expected every slug in the registry to be unique");
});

// ── 6. Four management steps ─────────────────────────────────────────────────

test("the article has exactly four numbered steps matching the approved structure", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  const titles = article!.steps.map((s) => s.title);
  assert.deepEqual(titles, [
    "Find a Daily Special",
    "Edit a Daily Special",
    "Publish or unpublish a Daily Special",
    "Delete a Daily Special",
  ]);
});

// ── 7. Related Help ───────────────────────────────────────────────────────────

test("Related Help points to create-a-daily-special", () => {
  const article = getArticleBySlug(ARTICLE_SLUG)!;
  assert.deepEqual(article.relatedSlugs, ["create-a-daily-special"]);
  const related = getRelatedArticles(article);
  assert.equal(related.length, 1);
  assert.equal(related[0].slug, "create-a-daily-special");
  assert.equal(related[0].title, "Create a Daily Special");
});

test("no unrelated articles were added to Related Help", () => {
  const article = getArticleBySlug(ARTICLE_SLUG)!;
  assert.equal((article.relatedSlugs ?? []).length, 1);
});

// ── 8 & 9. Screenshot assets ─────────────────────────────────────────────────

const EXPECTED_SCREENSHOTS = [
  "manage-daily-specials-01-find.png",
  "manage-daily-specials-02-edit.png",
  "manage-daily-specials-03-publishing.png",
  "manage-daily-specials-04-delete.png",
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

test("every screenshot has a non-empty alt description and positive width/height", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  for (const step of article!.steps) {
    if (!step.screenshot) continue;
    assert.ok(step.screenshot.alt.length > 10, `alt text too short for ${step.screenshot.src}`);
    assert.ok(step.screenshot.width > 0);
    assert.ok(step.screenshot.height > 0);
  }
});

// ── 10 & 11. Delete copy accuracy ────────────────────────────────────────────

test("the Delete a Daily Special step includes 'this action cannot be undone'", () => {
  const article = getArticleBySlug(ARTICLE_SLUG)!;
  const deleteStep = article.steps.find((s) => s.title === "Delete a Daily Special")!;
  const allText = deleteStep.body.join(" ").toLowerCase();
  assert.match(allText, /this action cannot be undone/);
});

test("no Event-specific recurring-delete/grandfathering warning appears anywhere in the article", () => {
  const article = getArticleBySlug(ARTICLE_SLUG)!;
  const allText = JSON.stringify(article).toLowerCase();
  assert.ok(!allText.includes("grandfather"));
  assert.ok(!allText.includes("recurring"));
  assert.ok(!allText.includes("your ability to create another"));
});

test("the delete screenshot's alt text reflects the real confirmation copy, not an invented one", () => {
  const article = getArticleBySlug(ARTICLE_SLUG)!;
  const deleteStep = article.steps.find((s) => s.title === "Delete a Daily Special")!;
  assert.match(deleteStep.screenshot!.alt, /Delete this Daily Special\? This action cannot be undone\./);
});

// ── 12. Closing section ───────────────────────────────────────────────────────

test("the closing section heading is 'Keep your Daily Specials up to date'", () => {
  const article = getArticleBySlug(ARTICLE_SLUG);
  assert.equal(article?.closingSection?.heading, "Keep your Daily Specials up to date");
  assert.equal(article?.closingSection?.body.length, 2);
});

// ── 13. Analytics — no per-article registration required ────────────────────

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

// ── Shared component reuse (no bespoke architecture) ─────────────────────────

test("the shared article route unconditionally renders HelpNeedSupport for every article, including this one", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/admin/help/[slug]/page.tsx"), "utf8");
  assert.ok(source.includes("<HelpNeedSupport"));
});

test("no Tip callout was added to this article — it wasn't required", () => {
  const article = getArticleBySlug(ARTICLE_SLUG)!;
  for (const step of article.steps) {
    assert.equal(step.note, undefined);
  }
});
