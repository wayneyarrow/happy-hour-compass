import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the cancelVenueAction() false-success fix
 * (src/app/admin/venue/cancelActions.ts). cancelVenueAction() calls
 * resolveOperatorContext()/createAdminClient() directly with no DI seam
 * (same reasoning as every other flow-specific contract test in this repo),
 * so this is a static, structural verification of the actual source text —
 * proving the exact control-flow shape the fix requires, rather than
 * exercising the real Server Action end-to-end.
 */

const CANCEL_ACTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/venue/cancelActions.ts"),
  "utf8"
);

test("CancelVenueState carries downgradeFailed + hhcErrorId as optional fields, alongside the pre-existing success/error fields", () => {
  const stateType = CANCEL_ACTIONS_SOURCE.match(/export type CancelVenueState = \{[\s\S]*?\n\};/)![0];
  assert.match(stateType, /success\?: true;/);
  assert.match(stateType, /error\?: string;/);
  assert.match(stateType, /downgradeFailed\?: true;/);
  assert.match(stateType, /hhcErrorId\?: string;/);
});

test("1. successful venue cancellation + successful downgrade still returns plain { success: true } (no downgradeFailed)", () => {
  assert.match(
    CANCEL_ACTIONS_SOURCE,
    /return downgradeFailed\s*\n\s*\? \{ success: true, downgradeFailed: true, hhcErrorId: downgradeHhcErrorId \}\s*\n\s*: \{ success: true \};/
  );
});

test("2a. downgrade failure does NOT collapse into a bare error response — the action still returns success: true (venue was genuinely cancelled)", () => {
  // The final return is unconditional on downgradeFailed producing an
  // object that still has success:true in both branches of the ternary —
  // confirmed by the same regex as the previous test. This test asserts
  // the negative: there is no separate early-return path that turns a
  // downgrade failure into `{ error: ... }` instead.
  const downgradeBlock = CANCEL_ACTIONS_SOURCE.split("// ── Billing: downgrade to free")[1]
    .split("// ── Audit log")[0];
  assert.doesNotMatch(downgradeBlock, /return \{ error:/);
});

test("2b. downgrade failure result is checked via result.ok (not ignored like the pre-fix `const { ok } = ...` destructure)", () => {
  const downgradeBlock = CANCEL_ACTIONS_SOURCE.split("// ── Billing: downgrade to free")[1]
    .split("// ── Audit log")[0];
  assert.match(downgradeBlock, /const result = await updateOperatorPlan\(operatorId, "free"\);/);
  assert.match(downgradeBlock, /if \(result\.ok\) \{/);
  assert.match(downgradeBlock, /\} else \{/);
});

test("2c. no duplicate HHC error is generated — downgradeHhcErrorId is only ever assigned from result.hhcErrorId, never from a new reportCriticalFailure/reportOperationalError call in this file", () => {
  assert.doesNotMatch(CANCEL_ACTIONS_SOURCE, /reportCriticalFailure/);
  assert.doesNotMatch(CANCEL_ACTIONS_SOURCE, /reportOperationalError/);
  assert.doesNotMatch(CANCEL_ACTIONS_SOURCE, /generateHhcErrorReference/);
  assert.match(CANCEL_ACTIONS_SOURCE, /downgradeHhcErrorId = result\.hhcErrorId;/);
});

test("2d. a misleading plan-change event/notification is not emitted when the downgrade fails — logPlanChangeEvent only runs inside the result.ok branch", () => {
  const downgradeBlock = CANCEL_ACTIONS_SOURCE.split("// ── Billing: downgrade to free")[1]
    .split("// ── Audit log")[0];
  const ifBlock = downgradeBlock.match(/if \(result\.ok\) \{([\s\S]*?)\} else \{/)![1];
  const elseBlock = downgradeBlock.match(/\} else \{([\s\S]*?)\n {6}\}/)![1];
  assert.match(ifBlock, /await logPlanChangeEvent\(/);
  assert.doesNotMatch(elseBlock, /logPlanChangeEvent/);
});

test("3a. existing auth/ownership/not-found/already-cancelled validation error paths are unchanged", () => {
  for (const expected of [
    `return { error: ctx.operatorError ?? "Could not resolve operator context." };`,
    `return { error: "Could not determine current user." };`,
    `return { error: "Could not resolve operator." };`,
    `return { error: "Only the admin can cancel the venue." };`,
    `return { error: "Venue ID is required." };`,
    `return { error: "Venue not found or you don't have permission to manage it." };`,
    `return { error: "This venue has already been cancelled." };`,
    `return { error: "Failed to cancel venue. Please try again." };`,
  ]) {
    assert.ok(
      CANCEL_ACTIONS_SOURCE.includes(expected),
      `expected unchanged validation error string not found: ${expected}`
    );
  }
});

test("3b. the venues cancel/unpublish write itself is unchanged and still happens before any billing/downgrade logic", () => {
  const venuesUpdateIndex = CANCEL_ACTIONS_SOURCE.indexOf('.from("venues")\n    .update({');
  const billingIndex = CANCEL_ACTIONS_SOURCE.indexOf("// ── Billing: downgrade to free");
  assert.ok(venuesUpdateIndex > -1 && billingIndex > -1);
  assert.ok(venuesUpdateIndex < billingIndex, "venue cancellation must still happen before the downgrade attempt");
});

test("#venue-churn Slack notification still fires unconditionally (venue cancellation is real regardless of downgrade outcome) and still reports the true previousPlan", () => {
  const afterBilling = CANCEL_ACTIONS_SOURCE.split("// ── Audit log")[1];
  assert.match(afterBilling, /channel: "venue-churn"/);
  assert.match(afterBilling, /Previous plan:\* \$\{previousPlan\}/);
});

test("no changes were made to logAuditEvent, founder email, or the venue_notes insert call shape", () => {
  assert.match(CANCEL_ACTIONS_SOURCE, /action:\s*"operator_venue_cancelled",/);
  assert.match(CANCEL_ACTIONS_SOURCE, /sendVenueCancellationFounderEmail\(\{/);
  assert.match(CANCEL_ACTIONS_SOURCE, /await adminClient\.from\("venue_notes"\)\.insert\(\{/);
});
