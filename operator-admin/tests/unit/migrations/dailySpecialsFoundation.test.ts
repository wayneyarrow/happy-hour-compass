import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 091_daily_specials_foundation.sql —
 * same no-live-Postgres-connection convention as the other migration tests
 * in this suite (e.g. tests/unit/migrations/planChangeEventsVenueId.test.ts).
 * Live behavioral verification (constraint rejection, RLS/anon/owner/
 * seeded-row/service-role access) was performed directly against the
 * linked Supabase project with disposable data during implementation — see
 * the Phase 1 implementation report's Database Validation section. This
 * file pins the migration SOURCE so a future edit can't silently regress
 * the security posture without a visible test failure.
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/091_daily_specials_foundation.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_PATH, "utf8");

/**
 * The migration file's header/inline commentary deliberately discusses (in
 * prose) several things the SQL itself must NOT do — e.g. explaining why
 * there's no slug column, why cardinality() is used instead of the buggy
 * array_length(), why business_hours is never read. That prose legitimately
 * contains strings like "slug", "is_recurring", and "business_hours" as
 * part of explaining their ABSENCE. Assertions that check something is not
 * actually present in the executable SQL run against this comment-stripped
 * version instead, so they test the DDL itself, not the commentary about it
 * — same "prose vs. actual DDL" distinction this suite's other migration
 * tests already draw explicitly (see planChangeEventsVenueId.test.ts).
 */
const CODE_ONLY = MIGRATION_SOURCE.replace(/--.*$/gm, "");

/**
 * The CREATE TABLE column-definition block only (not COMMENT ON bodies,
 * which also legitimately discuss column names in prose and can contain
 * escaped quotes/semicolons that make generically stripping every COMMENT
 * ON statement fragile). Used for assertions about which COLUMNS actually
 * exist.
 */
const CREATE_TABLE_MATCH = MIGRATION_SOURCE.match(
  /CREATE TABLE IF NOT EXISTS public\.daily_specials \(([\s\S]*?)\n\);/
);
if (!CREATE_TABLE_MATCH) {
  throw new Error("Could not locate the daily_specials CREATE TABLE block — migration structure may have changed.");
}
const TABLE_COLUMNS_BLOCK = CREATE_TABLE_MATCH[1];

/**
 * Every `ALTER TABLE public.daily_specials ADD CONSTRAINT ...;` body — the
 * only place a CHECK constraint could reference another table's column
 * (which Postgres would in fact reject outright, since CHECK constraints
 * cannot contain subqueries — but this asserts the source never even
 * attempts it).
 */
const CONSTRAINT_BLOCKS = [
  ...MIGRATION_SOURCE.matchAll(/ALTER TABLE public\.daily_specials\s*\n\s*ADD CONSTRAINT[\s\S]*?;/g),
].map((m) => m[0]);

test("migration file is 091 and lives in the standard migrations directory", () => {
  assert.ok(MIGRATION_PATH.endsWith("091_daily_specials_foundation.sql"));
});

test("daily_specials is not stored inside public.events — CREATE TABLE only, no ALTER of events", () => {
  assert.match(MIGRATION_SOURCE, /CREATE TABLE IF NOT EXISTS public\.daily_specials/);
  assert.doesNotMatch(MIGRATION_SOURCE, /ALTER TABLE public\.events/);
});

test("no daily_special_items / offer_items child table is created (locked v1 product decision)", () => {
  assert.equal((MIGRATION_SOURCE.match(/CREATE TABLE/g) ?? []).length, 1);
  assert.doesNotMatch(MIGRATION_SOURCE, /offer_item/i);
});

test("no slug column — no public detail page for Daily Specials in v1", () => {
  assert.doesNotMatch(TABLE_COLUMNS_BLOCK, /\bslug\b/i);
});

// ─────────────────────────────────────────────────────────────────────────
// Foreign keys / delete behaviour
// ─────────────────────────────────────────────────────────────────────────

test("venue_id is NOT NULL, references venues(id), ON DELETE CASCADE", () => {
  assert.match(
    MIGRATION_SOURCE,
    /venue_id\s+UUID\s+NOT NULL REFERENCES public\.venues\(id\) ON DELETE CASCADE/
  );
});

