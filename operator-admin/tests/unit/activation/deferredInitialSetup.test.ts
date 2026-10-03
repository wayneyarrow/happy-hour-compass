/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Resend } from "resend";
import {
  DEFERRED_INITIAL_SETUP_MAX_ATTEMPTS,
  DEFERRED_INITIAL_SETUP_START_BUDGET_MS,
  createQueuedSetupEmailSender,
  processDeferredInitialSetupEmails,
  type QueuedSetupLifecycle,
} from "../../../src/lib/activation/deferredInitialSetup";
import { processActivationReminders, planActivationReminders } from "../../../src/lib/activation/processActivationReminders";
import { createSetupContactCoordinator } from "../../../src/lib/activation/setupContactStore";
import { SETUP_CONTACT_CLAIM_TTL_MS } from "../../../src/lib/activation/setupContactPolicy";
import { createFakeOperatorsContactClient, makeOperatorContactRow } from "./support/fakeOperatorsContactClient";
import { createMemoryDeferredSetupStore } from "./support/memoryDeferredSetupStore";
import { createFakeActivationReminderClient } from "./support/fakeActivationReminderClient";

/**
 * The hourly worker that sends queued initial setup emails (migration 105)
 * under the operator's contact claim. Decisions use CONFIRMED delivery
 * evidence (last_setup_email_accepted_at), never the pre-send contact stamp.
 */

const NOW = new Date("2026-10-05T22:00:00.000Z");
const MIN = 60_000;
const H = 60 * MIN;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const QUEUED_AT = at(-30 * MIN).toISOString();
const LEGACY: QueuedSetupLifecycle = { id: "7f2c1a52-3a2e-4c1b-9a51-0d6f3c2b1e44", originType: "claim", originClaimId: "claim-1", originSubmissionId: null, verificationRequired: false };

type SendFn = (p: any, ctx: { row: any; attemptStart: Date }) => Promise<{ ok: boolean; error?: string; deliveryUncertain?: boolean }>;

/** What sendTransactionalEmail does on acceptance: stamp confirmed evidence with the attempt's START time. */
const accept: SendFn = async (_p, { row, attemptStart }) => {
  row.last_setup_email_accepted_at = attemptStart.toISOString();
  return { ok: true };
};

function world(overrides: Record<string, unknown>[] = [{}], lifecycle: QueuedSetupLifecycle | null = LEGACY) {
  const ops = createFakeOperatorsContactClient(
    overrides.map((o, i) =>
      makeOperatorContactRow({
        id: `op-${i + 1}`,
        email: `gm${i + 1}@venue.example`,
        initial_setup_deferred_at: QUEUED_AT,
        initial_setup_deferred_attempts: 0,
        first_name: "Jeremy",
        ...o,
      } as any)
    ),
    { postgrestTimestamps: true }
  );
  const coordinator = createSetupContactCoordinator(ops.client);
  const { store, lifecycles } = createMemoryDeferredSetupStore(ops.rows as never);
  if (lifecycle) ops.rows.forEach((r) => lifecycles.set(r.id, { ...lifecycle }));
  const sends: any[] = [];
  const notes: any[] = [];
  const alerts: any[] = [];
  let sendImpl: SendFn = accept;
  let clockNow = NOW;
  const row = (i = 0) => ops.rows[i] as any;
  const deps = (now: Date, extra: Record<string, unknown> = {}) => ({
    store,
    coordinator,
    clock: () => clockNow,
    sendEmail: (p: any) => {
      const r = ops.rows.find((x) => x.email === p.to) as any;
      sends.push({ ...p, claimKind: r.setup_contact_claim_kind, marker: r.initial_setup_deferred_attempt_started_at });
      return sendImpl(p, { row: r, attemptStart: clockNow });
    },
    writeNote: (async (n: any) => { notes.push(n); return { ok: true }; }) as any,
    sendAlert: (async (a: any) => { alerts.push(a); return "delivered"; }) as any,
    ...extra,
  });
  return {
    ops,
    row,
    coordinator,
    sends,
    notes,
    alerts,
    setSend: (fn: SendFn) => { sendImpl = fn; },
    setClock: (d: Date) => { clockNow = d; },
    run: (now = NOW, extra: Record<string, unknown> = {}) => {
      clockNow = now;
      return processDeferredInitialSetupEmails(null as never, now, deps(now, extra));
    },
  };
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 2));
  assert.ok(cond(), "condition reached");
}

