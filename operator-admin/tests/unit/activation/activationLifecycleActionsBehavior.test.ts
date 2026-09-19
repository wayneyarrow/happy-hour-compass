import { test } from "node:test";
import assert from "node:assert/strict";
import { extendActivationDeadlineImpl } from "../../../src/lib/activation/extendActivationDeadlineImpl";
import { deriveActivationState } from "../../../src/lib/activation/activationState";
import { computeStageDue } from "../../../src/lib/activation/activationReminderPolicy";

/**
 * Full behavioral tests for extendActivationDeadlineImpl() — the actual
 * implementation behind the exported extendActivationDeadlineAction Server
 * Action. This requires exercising all four lifecycle states (live/future,
 * passed/unexpired, expired-and-reopened, released-and-blocked) plus atomic
 * concurrency safety, which a source-inspection test cannot actually prove.
 *
 * WHY THIS TESTS THE IMPL, NOT THE EXPORTED ACTION: the exported
 * `extendActivationDeadlineAction` (activationLifecycleActions.ts) has a
 * fixed, client-safe signature — `(lifecycleId, prevState, formData)` — with
 * no dependency-override parameter, precisely so a browser/client has no
 * path to influence its authorization or persistence dependencies. The
 * ExtendActivationDeadlineDeps DI seam this file exercises lives entirely on
 * extendActivationDeadlineImpl() instead, a plain module with no
 * "use server" directive — it is never itself network-reachable, so
 * accepting `deps` there carries none of the risk it would on the exported
 * action. Every real call site (ActivationCard.tsx → the exported action →
 * this impl) omits `deps` entirely and gets the real
 * createClient()/createAdminClient()/isControlPanelAdmin()/revalidatePath();
 * only tests pass fakes. See activationLifecycleActionsWiring.test.ts for
 * the tests confirming the exported action's signature truly has no such
 * parameter.
 */

type FakeLifecycleRow = {
  id: string;
  operator_id: string;
  origin_type: "claim" | "submission";
  origin_claim_id: string | null;
  origin_submission_id: string | null;
  deadline_at: string;
  expired_at: string | null;
  released_at: string | null;
  reminder_stage: number;
  reminder_next_attempt_at?: string | null;
  reminder_attempt_count?: number;
  reminder_lease_stage?: number | null;
  reminder_lease_started_at?: string | null;
};

type Filter = { col: string; val: unknown; op: "eq" | "is" };

/**
 * A shared, mutable "table" for one lifecycle row plus its operator and a
 * notes sink. `makeClient(frozenSnapshot?)` normally reads the LIVE row, but
 * when given a frozen snapshot (captured before some other call mutates the
 * store), its `select()` returns that stale snapshot instead — letting a
 * test simulate "two callers read the same pre-race state" without needing
 * true concurrency: the atomic CAS is proven by having the stale caller's
 * `update()` filters (still evaluated against the LIVE, already-mutated
 * store) fail to match.
 */
function makeStore(initial: FakeLifecycleRow, accountActivatedAt: string | null = null) {
  const store: { lifecycle: FakeLifecycleRow; accountActivatedAt: string | null; notes: Record<string, unknown>[] } = {
    lifecycle: {
      reminder_next_attempt_at: null,
      reminder_attempt_count: 0,
      reminder_lease_stage: null,
      reminder_lease_started_at: null,
      ...initial,
    },
    accountActivatedAt,
    notes: [],
  };

  function makeClient(frozenSnapshot?: FakeLifecycleRow) {
    let fromCalled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      from(table: string) {
        fromCalled = true;
        if (table === "operator_activation_lifecycles") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({ data: { ...(frozenSnapshot ?? store.lifecycle) }, error: null }),
                  };
                },
              };
            },
            update(payload: Partial<FakeLifecycleRow>) {
              const filters: Filter[] = [];
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
                select() {
                  return {
                    maybeSingle: async () => {
                      const matches = filters.every((f) => {
                        const current = (store.lifecycle as unknown as Record<string, unknown>)[f.col];
                        return current === f.val;
                      });
                      if (!matches) return { data: null, error: null };
                      Object.assign(store.lifecycle, payload);
                      return { data: { id: store.lifecycle.id }, error: null };
                    },
                  };
                },
              };
              return builder;
            },
          };
        }
        if (table === "operators") {
          return {
            select() {
              return {
                eq() {
                  return { maybeSingle: async () => ({ data: { account_activated_at: store.accountActivatedAt }, error: null }) };
                },
              };
            },
          };
        }
        if (table === "venue_claim_notes" || table === "operator_submission_notes") {
          return {
            insert: async (row: Record<string, unknown>) => {
              store.notes.push(row);
              return { error: null };
            },
          };
        }
        throw new Error(`unexpected table in fake: ${table}`);
      },
    };
    return { client, wasTouched: () => fromCalled };
  }

  return { store, makeClient };
}

