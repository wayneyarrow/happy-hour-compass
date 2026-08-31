import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration
 * 087_venues_onboarding_completion_override.sql — the Phase 1B durable manual
 * onboarding-completion override. Same no-live-Postgres-connection convention
 * as the other migration tests in this suite.
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/087_venues_onboarding_completion_override.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

test("migration file is 087 and lives in the standard migrations directory", () => {
  assert.ok(MIGRATION_PATH.endsWith("087_venues_onboarding_completion_override.sql"));
});

test("adds all four override columns to public.venues, all nullable (no NOT NULL / DEFAULT)", () => {
  assert.match(MIGRATION_SOURCE, /ADD COLUMN IF NOT EXISTS onboarding_completed_override_at\s+TIMESTAMPTZ,/);
  assert.match(MIGRATION_SOURCE, /ADD COLUMN IF NOT EXISTS onboarding_completed_override_by\s+UUID,/);
  assert.match(MIGRATION_SOURCE, /ADD COLUMN IF NOT EXISTS onboarding_completed_override_by_email\s+TEXT,/);
  assert.match(MIGRATION_SOURCE, /ADD COLUMN IF NOT EXISTS onboarding_completed_override_reason\s+TEXT;/);
  assert.doesNotMatch(MIGRATION_SOURCE, /onboarding_completed_override_at\s+TIMESTAMPTZ\s+NOT NULL/);
});

test("does NOT add a general onboarding_status enum column — presence of onboarding_completed_override_at is the sole override signal", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /ADD COLUMN IF NOT EXISTS onboarding_status/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CHECK \(onboarding_status/);
});

test("does not add a CHECK constraint restricting these to a fixed set of values (free-text reason, unlike google_identity_status)", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /ADD CONSTRAINT/);
});

test("adds a partial index on onboarding_completed_override_at, scoped to NOT NULL rows only", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CREATE INDEX IF NOT EXISTS venues_onboarding_completed_override_at_idx\s*\n\s*ON public\.venues \(onboarding_completed_override_at\)\s*\n\s*WHERE onboarding_completed_override_at IS NOT NULL;/
  );
});

test("no backfill/UPDATE statements — every existing venue defaults to no override (unaffected behavior)", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /UPDATE public\.venues/);
});

test("does not touch RLS or GRANTs — ALTER TABLE ADD COLUMN on an existing table needs neither (venues' existing RLS/grants already cover it)", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /ROW LEVEL SECURITY/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE POLICY/);
  assert.doesNotMatch(MIGRATION_SOURCE, /GRANT/);
});

test("does not create a new table or drop/replace any function", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE TABLE/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE OR REPLACE FUNCTION/);
  assert.doesNotMatch(MIGRATION_SOURCE, /DROP FUNCTION/);
});
