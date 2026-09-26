import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deliverDeferredActivationStart,
  planActivationVerificationMode,
} from "../../../src/lib/activation/emailCodeActivationStart";
import { readVerificationLinkToken } from "../../../src/lib/activation/emailCodeVerificationTokens";
import type { ActivationLifecycleRow, ClaimActivationLifecycleResult } from "../../../src/lib/activation/activationLifecycle";
import { makeFakeEmailCodeDb, untouchableClient } from "./support/fakeEmailCodeDb";

/**
 * The single feature-flag decision point and the post-lifecycle delivery
 * step. Every sender/link generator is an injected spy — nothing here can
 * reach Resend, Supabase Auth, or Slack.
 */

const SECRET = "test-hmac-secret-that-is-at-least-32-characters-long";
const T0 = new Date("2026-09-25T18:00:00.000Z");
const OPERATOR = "22222222-2222-4222-8222-222222222222";

function lifecycle(overrides: Partial<ActivationLifecycleRow> = {}): ActivationLifecycleRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    operatorId: OPERATOR,
    originType: "claim",
    originClaimId: "c1",
    originSubmissionId: null,
    startedAt: T0.toISOString(),
    deadlineAt: "2026-10-09T18:00:00.000Z",
    reminderStage: 0,
    expiredAt: null,
    releasedAt: null,
    verificationRequired: true,
    ...overrides,
  };
}

// ── planActivationVerificationMode ───────────────────────────────────────────

test("plan: flag OFF → legacy, with zero reads of anything (Production today)", async () => {
  const plan = await planActivationVerificationMode(
    { email: "new@venue.example" },
    { isEnabled: () => false, adminClient: untouchableClient(), secret: SECRET }
  );
  assert.equal(plan, "legacy");
});

test("plan: the real flag reader defaults to OFF when the variable is unset", async () => {
  const previous = process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED;
  delete process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED;
  try {
    assert.equal(await planActivationVerificationMode({ email: "x@y.example" }, { adminClient: untouchableClient() }), "legacy");
  } finally {
    if (previous !== undefined) process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED = previous;
  }
});

test("plan: flag ON but HMAC secret missing → legacy (never a half-configured flow)", async () => {
  const plan = await planActivationVerificationMode(
    { email: "new@venue.example" },
    { isEnabled: () => true, adminClient: untouchableClient(), secret: null }
  );
  assert.equal(plan, "legacy");
});

test("plan: flag ON, brand-new operator → email_code", async () => {
  const db = makeFakeEmailCodeDb({ now: () => T0 });
  assert.equal(
    await planActivationVerificationMode({ email: "new@venue.example" }, { isEnabled: () => true, adminClient: db.client, secret: SECRET }),
    "email_code"
  );
});

test("plan: flag ON, already-activated (returning) operator → legacy (unchanged 'venue added' path)", async () => {
  const db = makeFakeEmailCodeDb({ now: () => T0 });
  db.seedOperator({ id: OPERATOR, email: "owner@venue.example", account_activated_at: "2026-09-01T00:00:00.000Z" });
  assert.equal(
    await planActivationVerificationMode({ email: "owner@venue.example" }, { isEnabled: () => true, adminClient: db.client, secret: SECRET }),
    "legacy"
  );
});

test("plan: flag ON, operator with a live GRANDFATHERED legacy lifecycle → legacy (the existing lifecycle is reused, never converted)", async () => {
  const db = makeFakeEmailCodeDb({ now: () => T0 });
  db.seedOperator({ id: OPERATOR, email: "owner@venue.example" });
  db.seedLifecycle({ id: "11111111-1111-4111-8111-111111111111", operator_id: OPERATOR, deadline_at: "2026-10-06T00:00:00.000Z", verification_required: false });
  assert.equal(
    await planActivationVerificationMode({ email: "owner@venue.example" }, { isEnabled: () => true, adminClient: db.client, secret: SECRET }),
    "legacy"
  );
});

