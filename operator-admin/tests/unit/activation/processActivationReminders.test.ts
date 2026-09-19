import { test } from "node:test";
import assert from "node:assert/strict";
import { processActivationReminders, planActivationReminders } from "../../../src/lib/activation/processActivationReminders";
import { computeStageDue } from "../../../src/lib/activation/activationReminderPolicy";
import {
  createFakeActivationReminderClient,
  makeLifecycleRow,
  type FakeLifecycleRow,
} from "./support/fakeActivationReminderClient";

/**
 * Behavioral tests for the Phase 2A-3 reminder/expiry orchestrator. Every
 * test that expects real processing explicitly enables the kill switch for
 * its own duration via withEnv() — the exact established pattern already
 * used for Customer Success (tests/unit/customerSuccess/processCustomerSuccessDeliveries.test.ts).
 * This never touches Vercel/production configuration — only this Node
 * process's own env, restored immediately after each test.
 *
 * NO TEST IN THIS FILE REACHES A REAL EMAIL/SLACK PROVIDER — sendReminderEmail,
 * sendExpirySlack, and sendExpiryFounderEmail are always injected fakes.
 */

function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return fn().finally(() => {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  });
}

const VAR = "OPERATOR_ACTIVATION_REMINDERS_ENABLED";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const KELLY_DEADLINE = "2026-10-02T23:41:30.607Z";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STAGE_OFFSET_DAYS: Record<1 | 2 | 3, number> = { 1: 11, 2: 7, 3: 2 };

/**
 * selectCatchUpStage() re-derives everything from deadline_at — it never
 * trusts reminder_next_attempt_at for the actual stage decision (that field
 * only controls which rows the SQL query even looks at). This computes a
 * deadline_at that makes exactly `stage` due (roughly an hour ago) while
 * keeping the NEXT stage (if any) comfortably still in the future, so tests
 * can isolate "stage N is due" without a higher stage also qualifying.
 */
function deadlineMakingStageDue(now: Date, stage: 1 | 2 | 3): string {
  const dueAt = now.getTime() - 60 * 60 * 1000; // 1 hour ago
  return new Date(dueAt + STAGE_OFFSET_DAYS[stage] * MS_PER_DAY).toISOString();
}

function stubEmail(overrides?: Partial<{ ok: boolean; error: string }>) {
  const calls: unknown[] = [];
  const fn = async (params: unknown) => {
    calls.push(params);
    return overrides?.ok === false ? { ok: false, failedAt: "send" as const, error: overrides.error ?? "stub failure" } : { ok: true, providerMessageId: "stub-id" };
  };
  return { fn, calls };
}

function stubSlack(result: "delivered" | "no-webhook" | "failed" = "delivered") {
  const calls: unknown[] = [];
  const fn = async (params: unknown) => {
    calls.push(params);
    return result;
  };
  return { fn, calls };
}

function stubFounderEmail(ok = true) {
  const calls: unknown[] = [];
  const fn = async (params: unknown) => {
    calls.push(params);
    return { ok };
  };
  return { fn, calls };
}

function seedWorld(lifecycle: FakeLifecycleRow, opts?: { activated?: boolean; noOrigin?: boolean }) {
  const operators = [{ id: lifecycle.operator_id, email: "kelly@example.com", first_name: "Kelly", last_name: "Terris", account_activated_at: opts?.activated ? "2026-01-01T00:00:00.000Z" : null }];
  const submissions = opts?.noOrigin ? [] : [{ id: lifecycle.origin_submission_id ?? "sub-1", venue_id: "venue-1" }];
  const venues = opts?.noOrigin ? [] : [{ id: "venue-1", name: "Buffalo Rouge Brewing Co." }];
  return createFakeActivationReminderClient({ lifecycles: [lifecycle], operators, submissions, venues });
}

/**
 * A single already-expired, unactivated lifecycle with no expiry side
 * effects reconciled yet (expiry_slack_notified_at / expiry_founder_email_sent_at
 * both null) — the exact shape reconcileExpirySideEffects()'s query selects
 * (`.not("expired_at", "is", null)`, `.is("released_at", null)`), for either
 * origin type.
 */
function seedExpiredWorld(origin: "claim" | "submission", opts?: { activated?: boolean }) {
  const operatorId = "op-1";
  const lifecycle = makeLifecycleRow({
    id: "lc-expired",
    operator_id: operatorId,
    origin_type: origin,
    origin_claim_id: origin === "claim" ? "claim-1" : null,
    origin_submission_id: origin === "submission" ? "sub-1" : null,
    reminder_stage: 3,
    deadline_at: "2026-10-10T00:00:00.000Z",
    expired_at: "2026-10-10T00:00:00.500Z",
  });
  const operators = [{ id: operatorId, email: "kelly@example.com", first_name: "Kelly", last_name: "Terris", account_activated_at: opts?.activated ? "2026-01-01T00:00:00.000Z" : null }];
  const claims = origin === "claim" ? [{ id: "claim-1", venue_id: "venue-1" }] : [];
  const submissions = origin === "submission" ? [{ id: "sub-1", venue_id: "venue-1" }] : [];
  const venues = [{ id: "venue-1", name: "Buffalo Rouge Brewing Co." }];
  const fake = createFakeActivationReminderClient({ lifecycles: [lifecycle], operators, claims, submissions, venues });
  return { fake, lifecycle };
}

