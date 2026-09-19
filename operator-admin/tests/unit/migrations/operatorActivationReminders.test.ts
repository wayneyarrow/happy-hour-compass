import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 099_operator_activation_reminders.sql —
 * same no-live-Postgres-connection convention as the other migration tests
 * in this suite (e.g. tests/unit/migrations/dailySpecialsFoundation.test.ts).
 * This migration is NOT applied (Phase 2A-2 is schema-foundation-only) —
 * these tests pin the SOURCE so a future edit can't silently regress the
 * reviewed design (no DML, no permissive policy, exact constraint bounds)
 * before it is ever applied.
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/099_operator_activation_reminders.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

/**
 * Comment-stripped source — the migration's own header/inline commentary
 * legitimately discusses columns, constraints, INSERT/UPDATE, GRANT, and
 * RLS in prose while explaining what the file deliberately does NOT do.
 * Assertions about what the executable SQL itself does or doesn't contain
 * run against this stripped version, matching this suite's established
 * "prose vs. actual DDL" distinction.
 */
const CODE_ONLY = MIGRATION_SOURCE.replace(/--.*$/gm, "");

test("migration file is 099 and lives in the standard migrations directory", () => {
  assert.ok(MIGRATION_PATH.endsWith("099_operator_activation_reminders.sql"));
});

// ── Expected columns ─────────────────────────────────────────────────────────

test("adds exactly the reviewed reminder/expiry columns to operator_activation_lifecycles", () => {
  const expectedColumns = [
    "reminder_next_attempt_at\\s+TIMESTAMPTZ",
    "reminder_attempt_count\\s+INTEGER\\s+NOT NULL DEFAULT 0",
    "reminder_last_attempted_at\\s+TIMESTAMPTZ",
    "reminder_last_error\\s+TEXT",
    "reminder_lease_stage\\s+INTEGER",
    "reminder_lease_started_at\\s+TIMESTAMPTZ",
    "expiry_slack_notified_at\\s+TIMESTAMPTZ",
    "expiry_founder_email_sent_at\\s+TIMESTAMPTZ",
  ];
  for (const pattern of expectedColumns) {
    assert.match(CODE_ONLY, new RegExp(pattern), `missing expected column definition matching /${pattern}/`);
  }
});

test("column additions are on operator_activation_lifecycles, using ADD COLUMN IF NOT EXISTS (rerun-safe)", () => {
  const alterBlock = CODE_ONLY.match(/ALTER TABLE public\.operator_activation_lifecycles\s*\n\s*ADD COLUMN IF NOT EXISTS[\s\S]*?;/);
  assert.ok(alterBlock, "expected a single ADD COLUMN IF NOT EXISTS block for operator_activation_lifecycles");
  assert.match(alterBlock![0], /reminder_next_attempt_at/);
  assert.match(alterBlock![0], /expiry_founder_email_sent_at/);
});

// ── Constraint bounds ────────────────────────────────────────────────────────

test("reminder_stage is bound to exactly 0-3 via DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT (rerun-safe)", () => {
  assert.match(CODE_ONLY, /DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_stage_check/);
  assert.match(CODE_ONLY, /ADD CONSTRAINT operator_activation_lifecycles_reminder_stage_check\s*\n\s*CHECK \(reminder_stage BETWEEN 0 AND 3\)/);
});

test("reminder_attempt_count is bound to >= 0", () => {
  assert.match(CODE_ONLY, /DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_attempt_count_check/);
  assert.match(CODE_ONLY, /ADD CONSTRAINT operator_activation_lifecycles_reminder_attempt_count_check\s*\n\s*CHECK \(reminder_attempt_count >= 0\)/);
});

test("reminder_lease_stage is null or bound to 1-3", () => {
  assert.match(CODE_ONLY, /DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_lease_stage_check/);
  assert.match(
    CODE_ONLY,
    /ADD CONSTRAINT operator_activation_lifecycles_reminder_lease_stage_check\s*\n\s*CHECK \(reminder_lease_stage IS NULL OR reminder_lease_stage BETWEEN 1 AND 3\)/
  );
});

