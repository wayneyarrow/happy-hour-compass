/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Resend } from "resend";
import { processActivationReminders } from "../../../src/lib/activation/processActivationReminders";
import { processCustomerSuccessDeliveries } from "../../../src/lib/customerSuccess/processCustomerSuccessDeliveries";
import { sendFinalSetupEmailImpl, generateFinalSetupLinkImpl } from "../../../src/lib/activation/finalSetupFollowUpImpl";
import { releaseActivationLifecycleImpl } from "../../../src/lib/activation/activationReleaseImpl";
import { createSetupContactCoordinator } from "../../../src/lib/activation/setupContactStore";
import { SETUP_CONTACT_CLAIM_TTL_MS } from "../../../src/lib/activation/setupContactPolicy";
import { createFakeActivationReminderClient, makeLifecycleRow } from "./support/fakeActivationReminderClient";
import { createFakeOperatorsContactClient, makeOperatorContactRow } from "./support/fakeOperatorsContactClient";
import { createFakeDeliveryClient, makeFakeCsEventRow } from "../customerSuccess/support/fakeDeliveryClient";
import { createFakeActivationReleaseClient, makeLifecycleRow as makeReleaseLifecycle } from "./support/fakeActivationReleaseClient";

/**
 * Setup-contact coordination across actors that share one operator:
 * milestone worker, reminder worker, founder Final resend / Copy, Release.
 * All share one contact coordinator (the real store over a fake operators
 * table, PostgREST timestamp format).
 */

const NOW = new Date("2026-10-05T22:00:00.000Z");
const H = 3600_000;

function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prior = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function contactStore() {
  const ops = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-1", email: "gm@venue.example" })], { postgrestTimestamps: true });
  return { ops, coordinator: createSetupContactCoordinator(ops.client, { clock: () => new Date(0) }) };
}

function milestoneWorld() {
  return createFakeDeliveryClient({
    venues: [{ id: "v-1", is_published: true, is_verified: true, created_by_operator_id: "op-1", market_id: "market-1", name: "Venue" }],
    markets: [{ id: "market-1", slug: "central-okanagan" }],
    memberships: [{ id: "m-1", operator_id: "op-1", role: "owner", email: "gm@venue.example", full_name: "Jeremy", status: "active" }],
    csBaselines: [{ id: "b-1", venue_id: "v-1", event_type: "venue_view_milestone", metric_value_at_baseline: 0 }],
    viewCounts: new Map([["v-1", 50]]),
    csEvents: [makeFakeCsEventRow({ id: "ev-1", venue_id: "v-1", operator_id: "op-1", milestone_value: 50, communication_status: "pending", next_attempt_at: new Date(NOW.getTime() - 60_000).toISOString() })],
  });
}

function runMilestones(delivery: ReturnType<typeof milestoneWorld>, coordinator: any, now: Date, sendEmail: any) {
  return withEnv({ CUSTOMER_SUCCESS_EMAILS_ENABLED: "true" }, () =>
    processCustomerSuccessDeliveries(delivery.client as never, now, sendEmail, { coordinator, coordinationEnabled: true })
  );
}

/** Stage 3 due an hour ago; deadline 4 days out (so spacing defers rather than skips). */
function reminderWorld() {
  return createFakeActivationReminderClient({
    lifecycles: [
      makeLifecycleRow({
        id: "lc-1",
        operator_id: "op-1",
        origin_submission_id: "sub-1",
        reminder_stage: 2,
        deadline_at: new Date(NOW.getTime() + 47 * H + 3 * 24 * H).toISOString(),
        reminder_next_attempt_at: new Date(NOW.getTime() - H).toISOString(),
      }),
    ],
    operators: [{ id: "op-1", email: "gm@venue.example", first_name: "Jeremy", last_name: null, account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "v-1" }],
    venues: [{ id: "v-1", name: "Venue", created_by_operator_id: "op-1" }],
  });
}

function reminderSpy() {
  const calls: any[] = [];
  return { calls, fn: (async (p: any) => { calls.push(p); return { ok: true, providerMessageId: "re-r" }; }) as any };
}

