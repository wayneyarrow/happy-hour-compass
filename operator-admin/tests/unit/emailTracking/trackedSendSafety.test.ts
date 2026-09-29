import { test } from "node:test";
import assert from "node:assert/strict";
import { registerEmailSend, recordEmailSendResult } from "../../../src/lib/emailTracking/emailSendRegistry";
import {
  planSendVariants,
  rewriteSenderDomain,
  senderAddress,
  sendWithVariants,
  type SendAttempt,
  type SendAttemptResult,
} from "../../../src/lib/emailTracking/trackedSend";
import { getTrackedSenderDomain } from "../../../src/lib/emailTracking/emailTrackingConfig";
import {
  computeSendRef,
  NEVER_TRACKED_SENDER_EMAIL_TYPES,
  TRACKED_SENDER_EMAIL_TYPES,
  usesTrackedSender,
} from "../../../src/lib/emailTracking/emailTrackingPolicy";
import type { EmailTrackingStore } from "../../../src/lib/emailTracking/emailTrackingStore";
import { createFakeEmailTrackingStore } from "./support/fakeEmailTrackingStore";

const ROOT_FROM = "Happy Hour Compass <hello@happyhourcompass.com>";
const CS_FROM = "Wayne <wayne@happyhourcompass.com>";
const TRACKED = "updates.happyhourcompass.com";
const REF = computeSendRef("hhc-customer-success:e1");

function recordingAttempt(results: SendAttemptResult[]): { attempt: SendAttempt; calls: Parameters<SendAttempt>[0][] } {
  const calls: Parameters<SendAttempt>[0][] = [];
  return {
    calls,
    attempt: async (p) => {
      calls.push(p);
      return results.shift() ?? { ok: true, id: "re_default" };
    },
  };
}

function plan(overrides: Partial<Parameters<typeof planSendVariants>[0]> = {}) {
  return planSendVariants({
    from: ROOT_FROM,
    emailType: "claim_approval",
    sendRef: REF,
    environment: "production",
    trackingEnabled: true,
    trackedDomain: TRACKED,
    useTrackedSender: false,
    ...overrides,
  });
}

/** Every method hangs forever — a stalled database connection. */
function hangingStore(): EmailTrackingStore {
  const never = () => new Promise<never>(() => {});
  return new Proxy({} as EmailTrackingStore, { get: () => never });
}

// ── Phase 1 routing ──────────────────────────────────────────────────────────

test("phase 1: ONLY automated Customer Success milestone emails use the tracked subdomain", () => {
  assert.deepEqual([...TRACKED_SENDER_EMAIL_TYPES], ["customer_success_milestone"]);
  assert.equal(usesTrackedSender("customer_success_milestone"), true);
  for (const t of [
    "claim_approval",
    "operator_activation",
    "operator_venue_added",
    "activation_reminder",
    "operator_verification_code",
    "password_reset",
    "consumer_signup_confirmation",
    "claim_notification",
    "customer_success_specials_nudge",
  ]) {
    assert.equal(usesTrackedSender(t), false, t);
  }
});

test("verification codes and password resets can never use the tracked sender, even if added to the tracked list by mistake", () => {
  for (const t of ["operator_verification_code", "password_reset"]) {
    assert.ok(NEVER_TRACKED_SENDER_EMAIL_TYPES.has(t));
    assert.ok(!TRACKED_SENDER_EMAIL_TYPES.has(t));
  }
  const mutable = TRACKED_SENDER_EMAIL_TYPES as Set<string>;
  mutable.add("password_reset");
  try {
    assert.equal(usesTrackedSender("password_reset"), false);
  } finally {
    mutable.delete("password_reset");
  }
  assert.equal(usesTrackedSender("customer_success_milestone", { trigger: "recovery_redirect" }), false);
});