test("lease shape consistency: reminder_lease_stage and reminder_lease_started_at must both be null or both be non-null", () => {
  assert.match(CODE_ONLY, /DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_lease_shape_check/);
  const constraintBlock = CODE_ONLY.match(/ADD CONSTRAINT operator_activation_lifecycles_reminder_lease_shape_check[\s\S]*?;/);
  assert.ok(constraintBlock, "expected the paired lease-shape CHECK constraint");
  assert.match(constraintBlock![0], /reminder_lease_stage IS NULL AND reminder_lease_started_at IS NULL/);
  assert.match(constraintBlock![0], /reminder_lease_stage IS NOT NULL AND reminder_lease_started_at IS NOT NULL/);
});

// ── Indexes ──────────────────────────────────────────────────────────────────

test("reminder due-index is scoped to live (unexpired, unreleased) lifecycles", () => {
  assert.match(
    CODE_ONLY,
    /CREATE INDEX IF NOT EXISTS operator_activation_lifecycles_reminder_due_idx\s*\n\s*ON public\.operator_activation_lifecycles \(reminder_next_attempt_at\)\s*\n\s*WHERE expired_at IS NULL AND released_at IS NULL/
  );
});

test("reminder lease/stale-recovery index is scoped to non-null leases", () => {
  assert.match(
    CODE_ONLY,
    /CREATE INDEX IF NOT EXISTS operator_activation_lifecycles_reminder_lease_idx\s*\n\s*ON public\.operator_activation_lifecycles \(reminder_lease_started_at\)\s*\n\s*WHERE reminder_lease_started_at IS NOT NULL/
  );
});

// ── event_key on both notes tables ──────────────────────────────────────────

for (const table of ["venue_claim_notes", "operator_submission_notes"]) {
  test(`${table} gains a nullable event_key column`, () => {
    const alterBlock = CODE_ONLY.match(new RegExp(`ALTER TABLE public\\.${table}\\s*\\n\\s*ADD COLUMN IF NOT EXISTS event_key TEXT;`));
    assert.ok(alterBlock, `expected event_key ADD COLUMN IF NOT EXISTS on ${table}`);
  });

  test(`${table} has a partial unique index on event_key WHERE NOT NULL`, () => {
    assert.match(
      CODE_ONLY,
      new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_event_key_uidx\\s*\\n\\s*ON public\\.${table} \\(event_key\\)\\s*\\n\\s*WHERE event_key IS NOT NULL`)
    );
  });
}

// ── Schema-only: no DML/backfill, no permissive policy, no unnecessary GRANT ─

test("migration is schema-only — no INSERT/UPDATE/DELETE statement anywhere in the executable SQL", () => {
  assert.doesNotMatch(CODE_ONLY, /\bINSERT INTO\b/i);
  assert.doesNotMatch(CODE_ONLY, /\bUPDATE\s+public\./i);
  assert.doesNotMatch(CODE_ONLY, /\bDELETE FROM\b/i);
});

test("no new permissive RLS policy is created", () => {
  assert.doesNotMatch(CODE_ONLY, /CREATE POLICY/i);
  assert.doesNotMatch(CODE_ONLY, /ALTER TABLE[\s\S]*?ENABLE ROW LEVEL SECURITY/i, "no new table is created here, so no new RLS-enable statement is expected either");
});

test("no GRANT statement — every altered table is already granted appropriately by an earlier migration", () => {
  assert.doesNotMatch(CODE_ONLY, /\bGRANT\b/i);
});

test("does not create any new table — ALTER-only migration", () => {
  assert.doesNotMatch(CODE_ONLY, /CREATE TABLE/i);
});

// ── The exact required semantic rule appears in a schema comment ──────────────

test("the exact reminder_stage semantic rule appears verbatim in a COMMENT ON COLUMN", () => {
  assert.match(
    MIGRATION_SOURCE,
    /reminder_stage records the highest stage durably resolved \(sent, '\s*\n\s*'skipped-as-superseded, or obsoleted by extension\) — never assume a '\s*\n\s*'given stage was actually delivered without checking for its Internal '\s*\n\s*'Note\./
  );
});
