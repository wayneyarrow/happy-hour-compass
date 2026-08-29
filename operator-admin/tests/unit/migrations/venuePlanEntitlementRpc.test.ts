import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 085_venue_plan_entitlement_atomic_sync.sql
 * — the venue-scoped counterpart to migration 081's
 * sync_operator_plan_entitlement(). Same no-live-Postgres-connection
 * convention as tests/unit/subscriptions/operatorPlanEntitlementRpc.test.ts
 * (this migration has also been executed against a real disposable
 * PostgreSQL engine — see the Phase 2A final-review task report).
 *
 * Renumbered from 084 to 085 (see the "Harden Existing Operator Plan RPC +
 * Renumber Phase 2A Migrations" task) to make room for
 * 082_harden_operator_plan_entitlement_rpc_permissions.sql.
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/085_venue_plan_entitlement_atomic_sync.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

function fnBody(): string {
  return MIGRATION_SOURCE.match(/AS \$\$([\s\S]*?)\$\$;/)![1];
}

test("migration file is 085 and lives in the standard migrations directory", () => {
  assert.ok(MIGRATION_PATH.endsWith("085_venue_plan_entitlement_atomic_sync.sql"));
});

test("sync_venue_plan_entitlement() function definition exists and returns venue_subscriptions", () => {
  assert.match(MIGRATION_SOURCE, /CREATE OR REPLACE FUNCTION public\.sync_venue_plan_entitlement\(/);
  assert.match(MIGRATION_SOURCE, /RETURNS public\.venue_subscriptions/);
});

test("accepts p_venue_id and p_cancel_at_period_end alongside the same parameter shape as the operator-level RPC", () => {
  assert.match(MIGRATION_SOURCE, /p_venue_id\s+UUID/);
  assert.match(MIGRATION_SOURCE, /p_cancel_at_period_end\s+BOOLEAN DEFAULT false/);
  for (const param of [
    "p_plan_code", "p_status", "p_billing_provider",
    "p_billing_provider_customer_id", "p_billing_provider_subscription_id",
    "p_current_period_start", "p_current_period_end",
  ]) {
    assert.match(MIGRATION_SOURCE, new RegExp(param));
  }
});

test("uses the established SECURITY DEFINER RPC pattern (matching migrations 075/081)", () => {
  assert.match(MIGRATION_SOURCE, /LANGUAGE plpgsql/);
  assert.match(MIGRATION_SOURCE, /SECURITY DEFINER/);
  assert.match(MIGRATION_SOURCE, /SET search_path = public/);
});

test("GRANT EXECUTE is scoped to service_role only", () => {
  assert.match(
    MIGRATION_SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.sync_venue_plan_entitlement\([\s\S]*?\) TO service_role;/
  );
  assert.doesNotMatch(MIGRATION_SOURCE, /TO anon/);
  assert.doesNotMatch(MIGRATION_SOURCE, /TO authenticated/);
});

test("REVOKEs the default PUBLIC execute grant before granting to service_role — Postgres grants EXECUTE on new functions to PUBLIC by default, and a bare GRANT alone does not remove it (verified against a real Postgres engine — see the Phase 2A final-review task report)", () => {
  assert.match(
    MIGRATION_SOURCE,
    /REVOKE EXECUTE ON FUNCTION public\.sync_venue_plan_entitlement\([\s\S]*?\) FROM PUBLIC;/
  );
  assert.match(
    MIGRATION_SOURCE,
    /REVOKE EXECUTE ON FUNCTION public\.sync_venue_plan_entitlement\([\s\S]*?\) FROM anon;/
  );
  assert.match(
    MIGRATION_SOURCE,
    /REVOKE EXECUTE ON FUNCTION public\.sync_venue_plan_entitlement\([\s\S]*?\) FROM authenticated;/
  );
  // Every REVOKE must appear before the final GRANT, so PUBLIC/anon/
  // authenticated are never left with EXECUTE even momentarily.
  const revokeIndex = MIGRATION_SOURCE.indexOf("REVOKE EXECUTE");
  const grantIndex = MIGRATION_SOURCE.lastIndexOf("GRANT EXECUTE");
  assert.ok(revokeIndex > -1 && grantIndex > -1);
  assert.ok(revokeIndex < grantIndex);
});

test("function body is a single-table upsert against venue_subscriptions only", () => {
  const body = fnBody();
  assert.match(body, /INSERT INTO public\.venue_subscriptions/);
  assert.match(body, /ON CONFLICT \(venue_id\) DO UPDATE SET/);
  assert.match(body, /cancel_at_period_end\s*=\s*EXCLUDED\.cancel_at_period_end/);
});

test("function NEVER reads or writes operators, operator_subscriptions, or venues.plan — single-table by design, unlike migration 081", () => {
  const body = fnBody();
  assert.doesNotMatch(body, /operators/i);
  assert.doesNotMatch(body, /operator_subscriptions/i);
  assert.doesNotMatch(body, /UPDATE public\.venues/i);
  assert.doesNotMatch(body, /venues\.plan/);
});

test("function does not narrow or duplicate the plan_code/status CHECK constraints from migration 083 as DDL", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /DROP CONSTRAINT/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ADD CONSTRAINT/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ALTER TABLE/);
});

test("migration does not create or alter any table, index, or RLS policy — function + grant only", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE TABLE/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE INDEX/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE POLICY/);
});

test("no secondary notification/audit side effects pulled into the function", () => {
  const body = fnBody();
  for (const forbidden of ["plan_change_events", "audit_logs", "venue_notes", "http", "net.http", "pg_notify"]) {
    assert.doesNotMatch(body, new RegExp(forbidden, "i"));
  }
});

test("header explicitly documents Phase 2A unused-by-live-code status", () => {
  assert.match(MIGRATION_SOURCE, /PHASE 2A STATUS/);
  assert.match(MIGRATION_SOURCE, /UNUSED by any live application code/);
});