test("tracked subdomain config: only a real happyhourcompass.com subdomain is accepted", () => {
  assert.equal(getTrackedSenderDomain({ EMAIL_TRACKED_SENDER_DOMAIN: " Updates.HappyHourCompass.com " } as unknown as NodeJS.ProcessEnv), TRACKED);
  for (const bad of ["", "happyhourcompass.com", "evil.com", "updates.happyhourcompass.com.evil.com", "a b.happyhourcompass.com"]) {
    assert.equal(getTrackedSenderDomain({ EMAIL_TRACKED_SENDER_DOMAIN: bad } as unknown as NodeJS.ProcessEnv), null, bad);
  }
});

// ── Variant planning ─────────────────────────────────────────────────────────

test("tracking OFF: the first request is exactly the pre-tracking request (no tags, same sender)", () => {
  const variants = plan({ trackingEnabled: false, from: CS_FROM, replyTo: "wayne@happyhourcompass.com", emailType: "customer_success_milestone", useTrackedSender: true });
  assert.deepEqual(variants[0], { kind: "untracked", from: CS_FROM, replyTo: "wayne@happyhourcompass.com" });
});

test("tracking ON, milestone: sent From the tracked subdomain (same name/local part), Reply-To on the real inbox, with tags", () => {
  const [first] = plan({ from: CS_FROM, replyTo: "wayne@happyhourcompass.com", emailType: "customer_success_milestone", useTrackedSender: true });
  assert.equal(first.kind, "tagged_tracked");
  assert.equal(first.from, "Wayne <wayne@updates.happyhourcompass.com>");
  assert.equal(first.replyTo, "wayne@happyhourcompass.com");
  assert.equal(first.tags?.[0].value, REF);
});

test("tracking ON, every other type (setup, reminders, codes, resets): stays on the root domain — tags only, so no open can be reported", () => {
  for (const type of ["claim_approval", "activation_reminder", "operator_verification_code", "password_reset"]) {
    const [first] = plan({ emailType: type, useTrackedSender: usesTrackedSender(type) });
    assert.equal(first.kind, "tagged_root", type);
    assert.equal(first.from, ROOT_FROM, type);
  }
});

test("tracking ON without a configured subdomain: milestone stays on the root domain", () => {
  const [first] = plan({ trackedDomain: null, emailType: "customer_success_milestone", useTrackedSender: true });
  assert.equal(first.kind, "tagged_root");
});

test("sender rewrite keeps display name and local part", () => {
  assert.equal(rewriteSenderDomain(ROOT_FROM, TRACKED), "Happy Hour Compass <hello@updates.happyhourcompass.com>");
  assert.equal(rewriteSenderDomain("hello@happyhourcompass.com", TRACKED), "hello@updates.happyhourcompass.com");
  assert.equal(senderAddress(ROOT_FROM), "hello@happyhourcompass.com");
  const [first] = plan({ emailType: "customer_success_milestone", useTrackedSender: true });
  assert.equal(first.replyTo, "hello@happyhourcompass.com", "no explicit Reply-To ⇒ replies still reach the root inbox");
});

// ── Database failure can never stop a critical email ─────────────────────────

test("a HUNG database: registration gives up within the bound, and the send is unaffected (the request never depends on the database)", async () => {
  const started = Date.now();
  const registered = await registerEmailSend(
    { type: "operator_verification_code", to: "op@venue.com", sendKey: "hhc-operator-verification-code:k", record: { lifecycleId: "lc1" } },
    { store: hangingStore(), isEnabled: () => true, timeoutMs: 50 }
  );
  assert.equal(registered, null);
  assert.ok(Date.now() - started < 1_000);

  const { attempt, calls } = recordingAttempt([{ ok: true, id: "re_1" }]);
  const sent = await sendWithVariants({ attempt, variants: plan({ emailType: "operator_verification_code" }), hasIdempotencyKey: true, logContext: { type: "operator_verification_code" } });
  assert.equal(sent.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, ROOT_FROM);

  const recordStarted = Date.now();
  await recordEmailSendResult({ emailMessageId: "x", attemptNumber: 1 }, { ok: true, id: "re_1" }, { store: hangingStore(), timeoutMs: 50 });
  assert.ok(Date.now() - recordStarted < 1_000, "recording the result can't hold the caller either");
});

