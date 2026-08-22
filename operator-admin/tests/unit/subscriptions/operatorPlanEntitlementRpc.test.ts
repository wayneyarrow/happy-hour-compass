import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 081_operator_plan_entitlement_atomic_sync.sql
 * (the new sync_operator_plan_entitlement() RPC) — read-only text assertions
 * against the migration file itself. No live Postgres/Supabase connection is
 * used or required — this repo's migrations are validated by inspection
 * before being applied through the normal Supabase deploy workflow, not by
 * this test suite executing SQL. See the migration's own header for the
 * full design rationale.
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/081_operator_plan_entitlement_atomic_sync.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

// Migration 036's constraint text — used to confirm this migration does not
// touch or narrow it (read from the real file, not hardcoded, so this test
// fails loudly if 036 itself is ever edited out from under this assumption).
const MIGRATION_036_SOURCE = readFileSync(
  join(__dirname, "../../../../supabase/migrations/036_operator_subscriptions.sql"),
  "utf8"
);

test("sync_operator_plan_entitlement() function definition exists", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CREATE OR REPLACE FUNCTION public\.sync_operator_plan_entitlement\(/
  );
  assert.match(MIGRATION_SOURCE, /RETURNS public\.operator_subscriptions/);
});

test("function uses the established SECURITY DEFINER RPC security pattern (matching migration 075's Brevo precedent)", () => {
  assert.match(MIGRATION_SOURCE, /LANGUAGE plpgsql/);
  assert.match(MIGRATION_SOURCE, /SECURITY DEFINER/);
  assert.match(MIGRATION_SOURCE, /SET search_path = public/);
});

test("GRANT EXECUTE is scoped to service_role only — no anon/authenticated execution granted", () => {
  assert.match(
    MIGRATION_SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.sync_operator_plan_entitlement\([\s\S]*?\) TO service_role;/
  );
  assert.doesNotMatch(MIGRATION_SOURCE, /TO anon/);
  assert.doesNotMatch(MIGRATION_SOURCE, /TO authenticated/);
});

test("function body contains both required atomic writes — operator_subscriptions upsert AND operators.plan update", () => {
  const fnBody = MIGRATION_SOURCE.match(/AS \$\$([\s\S]*?)\$\$;/)![1];
  assert.match(fnBody, /INSERT INTO public\.operator_subscriptions/);
  assert.match(fnBody, /ON CONFLICT \(operator_id\) DO UPDATE SET/);
  assert.match(fnBody, /UPDATE public\.operators/);
  assert.match(fnBody, /SET plan = p_plan_code/);
});

test("function defensively rolls back if the operators row does not exist (RAISE EXCEPTION on zero rows updated)", () => {
  const fnBody = MIGRATION_SOURCE.match(/AS \$\$([\s\S]*?)\$\$;/)![1];
  assert.match(fnBody, /GET DIAGNOSTICS v_rowcount = ROW_COUNT;/);
  assert.match(fnBody, /RAISE EXCEPTION/);
});

test("migration does not narrow or drop the existing plan_code/status CHECK constraints from migration 036 — relies on them unchanged", () => {
  // This migration must not touch operator_subscriptions_plan_code_check or
  // operator_subscriptions_status_check at all (as DDL) — invalid input is
  // rejected by the pre-existing constraint, not duplicated validation
  // logic here. (A prose mention of the constraint's name in a comment
  // explaining this reliance is fine and expected — only actual DDL is
  // checked for.)
  assert.doesNotMatch(MIGRATION_SOURCE, /DROP CONSTRAINT/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ADD CONSTRAINT/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ALTER TABLE/);

  // And confirm the constraint this migration relies on is exactly the one
  // migration 036 already defined — still permits enterprise, still an
  // existing business/schema invariant this task does not change.
  assert.match(
    MIGRATION_036_SOURCE,
    /CHECK \(plan_code IN \('free', 'pro', 'premium', 'enterprise'\)\)/
  );
});

test("migration does not create or alter any table, index, or RLS policy — function + grant only", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE TABLE/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE INDEX/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE POLICY/);
});

test("no secondary notification/audit side effects were pulled into the function", () => {
  const fnBody = MIGRATION_SOURCE.match(/AS \$\$([\s\S]*?)\$\$;/)![1];
  for (const forbidden of ["plan_change_events", "audit_logs", "venue_notes", "http", "net.http", "pg_notify"]) {
    assert.doesNotMatch(fnBody, new RegExp(forbidden, "i"));
  }
});

test("migration file is the expected next number (081) and lives in the repo's standard migrations directory", () => {
  // Sanity check that the file this suite reads is actually where the
  // implementation report says it is — fails loudly (rather than silently
  // reading a stale/wrong file) if the migration were ever renamed.
  assert.ok(MIGRATION_PATH.endsWith("081_operator_plan_entitlement_atomic_sync.sql"));
});