test("created_by_operator_id / updated_by_operator_id reference operators(id), ON DELETE SET NULL (matches events convention)", () => {
  assert.match(
    MIGRATION_SOURCE,
    /created_by_operator_id\s+UUID\s+REFERENCES public\.operators\(id\) ON DELETE SET NULL/
  );
  assert.match(
    MIGRATION_SOURCE,
    /updated_by_operator_id\s+UUID\s+REFERENCES public\.operators\(id\) ON DELETE SET NULL/
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Closed value sets — CHECK, not enum (matches project convention)
// ─────────────────────────────────────────────────────────────────────────

test("offer_type constrained to food | drink | food_drink", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CHECK \(offer_type IN \('food', 'drink', 'food_drink'\)\)/
  );
});

test("schedule_type constrained to one_time | weekly (not just an is_recurring boolean)", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CHECK \(schedule_type IN \('one_time', 'weekly'\)\)/
  );
  assert.doesNotMatch(TABLE_COLUMNS_BLOCK, /is_recurring/);
});

test("time_mode constrained to unspecified | all_day | timed", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CHECK \(time_mode IN \('unspecified', 'all_day', 'timed'\)\)/
  );
});

test("end_mode constrained to unspecified | time | close", () => {
  assert.match(
    MIGRATION_SOURCE,
    /CHECK \(end_mode IN \('unspecified', 'time', 'close'\)\)/
  );
});

test("no CREATE TYPE ... AS ENUM anywhere — CHECK constraints used throughout, per project convention", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /CREATE TYPE .* AS ENUM/i);
});

// ─────────────────────────────────────────────────────────────────────────
// Schedule / weekday / time CHECK constraints
// ─────────────────────────────────────────────────────────────────────────