/** A dependency spy that throws immediately if invoked — used to prove a code path structurally cannot reach it, rather than merely asserting an empty call count after the fact. */
function throwingSpy(name: string) {
  return async (...args: unknown[]) => {
    throw new Error(`${name} must never be invoked in this code path — args: ${JSON.stringify(args)}`);
  };
}

// ── Kill switch ──────────────────────────────────────────────────────────────

test("kill switch disabled: returns immediately with zero I/O (no client method ever called)", async () => {
  let touched = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from() {
      touched = true;
      throw new Error("must never be called while disabled");
    },
  };
  const result = await withEnv(VAR, undefined, () => processActivationReminders({ adminClient: client }));
  assert.equal(result.enabled, false);
  assert.equal(touched, false);
});

test("kill switch: 'false'/'1'/'TRUE' all mean disabled", async () => {
  for (const value of ["false", "1", "TRUE"]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = { from: () => { throw new Error("must never be called"); } };
    const result = await withEnv(VAR, value, () => processActivationReminders({ adminClient: client }));
    assert.equal(result.enabled, false, `value "${value}" must be disabled`);
  }
});

// ── Lazy initialization ──────────────────────────────────────────────────────

test("lazy init: Kelly's exact row initializes to 2026-09-21T23:41:30.607Z and sends nothing before due", async () => {
  const lifecycle = makeLifecycleRow({
    id: "kelly-lc", operator_id: "op-kelly", origin_type: "submission", origin_submission_id: "sub-1",
    started_at: "2026-09-18T23:41:30.607Z", deadline_at: KELLY_DEADLINE, reminder_stage: 0, reminder_next_attempt_at: null,
  });
  const fake = seedWorld(lifecycle);
  const now = new Date("2026-09-19T12:00:00.000Z"); // "today"

  const result = await withEnv(VAR, "true", () =>
    processActivationReminders({ adminClient: fake.client, now })
  );

  assert.equal(result.lazilyInitialized, 1);
  assert.equal(fake.lifecycles[0].reminder_next_attempt_at, "2026-09-21T23:41:30.607Z");
  assert.equal(fake.lifecycles[0].reminder_stage, 0, "lazy init never touches reminder_stage");
  assert.equal(result.reminderSent, 0, "nothing is due yet");
});

test("lazy init: already-due initialization proceeds through at most one ordinary reminder in the SAME invocation", async () => {
  // deadline chosen so stage 1 is already overdue relative to `now`, while
  // stage 2 is comfortably still in the future — isolates "exactly stage 1
  // is due" the same way deadlineMakingStageDue() does everywhere else.
  const now = new Date("2026-09-30T00:00:00.000Z");
  const deadline = deadlineMakingStageDue(now, 1);
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadline, reminder_next_attempt_at: null,
  });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();

  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );

  assert.equal(result.lazilyInitialized, 1);
  assert.equal(email.calls.length, 1, "the newly-initialized, already-due row is processed in this same pass");
  assert.equal(result.reminderSent, 1);
  assert.equal(fake.lifecycles[0].reminder_stage, 1);
});

test("lazy init: stage 3 remains null (no further automatic reminders)", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 3, deadline_at: FAR_FUTURE, reminder_next_attempt_at: null });
  const fake = seedWorld(lifecycle);
  await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client }));
  assert.equal(fake.lifecycles[0].reminder_next_attempt_at, null);
});

test("lazy init never special-cases by id — an activated operator's row is never touched", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: FAR_FUTURE, reminder_next_attempt_at: null });
  const fake = seedWorld(lifecycle, { activated: true });
  const result = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client }));
  assert.equal(result.lazilyInitialized, 0);
  assert.equal(fake.lifecycles[0].reminder_next_attempt_at, null);
});

// ── Reminder behavior: stage success, catch-up, exclusions ─────────────────

test("stage 1/2/3 each send successfully and advance reminder_stage exactly to the sent stage", async () => {
  for (const stage of [0, 1, 2] as const) {
    const selectedStage = stage + 1;
    const now = new Date("2026-06-15T00:00:00.000Z");
    const lifecycle = makeLifecycleRow({
      id: `lc-${selectedStage}`, operator_id: `op-${selectedStage}`, reminder_stage: stage,
      deadline_at: deadlineMakingStageDue(now, selectedStage as 1 | 2 | 3), reminder_next_attempt_at: now.toISOString(),
    });
    const fake = seedWorld(lifecycle);
    const email = stubEmail();
    const result = await withEnv(VAR, "true", () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
    );
    assert.equal(result.reminderSent, 1, `stage ${selectedStage} should send`);
    assert.equal(fake.lifecycles[0].reminder_stage, selectedStage);
    assert.equal(fake.lifecycles[0].reminder_lease_stage, null);
    assert.equal(fake.lifecycles[0].reminder_lease_started_at, null);
    assert.equal(fake.operatorSubmissionNotes.length, 1);
    assert.equal(fake.operatorSubmissionNotes[0].event_type, "reminder_sent");
    assert.equal(fake.operatorSubmissionNotes[0].event_key, `hhc-activation-reminder:lc-${selectedStage}:${selectedStage}`);
  }
});

