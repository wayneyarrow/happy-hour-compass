import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { handleResendWebhookRequest, __resetMisconfiguredAlertForTests, type ResendWebhookDeps } from "../../../src/lib/emailTracking/resendWebhookHandler";
import { runEmailOpenTracking, MAX_OPEN_NOTIFY_ATTEMPTS, UNMATCHED_RETRY_WINDOW_MS } from "../../../src/lib/emailTracking/emailOpenProcessing";
import { registerEmailSend, recordEmailSendResult, type EmailRecordContext, type EmailRegistryDeps } from "../../../src/lib/emailTracking/emailSendRegistry";
import type { SlackResult } from "../../../src/lib/slack";
import { createFakeEmailTrackingStore } from "./support/fakeEmailTrackingStore";

let keySeq = 0;
/** Tests describe sends the way callers do (optional idempotency key); email.ts derives the send key. */
function registerFor(
  input: { type: string; to: string; idempotencyKey?: string; record?: EmailRecordContext },
  deps: EmailRegistryDeps
) {
  return registerEmailSend({ type: input.type, to: input.to, record: input.record, sendKey: input.idempotencyKey ?? `hhc-email:test-${++keySeq}` }, deps);
}


/**
 * Signatures are produced exactly as Resend (Svix / Standard Webhooks) signs
 * them — HMAC-SHA256 over `${id}.${timestamp}.${body}` with the base64 key
 * after "whsec_" — and verified by the REAL Resend SDK verifier (no `verify`
 * override), so these tests prove the production verification path.
 */