const FOUNDER = { id: "founder-1", email: "founder@happyhourcompass.com" };
const NON_FOUNDER = { id: "user-1", email: "operator@example.com" };

function authDeps(user: { id: string; email: string } | null, isAdmin: boolean) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authClient: { auth: { getUser: async () => ({ data: { user } }) } } as any,
    checkAdmin: async () => isAdmin,
    revalidate: () => {}, // no-op — no real Next.js request context in tests
  };
}

// ── Authorization ────────────────────────────────────────────────────────────

test("extendActivationDeadlineAction: founder-authorized user can extend", async () => {
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    expired_at: null, released_at: null, reminder_stage: 0,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", {
    ...authDeps(FOUNDER, true),
    adminClient: client,
  });
  assert.equal(result.success, true);
  assert.notEqual(store.lifecycle.deadline_at, undefined);
});

test("extendActivationDeadlineAction: ordinary authenticated (non-founder) user is denied, and the lifecycle table is never touched", async () => {
  const { makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    expired_at: null, released_at: null, reminder_stage: 0,
  });
  const { client, wasTouched } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", {
    ...authDeps(NON_FOUNDER, false),
    adminClient: client,
  });
  assert.equal(result.success, undefined);
  assert.equal(result.error, "Unauthorized.");
  assert.equal(wasTouched(), false, "authorization must be checked BEFORE any lifecycle lookup");
});

test("extendActivationDeadlineAction: no signed-in user at all is denied the same as a non-founder", async () => {
  const { makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: new Date().toISOString(), expired_at: null, released_at: null, reminder_stage: 0,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authClient: { auth: { getUser: async () => ({ data: { user: null } }) } } as any,
    checkAdmin: async () => true, // even if this somehow returned true, no user means denied
    adminClient: client,
  });
  assert.equal(result.error, "Unauthorized.");
});

// ── State A: live, future deadline ──────────────────────────────────────────

test("extendActivationDeadlineAction: future deadline → +7 days from the CURRENT deadline", async () => {
  const originalDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: originalDeadline, expired_at: null, released_at: null, reminder_stage: 0,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  const expected = new Date(new Date(originalDeadline).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(store.lifecycle.deadline_at, expected);
  assert.equal(store.lifecycle.expired_at, null);
  assert.equal(store.lifecycle.reminder_stage, 0);
  assert.equal(store.lifecycle.reminder_attempt_count, 0);
  assert.equal(store.lifecycle.reminder_next_attempt_at, computeStageDue(1, expected));
});

// ── State B: deadline passed, expired_at IS NULL ────────────────────────────

test("extendActivationDeadlineAction: passed deadline, not yet expired → +7 days from NOW, a genuine fresh window", async () => {
  const pastDeadline = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_claim_id: null, origin_submission_id: "sub-1",
    deadline_at: pastDeadline, expired_at: null, released_at: null, reminder_stage: 0,
  });
  const { client } = makeClient();
  const before = Date.now();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });
  const after = Date.now();

  assert.equal(result.success, true);
  const newDeadlineMs = new Date(store.lifecycle.deadline_at).getTime();
  assert.ok(newDeadlineMs >= before + 7 * 24 * 60 * 60 * 1000 - 1000);
  assert.ok(newDeadlineMs <= after + 7 * 24 * 60 * 60 * 1000 + 1000);
});