test("catch-up: multiple overdue stages send only the latest, never a burst", async () => {
  const now = new Date("2026-06-20T00:00:00.000Z");
  // deadline chosen so both stage 1 and stage 2 are overdue.
  const deadline = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadline, reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(email.calls.length, 1, "only one email is ever sent per pass");
  assert.equal(result.reminderSent, 1);
  assert.equal(fake.lifecycles[0].reminder_stage, 2, "stage 1 is silently resolved-as-superseded, never sent");
});

test("expiry precedence: deadline already passed means no reminder is sent, even if reminder_next_attempt_at is also due", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const pastDeadline = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: pastDeadline, reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(email.calls.length, 0);
  assert.equal(result.reminderSent, 0);
  assert.equal(result.expiryTransitioned, 1, "expiry wins and transitions instead");
});

test("activated operator is excluded from reminder processing — fresh check before lease claim", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle, { activated: true });
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(email.calls.length, 0);
  assert.equal(result.reminderSkippedActivated, 1);
});

test("released lifecycle is excluded from both reminder and expiry processing", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", reminder_stage: 0,
    deadline_at: new Date(now.getTime() - 1000).toISOString(),
    released_at: "2026-06-01T00:00:00.000Z",
    reminder_next_attempt_at: now.toISOString(),
  });
  const fake = seedWorld(lifecycle);
  const result = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.reminderSent, 0);
  assert.equal(result.expiryTransitioned, 0);
});

test("already-expired lifecycle is excluded from reminder processing", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", reminder_stage: 0,
    deadline_at: FAR_FUTURE,
    expired_at: "2026-06-01T00:00:00.000Z",
    reminder_next_attempt_at: now.toISOString(),
  });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(email.calls.length, 0);
  assert.equal(result.reminderSent, 0);
});

test("invalid/unresolvable origin linkage is excluded — no crash, no send, counted distinctly", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle, { noOrigin: true }); // submission/venue rows missing
  const result = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.reminderSkippedUnresolvedOrigin, 1);
  assert.equal(result.reminderSent, 0);
});

// ── Lease / concurrency ──────────────────────────────────────────────────────

test("exact lease CAS: pins lifecycle id, current reminder_stage, no existing lease, not expired, not released", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  // After a full successful cycle, the lease is claimed then cleared — the
  // guarded ack proves the claim itself happened with the right pinned stage.
  assert.equal(fake.lifecycles[0].reminder_stage, 1);
});

test("concurrent worker race: a lease already held by another worker is respected — no double-send", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString(),
    reminder_lease_stage: 1, reminder_lease_started_at: new Date(now.getTime() - 60_000).toISOString(), // another worker's fresh lease
  });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(email.calls.length, 0, "a lease already held by someone else must never be double-claimed");
  assert.equal(result.reminderSkippedRaced, 1);
});

test("final pre-send validation: an extension changing deadline_at between claim and send means nothing is sent", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  // Single-row world: the ONLY .select() on operator_activation_lifecycles
  // reached after the claim (an UPDATE, not a SELECT) is the pre-send
  // validation re-read. Simulate a concurrent extension landing right there.
  const fake = createFakeActivationReminderClient(
    {
      lifecycles: [lifecycle],
      operators: [{ id: "op-1", email: "kelly@example.com", first_name: "Kelly", last_name: "Terris", account_activated_at: null }],
      submissions: [{ id: "sub-1", venue_id: "venue-1" }],
      venues: [{ id: "venue-1", name: "V" }],
    },
    {
      onLifecycleSelect: (callIndex, rows) => {
        // calls: 1=lazy-init candidates, 2=expiry-due candidates,
        // 3=due-reminder candidates, 4=pre-send validation re-read.
        if (callIndex === 4) rows[0].deadline_at = "2030-01-01T00:00:00.000Z";
      },
    }
  );
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(email.calls.length, 0, "extension-versus-worker race must send nothing");
  assert.equal(result.reminderSkippedRaced, 1);
  assert.equal((fake.lifecycles[0] as unknown as { reminder_lease_started_at: string | null }).reminder_lease_started_at, null, "the worker's own lease is released");
});

test("stale lease recovery frees a lease older than 15 minutes and makes the row eligible again", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const staleLeaseStart = new Date(now.getTime() - 20 * 60_000).toISOString(); // 20 minutes ago
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString(),
    reminder_lease_stage: 1, reminder_lease_started_at: staleLeaseStart,
  });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(result.staleLeasesRecovered, 1);
  assert.equal(email.calls.length, 1, "a recovered row is eligible for safe retry in the SAME pass");
  assert.equal(result.reminderSent, 1);
});