function runReminders(reminders: ReturnType<typeof reminderWorld>, coordinator: any, now: Date, sendReminderEmail: any) {
  // stage 2 → stage 3 isn't due yet for a 4-day deadline; force stage 3 due by placing it at stage 2 with deadline - 2d <= now
  return withEnv({ OPERATOR_ACTIVATION_REMINDERS_ENABLED: "true" }, () =>
    processActivationReminders({ adminClient: reminders.client, now, sendReminderEmail, coordinator, coordinationEnabled: true })
  );
}

// ── Ambiguous milestone outcomes vs. a later reminder ───────────────────────

test("provider timeout, then a reminder 10 minutes later (claim long expired, < 48 h): the reminder is deferred, not sent", async () => {
  const { ops, coordinator } = contactStore();
  const delivery = milestoneWorld();
  await runMilestones(delivery, coordinator, NOW, async () => ({ ok: false, error: "fetch failed", deliveryUncertain: true }));
  assert.equal(ops.rows[0].last_milestone_contact_status, "unconfirmed");

  const reminders = reminderWorld();
  reminders.lifecycles[0].deadline_at = new Date(NOW.getTime() + 4 * 24 * H).toISOString();
  reminders.lifecycles[0].reminder_stage = 1; // stage 2 due at deadline − 7 d → already due
  const later = new Date(NOW.getTime() + SETUP_CONTACT_CLAIM_TTL_MS + 4 * 60_000);
  const spy = reminderSpy();
  const r = await runReminders(reminders, coordinator, later, spy.fn);
  assert.equal(spy.calls.length, 0, "a possible milestone protects the full 48 h");
  assert.equal(r.reminderDeferredForMilestone, 1);
  assert.equal(reminders.lifecycles[0].reminder_next_attempt_at, new Date(NOW.getTime() + 48 * H).toISOString());
});

test("crash after possible provider acceptance, before anything is recorded: the claim survives, is folded in as an unconfirmed milestone, and the reminder is deferred", async () => {
  const { ops, coordinator } = contactStore();
  const delivery = milestoneWorld();
  const result = await runMilestones(delivery, coordinator, NOW, async () => {
    throw new Error("process killed after the provider accepted");
  });
  assert.equal(result.errors.length, 1);
  assert.notEqual(ops.rows[0].setup_contact_claimed_at, null, "claim left in place — never released without evidence");
  assert.equal(ops.rows[0].last_milestone_contact_at, null, "nothing recorded as sent");

  const reminders = reminderWorld();
  reminders.lifecycles[0].deadline_at = new Date(NOW.getTime() + 4 * 24 * H).toISOString();
  reminders.lifecycles[0].reminder_stage = 1;
  const later = new Date(NOW.getTime() + SETUP_CONTACT_CLAIM_TTL_MS + 60_000);
  const spy = reminderSpy();
  const r = await runReminders(reminders, coordinator, later, spy.fn);
  assert.equal(spy.calls.length, 0);
  assert.equal(r.reminderDeferredForMilestone, 1);
  assert.equal(ops.rows[0].last_milestone_contact_status, "unconfirmed", "folded as unconfirmed, not accepted");
  assert.equal(new Date(ops.rows[0].last_milestone_contact_at!).getTime(), NOW.getTime());
});

test("definite rejection, then a reminder minutes later: the reminder is sent (a rejected milestone never holds it back)", async () => {
  const { ops, coordinator } = contactStore();
  await runMilestones(milestoneWorld(), coordinator, NOW, async () => ({ ok: false, error: "invalid from", deliveryUncertain: false }));
  assert.equal(ops.rows[0].last_milestone_contact_at, null);
  const reminders = reminderWorld();
  reminders.lifecycles[0].deadline_at = new Date(NOW.getTime() + 4 * 24 * H).toISOString();
  reminders.lifecycles[0].reminder_stage = 1;
  const spy = reminderSpy();
  await runReminders(reminders, coordinator, new Date(NOW.getTime() + 10 * 60_000), spy.fn);
  assert.equal(spy.calls.length, 1);
});

