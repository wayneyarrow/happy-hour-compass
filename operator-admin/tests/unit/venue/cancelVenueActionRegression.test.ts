import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for cancelVenueAction() (src/app/admin/venue/cancelActions.ts):
 *   1. the original false-success fix (a downgrade failure must never
 *      collapse into a bare error response or a false-success response), and
 *   2. the Phase 2B venue-scoping + Stripe-cancellation-correctness cutover
 *      — cancelling Venue A must only ever touch Venue A, and a Stripe-
 *      backed venue's subscription must actually be cancelled at Stripe
 *      (not just flipped to Free locally while Stripe keeps billing).
 *
 * cancelVenueAction() calls resolveOperatorContext()/createAdminClient()/
 * Stripe directly with no DI seam (same reasoning as every other flow-
 * specific contract test in this repo), so this is a static, structural
 * verification of the actual source text — proving the exact control-flow
 * shape both fixes require, rather than exercising the real Server Action
 * end-to-end.
 */

const CANCEL_ACTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/venue/cancelActions.ts"),
  "utf8"
);

function billingBlock(): string {
  return CANCEL_ACTIONS_SOURCE
    .split("// ── Billing: downgrade THIS VENUE to free")[1]
    .split("// ── Audit log")[0];
}

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

test("2a. downgrade failure (either branch) does NOT collapse into a bare error response — the action still returns success: true (venue was genuinely cancelled)", () => {
  // The final return (asserted above) is unconditional on downgradeFailed
  // producing an object that still has success:true in both branches of
  // the ternary. This test asserts the negative within the billing block
  // itself: there is no separate early-return path that turns a downgrade/
  // Stripe-cancel failure into `{ error: ... }` instead.
  assert.doesNotMatch(billingBlock(), /return \{ error:/);
});

test("2b. Phase 2B: billing branches on whether the venue is Stripe-backed — Stripe-backed venues are actually cancelled at Stripe, manual paid plans are downgraded directly via updateVenuePlan()", () => {
  const block = billingBlock();
  assert.match(block, /const isStripeBacked =/);
  assert.match(block, /if \(isStripeBacked\) \{/);
  assert.match(block, /stripe\.subscriptions\.cancel\(/);
  assert.match(block, /const result = await updateVenuePlan\(venueId, "free"\);/);
  assert.match(block, /if \(result\.ok\) \{/);
});

test("2c. Stripe-cancel-failure path reports critically exactly once and assigns downgradeHhcErrorId from that report's reference — never a duplicate/independent HHC id", () => {
  const block = billingBlock();
  const stripeBranch = block.split("if (isStripeBacked) {")[1].split("} else {")[0];
  assert.match(stripeBranch, /await reportCriticalFailure\(\{/);
  assert.equal((stripeBranch.match(/reportCriticalFailure\(/g) ?? []).length, 1);
  assert.match(stripeBranch, /downgradeHhcErrorId = report\.hhcErrorId;/);
});

test("2d. manual-downgrade-failure path never generates its own HHC reference here — downgradeHhcErrorId comes only from updateVenuePlan()'s own result.hhcErrorId (which already reports internally)", () => {
  const block = billingBlock();
  const manualBranch = block.split("} else {").slice(1).join("} else {");
  assert.doesNotMatch(manualBranch, /reportCriticalFailure/);
  assert.doesNotMatch(manualBranch, /reportOperationalError/);
  assert.match(manualBranch, /downgradeHhcErrorId = result\.hhcErrorId;/);
});

test("2e. a misleading plan-change event is not logged for a failed manual downgrade — logPlanChangeEvent only runs inside that branch's result.ok check", () => {
  const block = billingBlock();
  const manualBranch = block.split("} else {").slice(1).join("} else {");
  const ifBlock = manualBranch.match(/if \(result\.ok\) \{([\s\S]*?)\} else \{/)![1];
  const elseBlock = manualBranch.match(/\} else \{([\s\S]*?)\n {6}\}/)![1];
  assert.match(ifBlock, /await logPlanChangeEvent\(/);
  assert.doesNotMatch(elseBlock, /logPlanChangeEvent/);
});

test("2f. Phase 2B: a Stripe-backed cancellation does NOT directly write venue_subscriptions or log its own plan_change_events row — the resulting webhook is the sole writer, exactly like every other Stripe-driven plan change", () => {
  const block = billingBlock();
  const stripeBranch = block.split("if (isStripeBacked) {")[1].split("} else {")[0];
  assert.doesNotMatch(stripeBranch, /updateVenuePlan\(/);
  assert.doesNotMatch(stripeBranch, /logPlanChangeEvent/);
});

test("Phase 2B: logPlanChangeEvent() call (manual branch) passes both operatorId and venueId — never guesses the venue", () => {
  const block = billingBlock();
  assert.match(block, /logPlanChangeEvent\(\{\s*\n\s*operatorId,\s*\n\s*venueId,/);
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
  const billingIndex = CANCEL_ACTIONS_SOURCE.indexOf("// ── Billing: downgrade THIS VENUE to free");
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

test("Phase 2B: the venue's Stripe Customer is never deleted — only the subscription is cancelled, so a future Checkout can reuse it", () => {
  assert.doesNotMatch(CANCEL_ACTIONS_SOURCE, /customers\.del\(/);
  assert.doesNotMatch(CANCEL_ACTIONS_SOURCE, /stripe\.customers\.delete/);
});