test("a FAILING or THROWING database: registration degrades to null without throwing", async () => {
  for (const store of [
    (() => { const f = createFakeEmailTrackingStore(); f.state.fail.insertEmailMessage = true; return f.store; })(),
    { ...createFakeEmailTrackingStore().store, insertEmailMessage: async () => { throw new Error("connection reset"); } },
    { ...createFakeEmailTrackingStore().store, resolveLifecycleLinks: async () => { throw new Error("boom"); } },
  ]) {
    assert.equal(await registerEmailSend({ type: "claim_approval", to: "op@venue.com", sendKey: "k", record: { lifecycleId: "lc1" } }, { store, isEnabled: () => true }), null);
  }
  const f = createFakeEmailTrackingStore();
  f.state.fail.markEmailSent = true;
  await assert.doesNotReject(recordEmailSendResult({ emailMessageId: "x", attemptNumber: 1 }, { ok: true, id: "re_1" }, { store: f.store }));
});

// ── Fallback rules (unit level; realistic Resend simulation in idempotentRetry.test.ts) ──

test("tracked request rejected for configuration (e.g. subdomain not verified) ⇒ untracked retry from the root domain, other tagged variants skipped", async () => {
  const { attempt, calls } = recordingAttempt([
    { ok: false, error: "The updates.happyhourcompass.com domain is not verified.", errorName: "validation_error" },
    { ok: true, id: "re_2" },
  ]);
  const sent = await sendWithVariants({ attempt, variants: plan({ emailType: "customer_success_milestone", useTrackedSender: true }), hasIdempotencyKey: true, logContext: { type: "x" } });
  assert.equal(sent.ok, true);
  assert.equal(sent.variant.kind, "untracked");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { from: ROOT_FROM, replyTo: undefined });
});

test("transient provider failures are NOT retried here (caller's own retry/escalation handles them)", async () => {
  for (const errorName of ["rate_limit_exceeded", "application_error", undefined]) {
    const { attempt, calls } = recordingAttempt([{ ok: false, error: "x", errorName }]);
    const sent = await sendWithVariants({ attempt, variants: plan({ emailType: "customer_success_milestone", useTrackedSender: true }), hasIdempotencyKey: true, logContext: { type: "x" } });
    assert.equal(sent.ok, false);
    assert.equal(calls.length, 1, String(errorName));
  }
});

test("a 409 without an idempotency key is never followed by another variant", async () => {
  const { attempt, calls } = recordingAttempt([{ ok: false, error: "x", errorName: "invalid_idempotent_request" }]);
  await sendWithVariants({ attempt, variants: plan(), hasIdempotencyKey: false, logContext: { type: "x" } });
  assert.equal(calls.length, 1);
});

test("an untracked-first request (flag off) that fails validation is not retried with tags", async () => {
  const { attempt, calls } = recordingAttempt([{ ok: false, error: "bad", errorName: "validation_error" }]);
  const sent = await sendWithVariants({ attempt, variants: plan({ trackingEnabled: false }), hasIdempotencyKey: true, logContext: { type: "x" } });
  assert.equal(sent.ok, false);
  assert.equal(calls.length, 1);
});

// ── Venue association from claim/submission ──────────────────────────────────

test("a claim/submission-linked email resolves its venue when the caller didn't pass one", async () => {
  const { store, state } = createFakeEmailTrackingStore({ originVenues: { sub1: "v9", claim1: "v7" } });
  const deps = { store, isEnabled: () => true };
  await registerEmailSend({ type: "operator_submission_more_info", to: "a@b.co", sendKey: "s1", record: { submissionId: "sub1" } }, deps);
  await registerEmailSend({ type: "claim_more_info", to: "a@b.co", sendKey: "s2", record: { claimId: "claim1" } }, deps);
  await registerEmailSend({ type: "operator_submission_closed", to: "a@b.co", sendKey: "s3", record: { submissionId: "sub-without-venue" } }, deps);
  assert.deepEqual(state.messages.map((m) => m.venue_id), ["v9", "v7", null]);
  assert.ok(state.messages.every((m) => m.open_notification === "none"), "timeline only — never Slack");
});