// ── State C: expired_at IS NOT NULL, released_at IS NULL → explicit reopen ──

test("extendActivationDeadlineAction: expired-but-unreleased lifecycle is explicitly reopened — new deadline from now, expired_at cleared, released_at stays null, reminder_stage PRESERVED (not reset)", async () => {
  const pastDeadline = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const priorExpiredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: pastDeadline, expired_at: priorExpiredAt, released_at: null, reminder_stage: 2,
  });
  const { client } = makeClient();
  const before = Date.now();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  assert.equal(store.lifecycle.expired_at, null, "expired_at must be cleared on reopen");
  assert.equal(store.lifecycle.released_at, null, "released_at must remain untouched");
  // Phase 2A correction: reminder_stage 2 was already resolved before the
  // reopen — a flat +7d reopen never obsoletes stage 3 (its 2-day pre-
  // deadline offset is always smaller than the 7-day window), so stage 2
  // must be PRESERVED, never blindly reset to 0.
  assert.equal(store.lifecycle.reminder_stage, 2);
  assert.equal(store.lifecycle.reminder_attempt_count, 0, "attempt count resets for the newly-scheduled stage");
  const newDeadlineMs = new Date(store.lifecycle.deadline_at).getTime();
  assert.ok(newDeadlineMs >= before + 7 * 24 * 60 * 60 * 1000 - 1000, "reopened deadline must be ~7 days from now, not from the stale deadline");
  const expectedNextAttempt = computeStageDue(3, store.lifecycle.deadline_at);
  assert.equal(store.lifecycle.reminder_next_attempt_at, expectedNextAttempt, "next attempt is stage 3's due time under the NEW deadline");

  // Structured note preserves the prior expired timestamp, no secrets.
  assert.equal(store.notes.length, 1);
  const note = store.notes[0] as { metadata_json: Record<string, unknown> };
  assert.equal(note.metadata_json.previousExpiredAt, priorExpiredAt);
  const metaStr = JSON.stringify(note.metadata_json);
  assert.doesNotMatch(metaStr, /token|link|password|secret/i);
});

test("extendActivationDeadlineAction: reopened lifecycle immediately re-derives as Awaiting Setup or Expiring Soon, never stuck on Expired", async () => {
  const pastDeadline = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const priorExpiredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: pastDeadline, expired_at: priorExpiredAt, released_at: null, reminder_stage: 0,
  });
  const { client } = makeClient();
  await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  const state = deriveActivationState({
    accountActivatedAt: null,
    activationStartedAt: "2026-01-01T00:00:00.000Z",
    activationDeadlineAt: store.lifecycle.deadline_at,
    expiredAt: store.lifecycle.expired_at,
    releasedAt: store.lifecycle.released_at,
  });
  assert.ok(state === "awaiting_setup" || state === "expiring_soon", `expected awaiting_setup/expiring_soon, got ${state}`);
  assert.notEqual(state, "expired");
});

// ── Phase 2A design-audit reminder-resolution examples ──────────────────────
//
// These prove extendActivationDeadlineImpl() is correctly wired to
// computeExtensionResolution() for every scenario worked through in the
// Phase 2A design audit — reminder_stage is preserved, never blindly reset,
// and only obsolete stages are silently skipped.

