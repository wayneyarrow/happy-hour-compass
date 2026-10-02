import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowFinalFollowUpPanel, shouldShowStandaloneResendPanel, type ActivationPresentation } from "../../../src/lib/activation/activationPresentation";

/** Which panel a Claim/Submission detail page shows, per activation state. */

function presentation(state: ActivationPresentation["state"], lifecycle: Partial<NonNullable<ActivationPresentation["lifecycle"]>> | null): ActivationPresentation {
  return {
    state,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lifecycle: lifecycle === null ? null : ({ id: "lc-1", releasedAt: null, ...lifecycle } as any),
    operator: null,
  } as ActivationPresentation;
}

test("the Final follow-up panel replaces Resend once the window has ended (Release Required or Expired), unreleased", () => {
  for (const state of ["release_required", "expired"] as const) {
    assert.equal(shouldShowFinalFollowUpPanel(presentation(state, {})), true, state);
  }
});

test("active windows keep the normal Resend panel; released, activated and untracked records never show Final follow-up", () => {
  for (const state of ["awaiting_setup", "expiring_soon"] as const) {
    const p = presentation(state, {});
    assert.equal(shouldShowFinalFollowUpPanel(p), false, state);
    assert.equal(shouldShowStandaloneResendPanel(p), true, state);
  }
  assert.equal(shouldShowFinalFollowUpPanel(presentation("released", { releasedAt: "2026-10-01T00:00:00.000Z" })), false);
  assert.equal(shouldShowFinalFollowUpPanel(presentation("expired", { releasedAt: "2026-10-01T00:00:00.000Z" })), false);
  assert.equal(shouldShowFinalFollowUpPanel(presentation("active", {})), false);
  assert.equal(shouldShowFinalFollowUpPanel(presentation("not_tracked", null)), false);
});
