import { test } from "node:test";
import assert from "node:assert/strict";
import { processActivationReminders } from "../../../src/lib/activation/processActivationReminders";
import { loadExpiryFollowUpDetails, collectPhones } from "../../../src/lib/activation/activationExpiryFollowUp";
import type { ActivationExpiryFollowUpDetails } from "../../../src/lib/activation/activationExpiryNotifications";
import { createFakeActivationReminderClient, makeLifecycleRow, type FakeLifecycleRow } from "./support/fakeActivationReminderClient";

/**
 * Post-expiry personal follow-up (migration 103): which expired lifecycles
 * get the #customer-success + founder-email follow-up, and the batch
 * selection rules that stop completed/ineligible/failing rows from starving
 * newer expiries. Every Slack/email dependency is an injected stub.
 */

const VAR = "OPERATOR_ACTIVATION_REMINDERS_ENABLED";
const NOW = new Date("2026-10-11T00:00:00.000Z");

function withEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const prior = process.env[VAR];
  process.env[VAR] = "true";
  return fn().finally(() => {
    if (prior === undefined) delete process.env[VAR];
    else process.env[VAR] = prior;
  });
}

function expiredRow(id: string, overrides: Partial<FakeLifecycleRow> = {}): FakeLifecycleRow {
  return makeLifecycleRow({
    id,
    operator_id: `op-${id}`,
    origin_type: "submission",
    origin_submission_id: `sub-${id}`,
    reminder_stage: 3,
    deadline_at: "2026-10-10T00:00:00.000Z",
    expired_at: "2026-10-10T00:00:00.500Z",
    expiry_follow_up_required: true,
    ...overrides,
  });
}

function world(
  rows: FakeLifecycleRow[],
  opts: { activated?: string[]; ownerOverride?: Record<string, string | null>; missingOrigins?: string[] } = {}
) {
  const operators = rows.map((r) => ({
    id: r.operator_id,
    email: `${r.operator_id}@example.com`,
    first_name: "Kelly",
    last_name: "Terris",
    account_activated_at: opts.activated?.includes(r.operator_id) ? "2026-10-10T12:00:00.000Z" : null,
  }));
  const submissions = rows
    .filter((r) => !opts.missingOrigins?.includes(r.id))
    .map((r) => ({ id: r.origin_submission_id as string, venue_id: `venue-${r.id}` }));
  const venues = rows.map((r) => ({
    id: `venue-${r.id}`,
    name: `Venue ${r.id}`,
    created_by_operator_id: opts.ownerOverride && r.id in opts.ownerOverride ? opts.ownerOverride[r.id] : r.operator_id,
  }));
  return createFakeActivationReminderClient({ lifecycles: rows, operators, submissions, venues });
}

function stubs(slackResult: "delivered" | "failed" | "no-webhook" = "delivered", emailOk = true) {
  const slackCalls: ActivationExpiryFollowUpDetails[] = [];
  const emailCalls: ActivationExpiryFollowUpDetails[] = [];
  return {
    slackCalls,
    emailCalls,
    deps: {
      sendExpirySlack: (async (d: ActivationExpiryFollowUpDetails) => {
        slackCalls.push(d);
        return slackResult;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      sendExpiryFounderEmail: (async (d: ActivationExpiryFollowUpDetails) => {
        emailCalls.push(d);
        return { ok: emailOk };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    },
  };
}

test("the expiry CAS marks the lifecycle as owing a follow-up in the same update as expired_at", async () => {
  const row = makeLifecycleRow({ id: "lc-1", operator_id: "op-lc-1", origin_submission_id: "sub-lc-1", reminder_stage: 3, deadline_at: new Date(NOW.getTime() - 1000).toISOString() });
  const fake = world([row]);
  const s = stubs();
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s.deps }));
  assert.equal(fake.lifecycles[0].expired_at, NOW.toISOString());
  assert.equal(fake.lifecycles[0].expiry_follow_up_required, true);
  assert.equal(s.slackCalls.length, 1, "the same pass notifies");
  assert.equal(s.emailCalls.length, 1);
  assert.equal(fake.lifecycles[0].expiry_follow_up_resolved_at, NOW.toISOString(), "both side effects done → resolved");
  assert.equal(fake.lifecycles[0].expiry_follow_up_skip_reason, null);
});

test("rollout cutoff: a lifecycle that expired before migration 103 is never notified and never gets a notified marker", async () => {
  const historical = expiredRow("old", { expiry_follow_up_required: false });
  const fake = world([historical]);
  const s = stubs();
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s.deps }));
  assert.equal(s.slackCalls.length, 0);
  assert.equal(s.emailCalls.length, 0);
  assert.equal(fake.operatorSubmissionNotes.length, 0);
  assert.equal(fake.lifecycles[0].expiry_slack_notified_at, null, "no false notification timestamp");
  assert.equal(fake.lifecycles[0].expiry_founder_email_sent_at, null, "no false notification timestamp");
  assert.equal(fake.lifecycles[0].expiry_follow_up_resolved_at, null);
});

