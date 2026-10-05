/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles */
import { test } from "node:test";
import assert from "node:assert/strict";
import { processActivationReminders } from "../../../src/lib/activation/processActivationReminders";
import { createSetupContactCoordinator } from "../../../src/lib/activation/setupContactStore";
import { processCustomerSuccessDeliveries } from "../../../src/lib/customerSuccess/processCustomerSuccessDeliveries";
import { createFakeActivationReminderClient, makeLifecycleRow } from "./support/fakeActivationReminderClient";
import { createFakeOperatorsContactClient, makeOperatorContactRow, type FakeOperatorContactRow } from "./support/fakeOperatorsContactClient";
import { createFakeDeliveryClient, makeFakeCsEventRow } from "../customerSuccess/support/fakeDeliveryClient";

/** Reminder worker × setup-contact coordination (migration 104). */

const NOW = new Date("2026-10-05T22:00:00.000Z");
const H = 3600_000;
const DAY = 24 * H;

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

/** Stage 3 due one hour ago; deadline = now + 47 h. */
function world(operator: Partial<FakeOperatorContactRow> = {}, deadlineAt = new Date(NOW.getTime() + 47 * H).toISOString()) {
  const lifecycle = makeLifecycleRow({
    id: "lc-1",
    operator_id: "op-1",
    origin_submission_id: "sub-1",
    reminder_stage: 2,
    deadline_at: deadlineAt,
    reminder_next_attempt_at: new Date(NOW.getTime() - H).toISOString(),
  });
  const reminders = createFakeActivationReminderClient({
    lifecycles: [lifecycle],
    operators: [{ id: "op-1", email: "gm@venue.example", first_name: "Jeremy", last_name: null, account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "v-1" }],
    venues: [{ id: "v-1", name: "Venue", created_by_operator_id: "op-1" }],
  });
  const ops = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-1", email: "gm@venue.example", ...operator })]);
  return { reminders, ops, coordinator: createSetupContactCoordinator(ops.client, { clock: () => new Date(0) }) };
}

function emailSpy() {
  const calls: any[] = [];
  return { calls, fn: (async (p: any) => { calls.push(p); return { ok: true, providerMessageId: "re-1" }; }) as any };
}

function runReminders(w: ReturnType<typeof world>, email: ReturnType<typeof emailSpy>, now = NOW, coordinationEnabled = true) {
  return withEnv({ OPERATOR_ACTIVATION_REMINDERS_ENABLED: "true" }, () =>
    processActivationReminders({ adminClient: w.reminders.client, now, sendReminderEmail: email.fn, coordinator: w.coordinator, coordinationEnabled })
  );
}

test("milestone sent 10 h ago: the due reminder is deferred to milestone + 48 h — not sent, not attempted, stage unchanged, explained in the timeline", async () => {
  const milestoneAt = new Date(NOW.getTime() - 10 * H).toISOString();
  const w = world({ last_milestone_contact_at: milestoneAt });
  const email = emailSpy();
  const result = await runReminders(w, email);
  assert.equal(email.calls.length, 0);
  assert.equal(result.reminderDeferredForMilestone, 1);
  const lc = w.reminders.lifecycles[0];
  assert.equal(lc.reminder_stage, 2);
  assert.equal(lc.reminder_attempt_count, 0);
  assert.equal(lc.reminder_lease_started_at, null);
  assert.equal(lc.reminder_next_attempt_at, new Date(NOW.getTime() + 38 * H).toISOString());
  const notes = w.reminders.operatorSubmissionNotes;
  assert.deepEqual(notes.map((n) => n.event_type), ["reminder_deferred"]);
  assert.match(notes[0].note as string, /Not a send attempt/);
  assert.equal(w.ops.rows[0].setup_contact_claimed_at, null, "operator claim released");

  // When the spacing has passed, the reminder sends normally.
  const later = new Date(NOW.getTime() + 38 * H);
  const email2 = emailSpy();
  const result2 = await runReminders(w, email2, later);
  assert.equal(result2.reminderSent, 1);
  assert.equal(email2.calls[0].stage, 3);
});

test("spacing would reach the deadline: the reminder is skipped (never sent early), stage resolved without a reminder_sent note — and expiry still runs", async () => {
  const w = world({ last_milestone_contact_at: new Date(NOW.getTime() - H).toISOString() }); // until = now + 47 h = deadline
  const email = emailSpy();
  const result = await runReminders(w, email);
  assert.equal(email.calls.length, 0);
  assert.equal(result.reminderSkippedForSpacing, 1);
  const lc = w.reminders.lifecycles[0];
  assert.equal(lc.reminder_stage, 3);
  assert.equal(lc.reminder_next_attempt_at, null);
  assert.equal(lc.deadline_at, new Date(NOW.getTime() + 47 * H).toISOString(), "deadline never moved");
  const types = w.reminders.operatorSubmissionNotes.map((n) => n.event_type);
  assert.deepEqual(types, ["reminder_skipped"]);
  assert.ok(!types.includes("reminder_sent"));

  const afterDeadline = new Date(NOW.getTime() + 48 * H);
  const r2 = await runReminders(w, emailSpy(), afterDeadline);
  assert.equal(r2.expiryTransitioned, 1, "expiry processing is unaffected by the skip");
  assert.equal(w.reminders.lifecycles[0].expiry_follow_up_required, true, "founder follow-up alerts remain eligible");
});

