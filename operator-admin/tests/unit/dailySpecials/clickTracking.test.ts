import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Daily Special click tracking (migration 101). Source-wiring checks — the
 * route and card do I/O, and no unit test may write to a real database.
 */

const SRC = join(__dirname, "../../../src");
const ROUTE = readFileSync(join(SRC, "app/api/track/daily-special-click/route.ts"), "utf8");
const CARD = readFileSync(join(SRC, "app/(website)/website-daily-specials/DailySpecialSearchCard.tsx"), "utf8");
const MIGRATION = readFileSync(join(__dirname, "../../../../supabase/migrations/101_daily_special_click_events.sql"), "utf8");

test("route resolves venue_id from the published Special, never from the request body", () => {
  assert.doesNotMatch(ROUTE, /const \{[^}]*venueId[^}]*\} = body/);
  assert.match(ROUTE, /\.from\("daily_specials"\)\s*\.select\("venue_id"\)\s*\.eq\("id", dailySpecialId\)\s*\.eq\("is_published", true\)/);
  assert.match(ROUTE, /venue_id:\s+special\.venue_id/);
  assert.match(ROUTE, /if \(special\?\.venue_id\)/);
});

test("route validates payload and never surfaces tracking failures to the consumer", () => {
  assert.match(ROUTE, /VALID_SOURCES = new Set\(\["search_results"\]\)/);
  assert.match(ROUTE, /UUID_RE\.test\(dailySpecialId\)/);
  assert.match(ROUTE, /sessionId\.length > 128/);
  assert.match(ROUTE, /return new NextResponse\(null, \{ status: 204 \}\);\s*\}\s*$/);
});

test("card de-duplicates rapid repeat clicks and survives navigation", () => {
  assert.match(CARD, /CLICK_DEDUPE_MS = 2_000/);
  assert.match(CARD, /now - previous < CLICK_DEDUPE_MS\) return;/);
  assert.match(CARD, /keepalive: true/);
  assert.match(CARD, /onClick=\{\(\) => trackDailySpecialClick\(special\)\}/);
  assert.doesNotMatch(CARD, /venueId: special\.venueId/);
});

test("migration 101: RLS on, service-role only, click history survives Special deletion", () => {
  assert.match(MIGRATION, /ALTER TABLE public\.daily_special_click_events ENABLE ROW LEVEL SECURITY;/);
  assert.match(MIGRATION, /GRANT ALL ON public\.daily_special_click_events TO service_role;/);
  assert.doesNotMatch(MIGRATION, /TO anon|TO authenticated/);
  assert.match(MIGRATION, /REFERENCES public\.daily_specials\(id\) ON DELETE SET NULL/);
  assert.match(MIGRATION, /CHECK \(source IN \('search_results'\)\)/);
});