test("notification details: venue, contact, history and links data are passed through; the Slack goes via the injected #customer-success sender", async () => {
  const row = expiredRow("a");
  const fake = world([row]);
  fake.operatorSubmissionNotes.push(
    { id: "n1", event_key: null, submission_id: "sub-a", created_at: "2026-09-21T23:00:00.000Z", event_type: "reminder_sent", metadata_json: { stage: 1 } },
    { id: "n2", event_key: null, submission_id: "sub-a", created_at: "2026-09-25T23:00:00.000Z", event_type: "manual_resend", metadata_json: {} },
    { id: "n3", event_key: null, submission_id: "sub-other", created_at: "2026-09-26T23:00:00.000Z", event_type: "reminder_sent", metadata_json: { stage: 2 } }
  );
  const s = stubs();
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s.deps }));
  const d = s.slackCalls[0];
  assert.equal(d.venueId, "venue-a");
  assert.equal(d.venueName, "Venue a");
  assert.equal(d.email, "op-a@example.com");
  assert.equal(d.origin, "submission");
  assert.equal(d.originId, "sub-a");
  assert.deepEqual(
    d.setupEmailHistory.map((h) => h.label),
    ["Reminder 1", "Resent by founder"],
    "only this origin's setup-email notes, oldest first"
  );
  assert.deepEqual(s.emailCalls[0], d, "founder email receives the same details");
});

test("completed (resolved) rows never occupy the batch — a new expiry behind 30 completed ones is still notified", async () => {
  const completed = Array.from({ length: 30 }, (_, i) =>
    expiredRow(`done-${i}`, {
      expiry_slack_notified_at: "2026-10-10T01:00:00.000Z",
      expiry_founder_email_sent_at: "2026-10-10T01:00:00.000Z",
      expiry_follow_up_resolved_at: "2026-10-10T01:00:00.000Z",
      expiry_follow_up_last_attempted_at: "2026-10-10T01:00:00.000Z",
      expired_at: "2026-10-01T00:00:00.000Z",
    })
  );
  const fresh = expiredRow("new");
  const fake = world([...completed, fresh]);
  const s = stubs();
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s.deps }));
  assert.deepEqual(s.slackCalls.map((d) => d.lifecycleId), ["new"]);
});

test("ineligible rows are resolved once with a skip reason and stop occupying the batch (activated, ownership changed, origin gone)", async () => {
  const activated = expiredRow("act");
  const moved = expiredRow("moved");
  const orphan = expiredRow("orphan");
  const fake = world([activated, moved, orphan], { activated: ["op-act"], ownerOverride: { moved: "someone-else" }, missingOrigins: ["orphan"] });
  const s = stubs();
  const result = await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s.deps }));
  assert.equal(s.slackCalls.length, 0);
  assert.equal(s.emailCalls.length, 0);
  assert.equal(result.expiryFollowUpSkipped, 3);
  const byId = Object.fromEntries(fake.lifecycles.map((l) => [l.id, l]));
  assert.equal(byId.act.expiry_follow_up_skip_reason, "activated");
  assert.equal(byId.moved.expiry_follow_up_skip_reason, "ownership_changed");
  assert.equal(byId.orphan.expiry_follow_up_skip_reason, "origin_unresolved");
  for (const l of fake.lifecycles) {
    assert.notEqual(l.expiry_follow_up_resolved_at, null);
    assert.equal(l.expiry_slack_notified_at, null, "never marked notified");
  }

  // A second pass doesn't look at them again.
  const s2 = stubs();
  const result2 = await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s2.deps }));
  assert.equal(result2.expiryFollowUpSkipped, 0);
});

