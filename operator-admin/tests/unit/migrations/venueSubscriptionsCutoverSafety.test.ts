import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 086_venue_subscriptions_cutover_safety.sql
 * — the Phase 2B deployment-window backfill safeguard + Stripe-identity
 * uniqueness constraints. Same no-live-Postgres-connection convention as
 * the other migration tests in this suite (this migration has also been
 * executed against a real disposable PostgreSQL engine with multiple
 * scenarios — see the Phase 2B task report for that validation).
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/086_venue_subscriptions_cutover_safety.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

test("migration file is 086 and lives in the standard migrations directory", () => {
  assert.ok(MIGRATION_PATH.endsWith("086_venue_subscriptions_cutover_safety.sql"));
});

test("adds partial UNIQUE indexes on billing_provider_customer_id and billing_provider_subscription_id, scoped to NOT NULL", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CREATE UNIQUE INDEX IF NOT EXISTS venue_subscriptions_customer_id_key\s*\n\s*ON public\.venue_subscriptions \(billing_provider_customer_id\)\s*\n\s*WHERE billing_provider_customer_id IS NOT NULL;/
  );
  assert.match(
    MIGRATION_SOURCE,
    /CREATE UNIQUE INDEX IF NOT EXISTS venue_subscriptions_subscription_id_key\s*\n\s*ON public\.venue_subscriptions \(billing_provider_subscription_id\)\s*\n\s*WHERE billing_provider_subscription_id IS NOT NULL;/
  );
});

test("backfill safeguard: raises loudly for any paid operator owning more than one venue — never guesses (same invariant as migration 083)", () => {
  assert.match(MIGRATION_SOURCE, /HAVING count\(\*\) > 1/);
  assert.match(MIGRATION_SOURCE, /RAISE EXCEPTION/);
  assert.match(MIGRATION_SOURCE, /refuses to guess/);
});

test("backfill only fills genuinely missing rows — ON CONFLICT DO NOTHING, never overwrites an existing venue_subscriptions row", () => {
  assert.match(MIGRATION_SOURCE, /ON CONFLICT \(venue_id\) DO NOTHING;/);
  assert.doesNotMatch(MIGRATION_SOURCE, /DO UPDATE/);
});

test("does not touch the function body of sync_venue_plan_entitlement or sync_operator_plan_entitlement", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE OR REPLACE FUNCTION/);
  assert.doesNotMatch(MIGRATION_SOURCE, /DROP FUNCTION/);
});

test("does not alter RLS or grants — additive indexes and a backfill insert only", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /ROW LEVEL SECURITY/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE POLICY/);
  assert.doesNotMatch(MIGRATION_SOURCE, /GRANT/);
});
