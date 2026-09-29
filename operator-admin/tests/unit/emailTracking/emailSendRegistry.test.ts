import { test } from "node:test";
import assert from "node:assert/strict";
import { registerEmailSend, recordEmailSendResult, type EmailRecordContext, type EmailRegistryDeps } from "../../../src/lib/emailTracking/emailSendRegistry";
import {
  computeSendRef,
  buildEmailOpenedNoteText,
  buildEmailOpenedSlackText,
  buildResendTags,
  classifyOpenNotification,
  describeEmail,
  isEligibleForOpenSlack,
  resolveEmailEnvironment,
  sanitizeSendContext,
} from "../../../src/lib/emailTracking/emailTrackingPolicy";
import { formatEmailOpenNote } from "../../../src/lib/emailTracking/emailOpenNotes";
import { getEmailOpenNotesForVenue } from "../../../src/lib/data/venueNotes";
import { createFakeEmailTrackingStore } from "./support/fakeEmailTrackingStore";

let keySeq = 0;
/** Tests describe sends the way callers do (optional idempotency key); email.ts derives the send key. */
function registerFor(
  input: { type: string; to: string; idempotencyKey?: string; record?: EmailRecordContext },
  deps: EmailRegistryDeps
) {
  return registerEmailSend({ type: input.type, to: input.to, record: input.record, sendKey: input.idempotencyKey ?? `hhc-email:test-${++keySeq}` }, deps);
}


const on = () => true;

// ── Policy ───────────────────────────────────────────────────────────────────