// ── Founder actions vs. automatic milestones ────────────────────────────────

function founderWorld() {
  return createFakeActivationReminderClient({
    lifecycles: [
      makeLifecycleRow({
        id: "lc-f",
        operator_id: "op-1",
        origin_type: "claim",
        origin_claim_id: "claim-1",
        origin_submission_id: null,
        deadline_at: "2026-10-02T23:41:30.607Z",
        expired_at: "2026-10-03T00:00:00.000Z",
        reminder_stage: 3,
      }),
    ],
    operators: [{ id: "op-1", email: "gm@venue.example", first_name: "Jeremy", last_name: null, account_activated_at: null }],
    claims: [{ id: "claim-1", venue_id: "v-1" }],
    venues: [{ id: "v-1", name: "Venue", created_by_operator_id: "op-1" }],
  });
}

function founderDeps(fake: ReturnType<typeof founderWorld>, coordinator: any, now: Date, sendEmail?: any) {
  return {
    authClient: { auth: { getUser: async () => ({ data: { user: { id: "f-1", email: "wayne@happyhourcompass.com" } } }) } } as any,
    adminClient: fake.client,
    checkAdmin: async () => true,
    generateLink: (async () => ({ data: { properties: { hashed_token: "h" }, user: null }, error: null })) as any,
    sendEmail: sendEmail ?? ((async () => ({ ok: true, id: "re-f" })) as any),
    sendAlert: (async () => "delivered") as any,
    revalidate: () => {},
    now: () => now,
    siteUrl: "https://staging.example.test",
    coordinator,
  };
}

test("founder first, mid-send: the founder's evidence is already written, so a milestone run during the send defers 48 h on spacing", async () => {
  const { ops, coordinator } = contactStore();
  const delivery = milestoneWorld();
  const milestoneCalls: any[] = [];
  const milestoneSend = (async (p: any) => { milestoneCalls.push(p); return { ok: true, id: "re-m" }; }) as any;
  const founderSend = (async () => {
    await runMilestones(delivery, coordinator, NOW, milestoneSend);
    return { ok: true, id: "re-f" };
  }) as any;
  const sent = await sendFinalSetupEmailImpl({ type: "claim", claimId: "claim-1" }, founderDeps(founderWorld(), coordinator, NOW, founderSend));
  assert.equal(sent.success, true, sent.error);
  assert.equal(milestoneCalls.length, 0);
  assert.equal(ops.rows[0].last_setup_contact_kind, "founder_final_resend");
  assert.equal(ops.rows[0].setup_contact_claimed_at, null, "founder released its claim after recording evidence");
  const ev = delivery.csEvents[0];
  assert.equal((ev.metadata_json as any).coordination.lastDeferral.reason, "recent_setup_contact");
  assert.equal(ev.next_attempt_at, "2026-10-07T22:00:00.000Z", "first business-day 3 PM ≥ 48 h after the founder contact");
  const next = await runMilestones(delivery, coordinator, new Date(NOW.getTime() + H), milestoneSend);
  assert.equal(milestoneCalls.length, 0);
  assert.equal(next.attempted, 0);
});

test("founder first, before its evidence is written: a milestone that read no recent contact still can't send — the founder holds the operator claim", async () => {
  const { ops, coordinator } = contactStore();
  const delivery = milestoneWorld();
  const milestoneCalls: any[] = [];
  let midClaim: any = null;
  const deps = {
    ...founderDeps(founderWorld(), coordinator, NOW),
    // Runs while the founder holds both claims, before any evidence is recorded.
    generateLink: (async () => {
      assert.equal(ops.rows[0].last_setup_contact_at, null);
      midClaim = await runMilestones(delivery, coordinator, NOW, (async (p: any) => { milestoneCalls.push(p); return { ok: true, id: "re-m" }; }) as any);
      return { data: { properties: { hashed_token: "h" }, user: null }, error: null };
    }) as any,
  };
  const sent = await sendFinalSetupEmailImpl({ type: "claim", claimId: "claim-1" }, deps);
  assert.equal(sent.success, true, sent.error);
  assert.equal(milestoneCalls.length, 0, "claim held → milestone backs off");
  assert.equal(midClaim.deferredForSetupContact, 1);
  assert.equal(delivery.csEvents[0].attempt_count, 0);
});

