/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles */
import { test } from "node:test";
import assert from "node:assert/strict";
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
  return { ops, coordinator: createSetupContactCoordinator(ops.client) };
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

test("initial setup email with the claim free: evidence recorded under the claim, then released; a later milestone defers 48 h", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { ops, coordinator } = contactStore();
  let claimDuringSend: string | null = null;
  const result = await withAutomaticSetupContact({ operatorId: "op-1", coordinator, now: () => NOW }, async () => {
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

test("initial setup email while a milestone is mid-send: it waits for the milestone to finish, then sends (never at the same moment)", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { coordinator } = contactStore();
  const delivery = milestoneWorld();
  const order: string[] = [];
  let initial: Promise<unknown> | null = null;
  let sleeps = 0;
  await runMilestones(delivery, coordinator, NOW, async () => {
    order.push("milestone-start");
    initial = withAutomaticSetupContact(
      {
        operatorId: "op-1",
        coordinator,
        now: () => NOW,
        sleep: async () => {
          sleeps++;
          await new Promise((r) => setImmediate(r));
        },
      },
      async () => {
        order.push("initial-send");
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
});

test("initial setup email whose wait expires: never refused — it logs, records evidence and sends", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { ops, coordinator } = contactStore();
  ops.rows[0].setup_contact_claimed_at = NOW.toISOString();
  ops.rows[0].setup_contact_claim_kind = "milestone";
  const warnings: unknown[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a); };
  try {
    let sent = false;
    await withAutomaticSetupContact({ operatorId: "op-1", coordinator, now: () => NOW, waitMs: 1000, pollMs: 500, sleep: async () => {} }, async () => {
      sent = true;
      return { ok: true };
    });
    assert.equal(sent, true);
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warnings.some((w) => /still in flight/.test(String((w as unknown[])[0]))), "explicit warning, never silent");
  assert.equal(ops.rows[0].last_setup_contact_kind, "setup_email");
  assert.equal(ops.rows[0].setup_contact_claim_kind, "milestone", "the other holder's claim is untouched");
});

test("re-entrant: a nested automatic send for the same operator runs immediately instead of waiting on its own claim", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { coordinator } = contactStore();
  let sleeps = 0;
  const opts = { operatorId: "op-1", coordinator, now: () => NOW, sleep: async () => { sleeps++; } };
  const inner = await withAutomaticSetupContact(opts, () => withAutomaticSetupContact(opts, async () => "inner-sent"));
  assert.equal(inner, "inner-sent");
  assert.equal(sleeps, 0);
});

test("initial setup email: unknown/activated recipient or coordination failure never blocks the send", async () => {
  const { withAutomaticSetupContact } = await import("../../../src/lib/activation/setupContactAutomatic");
  const { coordinator } = contactStore();
  assert.equal(await withAutomaticSetupContact({ email: "nobody@x.test", coordinator, admin: createFakeOperatorsContactClient([]).client }, async () => "sent"), "sent");
  const broken = { ...coordinator, claim: async () => { throw new Error("db down"); }, recordSetupContact: async () => false } as any;
  assert.equal(await withAutomaticSetupContact({ operatorId: "op-1", coordinator: broken }, async () => "sent"), "sent");
});
