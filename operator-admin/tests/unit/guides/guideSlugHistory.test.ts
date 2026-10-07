import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGuidePublicPath,
  describeGuideSlugWriteError,
  reconcileGuideCanonicalUrl,
  resolveHistoricalGuideRedirect,
} from "../../../src/lib/guideSlugHistory";

/**
 * Guide URL history (migration 108). The history rows themselves are written
 * by the content_guides_slug_history trigger, atomically with the guide
 * write — its behaviour (record on change, no-op without change, current /
 * historical collisions, conflicting owner, rollback, per-market scoping,
 * seed + re-run + aborts) is exercised against real Postgres in the
 * migration harness. These tests cover the app-side decisions and wiring.
 */

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = read("src/app/(website)/[market]/guides/[slug]/page.tsx");
const ACTIONS = read("src/app/control-panel/content-engine/actions.ts");
const DATA = read("src/lib/data/contentGuides.ts");
const MIGRATION = readFileSync(join(ROOT, "../supabase/migrations/108_content_guide_slug_history.sql"), "utf8");

const OLD = "/central-okanagan/guides/kelownas-best-sports-bars-to-catch-the-game";
const CURRENT = "/central-okanagan/guides/kelowna-s-best-sports-bars-to-catch-the-game";
const sportsBars = { marketSlug: "central-okanagan", slug: "kelowna-s-best-sports-bars-to-catch-the-game" };

// ── Historical routing ──────────────────────────────────────────────────────

test("1/4. historical slug of a public guide → its CURRENT path", () => {
  assert.equal(resolveHistoricalGuideRedirect(OLD, { ...sportsBars, isPublic: true }), CURRENT);
});

test("2. unknown historical slug → no redirect (404)", () => {
  assert.equal(resolveHistoricalGuideRedirect(OLD, null), null);
});

test("3. historical slug of a draft / out-of-window guide → no redirect (404)", () => {
  assert.equal(resolveHistoricalGuideRedirect(OLD, { ...sportsBars, isPublic: false }), null);
});

test("5. no loop/chain: target equal to the requested path never redirects", () => {
  assert.equal(resolveHistoricalGuideRedirect(CURRENT, { ...sportsBars, isPublic: true }), null);
  assert.equal(buildGuidePublicPath("central-okanagan", "x"), "/central-okanagan/guides/x");
});