test("founder Copy first: the pause is recorded under the claim and defers the milestone", async () => {
  const { ops, coordinator } = contactStore();
  const copy = await generateFinalSetupLinkImpl({ type: "claim", claimId: "claim-1" }, founderDeps(founderWorld(), coordinator, NOW));
  assert.equal(copy.ok, true);
  assert.equal(new Date(ops.rows[0].last_setup_pause_at!).getTime(), NOW.getTime());
  const delivery = milestoneWorld();
  const r = await runMilestones(delivery, coordinator, new Date(NOW.getTime() + H), async () => ({ ok: true, id: "x" }));
  assert.equal(r.deferredForSetupContact, 1);
  assert.equal((delivery.csEvents[0].metadata_json as any).coordination.lastDeferral.reason, "recent_setup_pause");
});

test("milestone first: while it is being sent, Final resend and Copy answer 'still finishing' (no link generated); afterwards the founder is NOT held back by 48 h", async () => {
  const { coordinator } = contactStore();
  const delivery = milestoneWorld();
  const fw = founderWorld();
  let duringResend: any = null;
  let duringCopy: any = null;
  let linkCalls = 0;
  const deps = () => ({
    ...founderDeps(fw, coordinator, NOW),
    generateLink: (async () => { linkCalls++; return { data: { properties: { hashed_token: "h" }, user: null }, error: null }; }) as any,
  });
  await runMilestones(delivery, coordinator, NOW, async () => {
    duringResend = await sendFinalSetupEmailImpl({ type: "claim", claimId: "claim-1" }, deps());
    duringCopy = await generateFinalSetupLinkImpl({ type: "claim", claimId: "claim-1" }, deps());
    return { ok: true, id: "re-m" };
  });
  assert.match(duringResend.error ?? "", /being sent right now/);
  assert.equal(duringCopy.ok, false);
  assert.equal(linkCalls, 0, "no setup link generated while the milestone holds the claim");
  assert.equal(fw.lifecycles[0].setup_link_claimed_at, null, "founder released its setup-link claim on refusal");

  const after = await sendFinalSetupEmailImpl({ type: "claim", claimId: "claim-1" }, deps());
  assert.equal(after.success, true, "founder actions are exempt from the 48 h spacing rule");
});

// ── Release ──────────────────────────────────────────────────────────────────

test("Release refuses while an operator contact claim is active, and proceeds once it is stale", async () => {
  const PAST = "2026-09-15T00:00:00.000Z";
  const relNow = new Date("2026-09-20T00:00:00.000Z");
  const world = (claimedAt: string) =>
    createFakeActivationReleaseClient({
      lifecycles: [makeReleaseLifecycle({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST })],
      operators: [{ id: "op-1", account_activated_at: null, setup_contact_claimed_at: claimedAt } as any],
      submissions: [{ id: "sub-1", venue_id: "venue-1" }],
      venues: [{ id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: PAST, is_verified: true, is_published: true }],
    });
  const auth = {
    authClient: { auth: { getUser: async () => ({ data: { user: { id: "f-1", email: "wayne@happyhourcompass.com" } } }) } } as any,
    checkAdmin: async () => true,
    revalidate: () => {},
    now: relNow,
    sendAlert: (async () => "delivered") as any,
  };
  const busy = world(new Date(relNow.getTime() - 30_000).toISOString());
  const refused = await releaseActivationLifecycleImpl("lc-1", { ...auth, adminClient: busy.client });
  assert.match(refused.error ?? "", /being sent right now/);
  assert.equal(busy.venues[0].created_by_operator_id, "op-1");

  const stale = world(new Date(relNow.getTime() - SETUP_CONTACT_CLAIM_TTL_MS - 1000).toISOString());
  const ok = await releaseActivationLifecycleImpl("lc-1", { ...auth, adminClient: stale.client });
  assert.equal(ok.success, true);
});

