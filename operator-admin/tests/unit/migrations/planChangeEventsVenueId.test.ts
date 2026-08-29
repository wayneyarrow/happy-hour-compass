import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 084_plan_change_events_venue_id.sql —
 * same no-live-Postgres-connection convention as the other migration tests
 * in this suite (also executed against a real disposable PostgreSQL engine
 * — see the Phase 2A final-review task report).
 *
 * Renumbered from 083 to 084 (see the "Harden Existing Operator Plan RPC +
 * Renumber Phase 2A Migrations" task) to make room for
 * 082_harden_operator_plan_entitlement_rpc_permissions.sql.
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/084_plan_change_events_venue_id.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

test("migration file is 084 and lives in the standard migrations directory", () => {
  assert.ok(MIGRATION_PATH.endsWith("084_plan_change_events_venue_id.sql"));
});

test("adds venue_id as a NULLABLE column (Phase 2A compatibility — no existing writer populates it yet)", () => {
  assert.match(
    MIGRATION_SOURCE,
    /ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public\.venues\(id\);/
  );
  // Must NOT be NOT NULL in Phase 2A — that would break every existing
  // operator-level writer (changePlanAction, the Stripe webhook route,
  // cancelVenueAction), none of which pass venue_id yet.
  assert.doesNotMatch(MIGRATION_SOURCE, /venue_id UUID[^;]*NOT NULL/);
});

test("index added for the future venue-scoped query pattern", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CREATE INDEX IF NOT EXISTS plan_change_events_venue_id_idx\s*\n\s*ON public\.plan_change_events \(venue_id\);/
  );
});

test("does not touch plan_change_events.operator_id or any other existing column as DDL", () => {
  // The header legitimately discusses "operator" in prose — only actual DDL
  // (DROP/ALTER COLUMN, or an operator_id reference inside a statement) is
  // checked for here.
  assert.doesNotMatch(MIGRATION_SOURCE, /DROP COLUMN/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ALTER COLUMN/);
  assert.doesNotMatch(MIGRATION_SOURCE, /^(ALTER TABLE|CREATE INDEX)[^;]*operator_id[^;]*;/m);
});

test("no new GRANT statement — existing GRANT ALL ... TO service_role from migration 042 already covers the new column", () => {
  // The header legitimately mentions the pre-existing GRANT from migration
  // 042 in prose — only an actual GRANT statement is checked for here.
  assert.doesNotMatch(MIGRATION_SOURCE, /^GRANT /m);
});

test("does not alter RLS — plan_change_events keeps its existing service-role-only posture", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /ROW LEVEL SECURITY/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE POLICY/);
});
