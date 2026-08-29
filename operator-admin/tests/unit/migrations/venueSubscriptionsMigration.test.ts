import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 083_venue_subscriptions.sql — read-only
 * text assertions against the migration file itself, no live Postgres
 * connection in this suite (this migration has also been executed against a
 * real disposable PostgreSQL engine — see the Phase 2A final-review task
 * report for that validation).
 *
 * Renumbered from 082 to 083 (see the "Harden Existing Operator Plan RPC +
 * Renumber Phase 2A Migrations" task) to make room for
 * 082_harden_operator_plan_entitlement_rpc_permissions.sql, which corrects
 * an already-shipped production privilege gap and is deliberately sequenced
 * ahead of the Phase 2A venue-subscription work.
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/083_venue_subscriptions.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

test("migration file is 083 and lives in the standard migrations directory", () => {
  assert.ok(MIGRATION_PATH.endsWith("083_venue_subscriptions.sql"));
});

test("creates venue_subscriptions with venue_id UNIQUE NOT NULL and ON DELETE CASCADE", () => {
  assert.match(MIGRATION_SOURCE, /CREATE TABLE IF NOT EXISTS public\.venue_subscriptions/);
  assert.match(MIGRATION_SOURCE, /venue_id\s+UUID\s+NOT NULL/);
  assert.match(MIGRATION_SOURCE, /REFERENCES public\.venues\(id\)\s*\n\s*ON DELETE CASCADE/);
  assert.match(MIGRATION_SOURCE, /CONSTRAINT venue_subscriptions_venue_id_key\s*\n\s*UNIQUE \(venue_id\)/);
});

test("plan_code and status reuse the exact existing operator_subscriptions vocabulary — no new enum invented", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CHECK \(plan_code IN \('free', 'pro', 'premium', 'enterprise'\)\)/
  );
  assert.match(
    MIGRATION_SOURCE,
    /CHECK \(status IN \('active', 'pending', 'cancelled', 'past_due'\)\)/
  );
});

test("includes cancel_at_period_end BOOLEAN NOT NULL DEFAULT false — new capability not present on operator_subscriptions", () => {
  assert.match(
    MIGRATION_SOURCE,
    /cancel_at_period_end\s+BOOLEAN\s+NOT NULL DEFAULT false/
  );
});

test("does NOT add venues.plan — one authoritative venue-level plan source only", () => {
  // Prose in the header legitimately discusses "venues.plan" as the
  // anti-pattern being avoided — only actual DDL is checked for here.
  assert.doesNotMatch(MIGRATION_SOURCE, /ALTER TABLE public\.venues\s+ADD COLUMN/i);
  assert.doesNotMatch(MIGRATION_SOURCE, /^\s*plan\s+TEXT/m);
});

test("RLS enabled with no permissive CREATE POLICY — service-role only, matching operator_subscriptions", () => {
  assert.match(MIGRATION_SOURCE, /ALTER TABLE public\.venue_subscriptions ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE POLICY/);
});

test("GRANT is service_role only — no anon/authenticated access", () => {
  assert.match(MIGRATION_SOURCE, /GRANT ALL ON public\.venue_subscriptions TO service_role;/);
  assert.doesNotMatch(MIGRATION_SOURCE, /GRANT[^;]*TO anon/);
  assert.doesNotMatch(MIGRATION_SOURCE, /GRANT[^;]*TO authenticated/);
});

test("updated_at trigger reuses the existing update_updated_at() function", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CREATE TRIGGER venue_subscriptions_updated_at\s*\n\s*BEFORE UPDATE ON public\.venue_subscriptions\s*\n\s*FOR EACH ROW EXECUTE FUNCTION update_updated_at\(\);/
  );
});

test("only the status index is added beyond the UNIQUE constraint's implicit index", () => {
  const createIndexes = MIGRATION_SOURCE.match(/CREATE INDEX IF NOT EXISTS [a-z_]+/g) ?? [];
  assert.deepEqual(createIndexes, ["CREATE INDEX IF NOT EXISTS venue_subscriptions_status_idx"]);
});

test("backfill safeguard: raises loudly for any paid operator owning more than one venue — never guesses", () => {
  assert.match(MIGRATION_SOURCE, /HAVING count\(\*\) > 1/);
  assert.match(MIGRATION_SOURCE, /RAISE EXCEPTION/);
  assert.match(MIGRATION_SOURCE, /refuses to guess/);
});

test("backfill safeguard check runs BEFORE the INSERT that copies paid single-venue operators", () => {
  const raiseIndex = MIGRATION_SOURCE.indexOf("RAISE EXCEPTION");
  const insertIndex = MIGRATION_SOURCE.indexOf("INSERT INTO public.venue_subscriptions (\n    venue_id,");
  assert.ok(raiseIndex > -1 && insertIndex > -1, "expected both the RAISE and the backfill INSERT to be present");
  assert.ok(raiseIndex < insertIndex, "the ambiguity check must run before any backfill INSERT executes");
});

test("backfill never hardcodes venues[0]/alphabetical selection — filters strictly by exactly-one-venue via a scalar subquery", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /ORDER BY.*name/i);
  assert.match(MIGRATION_SOURCE, /SELECT count\(\*\) FROM public\.venues v2\s*\n\s*WHERE v2\.created_by_operator_id = v\.created_by_operator_id\s*\n\s*\) = 1/);
});

test("backfill copy covers both a real operator_subscriptions row and the legacy manual-plan-without-subscription-row case via one COALESCE", () => {
  // COALESCE(os.plan_code, o.plan) appears in both the ambiguity-detection
  // query and the actual INSERT ... SELECT — one code path for Part 3B and
  // 3D of the task, not two separately-maintained branches.
  const occurrences = MIGRATION_SOURCE.match(/COALESCE\(os\.plan_code, o\.plan\)/g) ?? [];
  assert.ok(occurrences.length >= 2, "expected COALESCE(os.plan_code, o.plan) in both the safeguard query and the backfill INSERT");
});

test("backfill excludes Free operators entirely — no row is created for them", () => {
  assert.match(MIGRATION_SOURCE, /COALESCE\(os\.plan_code, o\.plan\) <> 'free'/);
});

test("backfill INSERT is idempotent (ON CONFLICT DO NOTHING) and every DDL statement uses IF NOT EXISTS", () => {
  assert.match(MIGRATION_SOURCE, /ON CONFLICT \(venue_id\) DO NOTHING;/);
  assert.match(MIGRATION_SOURCE, /CREATE TABLE IF NOT EXISTS public\.venue_subscriptions/);
  assert.match(MIGRATION_SOURCE, /CREATE INDEX IF NOT EXISTS venue_subscriptions_status_idx/);
});

test("migration never touches operator_subscriptions or operators as DDL (read-only join for backfill source data only)", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /ALTER TABLE public\.operator_subscriptions/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ALTER TABLE public\.operators/);
  assert.doesNotMatch(MIGRATION_SOURCE, /DROP TABLE/i);
});