// ── Automatic initial setup emails (approval / deferred start / legacy start) ─
// Only ever sent under the operator's contact claim; queued when it stays busy.

const NOT_SENT = (error: string) => ({ ok: false, error });
const QUEUED = () => ({ ok: true, queued: true });

function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const w = console.warn;
  const e = console.error;
  console.warn = () => {};
  console.error = () => {};
  return fn().finally(() => {
    console.warn = w;
    console.error = e;
  });
}

/** Real sendTransactionalEmail with only the Resend SDK call replaced (no database reached). */
async function withControlledResend(fn: (p: { calls: string[]; acceptMilestone: () => void }) => Promise<void>) {
  const proto = Object.getPrototypeOf(new Resend("re_test_only").emails);
  const original = proto.send;
  const keys = ["RESEND_API_KEY", "EMAIL_OPEN_TRACKING_ENABLED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.RESEND_API_KEY = "re_test_only";
  for (const k of keys.slice(1)) delete process.env[k];
  const calls: string[] = [];
  let acceptMilestone!: () => void;
  proto.send = function (payload: { subject: string }) {
    calls.push(payload.subject);
    if (payload.subject === "milestone") return new Promise((r) => { acceptMilestone = () => r({ data: { id: "re_m" }, error: null }); });
    return Promise.resolve({ data: { id: `re_${calls.length}` }, error: null });
  };
  const log = console.log;
  console.log = () => {};
  try {
    await fn({ calls, acceptMilestone: () => acceptMilestone() });
  } finally {
    console.log = log;
    proto.send = original;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("REGRESSION — provider completes after the old 60 s takeover point: no other email to the operator starts while it's in flight; the initial setup email is queued and sent under the claim afterwards", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { runHoldingContactClaim } = await import("../../../src/lib/activation/setupContactClaimGuard");
  const { sendTransactionalEmail } = await import("../../../src/lib/email");
  const { processDeferredInitialSetupEmails } = await import("../../../src/lib/activation/deferredInitialSetup");
  const { createMemoryDeferredSetupStore } = await import("./support/memoryDeferredSetupStore");
  const { ops, coordinator } = contactStore();
  // This test sends through the REAL sendTransactionalEmail, whose claim send
  // window is measured on the wall clock — so its timeline starts at the real
  // current time rather than the file's fixed T0.
  const T0 = new Date();

  await withControlledResend(async ({ calls, acceptMilestone }) => {
    // A milestone holder takes the claim and starts its provider request…
    const token = (await coordinator.claim("op-1", "milestone", T0))!;
    const milestone = runHoldingContactClaim("op-1", token, () =>
      sendTransactionalEmail({ type: "customer_success_milestone", to: "gm@venue.example", subject: "milestone", html: "<p/>", text: "t", criticality: "standard" })
    );
    for (let i = 0; i < 200 && calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["milestone"], "the milestone's provider request has started");

    // …which hasn't completed 61 s later (where the 60 s claim used to be taken over).
    let initialSent = false;
    const initial = await silenced(() =>
      withAutomaticSetupContact(
        { operatorId: "op-1", coordinator, now: () => new Date(T0.getTime() + 61_000), waitMs: 1000, pollMs: 500, sleep: async () => {}, onDeferred: QUEUED, onUnavailable: NOT_SENT },
        async () => {
          initialSent = true;
          return { ok: true };
        }
      )
    );
    assert.deepEqual(initial, { ok: true, queued: true }, "queued, not sent beside the in-flight milestone");
    assert.equal(initialSent, false);
    assert.equal(await coordinator.claim("op-1", "reminder", new Date(T0.getTime() + 5 * 60_000)), null, "still not replaceable at 5 min");
    assert.deepEqual(calls, ["milestone"], "nothing else reached the provider while the milestone was in flight");

    // The provider finally accepts the milestone; the holder records it and releases.
    acceptMilestone();
    assert.equal((await milestone).ok, true);
    await coordinator.recordMilestone("op-1", T0, "accepted");
    await coordinator.release("op-1", token);

    // The hourly worker sends the queued email — under the claim, after the milestone.
    const { store, lifecycles } = createMemoryDeferredSetupStore(ops.rows as never);
    lifecycles.set("op-1", { id: "lc-1", originType: "claim", originClaimId: "claim-1", originSubmissionId: null, verificationRequired: true });
    let claimDuringSend: string | null = null;
    const r = await processDeferredInitialSetupEmails(null as never, new Date(T0.getTime() + H), {
      store,
      coordinator,
      sendEmail: async () => {
        claimDuringSend = ops.rows[0].setup_contact_claim_kind;
        return sendTransactionalEmail({ type: "operator_activation", to: "gm@venue.example", subject: "setup", html: "<p/>", text: "t", criticality: "standard" });
      },
      writeNote: (async () => ({ ok: true })) as any,
      sendAlert: (async () => "delivered") as any,
    });
    assert.equal(r.sent, 1);
    assert.equal(claimDuringSend, "initial_setup");
    assert.deepEqual(calls, ["milestone", "setup"], "the setup email went out only after the milestone completed");
    assert.equal((ops.rows[0] as any).initial_setup_deferred_at, null, "queue entry cleared");
    assert.equal(ops.rows[0].setup_contact_claimed_at, null);
  });
});

test("initial setup email with the claim free: evidence recorded under the claim, then released; a later milestone defers 48 h", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { ops, coordinator } = contactStore();
  let claimDuringSend: string | null = null;
  const result = await withAutomaticSetupContact({ operatorId: "op-1", coordinator, now: () => NOW, onDeferred: QUEUED, onUnavailable: NOT_SENT }, async () => {
    claimDuringSend = ops.rows[0].setup_contact_claim_kind;
    return { ok: true };
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(claimDuringSend, "initial_setup");
  assert.equal(ops.rows[0].last_setup_contact_kind, "setup_email");
  assert.equal(ops.rows[0].setup_contact_claimed_at, null);
  const delivery = milestoneWorld();
  const r = await runMilestones(delivery, coordinator, new Date(NOW.getTime() + H), async () => ({ ok: true, id: "x" }));
  assert.equal(r.deferredForSetupContact, 1);
});

test("initial setup email while a milestone is mid-send: it waits for the milestone to finish, then sends under its own claim (never at the same moment)", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { ops, coordinator } = contactStore();
  const delivery = milestoneWorld();
  const order: string[] = [];
  let initial: Promise<unknown> | null = null;
  let sleeps = 0;
  let claimAtInitialSend: string | null = null;
  await runMilestones(delivery, coordinator, NOW, async () => {
    order.push("milestone-start");
    initial = withAutomaticSetupContact(
      {
        operatorId: "op-1",
        coordinator,
        now: () => NOW,
        onDeferred: QUEUED,
        onUnavailable: NOT_SENT,
        sleep: async () => {
          sleeps++;
          await new Promise((r) => setImmediate(r));
        },
      },
      async () => {
        order.push("initial-send");
        claimAtInitialSend = ops.rows[0].setup_contact_claim_kind;
        return { ok: true };
      }
    );
    await new Promise((r) => setImmediate(r));
    order.push("milestone-end");
    return { ok: true, id: "re-m" };
  });
  await initial;
  assert.deepEqual(order, ["milestone-start", "milestone-end", "initial-send"]);
  assert.ok(sleeps >= 1, "it waited for the milestone's claim");
  assert.equal(claimAtInitialSend, "initial_setup", "sent while holding its own claim");
});

test("initial setup email behind a crashed holder's claim: queued within the short wait (never a 6-minute request); the worker sends it once the claim has gone stale", async () => {
  const { withAutomaticSetupContact, INITIAL_SETUP_CLAIM_WAIT_MS } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { processDeferredInitialSetupEmails } = await import("../../../src/lib/activation/deferredInitialSetup");
  const { createMemoryDeferredSetupStore } = await import("./support/memoryDeferredSetupStore");
  const { ops, coordinator } = contactStore();
  ops.rows[0].setup_contact_claimed_at = NOW.toISOString();
  ops.rows[0].setup_contact_claim_kind = "milestone";
  let waited = 0;
  let sent = 0;
  const r = await silenced(() =>
    withAutomaticSetupContact(
      { operatorId: "op-1", coordinator, now: () => new Date(NOW.getTime() + waited), sleep: async (ms: number) => { waited += ms; }, onDeferred: QUEUED, onUnavailable: NOT_SENT },
      async () => {
        sent++;
        return { ok: true };
      }
    )
  );
  assert.deepEqual(r, { ok: true, queued: true });
  assert.equal(sent, 0);
  assert.ok(waited <= INITIAL_SETUP_CLAIM_WAIT_MS);
  assert.equal(ops.rows[0].setup_contact_claim_kind, "milestone", "the other holder's claim is untouched");
  assert.equal(ops.rows[0].last_setup_contact_at, null, "no evidence for an email that wasn't sent");

  const { store, lifecycles } = createMemoryDeferredSetupStore(ops.rows as never);
  lifecycles.set("op-1", { id: "lc-1", originType: "claim", originClaimId: "claim-1", originSubmissionId: null, verificationRequired: false });
  const sends: string[] = [];
  const deps = { store, coordinator, sendEmail: async () => { sends.push(ops.rows[0].setup_contact_claim_kind!); return { ok: true }; }, writeNote: (async () => ({ ok: true })) as any, sendAlert: (async () => "delivered") as any };
  const early = await processDeferredInitialSetupEmails(null as never, new Date(NOW.getTime() + SETUP_CONTACT_CLAIM_TTL_MS - 1000), deps);
  assert.equal(early.busy, 1, "a claim younger than its lifetime is never replaced");
  assert.equal(sends.length, 0);
  const later = await processDeferredInitialSetupEmails(null as never, new Date(NOW.getTime() + SETUP_CONTACT_CLAIM_TTL_MS + 1000), deps);
  assert.equal(later.sent, 1);
  assert.deepEqual(sends, ["initial_setup"]);
  assert.equal(ops.rows[0].last_milestone_contact_status, "unconfirmed", "the crashed milestone was folded in as a possible contact");
});

test("initial setup email: if it can be neither claimed nor queued, it is NOT sent — the caller's failure result and one #ops-critical alert", async () => {
  const { withAutomaticSetupContact, INITIAL_SETUP_UNAVAILABLE_MESSAGE } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { coordinator } = contactStore();
  const down = { ...coordinator, claim: async () => { throw new Error("db down"); }, deferInitialSetup: async () => false } as any;
  const alerts: any[] = [];
  let sent = false;
  const r = await silenced(() =>
    withAutomaticSetupContact(
      { operatorId: "op-1", coordinator: down, now: () => NOW, waitMs: 1000, pollMs: 500, sleep: async () => {}, onDeferred: QUEUED, onUnavailable: NOT_SENT, sendAlert: (async (a: any) => { alerts.push(a); return "delivered"; }) as any },
      async () => {
        sent = true;
        return { ok: true };
      }
    )
  );
  assert.equal(sent, false);
  assert.deepEqual(r, { ok: false, error: INITIAL_SETUP_UNAVAILABLE_MESSAGE });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].channel, "ops-critical");
});