test("a lease held for only 10 minutes is NOT recovered (under the 15-minute threshold)", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const freshLeaseStart = new Date(now.getTime() - 10 * 60_000).toISOString();
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: FAR_FUTURE, reminder_next_attempt_at: now.toISOString(),
    reminder_lease_stage: 1, reminder_lease_started_at: freshLeaseStart,
  });
  const fake = seedWorld(lifecycle);
  const result = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.staleLeasesRecovered, 0);
});

// ── Idempotency, note-before-ack, retries ───────────────────────────────────

test("deterministic provider idempotency: the same key is used for the same lifecycle+stage", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  let capturedKey: string | undefined;
  const sendReminderEmail = async (params: { lifecycleId: string; stage: number }) => {
    capturedKey = `hhc-activation-reminder:${params.lifecycleId}:${params.stage}`;
    return { ok: true, providerMessageId: "id-1" };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: sendReminderEmail as any }));
  assert.equal(capturedKey, "hhc-activation-reminder:lc-1:1");
});

test("note-before-ack ordering: reminder_stage only advances after the Internal Note write is attempted", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const order: string[] = [];
  const writeNote = async (params: { eventType: string }, client: unknown) => {
    order.push("note");
    const { writeActivationNote } = await import("../../../src/lib/activation/activationNotes");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return writeActivationNote(params as any, client as any);
  };
  await withEnv(VAR, "true", () =>
    processActivationReminders({
      adminClient: fake.client,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendReminderEmail: email.fn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeNote: writeNote as any,
    })
  );
  assert.equal(order[0], "note", "the note write must be attempted before the stage-advance ack");
  assert.equal(fake.lifecycles[0].reminder_stage, 1, "and the ack still succeeds normally afterward");
});

test("note 23505 (already exists) is treated as success — the stage still advances", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  // Pre-seed the note as if a prior crashed attempt already wrote it.
  fake.operatorSubmissionNotes.push({ id: "pre-existing", event_key: "hhc-activation-reminder:lc-1:1", event_type: "reminder_sent" });
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(result.reminderSent, 1, "23505 on the note must not block the acknowledgement");
  assert.equal(fake.lifecycles[0].reminder_stage, 1);
  assert.equal(fake.operatorSubmissionNotes.length, 1, "no duplicate note was created");
});

test("note-insert failure (a real error, not 23505) leaves the stage and lease untouched, safe for stale-lease retry", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const writeNote = async () => ({ ok: false, error: "simulated real DB error" });
  const result = await withEnv(VAR, "true", () =>
    processActivationReminders({
      adminClient: fake.client,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendReminderEmail: email.fn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeNote: writeNote as any,
    })
  );
  assert.equal(fake.lifecycles[0].reminder_stage, 0, "never advanced without the note");
  assert.notEqual(fake.lifecycles[0].reminder_lease_started_at, null, "lease stays held for stale-lease recovery to retry the whole sequence");
  assert.equal(result.reminderSent, 0);
});

test("acknowledgement zero-row match after provider success triggers a critical alert and leaves state untouched", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  // Force the ack CAS to fail post-note by mutating reminder_stage right
  // after the send (simulated via a note-writer side effect, since ack
  // happens immediately after the note in real code — this proxies "some
  // anomalous concurrent change" without needing a dedicated hook there).
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const realWriteNote = (await import("../../../src/lib/activation/activationNotes")).writeActivationNote;
  const writeNote = async (params: Parameters<typeof realWriteNote>[0], client: Parameters<typeof realWriteNote>[1]) => {
    const noteResult = await realWriteNote(params, client);
    // Simulate the anomaly: something else changed reminder_stage the
    // instant after the note landed, before our own ack CAS runs.
    fake.lifecycles[0].reminder_stage = 2;
    return noteResult;
  };
  const result = await withEnv(VAR, "true", () =>
    processActivationReminders({
      adminClient: fake.client,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendReminderEmail: email.fn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeNote: writeNote as any,
    })
  );
  assert.equal(result.reminderSent, 0, "the ack never completed");
  assert.equal(fake.lifecycles[0].reminder_stage, 2, "left exactly as the anomaly set it — never silently overwritten");
  assert.notEqual(fake.lifecycles[0].reminder_lease_started_at, null, "lease preserved for stale-lease recovery, not cleared blindly");
});

test("delivery failure: retries with backoff, incrementing attempt count, without falsely marking the stage delivered", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, reminder_attempt_count: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail({ ok: false, error: "Resend rejected" });
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(result.reminderFailedRetryable, 1);
  assert.equal(fake.lifecycles[0].reminder_stage, 0, "never falsely marked delivered");
  assert.equal(fake.lifecycles[0].reminder_attempt_count, 1);
  assert.equal(fake.lifecycles[0].reminder_lease_started_at, null);
  const expectedRetry = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  assert.equal(fake.lifecycles[0].reminder_next_attempt_at, expectedRetry);
  assert.equal(fake.operatorSubmissionNotes.some((n) => n.event_type === "reminder_delivery_failed"), true);
});