test("a queued email is sent under the operator's claim, with evidence first; the entry is cleared and a timeline note written", async () => {
  const w = world();
  const r = await w.run();
  assert.equal(r.sent, 1);
  assert.equal(w.sends[0].claimKind, "initial_setup");
  assert.ok(w.sends[0].marker, "the attempt is marked before the provider call");
  assert.deepEqual(w.sends[0].lifecycle, LEGACY);
  assert.equal(w.sends[0].firstName, "Jeremy");
  assert.equal(w.row().initial_setup_deferred_at, null);
  assert.equal(w.row().initial_setup_deferred_attempt_started_at, null);
  assert.equal(w.row().last_setup_contact_kind, "setup_email");
  assert.equal(w.row().setup_contact_claimed_at, null, "released after evidence");
  assert.equal(w.notes[0].eventType, "queued_setup_email_sent");
  assert.deepEqual(w.notes[0].origin, { type: "claim", claimId: "claim-1" });
  assert.doesNotMatch(JSON.stringify(w.notes), /token|create-password/);
  assert.equal((await w.run(at(H))).sent, 0, "sent once, never twice");
});

test("another email still holds the claim: nothing is sent; the entry waits until the claim is released or its 6-minute lifetime ends", async () => {
  const w = world([{ setup_contact_claimed_at: at(-MIN).toISOString(), setup_contact_claim_kind: "milestone" }]);
  assert.equal((await w.run()).busy, 1);
  assert.equal(w.sends.length, 0);
  assert.equal(w.row().initial_setup_deferred_attempt_started_at ?? null, null, "no attempt marked while busy");
  assert.equal((await w.run(at(-MIN + SETUP_CONTACT_CLAIM_TTL_MS - 1000))).busy, 1);
  assert.equal((await w.run(at(-MIN + SETUP_CONTACT_CLAIM_TTL_MS + 1000))).sent, 1);
});

test("no longer needed only on CONFIRMED evidence: activation, or a setup email the provider accepted that started after the request", async () => {
  const activated = world([{ account_activated_at: at(-10 * MIN).toISOString() }]);
  assert.equal((await activated.run()).cleared, 1);
  assert.equal(activated.sends.length, 0);

  const accepted = world([{ last_setup_email_accepted_at: at(-10 * MIN).toISOString() }]);
  await accepted.run();
  assert.equal(accepted.sends.length, 0);
  assert.equal(accepted.row().initial_setup_deferred_at, null);

  const acceptedBefore = world([{ last_setup_email_accepted_at: at(-3 * H).toISOString() }]);
  await acceptedBefore.run();
  assert.equal(acceptedBefore.sends.length, 1, "an email accepted BEFORE the request doesn't answer it");
});

test("REGRESSION — another setup attempt records (pre-send) evidence but fails: the queued email is still sent", async () => {
  // e.g. a founder Resend after the request: its contact is stamped BEFORE the
  // provider call, then the provider rejects (or never answers clearly).
  for (const later of [{ last_setup_contact_at: at(-10 * MIN).toISOString(), last_setup_contact_kind: "founder_resend" }, { last_setup_contact_at: at(-5 * MIN).toISOString(), last_setup_contact_kind: "unconfirmed_setup_contact" }]) {
    const w = world([later]);
    const r = await w.run();
    assert.equal(r.sent, 1, `${later.last_setup_contact_kind}: attempted ≠ delivered`);
    assert.equal(w.row().initial_setup_deferred_at, null);
  }
});

test("no live activation window: nothing sent, entry cleared, one #ops-critical alert", async () => {
  const w = world([{}], null);
  await w.run();
  assert.equal(w.sends.length, 0);
  assert.equal(w.row().initial_setup_deferred_at, null);
  assert.equal(w.alerts.length, 1);
  assert.equal(w.alerts[0].channel, "ops-critical");
});

test("definite rejection: retried on later passes (its own pre-send evidence never counts), then given up with an alert", async () => {
  const w = world();
  w.setSend(async () => ({ ok: false, error: "validation_error", deliveryUncertain: false }));
  for (let i = 1; i < DEFERRED_INITIAL_SETUP_MAX_ATTEMPTS; i++) {
    await w.run(at(i * H));
    assert.equal(w.row().initial_setup_deferred_attempts, i);
    assert.ok(w.row().initial_setup_deferred_at, "still queued");
    assert.equal(w.row().initial_setup_deferred_attempt_started_at, null, "outcome recorded — marker cleared");
  }
  await w.run(at(10 * H));
  assert.equal(w.row().initial_setup_deferred_at, null);
  assert.equal(w.alerts.length, 1);
  assert.equal(w.sends.length, DEFERRED_INITIAL_SETUP_MAX_ATTEMPTS);
});

test("uncertain provider outcome: never retried — cleared, 'unconfirmed' note, alert", async () => {
  const w = world();
  w.setSend(async () => ({ ok: false, error: "fetch failed" })); // no deliveryUncertain:false ⇒ uncertain
  const r = await w.run();
  assert.equal(r.unconfirmed, 1);
  assert.equal(w.row().initial_setup_deferred_at, null);
  assert.equal(w.notes[0].eventType, "queued_setup_email_unconfirmed");
  assert.equal(w.alerts.length, 1);
  await w.run(at(H));
  assert.equal(w.sends.length, 1, "no second attempt");
});

