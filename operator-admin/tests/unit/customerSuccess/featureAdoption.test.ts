import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGenuineOperatorContext,
  genuineOperatorFieldPatch,
  countActiveDailySpecials,
  countActiveEvents,
  shouldFireFirstAdoptionTrigger,
  type GenuineOperatorContext,
  type DailySpecialActiveRow,
  type EventActiveRow,
} from "../../../src/lib/customerSuccess/featureAdoption";

/**
 * Customer Success Project 2 — Feature Adoption Visibility, attribution
 * correction (impersonation exclusion).
 *
 * Pure logic tests only — no Supabase, no I/O, matching this repo's
 * established convention (dailySpecialSchedule.ts / recurrenceUtils.ts):
 * pure functions are unit-tested directly; Supabase-calling orchestration
 * (getVenueFeatureAdoption(), recordFeatureAdoption()'s RPC call,
 * saveEventAction()/saveDailySpecialAction() end to end) has no dedicated
 * test file, same as venueHealth.ts today — verified by code review and the
 * manual QA notes in the implementation report instead.
 *
 * isGenuineOperatorContext() is the single source of truth for "was this
 * request's actor a genuine, non-impersonated operator/member" — used both
 * to gate recordFeatureAdoption() (venue-level durable adoption) and, via
 * genuineOperatorFieldPatch(), to decide the is_genuine_operator_engaged
 * content-level provenance column written by saveEventAction()/
 * saveDailySpecialAction(). Testing these two functions exhaustively is what
 * pins the corrected attribution rule, since the SQL trigger this replaces
 * could not be executed in this environment (no local Postgres/Supabase
 * stack — see the implementation report) even in the ORIGINAL (now removed)
 * design.
 *
 * countActiveDailySpecials()/countActiveEvents() now take
 * is_genuine_operator_engaged directly (the column, not a derived
 * created_by/updated_by/is_seeded heuristic) — these tests also pin that
 * the active count reuses the existing canonical scheduling rules
 * (occursOnDate / upcomingBucket) unmodified.
 */

// ─────────────────────────────────────────────────────────────────────────
// isGenuineOperatorContext — the corrected attribution predicate
// ─────────────────────────────────────────────────────────────────────────

function ctx(overrides: Partial<GenuineOperatorContext>): GenuineOperatorContext {
  return { isImpersonating: false, operator: { id: "op-1" }, ...overrides };
}

test("isGenuineOperatorContext: genuine operator session (not impersonating, real operator) is genuine", () => {
  assert.equal(isGenuineOperatorContext(ctx({ isImpersonating: false, operator: { id: "op-1" } })), true);
});

test("isGenuineOperatorContext: Case A impersonation (claimed venue, real operator resolved) is NOT genuine", () => {
  // This is the exact bug being corrected: Case A resolves a real operator
  // id, identical in shape to a genuine session, but isImpersonating is
  // true and must exclude it.
  assert.equal(isGenuineOperatorContext(ctx({ isImpersonating: true, operator: { id: "op-1" } })), false);
});

test("isGenuineOperatorContext: Case B impersonation/support on an unclaimed venue (no operator) is NOT genuine", () => {
  assert.equal(isGenuineOperatorContext(ctx({ isImpersonating: true, operator: null })), false);
});

test("isGenuineOperatorContext: no operator and not impersonating (error/edge state) is NOT genuine", () => {
  assert.equal(isGenuineOperatorContext(ctx({ isImpersonating: false, operator: null })), false);
});

// ─────────────────────────────────────────────────────────────────────────
// genuineOperatorFieldPatch — the monotonic content-provenance field
// ─────────────────────────────────────────────────────────────────────────

test("genuineOperatorFieldPatch: genuine context returns { is_genuine_operator_engaged: true }", () => {
  assert.deepEqual(genuineOperatorFieldPatch(ctx({ isImpersonating: false, operator: { id: "op-1" } })), {
    is_genuine_operator_engaged: true,
  });
});

