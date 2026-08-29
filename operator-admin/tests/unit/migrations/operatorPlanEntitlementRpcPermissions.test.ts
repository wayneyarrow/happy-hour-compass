import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of
 * migration 082_harden_operator_plan_entitlement_rpc_permissions.sql —
 * the security-hardening fix for the ALREADY-DEPLOYED (migration 081)
 * sync_operator_plan_entitlement() RPC.
 *
 * Background (see the "Harden Existing Operator Plan RPC + Renumber
 * Phase 2A Migrations" task report for the full investigation): migration
 * 081 shipped with a bare `GRANT EXECUTE ... TO service_role` and no
 * `REVOKE ... FROM PUBLIC`. PostgreSQL grants EXECUTE on every new function
 * to PUBLIC by default, and Supabase's own default privileges separately
 * grant EXECUTE to anon/authenticated — confirmed live in production via a
 * read-only pg_proc.proacl query before this migration was authored:
 *   {=X/postgres,postgres=X/postgres,anon=X/postgres,
 *    authenticated=X/postgres,service_role=X/postgres}
 * This means anon/authenticated currently have real, callable EXECUTE on a
 * SECURITY DEFINER function that writes operator_subscriptions and
 * operators.plan, bypassing RLS entirely. This migration closes that gap
 * without touching the function body or any data.
 *
 * Same no-live-Postgres-connection convention as the other migration tests
 * in this suite — also executed against a real disposable PostgreSQL engine
 * with production-representative seed data (see the task report).
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/082_harden_operator_plan_entitlement_rpc_permissions.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

// The exact signature confirmed against the live production catalog and
// against migration 081's own GRANT statement.
const SIGNATURE = "UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ";

test("migration file is 082 and lives in the standard migrations directory", () => {
  assert.ok(MIGRATION_PATH.endsWith("082_harden_operator_plan_entitlement_rpc_permissions.sql"));
});

test("targets the exact, confirmed sync_operator_plan_entitlement signature — not guessed", () => {
  const escaped = SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `public\\.sync_operator_plan_entitlement\\(\\s*${escaped}\\s*\\)`
  );
  // Every REVOKE/GRANT statement in the file must reference this exact
  // signature — count occurrences rather than matching once, so a
  // mismatched or partially-updated signature on any one statement fails
  // loudly.
  const occurrences = MIGRATION_SOURCE.match(new RegExp(pattern, "g")) ?? [];
  assert.equal(occurrences.length, 4, "expected the exact signature on all 3 REVOKEs + 1 GRANT");
});

test("REVOKEs EXECUTE from PUBLIC, anon, and authenticated", () => {
  assert.match(MIGRATION_SOURCE, /REVOKE EXECUTE ON FUNCTION public\.sync_operator_plan_entitlement\([\s\S]*?\) FROM PUBLIC;/);
  assert.match(MIGRATION_SOURCE, /REVOKE EXECUTE ON FUNCTION public\.sync_operator_plan_entitlement\([\s\S]*?\) FROM anon;/);
  assert.match(MIGRATION_SOURCE, /REVOKE EXECUTE ON FUNCTION public\.sync_operator_plan_entitlement\([\s\S]*?\) FROM authenticated;/);
});

test("GRANTs EXECUTE to service_role only, after the REVOKEs", () => {
  assert.match(MIGRATION_SOURCE, /GRANT EXECUTE ON FUNCTION public\.sync_operator_plan_entitlement\([\s\S]*?\) TO service_role;/);
  const revokeIndex = MIGRATION_SOURCE.indexOf("REVOKE EXECUTE");
  const grantIndex = MIGRATION_SOURCE.lastIndexOf("GRANT EXECUTE");
  assert.ok(revokeIndex > -1 && grantIndex > -1);
  assert.ok(revokeIndex < grantIndex, "every REVOKE must appear before the final GRANT");
});

test("does NOT recreate, replace, or alter the function body — permissions-only migration", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE OR REPLACE FUNCTION/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE FUNCTION/);
  assert.doesNotMatch(MIGRATION_SOURCE, /DROP FUNCTION/);
});

test("does NOT touch operator_subscriptions or operators data or schema", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /INSERT INTO/i);
  assert.doesNotMatch(MIGRATION_SOURCE, /UPDATE public\.operators/i);
  assert.doesNotMatch(MIGRATION_SOURCE, /UPDATE public\.operator_subscriptions/i);
  assert.doesNotMatch(MIGRATION_SOURCE, /ALTER TABLE/i);
  assert.doesNotMatch(MIGRATION_SOURCE, /DELETE FROM/i);
});

test("does NOT touch RLS policies on operators/operator_subscriptions — closes the SECURITY DEFINER side-door, doesn't touch the RLS boundary itself", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /ROW LEVEL SECURITY/);
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE POLICY/);
});

test("header explains why explicit REVOKE is required for a SECURITY DEFINER function", () => {
  assert.match(MIGRATION_SOURCE, /SECURITY DEFINER/);
  assert.match(MIGRATION_SOURCE, /PUBLIC by\s*\n?--?\s*default/);
});

test("header documents the confirmed live production ACL evidence, not a guess", () => {
  assert.match(MIGRATION_SOURCE, /proacl/);
  assert.match(MIGRATION_SOURCE, /anon=X\/postgres/);
  assert.match(MIGRATION_SOURCE, /authenticated=X\/postgres/);
});

test("does not alter migration 081's file in place — this is a separate, additive corrective migration", () => {
  const migration081 = readFileSync(
    join(__dirname, "../../../../supabase/migrations/081_operator_plan_entitlement_atomic_sync.sql"),
    "utf8"
  );
  // 081 itself must contain no REVOKE — confirming this fix lives entirely
  // in the new migration, not a retroactive edit of already-shipped SQL.
  assert.doesNotMatch(migration081, /REVOKE/);
});