test("third-failure progression: after 3 failed attempts, schedules the NEXT stage's natural due time and resets attempt count", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const deadline = deadlineMakingStageDue(now, 1);
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, reminder_attempt_count: 2, deadline_at: deadline, reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail({ ok: false, error: "Resend rejected" });
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(result.reminderFailedExhausted, 1);
  assert.equal(fake.lifecycles[0].reminder_stage, 0, "still never falsely marked delivered");
  assert.equal(fake.lifecycles[0].reminder_attempt_count, 0, "fresh budget for the next stage");
  assert.equal(fake.lifecycles[0].reminder_next_attempt_at, computeStageDue(2, deadline));
});

test("stage-3 exhaustion: after 3 failed attempts at stage 3, reminder_next_attempt_at becomes null and the system waits for expiry", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 2, reminder_attempt_count: 2, deadline_at: deadlineMakingStageDue(now, 3), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail({ ok: false, error: "Resend rejected" });
  await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(fake.lifecycles[0].reminder_next_attempt_at, null);
  assert.equal(fake.lifecycles[0].reminder_stage, 2, "stage 3 was never falsely marked delivered");
});

test("a superseding stage correctly resolves an earlier exhausted stage without ever writing it a reminder_sent note", async () => {
  // Stage 1 exhausted, next_attempt scheduled for stage 2's natural due
  // time — which, by the time this pass runs, is ALSO already overdue.
  const now = new Date("2026-06-20T00:00:00.000Z");
  const deadline = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", reminder_stage: 0, reminder_attempt_count: 0,
    deadline_at: deadline, reminder_next_attempt_at: computeStageDue(2, deadline),
  });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const result = await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(result.reminderSent, 1);
  assert.equal(fake.lifecycles[0].reminder_stage, 2, "resolves directly to stage 2, superseding stage 1");
  const notes = fake.operatorSubmissionNotes.filter((n) => n.event_type === "reminder_sent");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].event_key, "hhc-activation-reminder:lc-1:2", "only stage 2's note exists — stage 1 was never delivered");
});

// ── Expiry behavior ──────────────────────────────────────────────────────────

test("expiry CAS fires exactly once — a second processing pass against an already-expired row does not re-transition it", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: new Date(now.getTime() - 1000).toISOString() });
  const fake = seedWorld(lifecycle);
  const result1 = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result1.expiryTransitioned, 1);
  const result2 = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result2.expiryTransitioned, 0, "already expired — never transitioned twice");
});

test("expiry never sets released_at, never mutates venue/operator relationship state", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: new Date(now.getTime() - 1000).toISOString() });
  const fake = seedWorld(lifecycle);
  await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(fake.lifecycles[0].expired_at, now.toISOString());
  assert.equal(fake.lifecycles[0].released_at, null);
  // No operator/venue/submission table was ever written to by this pass.
  assert.equal(fake.operators[0].account_activated_at, null);
});

test("expiry Internal Note reconciliation: retried until it exists, using event_key uniqueness", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 3, deadline_at: new Date(now.getTime() - 1000).toISOString(), expired_at: new Date(now.getTime() - 500).toISOString() });
  const fake = seedWorld(lifecycle);
  const result = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.expiryNotesWritten, 1);
  assert.equal(fake.operatorSubmissionNotes.filter((n) => n.event_type === "activation_expired").length, 1);
  assert.equal(
    fake.operatorSubmissionNotes.find((n) => n.event_type === "activation_expired")?.event_key,
    "hhc-activation-expiry:lc-1",
    "live mode must use the deterministic expiry event key"
  );

  // A second pass must not duplicate it.
  const result2 = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result2.expiryNotesWritten, 0, "already exists — 23505 tolerated, not re-counted as newly written");
  assert.equal(fake.operatorSubmissionNotes.filter((n) => n.event_type === "activation_expired").length, 1);
});