const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString("base64")}`;

function sign(body: string, opts: { id?: string; ts?: number; secretKey?: Buffer } = {}) {
  const id = opts.id ?? `msg_${randomBytes(6).toString("hex")}`;
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", opts.secretKey ?? KEY).update(`${id}.${ts}.${body}`).digest("base64");
  return { id, timestamp: ts, signature: `v1,${sig}` };
}

function openedPayload(p: { emailId: string; tagRef?: string; at?: string }) {
  return JSON.stringify({
    type: "email.opened",
    created_at: p.at ?? "2026-09-29T17:00:00.000Z",
    data: {
      email_id: p.emailId,
      created_at: "2026-09-29T16:59:00.000Z",
      from: "Happy Hour Compass <hello@happyhourcompass.com>",
      to: ["sam@venue.com"],
      subject: "s",
      ...(p.tagRef ? { tags: { hhc_send_ref: p.tagRef, hhc_env: "production" } } : {}),
    },
  });
}

function harness(runtime: "production" | "preview" = "production", slackResults: SlackResult[] = []) {
  const fake = createFakeEmailTrackingStore({ venues: { v1: "Packing House Pub" } });
  const slack: string[] = [];
  const deps: ResendWebhookDeps = {
    store: fake.store,
    secret: SECRET,
    runtimeEnvironment: runtime,
    sendSlack: async (text) => {
      slack.push(text);
      return slackResults.shift() ?? "delivered";
    },
    alertMisconfigured: async () => {},
  };
  return { ...fake, slack, deps };
}

async function sentEmail(h: ReturnType<typeof harness>, opts: { type?: string; env?: "production" | "preview"; venueId?: string | null; providerId?: string | null; key?: string } = {}) {
  const reg = await registerFor(
    { type: opts.type ?? "claim_approval", to: "sam@venue.com", idempotencyKey: opts.key, record: opts.venueId === null ? {} : { venueId: opts.venueId ?? "v1" } },
    { store: h.store, isEnabled: () => true, environment: opts.env ?? "production" }
  );
  assert.ok(reg);
  if (opts.providerId !== null) await recordEmailSendResult(reg, { ok: true, id: opts.providerId ?? `re_${randomBytes(4).toString("hex")}` }, { store: h.store });
  return h.state.messages.find((m) => m.id === reg.emailMessageId)!;
}

async function deliver(h: ReturnType<typeof harness>, body: string, headers = sign(body)) {
  return handleResendWebhookRequest(headers, body, h.deps);
}

// ── Security ────────────────────────────────────────────────────────────────

test("missing RESEND_WEBHOOK_SECRET: every delivery is rejected (500), ONE alert per instance (no flooding), nothing is stored", async () => {
  __resetMisconfiguredAlertForTests();
  const h = harness();
  let alerted = 0;
  const body = openedPayload({ emailId: "re_1" });
  for (let i = 0; i < 5; i++) {
    const out = await handleResendWebhookRequest(sign(body), body, { ...h.deps, secret: null, alertMisconfigured: async () => void alerted++ });
    assert.equal(out.status, 500);
  }
  assert.equal(alerted, 1);
  assert.equal(h.state.events.length, 0);
});

test("missing signature headers ⇒ 401", async () => {
  const h = harness();
  const out = await handleResendWebhookRequest({ id: null, timestamp: null, signature: null }, openedPayload({ emailId: "x" }), h.deps);
  assert.equal(out.status, 401);
  assert.equal(h.state.events.length, 0);
});

test("wrong secret, tampered body, and stale timestamp are all rejected by the real Resend verifier (401)", async () => {
  const h = harness();
  const body = openedPayload({ emailId: "re_1" });
  assert.equal((await deliver(h, body, sign(body, { secretKey: randomBytes(24) }))).status, 401, "wrong secret");
  assert.equal((await deliver(h, body.replace("re_1", "re_2"), sign(body))).status, 401, "tampered body");
  assert.equal((await deliver(h, body, sign(body, { ts: Math.floor(Date.now() / 1000) - 60 * 60 }))).status, 401, "replayed/stale timestamp");
  assert.equal(h.state.events.length, 0);
});

test("a correctly signed non-open event is acknowledged and ignored", async () => {
  const h = harness();
  const body = JSON.stringify({ type: "email.delivered", created_at: "2026-09-29T17:00:00.000Z", data: { email_id: "re_1" } });
  const out = await deliver(h, body);
  assert.equal(out.status, 200);
  assert.equal(out.body.status, "ignored");
  assert.equal(h.state.events.length, 0);
});

test("if the event cannot be persisted the webhook returns 500 so Resend redelivers", async () => {
  const h = harness();
  h.state.fail.insertProviderEvent = true;
  assert.equal((await deliver(h, openedPayload({ emailId: "re_1" }))).status, 500);
});

// ── Matching & first open ────────────────────────────────────────────────────

test("matches by Resend email_id, records the first open, and posts exactly one #customer-success notification", async () => {
  const h = harness();
  const row = await sentEmail(h, { providerId: "re_abc" });
  const out = await deliver(h, openedPayload({ emailId: "re_abc", at: "2026-09-29T17:05:00.000Z" }));
  assert.equal(out.status, 200);
  assert.equal(out.body.outcome, "first_open");
  const after = h.state.messages.find((m) => m.id === row.id)!;
  assert.equal(after.first_opened_at, "2026-09-29T17:05:00.000Z");
  assert.ok(after.open_notified_at);
  assert.equal(h.slack.length, 1);
  assert.match(h.slack[0], /Email opened/);
  assert.match(h.slack[0], /Packing House Pub/);
  assert.match(h.slack[0], /sam@venue\.com/);
});

test("webhook retries (same delivery id) and repeated opens (new delivery ids) never re-notify or move the first open later", async () => {
  const h = harness();
  await sentEmail(h, { providerId: "re_abc" });
  const body = openedPayload({ emailId: "re_abc", at: "2026-09-29T17:05:00.000Z" });
  const headers = sign(body);
  await deliver(h, body, headers);
  const retry = await deliver(h, body, headers);
  assert.equal(retry.body.status, "duplicate");
  const second = await deliver(h, openedPayload({ emailId: "re_abc", at: "2026-09-29T18:00:00.000Z" }));
  assert.equal(second.body.outcome, "repeat_open");
  assert.equal(h.slack.length, 1);
  assert.equal(h.state.messages[0].first_opened_at, "2026-09-29T17:05:00.000Z");
});

test("an out-of-order EARLIER open moves first_opened_at back without a second notification", async () => {
  const h = harness();
  await sentEmail(h, { providerId: "re_abc" });
  await deliver(h, openedPayload({ emailId: "re_abc", at: "2026-09-29T18:00:00.000Z" }));
  await deliver(h, openedPayload({ emailId: "re_abc", at: "2026-09-29T17:00:00.000Z" }));
  assert.equal(h.state.messages[0].first_opened_at, "2026-09-29T17:00:00.000Z");
  assert.equal(h.slack.length, 1);
});

test("early arrival WITH the tag (send result not yet recorded) matches immediately via hhc_send_ref", async () => {
  const h = harness();
  const row = await sentEmail(h, { providerId: null });
  assert.equal(row.provider_message_id, null);
  const out = await deliver(h, openedPayload({ emailId: "re_late", tagRef: row.send_ref }));
  assert.equal(out.body.outcome, "first_open");
  assert.equal(h.slack.length, 1);
});

test("early arrival WITHOUT a usable tag is kept, then matched by the cron once the send is recorded", async () => {
  const h = harness();
  const reg = await registerFor({ type: "claim_approval", to: "sam@venue.com", record: { venueId: "v1" } }, { store: h.store, isEnabled: () => true, environment: "production" });
  const out = await deliver(h, openedPayload({ emailId: "re_early" }));
  assert.equal(out.status, 200);
  assert.equal(out.body.outcome, "unmatched_pending");
  assert.equal(h.state.events[0].processed_at, null);

  await recordEmailSendResult(reg, { ok: true, id: "re_early" }, { store: h.store });
  const run = await runEmailOpenTracking(h.deps);
  assert.equal(run.firstOpens, 1);
  assert.equal(h.slack.length, 1);
  assert.equal(h.state.events[0].outcome, "first_open");
});

test("an event that never matches (e.g. an email sent before tracking) is closed out as 'unmatched' after the retry window", async () => {
  const h = harness();
  await deliver(h, openedPayload({ emailId: "re_unknown" }));
  const later = new Date(Date.now() + UNMATCHED_RETRY_WINDOW_MS + 60_000);
  const run = await runEmailOpenTracking({ ...h.deps, now: () => later });
  assert.equal(run.expiredUnmatched, 1);
  assert.equal(h.state.events[0].outcome, "unmatched");
  assert.equal(h.slack.length, 0);
});

test("a malformed tag is ignored (never used to look up a row)", async () => {
  const h = harness();
  await sentEmail(h, { providerId: "re_real" });
  const out = await deliver(h, openedPayload({ emailId: "re_other", tagRef: "'; drop table email_messages; --" }));
  assert.equal(out.body.outcome, "unmatched_pending");
  assert.equal(h.state.events[0].tagged_send_ref, null);
});

// ── Routing & environment separation ─────────────────────────────────────────

test("verification-code opens are recorded (and timeline-visible) but never posted to Slack", async () => {
  const h = harness();
  const row = await sentEmail(h, { type: "operator_verification_code", providerId: "re_code" });
  await deliver(h, openedPayload({ emailId: "re_code" }));
  assert.ok(h.state.messages.find((m) => m.id === row.id)!.first_opened_at);
  assert.equal(h.slack.length, 0);
});

test("consumer, founder and password-reset opens are recorded but never reach #customer-success", async () => {
  const h = harness();
  for (const [type, id] of [["consumer_signup_confirmation", "re_c"], ["claim_notification", "re_f"], ["password_reset", "re_p"]] as const) {
    await sentEmail(h, { type, providerId: id, venueId: null });
    await deliver(h, openedPayload({ emailId: id }));
  }
  assert.equal(h.state.messages.filter((m) => m.first_opened_at).length, 3);
  assert.equal(h.slack.length, 0);
});

test("staging sends never post to Slack, even when a production deployment processes the open", async () => {
  const h = harness("production");
  await sentEmail(h, { env: "preview", providerId: "re_stg" });
  await deliver(h, openedPayload({ emailId: "re_stg" }));
  await runEmailOpenTracking(h.deps);
  assert.equal(h.slack.length, 0);
});

test("a production open received by a staging deployment is recorded there but only notified by the production cron", async () => {
  const staging = harness("preview");
  await sentEmail(staging, { providerId: "re_prod" });
  await deliver(staging, openedPayload({ emailId: "re_prod" }));
  assert.equal(staging.slack.length, 0);
  const stagingRun = await runEmailOpenTracking(staging.deps);
  assert.equal(stagingRun.notificationsAttempted, 0, "a non-production runtime never posts");

  const prodSlack: string[] = [];
  const run = await runEmailOpenTracking({ ...staging.deps, runtimeEnvironment: "production", sendSlack: async (t) => (prodSlack.push(t), "delivered") });
  assert.equal(run.notificationsDelivered, 1);
  assert.equal(prodSlack.length, 1);
});

// ── Slack failure & retry ────────────────────────────────────────────────────

test("a failed Slack post is retried by the cron and delivered exactly once", async () => {
  const h = harness("production", ["failed"]);
  await sentEmail(h, { providerId: "re_abc" });
  await deliver(h, openedPayload({ emailId: "re_abc" }));
  assert.equal(h.slack.length, 1);
  assert.equal(h.state.messages[0].open_notified_at, null);
  assert.equal(h.state.messages[0].open_notify_attempt_count, 1);

  const run = await runEmailOpenTracking(h.deps);
  assert.equal(run.notificationsDelivered, 1);
  assert.ok(h.state.messages[0].open_notified_at);
  await runEmailOpenTracking(h.deps);
  assert.equal(h.slack.length, 2, "one failed + one delivered post, never a third");
});

test("Slack retries stop after the attempt cap", async () => {
  const h = harness("production", Array(MAX_OPEN_NOTIFY_ATTEMPTS + 3).fill("failed"));
  await sentEmail(h, { providerId: "re_abc" });
  await deliver(h, openedPayload({ emailId: "re_abc" }));
  for (let i = 0; i < MAX_OPEN_NOTIFY_ATTEMPTS + 2; i++) await runEmailOpenTracking(h.deps);
  assert.equal(h.slack.length, MAX_OPEN_NOTIFY_ATTEMPTS);
});

test("a notification claim held by another process (webhook in flight) blocks a concurrent cron post", async () => {
  const h = harness();
  await sentEmail(h, { providerId: "re_abc" });
  h.state.fail.setFirstOpenIfUnset = false;
  // Simulate: first open recorded and claim taken by the webhook, which hasn't finished posting.
  h.state.messages[0].first_opened_at = "2026-09-29T17:00:00.000Z";
  h.state.messages[0].open_notify_claimed_at = new Date().toISOString();
  const run = await runEmailOpenTracking(h.deps);
  assert.equal(run.notificationsAttempted, 1);
  assert.equal(h.slack.length, 0);
});