test("REGRESSION — provider accepts, then the invocation dies before the queue is cleared: the next pass confirms it and never sends again", async () => {
  const w = world();
  // Accepted (evidence written, as sendTransactionalEmail does), then the
  // process is killed: nothing after the provider call runs, the claim isn't released.
  w.setSend(async (_p, ctx) => {
    await accept(_p, ctx);
    return new Promise(() => {});
  });
  void w.run();
  await until(() => w.sends.length === 1);
  assert.ok(w.row().initial_setup_deferred_attempt_started_at, "interrupted attempt is still marked");
  assert.ok(w.row().initial_setup_deferred_at, "queue not cleared");

  w.setSend(accept);
  assert.equal((await w.run(at(2 * MIN))).busy, 1, "the dead pass's claim is respected until its lifetime ends");
  const r = await w.run(at(H));
  assert.equal(w.sends.length, 1, "never sent a second time");
  assert.equal(r.cleared, 1);
  assert.equal(w.row().initial_setup_deferred_at, null);
  assert.equal(w.row().initial_setup_deferred_attempt_started_at, null);
  assert.equal(w.notes.at(-1).eventType, "queued_setup_email_sent");
  assert.match(w.notes.at(-1).note, /confirmed by the email provider after the sending pass was interrupted/);
  assert.ok(w.row().last_setup_contact_at, "the dead pass's contact stays on record (pre-send evidence, protecting milestone spacing)");
});

test("REGRESSION — the 60-second cron deadline: no new send starts after the start budget, and a send cut off mid-flight is never resent blindly", async () => {
  // (a) Budget: two queued operators; the first send takes the pass past its start budget.
  const two = world([{}, {}]);
  const stop = NOW.getTime() + DEFERRED_INITIAL_SETUP_START_BUDGET_MS;
  two.setSend(async (p, ctx) => {
    const r = await accept(p, ctx);
    two.setClock(new Date(stop + 1000)); // the first send ran long
    return r;
  });
  const r = await two.run(NOW, { stopStartingAtMs: stop });
  assert.equal(r.sent, 1);
  assert.equal(r.leftForNextPass, 1);
  assert.equal(two.row(1).initial_setup_deferred_attempt_started_at ?? null, null, "the second was never started");
  assert.ok(two.row(1).initial_setup_deferred_at, "…and stays queued");
  two.setSend(accept);
  assert.equal((await two.run(at(H), { stopStartingAtMs: at(H).getTime() + DEFERRED_INITIAL_SETUP_START_BUDGET_MS })).sent, 1, "sent on the next pass");

  // (b) The invocation is killed at 60 s mid-send, before the provider answered: outcome unknown.
  const cut = world();
  cut.setSend(() => new Promise(() => {}));
  void cut.run();
  await until(() => cut.sends.length === 1);
  cut.setSend(accept);
  const next = await cut.run(at(H));
  assert.equal(cut.sends.length, 1, "not resent — it may have been accepted");
  assert.equal(next.unconfirmed, 1);
  assert.equal(cut.row().initial_setup_deferred_at, null);
  assert.equal(cut.notes.at(-1).eventType, "queued_setup_email_unconfirmed");
  assert.equal(cut.alerts.length, 1);
});

test("REGRESSION — a newer queue request arriving while an older one is being sent survives, and gets its own email", async () => {
  const w = world();
  const newer = at(-1 * MIN).toISOString(); // after the request being sent, before the send finished
  w.setSend(async (p, ctx) => {
    // A new approval for the same operator found the claim busy (this worker holds it) and queued again.
    assert.equal(await w.coordinator.deferInitialSetup("op-1", new Date(newer)), true);
    // An even older request never moves the entry back.
    assert.equal(await w.coordinator.deferInitialSetup("op-1", new Date(QUEUED_AT)), true);
    return accept(p, { ...ctx, attemptStart: new Date(ctx.attemptStart.getTime() - 5 * MIN) }); // this email STARTED before the newer request
  });
  w.setClock(at(-6 * MIN));
  const first = await w.run(at(-6 * MIN));
  assert.equal(first.sent, 1);
  assert.equal(new Date(w.row().initial_setup_deferred_at).toISOString(), newer, "the newer request is still queued");
  assert.equal(w.row().initial_setup_deferred_attempt_started_at, null, "only the finished attempt's marker was cleared");
  w.setSend(accept);
  const second = await w.run(at(H));
  assert.equal(second.sent, 1, "the newer request is answered by its own email");
  assert.equal(w.sends.length, 2);
  assert.equal(w.row().initial_setup_deferred_at, null);
});