test("expiry Internal Note reconciliation (claim origin): live mode writes the note with the deterministic key and routes to venue_claim_notes, not operator_submission_notes", async () => {
  const { fake, lifecycle } = seedExpiredWorld("claim");
  const now = new Date("2026-10-11T00:00:00.000Z");
  const slack = stubSlack("delivered");
  const founderEmail = stubFounderEmail(true);
  const result = await withEnv(VAR, "true", () =>
    processActivationReminders({
      adminClient: fake.client,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpirySlack: slack.fn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpiryFounderEmail: founderEmail.fn as any,
    })
  );
  assert.equal(result.expiryNotesWritten, 1);
  assert.equal(fake.venueClaimNotes.length, 1);
  assert.equal(fake.operatorSubmissionNotes.length, 0, "claim origin must never write to operator_submission_notes");
  assert.equal(fake.venueClaimNotes[0].event_type, "activation_expired");
  assert.equal(fake.venueClaimNotes[0].event_key, `hhc-activation-expiry:${lifecycle.id}`);
  assert.equal(fake.venueClaimNotes[0].claim_id, "claim-1");

  // Idempotent retry: a second live pass must not duplicate the note.
  const result2 = await withEnv(VAR, "true", () =>
    processActivationReminders({
      adminClient: fake.client,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpirySlack: stubSlack("delivered").fn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpiryFounderEmail: stubFounderEmail(true).fn as any,
    })
  );
  assert.equal(result2.expiryNotesWritten, 0, "23505 tolerated on retry — not re-counted as newly written");
  assert.equal(fake.venueClaimNotes.length, 1, "no duplicate note");

  // The remaining expiry side effects (Slack, founder email) still proceed normally afterward.
  assert.equal(result.expirySlackSent, 1);
  assert.equal(result.expiryFounderEmailsSent, 1);
  assert.notEqual(fake.lifecycles[0].expiry_slack_notified_at, null);
  assert.notEqual(fake.lifecycles[0].expiry_founder_email_sent_at, null);
});

test("expiry Slack and founder email are independently retried — one succeeding does not block the other from retrying", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 3, deadline_at: new Date(now.getTime() - 1000).toISOString(), expired_at: new Date(now.getTime() - 500).toISOString() });
  const fake = seedWorld(lifecycle);
  const slack = stubSlack("failed");
  const founderEmail = stubFounderEmail(true);
  const result = await withEnv(VAR, "true", () =>
    processActivationReminders({
      adminClient: fake.client,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpirySlack: slack.fn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpiryFounderEmail: founderEmail.fn as any,
    })
  );
  assert.equal(result.expirySlackSent, 0, "Slack failed — marker not set");
  assert.equal(result.expiryFounderEmailsSent, 1, "founder email succeeded independently");
  assert.equal(fake.lifecycles[0].expiry_slack_notified_at, null);
  assert.notEqual(fake.lifecycles[0].expiry_founder_email_sent_at, null);

  // Next pass retries ONLY Slack.
  const founderEmail2 = stubFounderEmail(true);
  const slack2 = stubSlack("delivered");
  await withEnv(VAR, "true", () =>
    processActivationReminders({
      adminClient: fake.client,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpirySlack: slack2.fn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpiryFounderEmail: founderEmail2.fn as any,
    })
  );
  assert.equal(founderEmail2.calls.length, 0, "founder email already sent — never retried once its marker is set");
  assert.equal(slack2.calls.length, 1, "Slack retried since its marker was still null");
});

test("founder email idempotency: a real send always uses the deterministic key (proven at the notification-builder level, see activationExpiryNotifications.test.ts) — never a random one", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-42", operator_id: "op-1", reminder_stage: 3, deadline_at: new Date(now.getTime() - 1000).toISOString(), expired_at: new Date(now.getTime() - 500).toISOString() });
  const fake = seedWorld(lifecycle);
  let capturedLifecycleId: string | undefined;
  const founderEmail = async (params: { lifecycleId: string }) => {
    capturedLifecycleId = params.lifecycleId;
    return { ok: true };
  };
  await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendExpiryFounderEmail: founderEmail as any })
  );
  assert.equal(capturedLifecycleId, "lc-42");
});

test("possible Slack duplicate on ambiguous crash is documented and reflected in behavior: a successful Slack post with no marker recorded WILL be retried (at-least-once, not exactly-once)", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 3, deadline_at: new Date(now.getTime() - 1000).toISOString(), expired_at: new Date(now.getTime() - 500).toISOString() });
  const fake = seedWorld(lifecycle);
  // First pass: Slack "succeeds" but we simulate a crash before the marker
  // write by leaving expiry_slack_notified_at untouched ourselves (the
  // orchestrator's own marker-write is what would normally follow success —
  // here we prove the CONSEQENCE of that write not having happened).
  const slack1 = stubSlack("delivered");
  await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendExpirySlack: slack1.fn as any })
  );
  assert.equal(slack1.calls.length, 1);
  // Simulate "the marker write itself crashed" by resetting it back to null.
  fake.lifecycles[0].expiry_slack_notified_at = null;
  const slack2 = stubSlack("delivered");
  await withEnv(VAR, "true", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processActivationReminders({ adminClient: fake.client, now, sendExpirySlack: slack2.fn as any })
  );
  assert.equal(slack2.calls.length, 1, "a second Slack post occurs — this IS the documented at-least-once behavior, not a bug");
});

test("activation detected immediately before the expiry CAS cancels the expiry entirely", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: new Date(now.getTime() - 1000).toISOString() });
  const fake = seedWorld(lifecycle, { activated: true });
  const result = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.expiryTransitioned, 0);
  assert.equal(fake.lifecycles[0].expired_at, null);
});

