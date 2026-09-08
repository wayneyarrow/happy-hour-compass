import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeDailySpecialSave,
  shouldStampSeededOnCreate,
  RECURRING_NOT_AUTHORIZED_MESSAGE,
  type DailySpecialCurrentRow,
} from "../../../src/lib/dailySpecialAuthorization";
import type { OperatorPlan } from "../../../src/lib/plans";

/**
 * authorizeDailySpecialSave() is the exact decision logic
 * saveDailySpecialAction (src/app/admin/daily-specials/actions.ts) calls —
 * not a reimplementation for testing purposes. See that file's own header
 * comment for why this is extracted as a pure function.
 */

const PAID_PLANS: OperatorPlan[] = ["pro", "premium", "enterprise"];

// ─────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────

test("create: Free creates one-time — always authorized", () => {
  const result = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "one_time",
    currentRow: null,
  });
  assert.equal(result.authorized, true);
});

test("create: Free cannot create weekly", () => {
  const result = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: null,
  });
  assert.equal(result.authorized, false);
  if (!result.authorized) assert.equal(result.reason, RECURRING_NOT_AUTHORIZED_MESSAGE);
});

test("create: Pro/Premium/Enterprise can create weekly", () => {
  for (const plan of PAID_PLANS) {
    const result = authorizeDailySpecialSave({
      plan,
      isUnclaimedVenueSupportMode: false,
      requestedScheduleType: "weekly",
      currentRow: null,
    });
    assert.equal(result.authorized, true, `expected ${plan} to be authorized`);
  }
});

test("create: support-mode (unclaimed venue) creates weekly regardless of implicit Free plan", () => {
  const result = authorizeDailySpecialSave({
    plan: "free", // Case B has no real operator/plan — implicitly "free"
    isUnclaimedVenueSupportMode: true,
    requestedScheduleType: "weekly",
    currentRow: null,
  });
  assert.equal(result.authorized, true);
});

test("create: support-mode weekly creation is stamped seeded; one-time is not", () => {
  assert.equal(shouldStampSeededOnCreate(true, "weekly"), true);
  assert.equal(shouldStampSeededOnCreate(true, "one_time"), false);
});

test("create: normal (non-support-mode) creation is never auto-stamped seeded", () => {
  // shouldStampSeededOnCreate() deliberately has no plan parameter at all —
  // it depends only on isUnclaimedVenueSupportMode and the requested
  // schedule type, so "on any plan" holds by construction, not by looping
  // over plan values here.
  assert.equal(shouldStampSeededOnCreate(false, "weekly"), false);
  assert.equal(shouldStampSeededOnCreate(false, "one_time"), false);
});

test("create: a brand-new special can never inherit grandfathering — currentRow is null for every insert", () => {
  const result = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: null, // no row exists yet — nothing to derive `true` from
  });
  assert.equal(result.authorized, false);
});

// ─────────────────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────────────────

test("edit: operator edits own one-time special — always authorized (schedule_type unaffected by ownership)", () => {
  const result = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "one_time",
    currentRow: { isSeededSpecial: false, scheduleType: "one_time" },
  });
  assert.equal(result.authorized, true);
});

test("edit: paid operator edits recurring normally, regardless of seeded state", () => {
  for (const plan of PAID_PLANS) {
    for (const currentRow of [
      null,
      { isSeededSpecial: false, scheduleType: "one_time" } as DailySpecialCurrentRow,
      { isSeededSpecial: true, scheduleType: "weekly" } as DailySpecialCurrentRow,
    ]) {
      const result = authorizeDailySpecialSave({
        plan,
        isUnclaimedVenueSupportMode: false,
        requestedScheduleType: "weekly",
        currentRow,
      });
      assert.equal(result.authorized, true);
    }
  }
});

test("edit: Free edits an existing seeded recurring special", () => {
  const result = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: { isSeededSpecial: true, scheduleType: "weekly" },
  });
  assert.equal(result.authorized, true);
});

test("edit: Free cannot convert an ordinary (non-seeded) one-time special to weekly", () => {
  const result = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: { isSeededSpecial: false, scheduleType: "one_time" },
  });
  assert.equal(result.authorized, false);
});

test("edit: Free cannot convert a SEEDED one-time special to weekly either — seeded status alone is not enough, it must be currently weekly", () => {
  const result = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: { isSeededSpecial: true, scheduleType: "one_time" },
  });
  assert.equal(result.authorized, false);
});

test("edit: payload cannot spoof grandfathering — an attacker-shaped currentRow claiming isSeededSpecial has no effect unless scheduleType is ALSO currently weekly", () => {
  // This function only ever sees what its CALLER passes as currentRow — it
  // cannot itself distinguish an honestly-derived value from a forged one.
  // What it DOES guarantee is the composition rule itself: isSeededSpecial
  // alone, without schedule_type === "weekly", is never sufficient.
  const result = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: { isSeededSpecial: true, scheduleType: "one_time" },
  });
  assert.equal(result.authorized, false);
});

