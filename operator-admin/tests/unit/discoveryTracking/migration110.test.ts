import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 110 (same no-live-Postgres convention as
 * the rest of tests/unit/migrations). Pins: additive-only, no backfill, NULL
 * = legacy environment, service-role-only new table.
 */
const SOURCE = readFileSync(join(__dirname, "../../../../supabase/migrations/110_search_discovery_tracking_foundation.sql"), "utf8");
const CODE = SOURCE.replace(/--.*$/gm, "");

const TABLES = ["website_search_events", "venue_discover_events", "venue_view_events", "event_view_events", "daily_special_click_events"];

test("adds a nullable environment column with no default to every existing tracking table", () => {
  for (const t of TABLES) {
    assert.match(CODE, new RegExp(`ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS environment TEXT;`), t);
    assert.match(CODE, new RegExp(`${t}_environment_check\\s+CHECK \\(environment IS NULL OR environment IN \\('production', 'staging', 'preview', 'development'\\)\\)`), t);
  }
  assert.doesNotMatch(CODE, /environment TEXT\s+(NOT NULL|DEFAULT)/);
});

test("never modifies or backfills existing rows", () => {
  assert.doesNotMatch(CODE, /\bUPDATE\s+public\./i);
  assert.doesNotMatch(CODE, /\bDELETE\s+FROM/i);
  assert.doesNotMatch(CODE, /\bTRUNCATE\b/i);
  assert.doesNotMatch(CODE, /\bDROP\s+(TABLE|COLUMN)\b/i);
});

test("search-quality columns are all nullable additions", () => {
  for (const col of ["mode", "origin", "capture_trigger", "result_count_capped", "other_filters_active", "search_id"]) {
    assert.match(CODE, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\s+(TEXT|BOOLEAN|UUID),?`), col);
  }
  assert.match(CODE, /CREATE UNIQUE INDEX IF NOT EXISTS website_search_events_search_id_key\s+ON public\.website_search_events \(search_id\)/);
});

test("website_discovery_events: RLS on, service_role only, dedupe key unique", () => {
  assert.match(CODE, /CREATE TABLE IF NOT EXISTS public\.website_discovery_events/);
  assert.match(CODE, /ALTER TABLE public\.website_discovery_events ENABLE ROW LEVEL SECURITY;/);
  assert.match(CODE, /GRANT ALL ON public\.website_discovery_events TO service_role;/);
  assert.doesNotMatch(CODE, /TO (anon|authenticated)/);
  assert.doesNotMatch(CODE, /CREATE POLICY/);
  assert.match(CODE, /CREATE UNIQUE INDEX IF NOT EXISTS website_discovery_events_dedupe_key_key\s+ON public\.website_discovery_events \(dedupe_key\)/);
});

test("the event/surface/item vocabularies match the application validator", async () => {
  const ev = await import("../../../src/lib/discoveryTracking/discoveryEvents");
  for (const v of [...ev.DISCOVERY_EVENT_TYPES, ...ev.DISCOVERY_SURFACES, ...ev.DISCOVERY_ITEM_TYPES, ...ev.DISCOVERY_SECTION_KINDS, ...ev.GUIDE_BLOCKS, ...ev.SEARCH_MODES]) {
    assert.ok(CODE.includes(`'${v}'`), v);
  }
});
