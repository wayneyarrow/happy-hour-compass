import { test } from "node:test";
import assert from "node:assert/strict";
import { claimOrReuseActivationLifecycle } from "../../../src/lib/activation/activationLifecycle";

/**
 * claimOrReuseActivationLifecycle()'s Phase 2B verificationRequired option:
 * the legacy INSERT payload must be exactly what it was before (no
 * verification key at all), a NEW lifecycle may be created on the
 * email-code flow, and a REUSED lifecycle always keeps its own mode —
 * the flag can never convert a grandfathered lifecycle.
 */

type Row = Record<string, unknown>;

function fakeDb(existingLive: Row | null = null) {
  const inserts: Row[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      if (table === "operators") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { account_activated_at: null }, error: null }) };
        return q;
      }
      const q = {
        insert(payload: Row) {
          inserts.push(payload);
          return {
            select: () => ({
              single: async () =>
                existingLive
                  ? { data: null, error: { code: "23505", message: "duplicate" } }
                  : {
                      data: {
                        id: "new-lifecycle",
                        expired_at: null,
                        released_at: null,
                        ...payload,
                        verification_required: payload.verification_required ?? false,
                      },
                      error: null,
                    },
            }),
          };
        },
        select: () => q,
        eq: () => q,
        is: () => q,
        maybeSingle: async () => ({ data: existingLive, error: null }),
      };
      return q;
    },
  };
  return { client, inserts };
}

const LEGACY_KEYS = ["deadline_at", "operator_id", "origin_claim_id", "origin_submission_id", "origin_type", "reminder_stage", "started_at"];

test("default (flag off): the INSERT payload is the exact legacy payload — no verification key at all", async () => {
  const { client, inserts } = fakeDb();
  const result = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "claim", claimId: "c1" }, logTag: "[t]" },
    client
  );
  assert.equal(result.decision, "started");
  assert.deepEqual(Object.keys(inserts[0]).sort(), LEGACY_KEYS);
  if (result.decision === "started") assert.equal(result.lifecycle.verificationRequired, false);
});

test("explicit verificationRequired: false is still the exact legacy payload", async () => {
  const { client, inserts } = fakeDb();
  await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "submission", submissionId: "s1" }, logTag: "[t]", verificationRequired: false },
    client
  );
  assert.deepEqual(Object.keys(inserts[0]).sort(), LEGACY_KEYS);
});

test("verificationRequired: true creates a NEW email-code lifecycle, origin preserved", async () => {
  for (const origin of [{ type: "claim", claimId: "c1" }, { type: "submission", submissionId: "s1" }] as const) {
    const { client, inserts } = fakeDb();
    const result = await claimOrReuseActivationLifecycle({ operatorId: "op-1", origin, logTag: "[t]", verificationRequired: true }, client);
    assert.equal(inserts[0].verification_required, true);
    assert.ok(!("verification_completed_at" in inserts[0]), "completion is only ever set by the consume function");
    assert.equal(inserts[0].origin_type, origin.type);
    assert.equal(result.decision, "started");
    if (result.decision === "started") {
      assert.equal(result.lifecycle.verificationRequired, true);
      assert.equal(result.lifecycle.originType, origin.type);
    }
  }
});

test("a REUSED grandfathered legacy lifecycle stays legacy even when the caller asked for email-code", async () => {
  const grandfathered = {
    id: "table-19-like",
    operator_id: "op-1",
    origin_type: "submission",
    origin_claim_id: null,
    origin_submission_id: "s0",
    started_at: "2026-09-22T00:30:04.915Z",
    deadline_at: "2026-10-06T00:30:04.915Z",
    reminder_stage: 1,
    expired_at: null,
    released_at: null,
    verification_required: false,
  };
  const { client } = fakeDb(grandfathered);
  const result = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "claim", claimId: "c-new" }, logTag: "[t]", verificationRequired: true },
    client
  );
  assert.equal(result.decision, "reused");
  if (result.decision === "reused") {
    assert.equal(result.lifecycle.id, "table-19-like");
    assert.equal(result.lifecycle.verificationRequired, false);
    assert.equal(result.lifecycle.deadlineAt, grandfathered.deadline_at);
    assert.equal(result.lifecycle.reminderStage, 1);
  }
});

test("a row read without the migration-100 columns maps to legacy", async () => {
  const { client } = fakeDb({
    id: "old",
    operator_id: "op-1",
    origin_type: "claim",
    origin_claim_id: "c0",
    origin_submission_id: null,
    started_at: "x",
    deadline_at: "y",
    reminder_stage: 0,
    expired_at: null,
    released_at: null,
  });
  const result = await claimOrReuseActivationLifecycle({ operatorId: "op-1", origin: { type: "claim", claimId: "c1" }, logTag: "[t]" }, client);
  assert.equal(result.decision === "reused" && result.lifecycle.verificationRequired, false);
});