test("edit: grandfathering is derived from the DB row, not the payload's requested schedule — requesting weekly is authorized only when the CURRENT row is seeded+weekly", () => {
  const seededWeekly = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: { isSeededSpecial: true, scheduleType: "weekly" },
  });
  const notSeededWeekly = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: { isSeededSpecial: false, scheduleType: "weekly" },
  });
  assert.equal(seededWeekly.authorized, true);
  assert.equal(notSeededWeekly.authorized, false);
});

// ─────────────────────────────────────────────────────────────────────────
// THE EXACT SEQUENTIAL CASE FROM THE TASK BRIEF (§5):
//   seeded weekly -> one_time allowed -> attempt to convert back to weekly
//   on Free must be blocked, because the CURRENT row is now one_time.
// ─────────────────────────────────────────────────────────────────────────

test("grandfathered row: seeded weekly -> one_time is allowed for Free (editing the grandfathered content itself)", () => {
  // Step 1: the row currently is seeded + weekly. Free operator changes it
  // to one_time. requestedScheduleType = "one_time" is always authorized
  // regardless of plan/seeded state — this is not a "create a new
  // recurring entitlement" action, it's editing the existing row down to
  // one-time.
  const step1 = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "one_time",
    currentRow: { isSeededSpecial: true, scheduleType: "weekly" },
  });
  assert.equal(step1.authorized, true);
});

test("grandfathered row: after seeded weekly -> one_time, Free CANNOT convert the now-one-time row back to weekly", () => {
  // Step 2: the row's CURRENT database state is now { isSeededSpecial:
  // true, scheduleType: "one_time" } (the save from step 1 actually wrote
  // schedule_type = 'one_time'). The operator, still Free, now tries to
  // switch it back to weekly. The server re-reads the row fresh at save
  // time (never trusts the payload) and finds scheduleType is no longer
  // "weekly" — so isSeededAndCurrentlyRecurring evaluates false, and the
  // conversion back to weekly is correctly blocked. This mirrors the
  // current-row grandfathering philosophy exactly: the row no longer
  // qualifies once it stops being currently recurring, even though it is
  // still is_seeded_special = true.
  const step2 = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: { isSeededSpecial: true, scheduleType: "one_time" },
  });
  assert.equal(step2.authorized, false);
  if (!step2.authorized) assert.equal(step2.reason, RECURRING_NOT_AUTHORIZED_MESSAGE);
});

test("grandfathered row: the same operator on Pro/Premium/Enterprise CAN convert it back to weekly — plan entitlement always wins independent of seeded history", () => {
  for (const plan of PAID_PLANS) {
    const result = authorizeDailySpecialSave({
      plan,
      isUnclaimedVenueSupportMode: false,
      requestedScheduleType: "weekly",
      currentRow: { isSeededSpecial: true, scheduleType: "one_time" },
    });
    assert.equal(result.authorized, true);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE — creates no reusable recurring entitlement
// ─────────────────────────────────────────────────────────────────────────

test("delete: after a grandfathered recurring special is deleted, a NEW recurring special attempt is correctly rejected on Free", () => {
  // Before deletion: the row exists, is seeded and currently weekly — Free
  // may manage it.
  const beforeDelete = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: { isSeededSpecial: true, scheduleType: "weekly" },
  });
  assert.equal(beforeDelete.authorized, true);

  // After deletion, the row is gone. A NEW insert (currentRow = null, the
  // only state an insert can ever have — see saveDailySpecialAction, which
  // only reads a current row when currentSpecialId is truthy) is evaluated
  // exactly like any other Free operator with no grandfathered history.
  const afterDeleteNewAttempt = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: null,
  });
  assert.equal(afterDeleteNewAttempt.authorized, false);
});

// ─────────────────────────────────────────────────────────────────────────
// Support mode — only in the same circumstances as the Events pattern
// ─────────────────────────────────────────────────────────────────────────

test("support mode: only bypasses the plan gate when isUnclaimedVenueSupportMode is explicitly true", () => {
  const supportOn = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: true,
    requestedScheduleType: "weekly",
    currentRow: null,
  });
  const supportOff = authorizeDailySpecialSave({
    plan: "free",
    isUnclaimedVenueSupportMode: false,
    requestedScheduleType: "weekly",
    currentRow: null,
  });
  assert.equal(supportOn.authorized, true);
  assert.equal(supportOff.authorized, false);
});

test("support mode: a normal operator login (has ctx.operator) is never in support mode, regardless of plan", () => {
  // isUnclaimedVenueSupportMode is only ever true for Case B (founder
  // impersonating an unclaimed venue, ctx.operator === null) — a normal
  // login always passes false for this parameter, by construction in
  // saveDailySpecialAction (`ctx.isImpersonating && !ctx.operator`).
  for (const plan of ["free", "pro", "premium", "enterprise"] as OperatorPlan[]) {
    const result = authorizeDailySpecialSave({
      plan,
      isUnclaimedVenueSupportMode: false,
      requestedScheduleType: "one_time",
      currentRow: null,
    });
    assert.equal(result.authorized, true); // one-time always fine regardless
  }
});