test("extendActivationDeadlineAction: Kelly's real lifecycle, stage 0, extended 7 days — stage stays 0, next attempt is the new stage-1 due time", async () => {
  // Kelly Terris / Buffalo Rouge Brewing Co.'s actual production values
  // (operator_activation_lifecycles.id = 8b573190-6cf5-4537-82f7-07c10a3f49c9)
  // as of the Phase 2A design audit — deadline still comfortably future.
  const kellyDeadline = "2026-10-02T23:41:30.607Z";
  const { store, makeClient } = makeStore({
    id: "kelly-lc", operator_id: "op-kelly", origin_type: "submission", origin_claim_id: null, origin_submission_id: "sub-kelly",
    deadline_at: kellyDeadline, expired_at: null, released_at: null, reminder_stage: 0,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("kelly-lc", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  const expectedNewDeadline = new Date(new Date(kellyDeadline).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(store.lifecycle.deadline_at, expectedNewDeadline, "new deadline = 2026-10-09T23:41:30.607Z");
  assert.equal(store.lifecycle.reminder_stage, 0, "stage 1's new due time is still future — nothing obsolete yet");
  assert.equal(store.lifecycle.reminder_next_attempt_at, computeStageDue(1, expectedNewDeadline));
});

test("extendActivationDeadlineAction: stage 1 resolved, extended 7 days — stage 1 preserved, next attempt is stage 2's new due time", async () => {
  const originalDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: originalDeadline, expired_at: null, released_at: null, reminder_stage: 1,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  assert.equal(store.lifecycle.reminder_stage, 1, "stage 1 must never be re-resolved/repeated");
  assert.equal(store.lifecycle.reminder_next_attempt_at, computeStageDue(2, store.lifecycle.deadline_at));
});

test("extendActivationDeadlineAction: stage 2 resolved, extended 7 days — stage 2 preserved, next attempt is stage 3's new due time", async () => {
  const originalDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: originalDeadline, expired_at: null, released_at: null, reminder_stage: 2,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  assert.equal(store.lifecycle.reminder_stage, 2);
  assert.equal(store.lifecycle.reminder_next_attempt_at, computeStageDue(3, store.lifecycle.deadline_at));
});

test("extendActivationDeadlineAction: stage 3 already resolved, extended — stays 3, no further automatic reminders (founder may use manual Resend)", async () => {
  const originalDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: originalDeadline, expired_at: null, released_at: null, reminder_stage: 3,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  assert.equal(store.lifecycle.reminder_stage, 3);
  assert.equal(store.lifecycle.reminder_next_attempt_at, null);
});

test("extendActivationDeadlineAction: overdue stage-0 lifecycle reopened for 7 days — resolves to stage 2 (stages 1 & 2 obsolete), schedules stage 3 five days out, no reminder sent", async () => {
  const pastDeadline = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const priorExpiredAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: pastDeadline, expired_at: priorExpiredAt, released_at: null, reminder_stage: 0,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  // A flat 7-day reopen always obsoletes stage 1 (-11d) and, at the exact
  // boundary, stage 2 (-7d) as well — both offsets exceed or equal the
  // 7-day fresh window — leaving only stage 3 (-2d) schedulable.
  assert.equal(store.lifecycle.reminder_stage, 2, "stages 1 and 2 are silently resolved as obsolete, never sent");
  assert.equal(
    store.lifecycle.reminder_next_attempt_at,
    computeStageDue(3, store.lifecycle.deadline_at),
    "only stage 3 is scheduled, against the NEW deadline"
  );
  // No reminder-related note of any kind is written by this action — only
  // the existing deadline_extended note.
  assert.equal(store.notes.length, 1);
  assert.equal((store.notes[0] as { event_type: string }).event_type, "deadline_extended");
});

test("extendActivationDeadlineAction: expired stage-3 lifecycle reopened — stays at stage 3, no automatic reminder is ever scheduled", async () => {
  const pastDeadline = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const priorExpiredAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: pastDeadline, expired_at: priorExpiredAt, released_at: null, reminder_stage: 3,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  assert.equal(store.lifecycle.reminder_stage, 3);
  assert.equal(store.lifecycle.reminder_next_attempt_at, null);
});

// ── Phase 2A design correction: extension must never clear/steal a lease ───

test("extendActivationDeadlineAction: an active reminder lease blocks the extension outright — no state change at all", async () => {
  const originalDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: originalDeadline, expired_at: null, released_at: null, reminder_stage: 1,
    reminder_lease_stage: 2, reminder_lease_started_at: new Date().toISOString(),
  });
  const originalSnapshot = { ...store.lifecycle };
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, undefined);
  assert.equal(result.error, "A reminder is currently being processed. Please refresh and try again shortly.");
  assert.deepEqual(store.lifecycle, originalSnapshot, "a held lease means absolutely nothing is mutated");
  assert.equal(store.notes.length, 0, "no note is written when extension is blocked by a lease");
});

test("extendActivationDeadlineAction: a free (null) lease permits extension normally", async () => {
  const originalDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: originalDeadline, expired_at: null, released_at: null, reminder_stage: 1,
    reminder_lease_stage: null, reminder_lease_started_at: null,
  });
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, true);
  assert.notEqual(store.lifecycle.deadline_at, originalDeadline);
});

