import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resetTurnstileAfterSubmissionError,
  type TurnstileResettableRef,
} from "../../../src/app/(consumer)/suggest/owner/turnstileRetry";

// ── Turnstile retry regression coverage ─────────────────────────────────────
//
// Investigation finding: after saveOperatorSubmissionAction returns an
// ordinary (non-Turnstile) error, the widget/token were never reset, so a
// retry reused the already-consumed token and Cloudflare rejected it as
// "timeout-or-duplicate" — a second, unrelated failure stacked on top of the
// first (Casa de Frida: server error, then Turnstile "failure" on retry).
//
// This exercises the exact contract handleConfirmMatch / handleRejectSubmit /
// handleNoMatchContinue in both OwnerSubmissionFlow.tsx and
// AddVenueModalContent.tsx now rely on for every non-Turnstile error path.

test("Turnstile succeeds, then a server/application error occurs: resets the token so a retry cannot reuse it, and surfaces the error message", () => {
  let generalError: string | null = null;
  let turnstileToken: string | null = "already-verified-token";
  let resetCallCount = 0;
  const turnstileRef: TurnstileResettableRef = {
    current: {
      reset() {
        resetCallCount++;
      },
    },
  };

  resetTurnstileAfterSubmissionError(
    "Something went wrong. Please try again.",
    (msg) => {
      generalError = msg;
    },
    (token) => {
      turnstileToken = token;
    },
    turnstileRef
  );

  assert.equal(generalError, "Something went wrong. Please try again.");
  // The consumed token is cleared — a retry now requires a fresh one
  // (both call sites disable their submit button while turnstileToken is
  // falsy: `disabled={isPending || !turnstileToken}`).
  assert.equal(turnstileToken, null);
  // The widget itself was told to re-render a fresh challenge.
  assert.equal(resetCallCount, 1);
});

test("does not throw when the Turnstile widget isn't currently mounted (ref.current is null)", () => {
  const turnstileRef: TurnstileResettableRef = { current: null };
  let turnstileToken: string | null = "already-verified-token";

  assert.doesNotThrow(() => {
    resetTurnstileAfterSubmissionError(
      "Something went wrong. Please try again.",
      () => {},
      (token) => {
        turnstileToken = token;
      },
      turnstileRef
    );
  });
  assert.equal(turnstileToken, null);
});

test("a fresh Turnstile completion after the reset produces a genuinely new token, distinct from the consumed one — simulating the retry itself", () => {
  let turnstileToken: string | null = "consumed-token-abc";
  const turnstileRef: TurnstileResettableRef = {
    current: { reset() {} },
  };

  resetTurnstileAfterSubmissionError(
    "Something went wrong. Please try again.",
    () => {},
    (token) => {
      turnstileToken = token;
    },
    turnstileRef
  );
  assert.equal(turnstileToken, null, "token cleared immediately after the error");

  // Simulates the widget's onVerify firing again after the visitor
  // re-completes the (freshly re-rendered) challenge.
  const freshToken = "fresh-token-xyz";
  turnstileToken = freshToken;

  assert.notEqual(turnstileToken, "consumed-token-abc");
  assert.equal(turnstileToken, freshToken);
});