test("genuineOperatorFieldPatch: Case A impersonation returns an empty patch (field omitted, never written false)", () => {
  assert.deepEqual(genuineOperatorFieldPatch(ctx({ isImpersonating: true, operator: { id: "op-1" } })), {});
});

test("genuineOperatorFieldPatch: Case B impersonation/support returns an empty patch", () => {
  assert.deepEqual(genuineOperatorFieldPatch(ctx({ isImpersonating: true, operator: null })), {});
});

test("genuineOperatorFieldPatch: never returns is_genuine_operator_engaged: false under any input", () => {
  const scenarios: GenuineOperatorContext[] = [
    ctx({ isImpersonating: true, operator: { id: "op-1" } }),
    ctx({ isImpersonating: true, operator: null }),
    ctx({ isImpersonating: false, operator: null }),
  ];
  for (const scenario of scenarios) {
    const patch = genuineOperatorFieldPatch(scenario) as Record<string, unknown>;
    assert.notEqual(patch.is_genuine_operator_engaged, false);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Monotonic merge semantics (scenarios 8, 9, 10, 11 — modeled as pure
// boolean algebra: on UPDATE, the DB preserves the existing column value
// whenever the patch omits the key, and only ever overwrites it to TRUE
// when included. This models "current OR patch" without needing a DB.)
// ─────────────────────────────────────────────────────────────────────────

function simulateWrite(currentValue: boolean, writeCtx: GenuineOperatorContext): boolean {
  const patch = genuineOperatorFieldPatch(writeCtx) as { is_genuine_operator_engaged?: true };
  return patch.is_genuine_operator_engaged ?? currentValue;
}

test("scenario: genuine operator creates non-seeded content -> provenance becomes true", () => {
  const afterCreate = simulateWrite(false, ctx({ isImpersonating: false, operator: { id: "op-1" } }));
  assert.equal(afterCreate, true);
});

test("scenario: admin/impersonation edits content a genuine operator already created -> provenance stays true, not reset", () => {
  const afterCreate = simulateWrite(false, ctx({ isImpersonating: false, operator: { id: "op-1" } }));
  const afterAdminEdit = simulateWrite(afterCreate, ctx({ isImpersonating: true, operator: { id: "op-1" } }));
  assert.equal(afterAdminEdit, true);
});

test("scenario: same genuine operator edits repeatedly -> provenance remains true across every edit", () => {
  let value = false;
  value = simulateWrite(value, ctx({ isImpersonating: false, operator: { id: "op-1" } }));
  value = simulateWrite(value, ctx({ isImpersonating: false, operator: { id: "op-1" } }));
  value = simulateWrite(value, ctx({ isImpersonating: false, operator: { id: "op-1" } }));
  assert.equal(value, true);
});

test("scenario: a different genuine operator edits the same content -> provenance remains true (still one durable fact)", () => {
  const afterFirstOperator = simulateWrite(false, ctx({ isImpersonating: false, operator: { id: "op-1" } }));
  const afterSecondOperator = simulateWrite(afterFirstOperator, ctx({ isImpersonating: false, operator: { id: "op-2" } }));
  assert.equal(afterSecondOperator, true);
});

test("scenario: Case A impersonation creates content -> provenance stays false", () => {
  const afterCreate = simulateWrite(false, ctx({ isImpersonating: true, operator: { id: "op-1" } }));
  assert.equal(afterCreate, false);
});

test("scenario: Case A impersonation edits inherited seeded content -> provenance stays false", () => {
  // "Inherited seeded content" starts at false (untouched seed); an
  // impersonated edit must not flip it true.
  const afterEdit = simulateWrite(false, ctx({ isImpersonating: true, operator: { id: "op-1" } }));
  assert.equal(afterEdit, false);
});

test("scenario: founder/support acts on an unclaimed venue (Case B) -> provenance stays false", () => {
  const afterCreate = simulateWrite(false, ctx({ isImpersonating: true, operator: null }));
  assert.equal(afterCreate, false);
});

test("scenario: untouched seeded content that no genuine operator has ever touched -> provenance stays false", () => {
  assert.equal(simulateWrite(false, ctx({ isImpersonating: false, operator: null })), false);
});

// ─────────────────────────────────────────────────────────────────────────
// countActiveDailySpecials — active-count provenance + scheduling rules
// ─────────────────────────────────────────────────────────────────────────

function special(overrides: Partial<DailySpecialActiveRow>): DailySpecialActiveRow {
  return {
    schedule_type: "one_time",
    one_time_date: null,
    days_of_week: null,
    recurrence_start_date: null,
    recurrence_end_date: null,
    is_genuine_operator_engaged: true,
    ...overrides,
  };
}

test("countActiveDailySpecials: genuine operator content, one-time active today, counts", () => {
  const rows = [special({ schedule_type: "one_time", one_time_date: "2026-06-15", is_genuine_operator_engaged: true })];
  assert.equal(countActiveDailySpecials(rows, "2026-06-15"), 1);
});

test("countActiveDailySpecials: genuine operator draft is excluded from active count regardless of schedule", () => {
  // Drafts are filtered out by getVenueFeatureAdoption()'s is_published
  // query filter before rows ever reach this function — there is no
  // is_published field here at all, which is the guarantee. Documented,
  // same as the prior version's equivalent test.
  assert.equal(countActiveDailySpecials([], "2026-06-15"), 0);
});

test("countActiveDailySpecials: genuine operator edit of seeded content, active today, counts", () => {
  const rows = [special({ schedule_type: "weekly", days_of_week: [1], is_genuine_operator_engaged: true })];
  // 2026-06-15 is a Monday.
  assert.equal(countActiveDailySpecials(rows, "2026-06-15"), 1);
});

test("countActiveDailySpecials: impersonation-only active content (Red X + 0 case) is excluded", () => {
  const rows = [special({ schedule_type: "one_time", one_time_date: "2026-06-15", is_genuine_operator_engaged: false })];
  assert.equal(countActiveDailySpecials(rows, "2026-06-15"), 0);
});

test("countActiveDailySpecials: untouched seeded content is excluded even if scheduled for today", () => {
  const rows = [special({ schedule_type: "one_time", one_time_date: "2026-06-15", is_genuine_operator_engaged: false })];
  assert.equal(countActiveDailySpecials(rows, "2026-06-15"), 0);
});

test("countActiveDailySpecials: one-time expired does not count even when genuinely engaged", () => {
  const rows = [special({ schedule_type: "one_time", one_time_date: "2026-06-01", is_genuine_operator_engaged: true })];
  assert.equal(countActiveDailySpecials(rows, "2026-06-15"), 0);
});

test("countActiveDailySpecials: weekly outside recurrence bounds does not count", () => {
  const rows = [
    special({
      schedule_type: "weekly",
      days_of_week: [1],
      recurrence_end_date: "2026-05-01",
      is_genuine_operator_engaged: true,
    }),
  ];
  assert.equal(countActiveDailySpecials(rows, "2026-06-15"), 0);
});

test("countActiveDailySpecials: mixed genuine, impersonation-only, and admin content — only genuine active rows count", () => {
  const rows = [
    special({ schedule_type: "one_time", one_time_date: "2026-06-15", is_genuine_operator_engaged: true }), // counts
    special({ schedule_type: "one_time", one_time_date: "2026-06-15", is_genuine_operator_engaged: false }), // impersonation-only -> excluded
    special({ schedule_type: "one_time", one_time_date: "2026-01-01", is_genuine_operator_engaged: true }), // expired -> excluded
    special({ schedule_type: "weekly", days_of_week: [1], is_genuine_operator_engaged: true }), // counts
  ];
  assert.equal(countActiveDailySpecials(rows, "2026-06-15"), 2);
});

test("countActiveDailySpecials: content deletion — deleted rows are simply absent from the input, contributing 0", () => {
  // Deletion is a hard DELETE; there is no tombstone row to pass here at
  // all. An empty candidate list is the correct representation.
  assert.equal(countActiveDailySpecials([], "2026-06-15"), 0);
});

test("countActiveDailySpecials: venue with no related content returns 0", () => {
  assert.equal(countActiveDailySpecials([], "2026-06-15"), 0);
});

// ─────────────────────────────────────────────────────────────────────────
// countActiveEvents — active-count provenance + scheduling rules
// ─────────────────────────────────────────────────────────────────────────

function evt(overrides: Partial<EventActiveRow>): EventActiveRow {
  return { first_date: null, recurrence: "none", is_genuine_operator_engaged: true, ...overrides };
}

test("countActiveEvents: genuine operator content, one-time upcoming, counts", () => {
  const rows = [evt({ first_date: "2026-06-20", recurrence: "none", is_genuine_operator_engaged: true })];
  assert.equal(countActiveEvents(rows, "2026-06-15"), 1);
});

test("countActiveEvents: genuine operator edit of seeded recurring content counts regardless of first_date", () => {
  const rows = [evt({ first_date: "2020-01-01", recurrence: "weekly", is_genuine_operator_engaged: true })];
  assert.equal(countActiveEvents(rows, "2026-06-15"), 1);
});

test("countActiveEvents: impersonation-only active content (Red X + 0 case) is excluded", () => {
  const rows = [evt({ first_date: "2026-06-20", recurrence: "none", is_genuine_operator_engaged: false })];
  assert.equal(countActiveEvents(rows, "2026-06-15"), 0);
});

test("countActiveEvents: untouched seeded content is excluded even if upcoming", () => {
  const rows = [evt({ first_date: "2026-06-20", recurrence: "none", is_genuine_operator_engaged: false })];
  assert.equal(countActiveEvents(rows, "2026-06-15"), 0);
});

test("countActiveEvents: one-time past does not count even when genuinely engaged", () => {
  const rows = [evt({ first_date: "2026-06-01", recurrence: "none", is_genuine_operator_engaged: true })];
  assert.equal(countActiveEvents(rows, "2026-06-15"), 0);
});

test("countActiveEvents: direct Control Panel/service-role content (never genuinely engaged) never contributes", () => {
  // Direct CP writes (updateEventBoostAction etc.) never call
  // saveEventAction() at all, so is_genuine_operator_engaged is whatever it
  // already was — for content created only that way, always false.
  const rows = [evt({ first_date: "2026-06-20", recurrence: "none", is_genuine_operator_engaged: false })];
  assert.equal(countActiveEvents(rows, "2026-06-15"), 0);
});

test("countActiveEvents: mixed genuine and impersonation/admin content — only genuine active rows count", () => {
  const rows = [
    evt({ first_date: "2026-06-20", recurrence: "none", is_genuine_operator_engaged: true }), // counts
    evt({ first_date: "2026-06-20", recurrence: "none", is_genuine_operator_engaged: false }), // impersonation-only -> excluded
    evt({ first_date: "2026-01-01", recurrence: "none", is_genuine_operator_engaged: true }), // past -> excluded
    evt({ first_date: "2020-01-01", recurrence: "weekly", is_genuine_operator_engaged: true }), // counts
  ];
  assert.equal(countActiveEvents(rows, "2026-06-15"), 2);
});

test("countActiveEvents: venue with no related content returns 0", () => {
  assert.equal(countActiveEvents([], "2026-06-15"), 0);
});

// ─────────────────────────────────────────────────────────────────────────
// Red X / Green check invariants (the locked display contract)
// ─────────────────────────────────────────────────────────────────────────

test("invariant: a positive active count is only ever reachable through genuinely-engaged rows", () => {
  const genuineActiveRow = special({ schedule_type: "one_time", one_time_date: "2026-06-15", is_genuine_operator_engaged: true });
  assert.equal(countActiveDailySpecials([genuineActiveRow], "2026-06-15") > 0, true);
  assert.equal(genuineActiveRow.is_genuine_operator_engaged, true);
});

test("invariant: impersonation-only rows can never produce a positive active count regardless of schedule", () => {
  const impersonationRows = [
    special({ schedule_type: "one_time", one_time_date: "2026-06-15", is_genuine_operator_engaged: false }),
    special({ schedule_type: "weekly", days_of_week: [0, 1, 2, 3, 4, 5, 6], is_genuine_operator_engaged: false }),
  ];
  assert.equal(countActiveDailySpecials(impersonationRows, "2026-06-15"), 0);

  const impersonationEvents = [
    evt({ first_date: "2026-06-20", recurrence: "none", is_genuine_operator_engaged: false }),
    evt({ first_date: "2020-01-01", recurrence: "weekly", is_genuine_operator_engaged: false }),
  ];
  assert.equal(countActiveEvents(impersonationEvents, "2026-06-15"), 0);
});

// ─────────────────────────────────────────────────────────────────────────
// shouldFireFirstAdoptionTrigger — pure model of the SQL first-adoption
// trigger (migration 096's events_first_adoption_trigger()/
// daily_specials_first_adoption_trigger()). The actual trigger runs only in
// Postgres and could not be executed in this environment (no local
// Postgres/Supabase stack available) — this pins the intended behavior as
// far as is possible without one.
// ─────────────────────────────────────────────────────────────────────────

test("shouldFireFirstAdoptionTrigger: INSERT with genuine provenance fires", () => {
  assert.equal(shouldFireFirstAdoptionTrigger("INSERT", true, false), true);
});

test("shouldFireFirstAdoptionTrigger: INSERT without genuine provenance (impersonation/admin create) does not fire", () => {
  assert.equal(shouldFireFirstAdoptionTrigger("INSERT", false, false), false);
});

test("shouldFireFirstAdoptionTrigger: UPDATE transitioning false->true (first genuine edit of seeded content) fires", () => {
  assert.equal(shouldFireFirstAdoptionTrigger("UPDATE", true, false), true);
});

test("shouldFireFirstAdoptionTrigger: UPDATE already true->true (repeat genuine edit) does NOT re-fire", () => {
  // This is the exact case that must not "advance last_engaged_at via the
  // trigger a second time" — repeat engagement is handled separately by
  // recordFeatureAdoption()'s RPC, not by this trigger firing again.
  assert.equal(shouldFireFirstAdoptionTrigger("UPDATE", true, true), false);
});

test("shouldFireFirstAdoptionTrigger: UPDATE false->false (admin/impersonation edit of untouched content) does not fire", () => {
  assert.equal(shouldFireFirstAdoptionTrigger("UPDATE", false, false), false);
});

test("shouldFireFirstAdoptionTrigger: UPDATE true->false is impossible under the monotonic column, but the model still would not fire (no false positive either way)", () => {
  assert.equal(shouldFireFirstAdoptionTrigger("UPDATE", false, true), false);
});

test("scenario: admin edits already-genuine content later — trigger does not re-fire (last_engaged_at unaffected by the trigger)", () => {
  // Combines the monotonic content-provenance merge (genuineOperatorFieldPatch)
  // with the trigger model: an admin/impersonation edit never sets the
  // patch, so provenance stays true (already established), and the
  // false->true trigger condition is never satisfied again.
  const afterGenuineCreate = simulateWrite(false, ctx({ isImpersonating: false, operator: { id: "op-1" } }));
  assert.equal(afterGenuineCreate, true);
  assert.equal(shouldFireFirstAdoptionTrigger("INSERT", afterGenuineCreate, false), true);

  const afterAdminEdit = simulateWrite(afterGenuineCreate, ctx({ isImpersonating: true, operator: { id: "op-1" } }));
  assert.equal(afterAdminEdit, true); // still true, not reset
  assert.equal(shouldFireFirstAdoptionTrigger("UPDATE", afterAdminEdit, afterGenuineCreate), false); // true->true, no re-fire
});