// ── State D: released_at IS NOT NULL → blocked, never reopened ──────────────

test("extendActivationDeadlineAction: a released lifecycle is blocked outright and nothing is mutated", async () => {
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    expired_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    released_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    reminder_stage: 3,
  });
  const originalSnapshot = { ...store.lifecycle };
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /already been released/);
  assert.deepEqual(store.lifecycle, originalSnapshot, "a released lifecycle must never be mutated");
  assert.equal(store.notes.length, 0, "no note is written when the action is blocked");
});

// ── Already-activated operator is blocked (regression) ──────────────────────

test("extendActivationDeadlineAction: an already-activated operator blocks the extension", async () => {
  const { store, makeClient } = makeStore(
    {
      id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
      deadline_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      expired_at: null, released_at: null, reminder_stage: 0,
    },
    "2026-01-01T00:00:00.000Z" // account_activated_at
  );
  const originalSnapshot = { ...store.lifecycle };
  const { client } = makeClient();
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  assert.match(result.error ?? "", /already activated/);
  assert.deepEqual(store.lifecycle, originalSnapshot);
});

// ── Concurrency: atomic compare-and-swap ─────────────────────────────────────

test("extendActivationDeadlineAction: two extension attempts reading the same stale snapshot — exactly one succeeds, the other gets a clear conflict error, no double-extension", async () => {
  const originalDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: originalDeadline, expired_at: null, released_at: null, reminder_stage: 0,
  });

  // Both "callers" read this exact pre-race snapshot.
  const staleSnapshot = { ...store.lifecycle };
  const clientA = makeClient(staleSnapshot).client;
  const clientB = makeClient(staleSnapshot).client;

  const resultA = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: clientA });
  assert.equal(resultA.success, true, "the first extension to land wins");

  const resultB = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: clientB });
  assert.equal(resultB.success, undefined, "the second, now-stale extension must not also succeed");
  assert.match(resultB.error ?? "", /changed by another action/);

  // The deadline reflects exactly ONE extension (+7 days from the original),
  // never two (+14 days) — B's update never applied.
  const expectedSingleExtension = new Date(new Date(originalDeadline).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(store.lifecycle.deadline_at, expectedSingleExtension);
  assert.equal(store.notes.length, 1, "only the winning extension writes a note");
});

test("extendActivationDeadlineAction: a reopen (case C) racing against a released action also loses cleanly via the expired_at pin", async () => {
  const pastDeadline = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const priorExpiredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { store, makeClient } = makeStore({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: pastDeadline, expired_at: priorExpiredAt, released_at: null, reminder_stage: 0,
  });

  const staleSnapshot = { ...store.lifecycle };

  // Simulate someone else releasing the lifecycle between the stale read and this call's update.
  store.lifecycle.released_at = new Date().toISOString();

  const { client } = makeClient(staleSnapshot);
  const result = await extendActivationDeadlineImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: client });

  // The fetch step itself reads the frozen (stale) snapshot in this fake, so
  // the released_at guard (evaluated on that stale read) doesn't trip here —
  // instead the CAS update's released_at IS NULL filter correctly fails
  // against the now-released live row, proving the update-time check is the
  // real safety net even if an earlier read was stale.
  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /changed by another action/);
  assert.equal(store.lifecycle.expired_at, priorExpiredAt, "expired_at must not be cleared when the CAS doesn't match");
});