test("route: history checked only after the current-slug lookup misses; 308 or 404", () => {
  const fallback = PAGE.slice(PAGE.indexOf("export default async function GuideDetailPage"));
  const current = fallback.indexOf("getPublicGuideByMarketAndSlug(market, slug)");
  const history = fallback.indexOf("getGuideByHistoricalSlug(market, slug)");
  assert.ok(current >= 0 && history > current, "current lookup first, history second");
  assert.match(fallback, /if \(!guide\) \{[\s\S]*?resolveHistoricalGuideRedirect\([\s\S]*?if \(target\) permanentRedirect\(target\);\s*notFound\(\);\s*\}/);
});

test("lookup: market-scoped history, guide read live, public-only via isGuidePublicNow", () => {
  const fn = DATA.slice(DATA.indexOf("export async function getGuideByHistoricalSlug"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /from\("content_guide_slug_history"\)[\s\S]*?\.eq\("market_id",[\s\S]*?\.eq\("old_slug", oldSlug\)/);
  assert.match(body, /from\("content_guides"\)[\s\S]*?\.eq\("id",/);
  assert.match(body, /isPublic: isGuidePublicNow\(/);
});

// ── Canonical safety ────────────────────────────────────────────────────────

const prev = { marketSlug: "central-okanagan", slug: "old-slug" };
const next = { marketSlug: "central-okanagan", slug: "new-slug" };

test("14. self-canonical old URL follows the slug change", () => {
  assert.equal(
    reconcileGuideCanonicalUrl({ submitted: "/central-okanagan/guides/old-slug", previous: prev, next }),
    "/central-okanagan/guides/new-slug"
  );
  assert.equal(
    reconcileGuideCanonicalUrl({ submitted: "/central-okanagan/guides/old-slug/", previous: prev, next }),
    "/central-okanagan/guides/new-slug"
  );
  // Market change too.
  assert.equal(
    reconcileGuideCanonicalUrl({
      submitted: "/central-okanagan/guides/old-slug",
      previous: prev,
      next: { marketSlug: "greater-vancouver", slug: "old-slug" },
    }),
    "/greater-vancouver/guides/old-slug"
  );
});

test("15. genuinely customised canonical is preserved", () => {
  const custom = "/central-okanagan/guides/some-other-guide";
  assert.equal(reconcileGuideCanonicalUrl({ submitted: custom, previous: prev, next }), custom);
});

test("canonical: unchanged URL keeps submitted value; empty stays empty (generated fallback)", () => {
  assert.equal(
    reconcileGuideCanonicalUrl({ submitted: "/anything", previous: prev, next: prev }),
    "/anything"
  );
  assert.equal(reconcileGuideCanonicalUrl({ submitted: null, previous: prev, next }), null);
  assert.equal(reconcileGuideCanonicalUrl({ submitted: "  ", previous: prev, next }), null);
  // Already updated by the editor to the new path → kept.
  assert.equal(
    reconcileGuideCanonicalUrl({ submitted: "/central-okanagan/guides/new-slug", previous: prev, next }),
    "/central-okanagan/guides/new-slug"
  );
});

// ── Write errors (create + update) ──────────────────────────────────────────

test("8/9/12. slug conflicts map to clear field errors; history-owner conflict is a form error", () => {
  assert.deepEqual(
    describeGuideSlugWriteError({ code: "23505", message: 'duplicate key value violates unique constraint "content_guides_market_slug_unique"' }),
    { kind: "field", message: "This slug is already used by another guide in this market." }
  );
  const historical = describeGuideSlugWriteError({
    code: "23505",
    message: "content_guide_slug_history: slug x is a retired URL of another guide in this market",
  });
  assert.equal(historical?.kind, "field");
  assert.match(historical!.message, /former URL of another guide/);
  const owner = describeGuideSlugWriteError({
    code: "23505",
    message: "content_guide_slug_history: retired slug x is already recorded for a different guide y",
  });
  assert.equal(owner?.kind, "form");
  assert.equal(describeGuideSlugWriteError({ code: "42501", message: "x" }), null);
  assert.equal(describeGuideSlugWriteError(null), null);
});

test("actions: both map errors via describeGuideSlugWriteError; update reconciles canonical", () => {
  assert.equal((ACTIONS.match(/describeGuideSlugWriteError\(error\)/g) ?? []).length, 2);
  const update = ACTIONS.slice(ACTIONS.indexOf("export async function updateGuideAction"));
  assert.match(update, /select\("slug, market_id, canonical_url"\)/);
  assert.match(update, /reconcileGuideCanonicalUrl\(\{/);
  assert.match(update, /canonical_url:\s+canonicalUrl,/);
  // History is never written from app code — the trigger owns it (atomic).
  assert.doesNotMatch(ACTIONS, /content_guide_slug_history/);
});

// ── Migration shape (behaviour is exercised in the PGlite harness) ──────────

test("migration 108: per-market table, trigger on slug/market, single guarded seed", () => {
  assert.match(MIGRATION, /UNIQUE \(market_id, old_slug\)/);
  assert.match(MIGRATION, /BEFORE INSERT OR UPDATE OF slug, market_id ON public\.content_guides/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /GRANT ALL ON public\.content_guide_slug_history TO service_role/);
  assert.match(MIGRATION, /c_old\s+CONSTANT TEXT := 'kelownas-best-sports-bars-to-catch-the-game'/);
  assert.match(MIGRATION, /c_current\s+CONSTANT TEXT := 'kelowna-s-best-sports-bars-to-catch-the-game'/);
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, ""), /UPDATE public\.content_guides/);
});