test("plan: flag ON, operator with a live email-code lifecycle → email_code; an expired/released one doesn't count", async () => {
  const live = makeFakeEmailCodeDb({ now: () => T0 });
  live.seedOperator({ id: OPERATOR, email: "owner@venue.example" });
  live.seedLifecycle({ id: "11111111-1111-4111-8111-111111111111", operator_id: OPERATOR, deadline_at: "2026-10-06T00:00:00.000Z", verification_required: true });
  assert.equal(
    await planActivationVerificationMode({ email: "owner@venue.example" }, { isEnabled: () => true, adminClient: live.client, secret: SECRET }),
    "email_code"
  );

  const closed = makeFakeEmailCodeDb({ now: () => T0 });
  closed.seedOperator({ id: OPERATOR, email: "owner@venue.example" });
  closed.seedLifecycle({
    id: "11111111-1111-4111-8111-111111111111",
    operator_id: OPERATOR,
    deadline_at: "2026-09-20T00:00:00.000Z",
    verification_required: false,
    released_at: "2026-09-21T00:00:00.000Z",
  });
  assert.equal(
    await planActivationVerificationMode({ email: "owner@venue.example" }, { isEnabled: () => true, adminClient: closed.client, secret: SECRET }),
    "email_code",
    "a restarted operator (prior lifecycle released) gets the current flow for their NEW lifecycle"
  );
});

test("plan: flag ON, any read error → legacy", async () => {
  const db = makeFakeEmailCodeDb({ now: () => T0, failTables: ["operators"] });
  assert.equal(
    await planActivationVerificationMode({ email: "x@y.example" }, { isEnabled: () => true, adminClient: db.client, secret: SECRET }),
    "legacy"
  );
});

// ── deliverDeferredActivationStart ───────────────────────────────────────────

function spies() {
  const continueEmails: { to: string; origin: string; continueUrl: string }[] = [];
  const issued: string[] = [];
  const legacyEmails: string[] = [];
  const generateLinkCalls: unknown[] = [];
  return {
    continueEmails,
    issued,
    legacyEmails,
    generateLinkCalls,
    deps: {
      adminClient: untouchableClient(),
      secret: SECRET,
      siteUrl: "https://staging.example",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendContinueEmail: (async (p: any) => {
        continueEmails.push({ to: p.to, origin: p.origin, continueUrl: p.continueUrl });
        return { ok: true };
      }) as never,
      issueCode: (async (lifecycleId: string) => {
        issued.push(lifecycleId);
        return { status: "code_sent" };
      }) as never,
      generateLink: (async (_c: unknown, params: unknown) => {
        generateLinkCalls.push(params);
        return { data: { properties: { action_link: "https://supabase.example/legacy-link" } }, error: null };
      }) as never,
    },
    sendLegacySetupEmail: async (link: string) => {
      legacyEmails.push(link);
      return { ok: true };
    },
  };
}

const recipient = { email: "owner@venue.example", firstName: "Sam" };

test("deliver: founder approval of a verification-required lifecycle sends ONE continue-setup email linking to that lifecycle's code screen — no Supabase link", async () => {
  for (const origin of ["claim", "submission"] as const) {
    const s = spies();
    const lc = lifecycle({ originType: origin });
    const result = await deliverDeferredActivationStart(
      { lifecycleResult: { decision: "started", lifecycle: lc }, delivery: "email_link", origin, recipient, logTag: "[t]", sendLegacySetupEmail: s.sendLegacySetupEmail },
      s.deps
    );
    assert.deepEqual(result, { kind: "continue_email_sent" });
    assert.equal(s.continueEmails.length, 1);
    assert.equal(s.continueEmails[0].origin, origin, "origin preserved into the email copy");
    const url = new URL(s.continueEmails[0].continueUrl);
    assert.equal(url.origin + url.pathname, "https://staging.example/operator/verify");
    assert.equal(readVerificationLinkToken(url.searchParams.get("t"), SECRET), lc.id);
    assert.equal(s.generateLinkCalls.length, 0);
    assert.equal(s.legacyEmails.length, 0);
    assert.equal(s.issued.length, 0, "founder approvals never auto-send a code (it would expire unread)");
  }
});