test("an interrupted attempt for an OLDER request doesn't block a newer one", async () => {
  const w = world([{ initial_setup_deferred_at: at(-10 * MIN).toISOString(), initial_setup_deferred_attempt_started_at: at(-20 * MIN).toISOString() }]);
  const r = await w.run();
  assert.equal(r.sent, 1);
  assert.equal(w.row().initial_setup_deferred_at, null);
});

// ── The email itself ─────────────────────────────────────────────────────────

async function withFakeResend(fn: (sent: any[]) => Promise<void>) {
  const proto = Object.getPrototypeOf(new Resend("re_test_only").emails);
  const original = proto.send;
  const sent: any[] = [];
  proto.send = async (payload: any) => {
    sent.push(payload);
    return { data: { id: "re_x" }, error: null };
  };
  const keys = ["RESEND_API_KEY", "EMAIL_OPEN_TRACKING_ENABLED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "OPERATOR_VERIFICATION_CODE_HMAC_SECRET", "NEXT_PUBLIC_SITE_URL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET = "x".repeat(40);
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example.test";
  for (const k of ["EMAIL_OPEN_TRACKING_ENABLED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) delete process.env[k];
  const log = console.log;
  console.log = () => {};
  try {
    await fn(sent);
  } finally {
    console.log = log;
    proto.send = original;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the queued email matches the immediate one: continue-setup for an email-code lifecycle; a fresh setup link with the origin's template otherwise", async () => {
  await withFakeResend(async (sent) => {
    const links: any[] = [];
    const admin = { auth: { admin: { generateLink: async (p: any) => { links.push(p); return { data: { properties: { action_link: "https://proj.supabase.co/auth/v1/verify?x" } }, error: null }; } } } } as any;
    const send = createQueuedSetupEmailSender(admin);

    assert.equal((await send({ lifecycle: { ...LEGACY, verificationRequired: true }, to: "gm@venue.example", firstName: "Jeremy" })).ok, true);
    assert.equal(links.length, 0, "no Supabase link for an email-code lifecycle");
    assert.match(sent[0].html, /\/operator\/verify\?t=/);

    assert.equal((await send({ lifecycle: LEGACY, to: "gm@venue.example", firstName: "Jeremy" })).ok, true);
    assert.equal(links[0].type, "recovery");
    assert.equal(links[0].options.redirectTo, "https://staging.example.test/operator/create-password");
    assert.match(sent[1].subject, /claim/i);

    await send({ lifecycle: { ...LEGACY, originType: "submission", originClaimId: null, originSubmissionId: "sub-1" }, to: "gm@venue.example", firstName: "Jeremy" });
    assert.notEqual(sent[2].subject, sent[1].subject, "submission template");
  });
});

// ── Wiring into the hourly worker ────────────────────────────────────────────

test("the hourly worker runs queued delivery on live passes only, with a start budget inside the cron's 60 s — never in planning (dry-run) mode", async () => {
  const calls: { now: Date; stopStartingAtMs: number }[] = [];
  const fake = createFakeActivationReminderClient({ lifecycles: [], operators: [], claims: [], venues: [] } as any);
  const deps = {
    adminClient: fake.client,
    now: NOW,
    processDeferredInitialSetup: async (_a: unknown, n: Date, o: { stopStartingAtMs: number }) => {
      calls.push({ now: n, ...o });
      return { sent: 0, cleared: 0, busy: 0, unconfirmed: 0, failed: 0, leftForNextPass: 0, errors: [] };
    },
  };
  const prior = process.env.OPERATOR_ACTIVATION_REMINDERS_ENABLED;
  process.env.OPERATOR_ACTIVATION_REMINDERS_ENABLED = "true";
  try {
    const before = Date.now();
    const live = await processActivationReminders(deps);
    assert.equal(calls.length, 1);
    assert.ok(live.deferredInitialSetup);
    assert.ok(calls[0].stopStartingAtMs >= before + DEFERRED_INITIAL_SETUP_START_BUDGET_MS && calls[0].stopStartingAtMs <= Date.now() + DEFERRED_INITIAL_SETUP_START_BUDGET_MS);
    assert.ok(DEFERRED_INITIAL_SETUP_START_BUDGET_MS <= 30_000, "leaves at least half of the 60 s cron limit for the last send");
    await planActivationReminders(deps);
    assert.equal(calls.length, 1, "planning never sends");
  } finally {
    if (prior === undefined) delete process.env.OPERATOR_ACTIVATION_REMINDERS_ENABLED;
    else process.env.OPERATOR_ACTIVATION_REMINDERS_ENABLED = prior;
  }
});
