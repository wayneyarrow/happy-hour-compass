import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canCreateRecurringDailySpecialInSupportMode,
  canManageGrandfatheredRecurringDailySpecial,
  canUseRecurringDailySpecials,
  type OperatorPlan,
} from "../../../src/lib/plans";

/**
 * Phase 1 Daily Specials entitlement helpers — pure, no I/O. Mirrors
 * canUseRecurringEvents() / canManageGrandfatheredRecurringEvent() /
 * canCreateRecurringEventInSupportMode() exactly (see plans.ts's own
 * comments), so this suite exists specifically to pin the same guarantees
 * for the Daily Specials names, as separate, independently-testable
 * functions rather than assuming parity with Events forever.
 */

const ALL_PLANS: OperatorPlan[] = ["free", "pro", "premium", "enterprise"];

// ─────────────────────────────────────────────────────────────────────────
// canUseRecurringDailySpecials
// ─────────────────────────────────────────────────────────────────────────

test("entitlement: Free cannot create recurring Daily Specials", () => {
  assert.equal(canUseRecurringDailySpecials("free"), false);
});

test("entitlement: Pro can create recurring Daily Specials", () => {
  assert.equal(canUseRecurringDailySpecials("pro"), true);
});

test("entitlement: Premium can create recurring Daily Specials", () => {
  assert.equal(canUseRecurringDailySpecials("premium"), true);
});

test("entitlement: Enterprise matches the current plan convention (same tier as Pro/Premium for this feature)", () => {
  assert.equal(canUseRecurringDailySpecials("enterprise"), true);
});

test("entitlement: exactly Free is excluded, every other plan is included", () => {
  for (const plan of ALL_PLANS) {
    assert.equal(canUseRecurringDailySpecials(plan), plan !== "free");
  }
});

// ─────────────────────────────────────────────────────────────────────────
// canManageGrandfatheredRecurringDailySpecial
// ─────────────────────────────────────────────────────────────────────────

test("entitlement: Free CAN manage an existing seeded-and-currently-recurring Special", () => {
  assert.equal(canManageGrandfatheredRecurringDailySpecial("free", true), true);
});

test("entitlement: Free CANNOT manage a recurring Special that is not seeded-and-currently-recurring", () => {
  // This is the case for an ordinary (non-seeded) one-time special, or any
  // special that is not CURRENTLY a seeded recurring row. The caller's
  // contract (see plans.ts's doc comment, mirroring events' identical
  // contract) is that `isSeededAndCurrentlyRecurring` must be derived from
  // the row's state as read from the database at the moment of the
  // write — never trusted from an incoming payload. This function cannot
  // itself distinguish an honestly-derived `false` from a maliciously
  // forged one; that guarantee lives in the future Phase 2 server action
  // (mirroring saveEventAction, which re-reads `recurrence, is_seeded_event`
  // from the DB before evaluating this check — see saveEventAction's own
  // comment block). What IS fully covered here is that this function
  // itself correctly refuses Free whenever the flag is false, for any plan
  // that isn't already separately entitled.
  assert.equal(canManageGrandfatheredRecurringDailySpecial("free", false), false);
});

test("entitlement: Pro/Premium/Enterprise can manage a recurring Special regardless of seeded state (already entitled)", () => {
  for (const plan of ["pro", "premium", "enterprise"] as OperatorPlan[]) {
    assert.equal(canManageGrandfatheredRecurringDailySpecial(plan, true), true);
    assert.equal(canManageGrandfatheredRecurringDailySpecial(plan, false), true);
  }
});

test("entitlement: a brand-new recurring Special can never be grandfathered — there is no current row to derive `true` from", () => {
  // Mirrors saveEventAction's own comment: "currentEventId is null for
  // inserts, so new recurring events are never eligible — only an existing
  // seeded-and-recurring row can qualify." An insert has no existing row,
  // so any honest caller passes isSeededAndCurrentlyRecurring = false for
  // every new-special creation attempt, regardless of what the incoming
  // payload claims about seeded/recurring status.
  assert.equal(canManageGrandfatheredRecurringDailySpecial("free", false), false);
});

test("entitlement: deleting a grandfathered recurring Special creates no reusable recurring privilege", () => {
  // Before deletion: the row exists, is seeded and currently weekly — Free
  // may manage it.
  const beforeDelete = canManageGrandfatheredRecurringDailySpecial("free", true);
  assert.equal(beforeDelete, true);

  // After deletion: there is no row left to derive `true` from. Attempting
  // to create a brand-new recurring special (a fresh insert, structurally
  // identical to any other new-recurring-special attempt — see the test
  // above) must be evaluated with isSeededAndCurrentlyRecurring = false,
  // exactly like any other Free operator with no grandfathered history.
  // Nothing about the special having existed and been deleted changes this
  // function's behavior — there is no persisted "used to have a
  // grandfathered special" flag anywhere in this contract.
  const afterDeleteNewAttempt = canManageGrandfatheredRecurringDailySpecial("free", false);
  assert.equal(afterDeleteNewAttempt, false);
});

// ─────────────────────────────────────────────────────────────────────────
// canCreateRecurringDailySpecialInSupportMode
// ─────────────────────────────────────────────────────────────────────────

test("entitlement: support-mode recurring creation requires isUnclaimedVenueSupportMode = true", () => {
  assert.equal(canCreateRecurringDailySpecialInSupportMode(true), true);
  assert.equal(canCreateRecurringDailySpecialInSupportMode(false), false);
});

test("entitlement: support-mode flag has no plan parameter — it is unconditional once the flag is true, same shape as Events' identical function", () => {
  // Signature-level check: this function takes exactly one boolean
  // parameter, mirroring canCreateRecurringEventInSupportMode(). There is
  // no way to pass a plan into it at all — Case B (unclaimed-venue
  // impersonation) has no real operator/plan to read in the first place
  // (see plans.ts's doc comment), so the function correctly has no plan
  // input to accidentally gate on.
  assert.equal(canCreateRecurringDailySpecialInSupportMode.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────
// Composition — mirrors the exact gating expression saveEventAction uses
// today (isRecurring && !canUseX(plan) && !canCreateXInSupportMode(mode) →
// check grandfathering), so a future saveDailySpecialAction can reuse this
// composition with confidence it produces the same decision table Events
// already relies on.
// ─────────────────────────────────────────────────────────────────────────

function wouldBlockRecurringSave(
  plan: OperatorPlan,
  isUnclaimedVenueSupportMode: boolean,
  isSeededAndCurrentlyRecurring: boolean
): boolean {
  if (canUseRecurringDailySpecials(plan)) return false;
  if (canCreateRecurringDailySpecialInSupportMode(isUnclaimedVenueSupportMode)) return false;
  return !canManageGrandfatheredRecurringDailySpecial(plan, isSeededAndCurrentlyRecurring);
}

test("composition: Free, normal login, new recurring special → blocked", () => {
  assert.equal(wouldBlockRecurringSave("free", false, false), true);
});

test("composition: Free, normal login, editing an existing grandfathered seeded recurring special → allowed", () => {
  assert.equal(wouldBlockRecurringSave("free", false, true), false);
});

test("composition: Free, unclaimed-venue support mode (Case B) → allowed regardless of seeded state", () => {
  assert.equal(wouldBlockRecurringSave("free", true, false), false);
  assert.equal(wouldBlockRecurringSave("free", true, true), false);
});

test("composition: Pro/Premium/Enterprise, normal login → always allowed", () => {
  for (const plan of ["pro", "premium", "enterprise"] as OperatorPlan[]) {
    assert.equal(wouldBlockRecurringSave(plan, false, false), false);
  }
});
