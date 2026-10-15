import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 112_scout_reports.sql — text assertions,
 * no live Postgres in this suite.
 */

const SQL = readFileSync(join(__dirname, "../../../../supabase/migrations/112_scout_reports.sql"), "utf8");
const CODE = SQL.replace(/--.*$/gm, "");

test("creates the table with RLS enabled and no policies, views, RPCs or storage", () => {
  assert.match(CODE, /CREATE TABLE IF NOT EXISTS public\.scout_reports/);
  assert.match(CODE, /ALTER TABLE public\.scout_reports ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(CODE, /CREATE POLICY/);
  assert.doesNotMatch(CODE, /CREATE (OR REPLACE )?VIEW/);
  assert.doesNotMatch(CODE, /storage\.|buckets/);
  assert.doesNotMatch(CODE, /ALTER ROLE|CREATE ROLE|ALTER DEFAULT PRIVILEGES/);
  // The only function is the trigger guard.
  assert.deepEqual([...CODE.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)/g)].map((m) => m[1]), ["public.scout_reports_guard"]);
});

test("access: everything revoked from PUBLIC, anon and authenticated; service_role only", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert.match(CODE, new RegExp(`REVOKE ALL ON public\\.scout_reports FROM ${role};`));
  }
  assert.match(CODE, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.scout_reports TO service_role;/);
  assert.doesNotMatch(CODE, /GRANT [^;]* TO (anon|authenticated|PUBLIC)/);
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assert.match(CODE, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.scout_reports_guard\\(\\) FROM ${role};`));
  }
});

test("one report per type + environment + period, enforced by the database", () => {
  assert.match(CODE, /CONSTRAINT scout_reports_one_per_period UNIQUE \(report_type, environment, period_start\)/);
  assert.match(CODE, /environment\s+TEXT\s+NOT NULL CHECK \(environment IN \('production', 'staging'\)\)/);
  assert.match(CODE, /report_type\s+TEXT\s+NOT NULL CHECK \(report_type IN \('product_usage_and_discovery'\)\)/);
});

test("generation state is separate from completeness, and their combinations are constrained", () => {
  assert.match(CODE, /generation_state\s+TEXT\s+NOT NULL CHECK \(generation_state IN \('generating', 'generated', 'failed'\)\)/);
  assert.match(CODE, /completeness\s+TEXT\s+CHECK \(completeness IN \('complete', 'incomplete'\)\)/);
  assert.match(CODE, /CHECK \(\(generation_state = 'generating'\) = \(lease_started_at IS NOT NULL\)\)/);
  assert.match(CODE, /CHECK \(generation_state <> 'failed' OR payload IS NULL\)/);
  assert.match(CODE, /CHECK \(period_end > period_start\)/);
  assert.match(CODE, /attempt_count\s+INTEGER\s+NOT NULL DEFAULT 1 CHECK \(attempt_count BETWEEN 1 AND 10\)/);
});

test("complete reports are immutable snapshots; identity can never change", () => {
  assert.match(CODE, /IF OLD\.completeness = 'complete' THEN\s+RAISE EXCEPTION/);
  for (const col of ["id", "report_type", "environment", "period_start", "period_end"]) {
    assert.match(CODE, new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}`));
  }
  assert.match(CODE, /CREATE TRIGGER scout_reports_guard\s+BEFORE UPDATE ON public\.scout_reports/);
  assert.match(CODE, /SET search_path = ''/);
});

test("no data is touched outside the new table", () => {
  assert.doesNotMatch(CODE, /^\s*(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/im, "no data-modifying statements");
  assert.doesNotMatch(CODE, /ALTER TABLE public\.(?!scout_reports)/);
});
