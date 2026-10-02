import { test } from "node:test";
import assert from "node:assert/strict";
import { selectActivationOriginLifecycle, type ActivationOriginLifecycleCandidate } from "../../../src/lib/operatorActivation";

/**
 * Which lifecycle an account activation is attributed to. Drives the
 * "account activated" note and the auto-approved venue verification step in
 * completeOperatorAccountActivation() — which must keep working when an
 * operator finishes setup AFTER their window expired (post-expiry final
 * follow-up). Released lifecycles are excluded by the query itself.
 */

function row(overrides: Partial<ActivationOriginLifecycleCandidate>): ActivationOriginLifecycleCandidate {
  return {
    origin_type: "claim",
    origin_claim_id: "claim-1",
    origin_submission_id: null,
    expired_at: null,
    started_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("a live lifecycle always wins", () => {
  const live = row({ origin_claim_id: "claim-live" });
  const expired = row({ origin_claim_id: "claim-old", expired_at: "2026-09-20T00:00:00.000Z" });
  assert.equal(selectActivationOriginLifecycle([expired, live]), live);
});

test("with no live lifecycle, the most recently expired one is used (setup finished after expiry)", () => {
  const older = row({ origin_claim_id: "claim-a", expired_at: "2026-09-10T00:00:00.000Z" });
  const newer = row({ origin_type: "submission", origin_claim_id: null, origin_submission_id: "sub-b", expired_at: "2026-10-02T23:41:30.607Z" });
  assert.equal(selectActivationOriginLifecycle([older, newer]), newer);
});

test("no unreleased lifecycle → null (the legacy pre-098 fallback applies)", () => {
  assert.equal(selectActivationOriginLifecycle([]), null);
});