test("schedule fields CHECK exists and requires cardinality() (not array_length()) for the non-empty-weekday rule", () => {
  assert.match(MIGRATION_SOURCE, /daily_specials_schedule_fields_check/);
  // array_length(arr, 1) returns NULL (not 0) for an empty array, and a
  // NULL CHECK result is ACCEPTED by Postgres — cardinality() correctly
  // returns 0 instead. Regression pin for a bug caught and fixed during
  // this task's own database validation pass.
  assert.match(CODE_ONLY, /cardinality\(days_of_week\) >= 1/);
  assert.doesNotMatch(CODE_ONLY, /array_length\(days_of_week/);
});

test("weekday range CHECK exists (0-6)", () => {
  assert.match(MIGRATION_SOURCE, /daily_specials_days_of_week_range_check/);
  assert.match(MIGRATION_SOURCE, /ARRAY\[0, 1, 2, 3, 4, 5, 6\]::SMALLINT\[\]/);
});

test("weekday no-duplicates CHECK exists", () => {
  assert.match(MIGRATION_SOURCE, /daily_specials_days_of_week_no_duplicates_check/);
  assert.match(MIGRATION_SOURCE, /array_has_duplicate_smallints/);
});

test("recurrence end >= start CHECK exists", () => {
  assert.match(MIGRATION_SOURCE, /daily_specials_recurrence_date_order_check/);
  assert.match(MIGRATION_SOURCE, /recurrence_end_date >= recurrence_start_date/);
});

test("end_mode <-> end_time consistency CHECK exists (Close never carries a clock time)", () => {
  assert.match(MIGRATION_SOURCE, /daily_specials_end_mode_check/);
  assert.match(MIGRATION_SOURCE, /end_mode = 'close' AND end_time IS NULL/);
});

test("all_day/unspecified time_mode forbids start_time and forces end_mode unspecified", () => {
  assert.match(MIGRATION_SOURCE, /daily_specials_time_mode_check_no_time_check/);
});

test("timed time_mode requires a meaningful boundary", () => {
  assert.match(MIGRATION_SOURCE, /daily_specials_timed_boundary_check/);
});

test("start_time/end_time are real TIME columns, not TEXT (unlike events.start_time/end_time)", () => {
  assert.match(MIGRATION_SOURCE, /start_time\s+TIME,/);
  assert.match(MIGRATION_SOURCE, /end_time\s+TIME/);
});

test("array_has_duplicate_smallints() never reads or writes venues.business_hours — Close stays semantic", () => {
  // Scoped to the CREATE TABLE column block and every CHECK constraint body
  // — the only places functional DDL could reference another table's
  // column. venues.business_hours is legitimately discussed in prose
  // (COMMENT ON bodies) explaining that Phase 1 deliberately does NOT
  // resolve Close against it.
  assert.doesNotMatch(TABLE_COLUMNS_BLOCK, /business_hours/);
  assert.ok(CONSTRAINT_BLOCKS.length > 0, "expected at least one ADD CONSTRAINT block");
  for (const block of CONSTRAINT_BLOCKS) {
    assert.doesNotMatch(block, /business_hours/);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Seeded / provenance columns
// ─────────────────────────────────────────────────────────────────────────

test("is_seeded_special, source_url, last_verified_at all present", () => {
  assert.match(MIGRATION_SOURCE, /is_seeded_special\s+BOOLEAN\s+NOT NULL DEFAULT FALSE/);
  assert.match(MIGRATION_SOURCE, /source_url\s+TEXT/);
  assert.match(MIGRATION_SOURCE, /last_verified_at\s+TIMESTAMPTZ/);
});

// ─────────────────────────────────────────────────────────────────────────
// RLS — the critical "venue ownership, not created_by_operator_id" rule
// (071_events_venue_ownership_rls.sql's corrected pattern)
// ─────────────────────────────────────────────────────────────────────────

test("RLS is enabled", () => {
  assert.match(MIGRATION_SOURCE, /ALTER TABLE public\.daily_specials ENABLE ROW LEVEL SECURITY/);
});

test("all four policies (SELECT/INSERT/UPDATE/DELETE) exist for the authenticated role", () => {
  for (const cmd of ["FOR SELECT", "FOR INSERT", "FOR UPDATE", "FOR DELETE"]) {
    assert.match(MIGRATION_SOURCE, new RegExp(cmd));
  }
  assert.equal((MIGRATION_SOURCE.match(/CREATE POLICY/g) ?? []).length, 4);
});

test("every policy authorizes by venue ownership (venues joined to operators by email), never by created_by_operator_id", () => {
  const policyBlocks = MIGRATION_SOURCE.split("CREATE POLICY").slice(1);
  assert.equal(policyBlocks.length, 4);
  for (const block of policyBlocks) {
    assert.match(
      block,
      /venue_id IN \(\s*SELECT v\.id\s*FROM public\.venues v\s*JOIN public\.operators o ON o\.id = v\.created_by_operator_id\s*WHERE o\.email = \(auth\.jwt\(\) ->> 'email'\)\s*\)/
    );
    // The ownership predicate joins THROUGH venues.created_by_operator_id
    // (the venue's owner) — it must never scope directly by a
    // daily_specials.created_by_operator_id column (which is NULL for
    // every seeded row, and would reproduce events' original 071 bug).
    assert.doesNotMatch(block, /daily_specials\.created_by_operator_id/);
  }
});

test("no anon (public) policy exists — no public intake form for this table", () => {
  // Scoped to the four CREATE POLICY blocks specifically — the migration
  // legitimately GRANTs EXECUTE on array_has_duplicate_smallints() to anon
  // elsewhere (required for CHECK constraint evaluation on anon's own
  // writes, see the GRANT test below), which is not an RLS policy and must
  // not make this assertion fail.
  const policyBlocks = CODE_ONLY.split("CREATE POLICY").slice(1);
  assert.equal(policyBlocks.length, 4);
  for (const block of policyBlocks) {
    assert.doesNotMatch(block, /TO anon/);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GRANTs
// ─────────────────────────────────────────────────────────────────────────

test("authenticated is granted SELECT, INSERT, UPDATE, DELETE on daily_specials", () => {
  assert.match(
    MIGRATION_SOURCE,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.daily_specials TO authenticated;/
  );
});

test("service_role is granted ALL on daily_specials", () => {
  assert.match(MIGRATION_SOURCE, /GRANT ALL ON public\.daily_specials TO service_role;/);
});

test("no GRANT to anon on the table itself", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /GRANT [^;]*ON public\.daily_specials TO anon/);
});

test("the array_has_duplicate_smallints() helper function grants EXECUTE to every writing role (anon/authenticated/service_role) — required for CHECK constraint evaluation to succeed for that role's own writes", () => {
  // A role with no EXECUTE privilege on a function called from a CHECK
  // constraint cannot INSERT/UPDATE at all, even when RLS would otherwise
  // allow the row — caught empirically during this task's own RLS
  // validation pass (an authenticated venue owner's authorized UPDATE
  // failed with "permission denied for function
  // array_has_duplicate_smallints" until this GRANT was added).
  assert.match(
    MIGRATION_SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.array_has_duplicate_smallints\(SMALLINT\[\]\) TO anon;/
  );
  assert.match(
    MIGRATION_SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.array_has_duplicate_smallints\(SMALLINT\[\]\) TO authenticated;/
  );
  assert.match(
    MIGRATION_SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.array_has_duplicate_smallints\(SMALLINT\[\]\) TO service_role;/
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Plan entitlement is NOT enforced by this migration (application-only,
// matching events' identical posture)
// ─────────────────────────────────────────────────────────────────────────

test("plan/entitlement/recurring gating is not referenced anywhere in this migration — enforced in application code only", () => {
  assert.doesNotMatch(MIGRATION_SOURCE, /plan_code/);
  assert.doesNotMatch(MIGRATION_SOURCE, /venue_subscriptions/);
});