test("setup contacts never defer reminders — only milestones do", async () => {
  const w = world({ last_setup_contact_at: new Date(NOW.getTime() - H).toISOString(), last_setup_pause_at: new Date(NOW.getTime() - H).toISOString() });
  const email = emailSpy();
  assert.equal((await runReminders(w, email)).reminderSent, 1);
});

test("milestone worker holds the operator claim: the reminder abandons its lease and retries next pass (nothing marked)", async () => {
  const w = world({ setup_contact_claimed_at: new Date(NOW.getTime() - 5_000).toISOString(), setup_contact_claim_kind: "milestone" });
  const email = emailSpy();
  const result = await runReminders(w, email);
  assert.equal(email.calls.length, 0);
  assert.equal(result.reminderSkippedRaced, 1);
  const lc = w.reminders.lifecycles[0];
  assert.equal(lc.reminder_stage, 2);
  assert.equal(lc.reminder_lease_started_at, null);
  assert.equal(w.reminders.operatorSubmissionNotes.length, 0);
});

test("activation during deferral: the deferred reminder is never sent", async () => {
  const w = world({ last_milestone_contact_at: new Date(NOW.getTime() - 10 * H).toISOString() });
  await runReminders(w, emailSpy());
  w.reminders.operators[0].account_activated_at = new Date(NOW.getTime() + H).toISOString();
  const email = emailSpy();
  const r = await runReminders(w, email, new Date(NOW.getTime() + 38 * H));
  assert.equal(email.calls.length, 0);
  assert.equal(r.reminderSkippedActivated, 1);
});

test("flag off: today's behaviour — the reminder sends despite a recent milestone", async () => {
  const w = world({ last_milestone_contact_at: new Date(NOW.getTime() - H).toISOString() });
  const email = emailSpy();
  assert.equal((await runReminders(w, email, NOW, false)).reminderSent, 1);
});

test("dry-run previews the coordination decision without claiming or writing", async () => {
  const { planActivationReminders } = await import("../../../src/lib/activation/processActivationReminders");
  const w = world({ last_milestone_contact_at: new Date(NOW.getTime() - 10 * H).toISOString() });
  const before = JSON.stringify(w.ops.rows);
  const plan = await planActivationReminders({ adminClient: w.reminders.client, now: NOW, coordinator: w.coordinator, coordinationEnabled: true });
  assert.ok(plan.plannedActions.some((a) => a.type === "reminder_deferred"));
  assert.equal(JSON.stringify(w.ops.rows), before);
});

test("both workers at :00 — a reminder pass that runs WHILE a milestone is mid-send backs off; the next pass applies 48 h spacing", async () => {
  const w = world();
  const delivery = createFakeDeliveryClient({
    venues: [{ id: "v-1", is_published: true, is_verified: true, created_by_operator_id: "op-1", market_id: "market-1", name: "Venue" }],
    markets: [{ id: "market-1", slug: "central-okanagan" }],
    memberships: [{ id: "m-1", operator_id: "op-1", role: "owner", email: "gm@venue.example", full_name: "Jeremy", status: "active" }],
    csBaselines: [{ id: "b-1", venue_id: "v-1", event_type: "venue_view_milestone", metric_value_at_baseline: 0 }],
    viewCounts: new Map([["v-1", 50]]),
    csEvents: [makeFakeCsEventRow({ id: "ev-1", venue_id: "v-1", operator_id: "op-1", milestone_value: 50, communication_status: "pending", next_attempt_at: new Date(NOW.getTime() - 60_000).toISOString() })],
  });
  const reminderEmail = emailSpy();
  let midSendReminder: any = null;
  const milestoneSend = (async () => {
    // The reminder cron fires at the same :00 while the milestone is in flight.
    midSendReminder = await runReminders(w, reminderEmail);
    return { ok: true, id: "re-m" };
  }) as any;
  await withEnv({ CUSTOMER_SUCCESS_EMAILS_ENABLED: "true" }, () =>
    processCustomerSuccessDeliveries(delivery.client as never, NOW, milestoneSend, { coordinator: w.coordinator, coordinationEnabled: true })
  );
  assert.equal(reminderEmail.calls.length, 0, "no reminder while the milestone holds the operator claim");
  assert.equal(midSendReminder.reminderSkippedRaced, 1);
  assert.equal(w.ops.rows[0].last_milestone_contact_at, NOW.toISOString());

  // Next pass: the milestone was just sent and the deadline is 47 h away, so
  // 48 h spacing reaches the deadline → the reminder is skipped, not sent.
  const next = await runReminders(w, reminderEmail, new Date(NOW.getTime() + H));
  assert.equal(reminderEmail.calls.length, 0);
  assert.equal(next.reminderSkippedForSpacing, 1);
  assert.equal(w.reminders.lifecycles[0].reminder_stage, 3);
});

test("deadline days away from rollout: a 2-day-out deadline with spacing until exactly the deadline is never sent early", async () => {
  const deadline = new Date(NOW.getTime() + 2 * DAY).toISOString();
  const w = world({ last_milestone_contact_at: NOW.toISOString() }, deadline);
  // stage 3 due at deadline − 2 d = now; milestone just now → until = now + 48 h = deadline → skip
  const email = emailSpy();
  const r = await runReminders(w, email);
  assert.equal(email.calls.length, 0);
  assert.equal(r.reminderSkippedForSpacing, 1);
});