test("activation detected immediately before Slack/founder-email cancels each notification independently", async () => {
  const now = new Date("2026-10-10T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 3, deadline_at: new Date(now.getTime() - 1000).toISOString(), expired_at: new Date(now.getTime() - 500).toISOString() });
  const fake = seedWorld(lifecycle, { activated: true });
  const slack = stubSlack("delivered");
  const founderEmail = stubFounderEmail(true);
  await withEnv(VAR, "true", () =>
    processActivationReminders({
      adminClient: fake.client,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpirySlack: slack.fn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpiryFounderEmail: founderEmail.fn as any,
    })
  );
  assert.equal(slack.calls.length, 0, "activated — Slack must never be sent");
  assert.equal(founderEmail.calls.length, 0, "activated — founder email must never be sent");
});

test("existing active precedence is preserved: an activated operator's lifecycle is never processed by any part of this worker", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: FAR_FUTURE, reminder_next_attempt_at: null });
  const fake = seedWorld(lifecycle, { activated: true });
  const result = await withEnv(VAR, "true", () => processActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.lazilyInitialized, 0);
  assert.equal(result.reminderSent, 0);
  assert.equal(result.expiryTransitioned, 0);
});

// ── Dry-run / read-only planning ─────────────────────────────────────────────
//
// planActivationReminders() is a SEPARATE exported function from the live
// processActivationReminders() — see that file's header. Every test below
// deliberately runs with the kill switch UNSET (withEnv(VAR, undefined, ...))
// to prove planning stays usable in that — the normal, expected — state,
// never relying on the switch being flipped on for a test to pass.

test("planning works while the persistent kill switch is unset — proves it never gates read-only planning", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const result = await withEnv(VAR, undefined, () => planActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.enabled, false, "the persistent switch really is unset — this is not accidentally testing the enabled path");
  assert.equal(result.dryRun, true);
  assert.ok(result.plannedActions.some((a) => a.type === "reminder_send" && a.lifecycleId === "lc-1"), "planning still read real data and produced a real decision");
});

test("dry-run: full decision reporting with ZERO writes and zero external calls", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const fake = seedWorld(lifecycle);
  const email = stubEmail();
  const originalSnapshot = { ...fake.lifecycles[0] };
  const result = await withEnv(VAR, undefined, () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    planActivationReminders({ adminClient: fake.client, now, sendReminderEmail: email.fn as any })
  );
  assert.equal(result.dryRun, true);
  assert.equal(email.calls.length, 0, "dry-run never calls the real send path");
  assert.deepEqual(fake.lifecycles[0], originalSnapshot, "dry-run writes nothing at all");
  assert.equal(fake.operatorSubmissionNotes.length, 0);
  assert.ok(result.plannedActions.some((a) => a.type === "reminder_send" && a.lifecycleId === "lc-1"));
});

test("dry-run never recovers/clears a stale lease", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const staleLeaseStart = new Date(now.getTime() - 20 * 60_000).toISOString();
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", reminder_stage: 0, deadline_at: FAR_FUTURE, reminder_next_attempt_at: now.toISOString(),
    reminder_lease_stage: 1, reminder_lease_started_at: staleLeaseStart,
  });
  const fake = seedWorld(lifecycle);
  const result = await withEnv(VAR, undefined, () => planActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.staleLeasesRecovered, 0);
  assert.equal(fake.lifecycles[0].reminder_lease_started_at, staleLeaseStart, "lease left completely untouched");
});

test("dry-run computes lazy-init decisions but persists nothing", async () => {
  const lifecycle = makeLifecycleRow({ id: "kelly-lc", operator_id: "op-kelly", deadline_at: KELLY_DEADLINE, reminder_stage: 0, reminder_next_attempt_at: null });
  const fake = seedWorld(lifecycle);
  const now = new Date("2026-09-19T12:00:00.000Z");
  const result = await withEnv(VAR, undefined, () => planActivationReminders({ adminClient: fake.client, now }));
  assert.equal(result.lazilyInitialized, 1);
  assert.equal(fake.lifecycles[0].reminder_next_attempt_at, null, "nothing is actually persisted in dry-run");
  assert.ok(result.plannedActions.some((a) => a.type === "lazy_init" && a.lifecycleId === "kelly-lc"));
});

// ── Expiry reconciliation under dry-run: the exact bug class this hotfix
// closes (reconcileOneExpiredLifecycle() previously called writeNote()
// unconditionally, before checking dryRun) ──────────────────────────────────