test("environment: Vercel production/preview map through; anything off-Vercel is development", () => {
  assert.equal(resolveEmailEnvironment({ VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv), "production");
  assert.equal(resolveEmailEnvironment({ VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv), "preview");
  assert.equal(resolveEmailEnvironment({} as unknown as NodeJS.ProcessEnv), "development");
  assert.equal(resolveEmailEnvironment({ VERCEL_ENV: "development" } as unknown as NodeJS.ProcessEnv), "development");
});

test("routing: CS + operator setup/reminder types notify; verification codes, consumer, founder and password-reset never do", () => {
  for (const t of ["customer_success_milestone", "claim_approval", "operator_activation", "operator_venue_added", "activation_reminder"]) {
    assert.equal(classifyOpenNotification(t), "customer_success", t);
  }
  for (const t of [
    "operator_verification_code",
    "password_reset",
    "consumer_signup_confirmation",
    "consumer_signup_founder_notification",
    "claim_notification",
    "operator_account_activated",
    "activation_expiry_founder_notification",
    "contact_submitter_confirmation",
  ]) {
    assert.equal(classifyOpenNotification(t), "none", t);
  }
  // A continue-setup email sent in answer to a forgot-password request reuses a setup type but is a reset response.
  assert.equal(classifyOpenNotification("claim_approval", { trigger: "recovery_redirect" }), "none");
});

test("Slack eligibility: only production rows, from a production runtime, with a venue, first-opened and not yet notified", () => {
  const base = { open_notification: "customer_success", venue_id: "v1", environment: "production", first_opened_at: "2026-09-29T10:00:00.000Z", open_notified_at: null };
  assert.equal(isEligibleForOpenSlack(base, "production"), true);
  assert.equal(isEligibleForOpenSlack(base, "preview"), false, "a staging deployment never posts, even for a production row");
  assert.equal(isEligibleForOpenSlack({ ...base, environment: "preview" }, "production"), false, "staging sends never reach the production channel");
  assert.equal(isEligibleForOpenSlack({ ...base, venue_id: null }, "production"), false);
  assert.equal(isEligibleForOpenSlack({ ...base, open_notification: "none" }, "production"), false);
  assert.equal(isEligibleForOpenSlack({ ...base, open_notified_at: "x" }, "production"), false);
});

test("tags are Resend-safe and carry a deterministic send reference derived only from the send key", () => {
  const ref = computeSendRef("hhc-customer-success:e1");
  assert.match(ref, /^[0-9a-f]{32}$/);
  assert.equal(computeSendRef("hhc-customer-success:e1"), ref, "same key ⇒ same ref, with or without a database");
  assert.notEqual(computeSendRef("hhc-customer-success:e2"), ref);
  assert.ok(!ref.includes("customer"), "the key itself is not exposed");
  const tags = buildResendTags({ sendRef: ref, emailType: "weird type:1", environment: "preview" });
  for (const t of tags) assert.match(t.value, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(tags[0], { name: "hhc_send_ref", value: ref });
});

test("send context keeps only allowlisted primitive keys — never links, codes, or subjects", () => {
  const ctx = sanitizeSendContext({ trigger: "founder_resend", reminderStage: 2, ...({ setupLink: "https://x", subject: "123456 is your code" } as object) });
  assert.deepEqual(ctx, { trigger: "founder_resend", reminderStage: 2 });
  assert.equal(sanitizeSendContext({ ...({ trigger: "bogus" } as object) }), null);
});

test("labels and copy say 'Email opened' and never 'read'", () => {
  const slack = buildEmailOpenedSlackText({
    venueName: "Packing House Pub",
    emailType: "customer_success_milestone",
    sendContext: { milestone: 100 },
    recipientEmail: "sam@venue.com",
    sentAt: "2026-09-28T21:04:00.000Z",
    firstOpenedAt: "2026-09-28T23:18:00.000Z",
  });
  assert.match(slack, /Email opened/);
  assert.match(slack, /Packing House Pub/);
  assert.match(slack, /100-view milestone email/);
  assert.match(slack, /sam@venue\.com/);
  assert.match(slack, /2h 14m later/);
  assert.match(slack, /Sent:\*.*2026/);
  const note = buildEmailOpenedNoteText({ emailType: "activation_reminder", sendContext: { reminderStage: 2 }, recipientEmail: "a@b.co", sentAt: null });
  assert.match(note, /^Email opened — Account setup reminder 2 of 3 to a@b\.co\.$/);
  for (const text of [slack, note, describeEmail("claim_approval", { trigger: "founder_resend" })]) {
    assert.ok(!/\bread\b|read receipt/i.test(text.replace(/images loaded/g, "")), `must not claim the message was read: ${text}`);
  }
});

// ── Registry ─────────────────────────────────────────────────────────────────

test("flag off: nothing is registered and the send proceeds untracked", async () => {
  const { store, state } = createFakeEmailTrackingStore();
  const reg = await registerFor({ type: "claim_approval", to: "a@b.co" }, { store, isEnabled: () => false });
  assert.equal(reg, null);
  assert.equal(state.calls.length, 0);
});

test("registration records type, recipient, environment, routing, associations and the send reference", async () => {
  const { store, state } = createFakeEmailTrackingStore();
  const reg = await registerFor(
    { type: "customer_success_milestone", to: " Sam@Venue.com ", idempotencyKey: "hhc-customer-success:e1", record: { venueId: "v1", operatorId: "o1", customerSuccessEventId: "e1", context: { milestone: 100 } } },
    { store, isEnabled: on, environment: "production" }
  );
  assert.ok(reg);
  const row = state.messages[0];
  assert.equal(row.send_key, "hhc-customer-success:e1");
  assert.equal(row.recipient_email, "sam@venue.com");
  assert.equal(row.environment, "production");
  assert.equal(row.open_notification, "customer_success");
  assert.equal(row.venue_id, "v1");
  assert.equal(row.customer_success_event_id, "e1");
  assert.deepEqual(row.send_context, { milestone: 100 });
  assert.equal(row.send_ref, computeSendRef("hhc-customer-success:e1"));
  assert.equal(reg.emailMessageId, row.id);
});

test("a lifecycle fills in venue/operator/origin the caller didn't know (verification codes, reminders)", async () => {
  const { store, state } = createFakeEmailTrackingStore({
    lifecycles: { lc1: { operatorId: "o1", claimId: "c1", submissionId: null, venueId: "v1" } },
  });
  await registerFor({ type: "operator_verification_code", to: "a@b.co", idempotencyKey: "hhc-operator-verification-code:k1", record: { lifecycleId: "lc1" } }, { store, isEnabled: on, environment: "production" });
  const row = state.messages[0];
  assert.deepEqual([row.venue_id, row.operator_id, row.claim_id, row.lifecycle_id], ["v1", "o1", "c1", "lc1"]);
  assert.equal(row.open_notification, "none", "verification-code opens are recorded, not notified");
});

test("retries of the SAME logical send (same idempotency key) reuse one row and count attempts", async () => {
  const { store, state } = createFakeEmailTrackingStore();
  const deps = { store, isEnabled: on, environment: "production" as const };
  const first = await registerFor({ type: "activation_reminder", to: "a@b.co", idempotencyKey: "hhc-activation-reminder:lc1:1" }, deps);
  await recordEmailSendResult(first, { ok: false, error: "rate limited" }, deps);
  const retry = await registerFor({ type: "activation_reminder", to: "a@b.co", idempotencyKey: "hhc-activation-reminder:lc1:1" }, deps);
  await recordEmailSendResult(retry, { ok: true, id: "re_1" }, deps);
  assert.equal(state.messages.length, 1);
  assert.equal(first?.emailMessageId, retry?.emailMessageId);
  assert.equal(retry?.attemptNumber, 2);
  assert.equal(state.messages[0].status, "sent");
  assert.equal(state.messages[0].provider_message_id, "re_1");
});

test("distinct sends (no idempotency key — e.g. founder resends) are distinct rows", async () => {
  const { store, state } = createFakeEmailTrackingStore();
  const deps = { store, isEnabled: on, environment: "production" as const };
  await registerFor({ type: "claim_approval", to: "a@b.co", record: { venueId: "v1", context: { trigger: "founder_resend" } } }, deps);
  await registerFor({ type: "claim_approval", to: "a@b.co", record: { venueId: "v1", context: { trigger: "founder_resend" } } }, deps);
  assert.equal(state.messages.length, 2);
  assert.notEqual(state.messages[0].send_key, state.messages[1].send_key);
});

test("a registry failure never blocks the email: registration degrades to 'untracked'", async () => {
  const { store, state } = createFakeEmailTrackingStore();
  state.fail.insertEmailMessage = true;
  assert.equal(await registerFor({ type: "claim_approval", to: "a@b.co" }, { store, isEnabled: on }), null);
  const throwing = { ...store, insertEmailMessage: async () => { throw new Error("boom"); } };
  assert.equal(await registerFor({ type: "claim_approval", to: "a@b.co" }, { store: throwing, isEnabled: on }), null);
  await recordEmailSendResult(null, { ok: true, id: "x" }, { store }); // no-op, no throw
});

test("a failed attempt never downgrades an already-sent logical email", async () => {
  const { store, state } = createFakeEmailTrackingStore();
  const deps = { store, isEnabled: on, environment: "production" as const };
  const reg = await registerFor({ type: "claim_approval", to: "a@b.co", idempotencyKey: "k" }, deps);
  await recordEmailSendResult(reg, { ok: true, id: "re_1" }, deps);
  await recordEmailSendResult(reg, { ok: false, error: "late failure" }, deps);
  assert.equal(state.messages[0].status, "sent");
});

// ── Timeline ─────────────────────────────────────────────────────────────────

test("timeline: opened emails with a venue become 'Email opened' notes dated at the first open; no venue ⇒ no note", async () => {
  const { store, state } = createFakeEmailTrackingStore();
  const deps = { store, isEnabled: on, environment: "production" as const };
  await registerFor({ type: "claim_approval", to: "a@b.co", record: { venueId: "v1" } }, deps);
  await registerFor({ type: "password_reset", to: "c@d.co" }, deps);
  await registerFor({ type: "operator_verification_code", to: "a@b.co", record: { venueId: "v1" } }, deps);
  for (const m of state.messages) m.first_opened_at = "2026-09-29T17:00:00.000Z";
  state.messages[2].first_opened_at = null; // not opened yet

  assert.equal(formatEmailOpenNote(state.messages[1]), null, "an email without a venue never creates a venue note");
  const { notes } = await getEmailOpenNotesForVenue("v1", store);
  assert.equal(notes.length, 1);
  assert.match(notes[0].note, /^Email opened — Claim approved — account setup email to a@b\.co/);
  assert.equal(notes[0].created_at, "2026-09-29T17:00:00.000Z");
  assert.equal(notes[0].author_label, "Happy Hour Compass");
});

test("timeline: a store error (e.g. migration not applied yet) yields no entries, never a thrown page", async () => {
  const { store } = createFakeEmailTrackingStore();
  const failing = { ...store, listOpenedEmailsForVenue: async () => ({ error: 'relation "email_messages" does not exist' }) };
  assert.deepEqual(await getEmailOpenNotesForVenue("v1", failing), { notes: [] });
});