test("persistently failing rows rotate: 26 rows whose Slack keeps failing all get attempted within two passes (batch of 25)", async () => {
  const rows = Array.from({ length: 26 }, (_, i) => expiredRow(`f${String(i).padStart(2, "0")}`));
  const fake = world(rows);
  const s1 = stubs("failed", false);
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s1.deps }));
  assert.equal(s1.slackCalls.length, 25);
  const attemptedFirst = new Set(s1.slackCalls.map((d) => d.lifecycleId));
  const missed = rows.map((r) => r.id).filter((id) => !attemptedFirst.has(id));
  assert.equal(missed.length, 1);

  const later = new Date(NOW.getTime() + 60 * 60 * 1000);
  const s2 = stubs("failed", false);
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: later, ...s2.deps }));
  assert.equal(s2.slackCalls[0].lifecycleId, missed[0], "the never-attempted row goes first (NULLS FIRST rotation)");
});

test("Slack and founder email retry independently; the follow-up resolves only once both are delivered", async () => {
  const fake = world([expiredRow("x")]);
  const s1 = stubs("failed", true);
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s1.deps }));
  assert.equal(fake.lifecycles[0].expiry_slack_notified_at, null);
  assert.notEqual(fake.lifecycles[0].expiry_founder_email_sent_at, null);
  assert.equal(fake.lifecycles[0].expiry_follow_up_resolved_at, null, "Slack still owed");

  const s2 = stubs("delivered", true);
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: new Date(NOW.getTime() + 3_600_000), ...s2.deps }));
  assert.equal(s2.emailCalls.length, 0, "founder email never re-sent once delivered");
  assert.equal(s2.slackCalls.length, 1);
  assert.notEqual(fake.lifecycles[0].expiry_follow_up_resolved_at, null);

  const s3 = stubs();
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: new Date(NOW.getTime() + 7_200_000), ...s3.deps }));
  assert.equal(s3.slackCalls.length + s3.emailCalls.length, 0, "resolved — nothing further");
});

test("'no-webhook' is not treated as delivered — the marker stays null and the row stays owed", async () => {
  const fake = world([expiredRow("nw")]);
  const s = stubs("no-webhook", true);
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s.deps }));
  assert.equal(fake.lifecycles[0].expiry_slack_notified_at, null);
  assert.equal(fake.lifecycles[0].expiry_follow_up_resolved_at, null);
});

test("follow-up processing never restarts reminders, moves the deadline, unexpires, releases, or touches the venue — even when every notification fails", async () => {
  const row = expiredRow("inv", { reminder_next_attempt_at: null });
  const fake = world([row]);
  const before = { ...fake.lifecycles[0] };
  const s = stubs("failed", false);
  await withEnabled(() => processActivationReminders({ adminClient: fake.client, now: NOW, ...s.deps }));
  const after = fake.lifecycles[0];
  for (const col of [
    "deadline_at",
    "expired_at",
    "released_at",
    "reminder_stage",
    "reminder_next_attempt_at",
    "reminder_attempt_count",
    "reminder_lease_stage",
    "reminder_lease_started_at",
  ] as const) {
    assert.equal(after[col], before[col], `${col} unchanged`);
  }
});

// ── loadExpiryFollowUpDetails ────────────────────────────────────────────────

test("loader: claim origin collects claimant, business and venue phones (deduplicated) and reports views from the injected counter", async () => {
  const row = makeLifecycleRow({
    id: "lc-c",
    operator_id: "op-c",
    origin_type: "claim",
    origin_claim_id: "claim-c",
    origin_submission_id: null,
    deadline_at: "2026-10-08T21:53:47.692Z",
    expired_at: "2026-10-08T22:00:00.000Z",
  });
  const fake = createFakeActivationReminderClient({
    lifecycles: [row],
    operators: [{ id: "op-c", email: "gm@venue.example", first_name: "Jeremy", last_name: null, account_activated_at: null }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    claims: [{ id: "claim-c", venue_id: "venue-c", phone: "250-555-0100", info_phone: "(250) 555-0100" } as any],
    venues: [{ id: "venue-c", name: "Moxies", created_by_operator_id: "op-c", phone: "250-555-0199" }],
  });
  const result = await loadExpiryFollowUpDetails(fake.client, row, { getViews: async () => 1234 });
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.deepEqual(result.details.phones, [
    { label: "claimant", value: "250-555-0100" },
    { label: "venue", value: "250-555-0199" },
  ]);
  assert.equal(result.details.totalViews, 1234);
  assert.equal(result.details.origin, "claim");
  assert.equal(result.details.originId, "claim-c");
});

test("collectPhones drops blanks and duplicate numbers in different formats", () => {
  assert.deepEqual(
    collectPhones([
      { label: "a", value: " " },
      { label: "b", value: null },
      { label: "c", value: "+1 250 555 0100" },
      { label: "d", value: "+1 (250) 555-0100" },
    ]),
    [{ label: "c", value: "+1 250 555 0100" }]
  );
});