for (const origin of ["claim", "submission"] as const) {
  test(`dry-run expiry reconciliation (${origin} origin): reports planned expiry_note/expiry_slack/expiry_founder_email without invoking any mutating dependency or changing the row`, async () => {
    const { fake, lifecycle } = seedExpiredWorld(origin);
    const originalSnapshot = { ...fake.lifecycles[0] };
    const now = new Date("2026-10-11T00:00:00.000Z");

    // Every externally-mutating dependency this pass could reach is a
    // throwing spy — the test fails immediately (not just via a trailing
    // assertion) the instant planning calls any of them for real.
    const writeNote = throwingSpy("writeNote");
    const sendExpirySlack = throwingSpy("sendExpirySlack");
    const sendExpiryFounderEmail = throwingSpy("sendExpiryFounderEmail");
    const sendReminderEmail = throwingSpy("sendReminderEmail");

    const result = await withEnv(VAR, undefined, () =>
      planActivationReminders({
        adminClient: fake.client,
        now,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        writeNote: writeNote as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendExpirySlack: sendExpirySlack as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendExpiryFounderEmail: sendExpiryFounderEmail as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendReminderEmail: sendReminderEmail as any,
      })
    );

    assert.equal(result.dryRun, true);
    assert.ok(result.plannedActions.some((a) => a.type === "expiry_note" && a.lifecycleId === lifecycle.id), "must report the planned expiry_note action");
    assert.ok(result.plannedActions.some((a) => a.type === "expiry_slack" && a.lifecycleId === lifecycle.id), "must report the planned expiry_slack action");
    assert.ok(result.plannedActions.some((a) => a.type === "expiry_founder_email" && a.lifecycleId === lifecycle.id), "must report the planned expiry_founder_email action");

    assert.deepEqual(fake.lifecycles[0], originalSnapshot, "the expired lifecycle row must be left byte-for-byte unchanged by planning");
    assert.equal(fake.venueClaimNotes.length, 0, "no Claim note was ever inserted");
    assert.equal(fake.operatorSubmissionNotes.length, 0, "no Submission note was ever inserted");
    assert.equal(result.expiryNotesWritten, 0);
    assert.equal(result.expirySlackSent, 0);
    assert.equal(result.expiryFounderEmailsSent, 0);
  });
}

test("planning cannot mutate even if the underlying client would happily accept a mutation — no update()/insert() is ever invoked, across a reminder-due candidate AND an already-expired candidate in the same pass", async () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const reminderDue = makeLifecycleRow({ id: "lc-reminder-due", operator_id: "op-1", reminder_stage: 0, deadline_at: deadlineMakingStageDue(now, 1), reminder_next_attempt_at: now.toISOString() });
  const expired = makeLifecycleRow({
    id: "lc-expired", operator_id: "op-2", origin_submission_id: "sub-2", reminder_stage: 3,
    deadline_at: "2026-06-01T00:00:00.000Z", expired_at: "2026-06-01T00:00:00.500Z",
  });
  const operators = [
    { id: "op-1", email: "kelly@example.com", first_name: "Kelly", last_name: "Terris", account_activated_at: null },
    { id: "op-2", email: "jamie@example.com", first_name: "Jamie", last_name: "Lee", account_activated_at: null },
  ];
  const submissions = [
    { id: "sub-1", venue_id: "venue-1" },
    { id: "sub-2", venue_id: "venue-2" },
  ];
  const venues = [
    { id: "venue-1", name: "Buffalo Rouge Brewing Co." },
    { id: "venue-2", name: "Second Venue" },
  ];
  const fake = createFakeActivationReminderClient({ lifecycles: [reminderDue, expired], operators, submissions, venues });

  const mutationCalls: { table: string; method: string }[] = [];
  const spiedClient = {
    from(table: string) {
      const real = fake.client.from(table);
      return {
        ...real,
        update: (...args: unknown[]) => {
          mutationCalls.push({ table, method: "update" });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (real as any).update(...args);
        },
        insert: (...args: unknown[]) => {
          mutationCalls.push({ table, method: "insert" });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (real as any).insert(...args);
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  // Every externally-mutating dependency the orchestrator can be handed is a
  // throwing spy — safety here must never depend on absent env vars or
  // missing credentials, only on planning's own structural gating.
  const sendReminderEmail = throwingSpy("sendReminderEmail");
  const writeNote = throwingSpy("writeNote");
  const sendExpirySlack = throwingSpy("sendExpirySlack");
  const sendExpiryFounderEmail = throwingSpy("sendExpiryFounderEmail");

  const result = await withEnv(VAR, undefined, () =>
    planActivationReminders({
      adminClient: spiedClient,
      now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendReminderEmail: sendReminderEmail as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeNote: writeNote as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpirySlack: sendExpirySlack as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendExpiryFounderEmail: sendExpiryFounderEmail as any,
    })
  );

  assert.deepEqual(mutationCalls, [], "planning must never call update() or insert() on any table, even when both a reminder-due and an already-expired candidate exist");
  assert.ok(result.plannedActions.some((a) => a.type === "reminder_send" && a.lifecycleId === "lc-reminder-due"));
  assert.ok(result.plannedActions.some((a) => a.type === "expiry_note" && a.lifecycleId === "lc-expired"));
  assert.ok(result.plannedActions.some((a) => a.type === "expiry_slack" && a.lifecycleId === "lc-expired"));
  assert.ok(result.plannedActions.some((a) => a.type === "expiry_founder_email" && a.lifecycleId === "lc-expired"));
});