test("deliver: in-flow submission issues the first code and returns the in-app verify path for that lifecycle", async () => {
  const s = spies();
  const lc = lifecycle({ originType: "submission", originClaimId: null, originSubmissionId: "s1" });
  const result = await deliverDeferredActivationStart(
    { lifecycleResult: { decision: "started", lifecycle: lc }, delivery: "in_flow", origin: "submission", recipient, requestIp: "203.0.113.9", logTag: "[t]", sendLegacySetupEmail: s.sendLegacySetupEmail },
    s.deps
  );
  assert.equal(result.kind, "code_issued");
  if (result.kind === "code_issued") {
    assert.match(result.verificationPath, /^\/operator\/verify\?t=/);
    assert.equal(readVerificationLinkToken(new URLSearchParams(result.verificationPath.split("?")[1]).get("t"), SECRET), lc.id);
  }
  assert.deepEqual(s.issued, [lc.id]);
  assert.equal(s.continueEmails.length + s.legacyEmails.length + s.generateLinkCalls.length, 0);
});

test("deliver: a REUSED verification-required lifecycle is used as-is — no second lifecycle, same code screen", async () => {
  const s = spies();
  const lc = lifecycle();
  const result = await deliverDeferredActivationStart(
    { lifecycleResult: { decision: "reused", lifecycle: lc }, delivery: "email_link", origin: "claim", recipient, logTag: "[t]", sendLegacySetupEmail: s.sendLegacySetupEmail },
    s.deps
  );
  assert.deepEqual(result, { kind: "continue_email_sent" });
  assert.equal(readVerificationLinkToken(new URL(s.continueEmails[0].continueUrl).searchParams.get("t"), SECRET), lc.id);
});

test("deliver: a reused LEGACY lifecycle, or a failed lifecycle claim, falls back to the exact legacy setup email", async () => {
  const cases: ClaimActivationLifecycleResult[] = [
    { decision: "reused", lifecycle: lifecycle({ verificationRequired: false }) },
    { decision: "claim_failed", error: "db down" },
  ];
  for (const lifecycleResult of cases) {
    const s = spies();
    const result = await deliverDeferredActivationStart(
      { lifecycleResult, delivery: "in_flow", origin: "submission", recipient, logTag: "[t]", sendLegacySetupEmail: s.sendLegacySetupEmail },
      s.deps
    );
    assert.deepEqual(result, { kind: "legacy_fallback_sent" });
    assert.deepEqual(s.legacyEmails, ["https://supabase.example/legacy-link"]);
    assert.equal(s.issued.length + s.continueEmails.length, 0);
  }
});

test("deliver: an operator who activated in the meantime is sent nothing", async () => {
  const s = spies();
  const result = await deliverDeferredActivationStart(
    { lifecycleResult: { decision: "already_activated" }, delivery: "email_link", origin: "claim", recipient, logTag: "[t]", sendLegacySetupEmail: s.sendLegacySetupEmail },
    s.deps
  );
  assert.deepEqual(result, { kind: "nothing_to_send" });
  assert.equal(s.issued.length + s.continueEmails.length + s.legacyEmails.length + s.generateLinkCalls.length, 0);
});

test("deliver: a continue-setup email failure is reported, never masked by a legacy link", async () => {
  const s = spies();
  const result = await deliverDeferredActivationStart(
    { lifecycleResult: { decision: "started", lifecycle: lifecycle() }, delivery: "email_link", origin: "claim", recipient, logTag: "[t]", sendLegacySetupEmail: s.sendLegacySetupEmail },
    { ...s.deps, sendContinueEmail: (async () => ({ ok: false, error: "provider down" })) as never }
  );
  assert.deepEqual(result, { kind: "failed", error: "provider down" });
  assert.equal(s.generateLinkCalls.length, 0);
});