test("initial setup email: a claim error is retried, never treated as permission to send; a persistent one queues it", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { ops, coordinator } = contactStore();
  let failures = 2;
  const flaky = { ...coordinator, claim: async (...a: Parameters<typeof coordinator.claim>) => (failures-- > 0 ? Promise.reject(new Error("db blip")) : coordinator.claim(...a)) } as any;
  let sends = 0;
  const ok = await withAutomaticSetupContact({ operatorId: "op-1", coordinator: flaky, now: () => NOW, sleep: async () => {}, onDeferred: QUEUED, onUnavailable: NOT_SENT }, async () => {
    sends++;
    return { ok: true };
  });
  assert.deepEqual(ok, { ok: true });
  assert.equal(sends, 1);

  const down = { ...coordinator, claim: async () => { throw new Error("db down"); } } as any;
  const queued = await silenced(() =>
    withAutomaticSetupContact({ operatorId: "op-1", coordinator: down, now: () => NOW, waitMs: 1000, pollMs: 500, sleep: async () => {}, onDeferred: QUEUED, onUnavailable: NOT_SENT }, async () => {
      sends++;
      return { ok: true };
    })
  );
  assert.deepEqual(queued, { ok: true, queued: true });
  assert.equal(sends, 1, "not sent without the claim");
  assert.ok((ops.rows[0] as any).initial_setup_deferred_at, "queued durably");
});

