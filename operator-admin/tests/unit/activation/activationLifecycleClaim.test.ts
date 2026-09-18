import { test } from "node:test";
import assert from "node:assert/strict";
import { claimOrReuseActivationLifecycle } from "../../../src/lib/activation/activationLifecycle";

/**
 * Behavioral tests for claimOrReuseActivationLifecycle() — the atomic
 * single-lifecycle guarantee this correction adds (see that file's header
 * for the full design and the race it replaces).
 *
 * CONCURRENCY TESTING LIMITATION (see the correction report's "Tests and
 * limitations" section): this fake models the database's uniqueness
 * enforcement (a live row for the same operator_id cannot be inserted
 * twice) precisely enough to prove the APPLICATION CODE correctly handles
 * a 23505 conflict by reading back and reusing the winning row — which is
 * exactly what happens when two real concurrent requests race against the
 * real partial unique index (migration 098). It does not, and cannot,
 * prove that PostgreSQL itself serializes two literally-simultaneous
 * INSERTs this way — that is standard, well-established Postgres behavior
 * for any unique index, not something specific to this codebase, but it is
 * still real production behavior this environment cannot execute (no
 * database write access, and applying the migration is out of scope for
 * this phase). A real concurrent-request smoke test against the applied
 * migration in staging is recommended before this ships — see the report.
 */

type FakeLifecycleRow = {
  id: string;
  operator_id: string;
  origin_type: "claim" | "submission";
  origin_claim_id: string | null;
  origin_submission_id: string | null;
  started_at: string;
  deadline_at: string;
  reminder_stage: number;
  expired_at: string | null;
  released_at: string | null;
};

function isLive(row: FakeLifecycleRow): boolean {
  return row.expired_at == null && row.released_at == null;
}

/**
 * Models the two tables claimOrReuseActivationLifecycle() touches, enforcing
 * the SAME invariant migration 098's partial unique index enforces: at most
 * one live row per operator_id. An insert that would violate it returns the
 * same {code: "23505"} shape the real Postgres driver returns, exercising
 * the exact branch the real code depends on.
 */
function makeFakeLifecycleDb(initialAccountActivatedAt: string | null = null) {
  const rows: FakeLifecycleRow[] = [];
  const accountActivatedAt = initialAccountActivatedAt;
  let nextId = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      if (table === "operators") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: { account_activated_at: accountActivatedAt }, error: null }),
        };
      }

      if (table === "operator_activation_lifecycles") {
        return {
          insert(payload: Omit<FakeLifecycleRow, "id" | "expired_at" | "released_at">) {
            return {
              select() {
                return {
                  single: async () => {
                    const conflict = rows.some((r) => r.operator_id === payload.operator_id && isLive(r));
                    if (conflict) {
                      return {
                        data: null,
                        error: { code: "23505", message: "duplicate key value violates unique constraint" },
                      };
                    }
                    const row: FakeLifecycleRow = {
                      id: `lifecycle-${nextId++}`,
                      expired_at: null,
                      released_at: null,
                      ...payload,
                    };
                    rows.push(row);
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
          select() {
            const filters: { col: string; val: unknown; op: "eq" | "is" }[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const builder: any = {
              eq(col: string, val: unknown) {
                filters.push({ col, val, op: "eq" });
                return builder;
              },
              is(col: string, val: unknown) {
                filters.push({ col, val, op: "is" });
                return builder;
              },
              maybeSingle: async () => {
                const match = rows.find((r) =>
                  filters.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val)
                );
                return { data: match ?? null, error: null };
              },
            };
            return builder;
          },
        };
      }

      throw new Error(`unexpected table in fake: ${table}`);
    },
  };

  return {
    client,
    rows,
    expireRow(id: string) {
      const row = rows.find((r) => r.id === id);
      if (row) row.expired_at = new Date().toISOString();
    },
  };
}

// ── Already-activated operator ──────────────────────────────────────────────

test("claimOrReuseActivationLifecycle: already-activated operator gets no lifecycle, no insert attempted", async () => {
  const db = makeFakeLifecycleDb("2026-09-01T00:00:00.000Z");
  const result = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "claim", claimId: "claim-1" }, logTag: "[test]" },
    db.client
  );
  assert.deepEqual(result, { decision: "already_activated" });
  assert.equal(db.rows.length, 0);
});

// ── Brand-new lifecycle ──────────────────────────────────────────────────────

test("claimOrReuseActivationLifecycle: unactivated operator with no existing lifecycle starts a fresh one", async () => {
  const db = makeFakeLifecycleDb(null);
  const result = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "claim", claimId: "claim-1" }, logTag: "[test]" },
    db.client
  );
  assert.equal(result.decision, "started");
  if (result.decision === "started") {
    assert.equal(result.lifecycle.operatorId, "op-1");
    assert.equal(result.lifecycle.originType, "claim");
    assert.equal(result.lifecycle.originClaimId, "claim-1");
    assert.equal(result.lifecycle.reminderStage, 0);
  }
  assert.equal(db.rows.length, 1);
});

// ── THE RACE: concurrent Claim + Submission for one operator ────────────────

test("claimOrReuseActivationLifecycle: concurrent Claim then Submission for the same unactivated operator — the second reuses instead of competing", async () => {
  const db = makeFakeLifecycleDb(null);

  const claimResult = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "claim", claimId: "claim-1" }, logTag: "[test-claim]" },
    db.client
  );
  assert.equal(claimResult.decision, "started");

  // Simulates the second of two near-simultaneous requests losing the race
  // against the real partial unique index (see file header for the
  // concurrency-testing limitation this represents).
  const submissionResult = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "submission", submissionId: "sub-1" }, logTag: "[test-submission]" },
    db.client
  );
  assert.equal(submissionResult.decision, "reused");
  if (submissionResult.decision === "reused" && claimResult.decision === "started") {
    // The claim's lifecycle is authoritative — the submission gets no
    // competing deadline of its own.
    assert.equal(submissionResult.lifecycle.id, claimResult.lifecycle.id);
    assert.equal(submissionResult.lifecycle.originType, "claim");
  }
  // Exactly one row exists — never two competing lifecycles.
  assert.equal(db.rows.length, 1);
});

test("claimOrReuseActivationLifecycle: concurrent Submission + Submission for the same unactivated operator — no competing deadlines", async () => {
  const db = makeFakeLifecycleDb(null);

  const first = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "submission", submissionId: "sub-1" }, logTag: "[test]" },
    db.client
  );
  const second = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "submission", submissionId: "sub-2" }, logTag: "[test]" },
    db.client
  );

  assert.equal(first.decision, "started");
  assert.equal(second.decision, "reused");
  assert.equal(db.rows.length, 1);
  if (first.decision === "started" && second.decision === "reused") {
    assert.equal(second.lifecycle.originSubmissionId, "sub-1", "sub-1's lifecycle remains authoritative, not sub-2's");
  }
});

// ── Same-origin retry ────────────────────────────────────────────────────────

test("claimOrReuseActivationLifecycle: retry of the same origin after success reuses the identical lifecycle, no reset", async () => {
  const db = makeFakeLifecycleDb(null);
  const origin = { type: "claim" as const, claimId: "claim-1" };

  const first = await claimOrReuseActivationLifecycle({ operatorId: "op-1", origin, logTag: "[test]" }, db.client);
  const retry = await claimOrReuseActivationLifecycle({ operatorId: "op-1", origin, logTag: "[test]" }, db.client);

  assert.equal(first.decision, "started");
  assert.equal(retry.decision, "reused");
  assert.equal(db.rows.length, 1, "a retry must never create a second row");
  if (first.decision === "started" && retry.decision === "reused") {
    assert.equal(retry.lifecycle.id, first.lifecycle.id);
    assert.equal(retry.lifecycle.deadlineAt, first.lifecycle.deadlineAt, "a retry must never extend the deadline");
  }
});

// ── New lifecycle after expiry/release ───────────────────────────────────────

test("claimOrReuseActivationLifecycle: a new claim/submission may start fresh once the prior lifecycle is expired", async () => {
  const db = makeFakeLifecycleDb(null);

  const first = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "claim", claimId: "claim-1" }, logTag: "[test]" },
    db.client
  );
  assert.equal(first.decision, "started");
  if (first.decision !== "started") return;
  db.expireRow(first.lifecycle.id);

  const restarted = await claimOrReuseActivationLifecycle(
    { operatorId: "op-1", origin: { type: "submission", submissionId: "sub-1" }, logTag: "[test]" },
    db.client
  );
  assert.equal(restarted.decision, "started", "an expired lifecycle must not block a fresh one");
  if (restarted.decision === "started") {
    assert.notEqual(restarted.lifecycle.id, first.lifecycle.id);
    assert.equal(restarted.lifecycle.originType, "submission");
  }
  assert.equal(db.rows.length, 2, "the old expired row is preserved, not deleted");
});

// ── Unexpected failure ───────────────────────────────────────────────────────

test("claimOrReuseActivationLifecycle: an unexpected (non-23505) insert error is reported as claim_failed, never thrown", async () => {
  const db = makeFakeLifecycleDb(null);
  // Override the lifecycle table's insert to simulate a genuine DB error
  // unrelated to the uniqueness constraint.
  const originalFrom = db.client.from.bind(db.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db.client.from = (table: string): any => {
    if (table === "operator_activation_lifecycles") {
      return {
        insert() {
          return { select: () => ({ single: async () => ({ data: null, error: { code: "XX000", message: "connection reset" } }) }) };
        },
      };
    }
    return originalFrom(table);
  };

  await assert.doesNotReject(async () => {
    const result = await claimOrReuseActivationLifecycle(
      { operatorId: "op-1", origin: { type: "claim", claimId: "claim-1" }, logTag: "[test]" },
      db.client
    );
    assert.equal(result.decision, "claim_failed");
  });
});