test("re-entrant: a nested automatic send for the same operator runs immediately inside the outer claim", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { ops, coordinator } = contactStore();
  let sleeps = 0;
  const opts = { operatorId: "op-1", coordinator, now: () => NOW, onDeferred: () => "queued", onUnavailable: (e: string) => e, sleep: async () => { sleeps++; } };
  let claimAtInner: string | null = null;
  const inner = await withAutomaticSetupContact(opts, () =>
    withAutomaticSetupContact(opts, async () => {
      claimAtInner = ops.rows[0].setup_contact_claim_kind;
      return "inner-sent";
    })
  );
  assert.equal(inner, "inner-sent");
  assert.equal(sleeps, 0);
  assert.equal(claimAtInner, "initial_setup");
});

test("initial setup email: no unactivated operator for the recipient (unknown address, or activated/returning operator) → nothing to coordinate, sent directly", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { coordinator } = contactStore();
  const p = { onDeferred: () => "queued", onUnavailable: (e: string) => e };
  assert.equal(await withAutomaticSetupContact({ ...p, email: "nobody@x.test", coordinator, admin: createFakeOperatorsContactClient([]).client }, async () => "sent"), "sent");
  const activated = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-a", email: "a@x.test", account_activated_at: "2026-10-01T00:00:00Z" })], { postgrestTimestamps: true });
  const activatedCoordinator = createSetupContactCoordinator(activated.client, { clock: () => new Date(0) });
  activated.rows[0].setup_contact_claimed_at = NOW.toISOString(); // even a busy claim doesn't matter for an activated operator
  assert.equal(await withAutomaticSetupContact({ ...p, email: "a@x.test", coordinator: activatedCoordinator }, async () => "sent"), "sent");
  assert.equal(await withAutomaticSetupContact({ ...p, operatorId: "op-a", coordinator: activatedCoordinator, now: () => NOW }, async () => "sent"), "sent");
});

test("timing invariants: the claim outlives any request a holder can have in flight; the initial wait fits a request; queued delivery covers the rest", async () => {
  const { INITIAL_SETUP_CLAIM_WAIT_MS } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { SETUP_CONTACT_SEND_START_WINDOW_MS } = await import("../../../src/lib/activation/setupContactPolicy");
  const NODE_FETCH_HEADERS_TIMEOUT_MS = 300_000;
  const VERCEL_FUNCTION_LIMIT_MS = 300_000; // project default (fluid compute), no route overrides it
  assert.ok(SETUP_CONTACT_CLAIM_TTL_MS > SETUP_CONTACT_SEND_START_WINDOW_MS + NODE_FETCH_HEADERS_TIMEOUT_MS);
  assert.ok(INITIAL_SETUP_CLAIM_WAIT_MS * 10 <= VERCEL_FUNCTION_LIMIT_MS, "a small fraction of the request budget");
  assert.ok(INITIAL_SETUP_CLAIM_WAIT_MS < SETUP_CONTACT_CLAIM_TTL_MS, "the request never waits out a claim — it queues instead");
});

test("claims are stamped with the wall clock, never a worker's earlier pass time", async () => {
  const ops = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-1" })]);
  const later = new Date(NOW.getTime() + 45_000);
  const c = createSetupContactCoordinator(ops.client, { clock: () => later });
  const token = await c.claim("op-1", "milestone", NOW);
  assert.equal(token, later.toISOString(), "a pass that started 45 s ago must not make a fresh claim look 45 s old");
});
