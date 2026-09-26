import { test } from "node:test";
import assert from "node:assert/strict";
import {
  continueAfterVerification,
  loadVerificationPageView,
  requestVerificationCode,
  startSessionAfterVerification,
  submitVerificationCode,
  type EmailCodeVerificationDeps,
} from "../../../src/lib/activation/emailCodeVerificationService";
import { computeVerificationCodeDigest } from "../../../src/lib/activation/emailCodeVerificationPolicy";
import { signVerificationLinkToken, signVerifiedBrowserProof } from "../../../src/lib/activation/emailCodeVerificationTokens";
import { makeFakeEmailCodeDb } from "./support/fakeEmailCodeDb";

/**
 * Behavior of the email-code verification engine against an in-memory
 * model of migration 100 (see support/fakeEmailCodeDb.ts). No real
 * database, Resend, Supabase Auth, or Slack is reachable from here: every
 * email send, link generation, and session exchange is an injected spy.
 */

const SECRET = "test-hmac-secret-that-is-at-least-32-characters-long";
const OTHER_SECRET = "another-hmac-secret-that-is-also-32-characters-long";
const LIFECYCLE = "11111111-1111-4111-8111-111111111111";
const OPERATOR = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-09-25T18:00:00.000Z");

function world(opts: {
  verificationRequired?: boolean;
  lifecycle?: Partial<{ expired_at: string | null; released_at: string | null; deadline_at: string; verification_completed_at: string | null }>;
  activatedAt?: string | null;
  failRpc?: string[];
  failTables?: string[];
  sendOk?: boolean;
} = {}) {
  let now = T0;
  const db = makeFakeEmailCodeDb({ now: () => now, failRpc: opts.failRpc, failTables: opts.failTables });
  db.seedOperator({ id: OPERATOR, email: "owner@venue.example", first_name: "Sam", account_activated_at: opts.activatedAt ?? null });
  db.seedLifecycle({
    id: LIFECYCLE,
    operator_id: OPERATOR,
    deadline_at: "2026-10-09T18:00:00.000Z",
    verification_required: opts.verificationRequired ?? true,
    ...opts.lifecycle,
  });
  const emails: { to: string; code: string; idempotencyKey: string; continueUrl: string }[] = [];
  const sessions: string[] = [];
  let nextCode = 123456;
  const deps: EmailCodeVerificationDeps = {
    adminClient: db.client,
    secret: SECRET,
    now: () => now,
    generateCode: () => String(nextCode++),
    siteUrl: "https://staging.example",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCodeEmail: (async (p: any) => {
      emails.push({ to: p.to, code: p.code, idempotencyKey: p.idempotencyKey, continueUrl: p.continueUrl });
      return opts.sendOk === false ? { ok: false, error: "provider down" } : { ok: true };
    }) as EmailCodeVerificationDeps["sendCodeEmail"],
    establishSession: async (tokenHash) => {
      sessions.push(tokenHash);
      return { ok: true };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generateLink: ((client: any, params: any) => client.auth.admin.generateLink(params)) as EmailCodeVerificationDeps["generateLink"],
  };
  const token = signVerificationLinkToken(LIFECYCLE, SECRET)!;
  return {
    db,
    deps,
    token,
    emails,
    sessions,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    codes: () => db.tables.operator_verification_codes,
    lifecycle: () => db.tables.operator_activation_lifecycles.find((l) => l.id === LIFECYCLE)!,
  };
}

async function sendFirstCode(w: ReturnType<typeof world>) {
  const result = await requestVerificationCode(w.token, { requestIp: "203.0.113.9" }, w.deps);
  assert.equal(result.status, "code_sent");
  return w.emails.at(-1)!.code;
}

// ── Issue ────────────────────────────────────────────────────────────────────

test("send code: issues exactly one code, stores only its HMAC digest, and emails the plaintext once", async () => {
  const w = world();
  const code = await sendFirstCode(w);

  assert.equal(w.emails.length, 1);
  assert.equal(w.emails[0].to, "owner@venue.example");
  assert.match(code, /^\d{6}$/);
  const [row] = w.codes();
  assert.equal(row.code_digest, computeVerificationCodeDigest({ code, lifecycleId: LIFECYCLE, secret: SECRET }));
  assert.ok(!JSON.stringify(w.codes()).includes(code), "plaintext code must never be stored");
  assert.equal(row.request_ip, "203.0.113.9");
  assert.equal(w.emails[0].idempotencyKey, `hhc-operator-verification-code:${row.id}`);
  assert.ok(w.emails[0].continueUrl.startsWith("https://staging.example/operator/verify?t="));
});

test("send code: never issues or emails for a forged token, a token from another secret, or a missing secret", async () => {
  const w = world();
  for (const token of ["", "garbage", `${LIFECYCLE}.AAAA`, signVerificationLinkToken(LIFECYCLE, OTHER_SECRET)!]) {
    assert.equal((await requestVerificationCode(token, { requestIp: null }, w.deps)).status, "unavailable");
  }
  assert.equal((await requestVerificationCode(w.token, { requestIp: null }, { ...w.deps, secret: null })).status, "unavailable");
  assert.equal(w.db.rpcCalls.length, 0);
  assert.equal(w.emails.length, 0);
});

test("send code: a LEGACY lifecycle (verification_required = false) can never be sent a code", async () => {
  const w = world({ verificationRequired: false });
  const result = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(result.status, "unavailable");
  assert.equal(w.emails.length, 0);
  assert.equal(w.codes().length, 0);
});

test("send code: a provider failure reports send_failed (never 'sent'), and the issued row still counts toward cooldown", async () => {
  const w = world({ sendOk: false });
  const result = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(result.status, "send_failed");
  assert.equal(w.codes().length, 1);
  const again = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(again.status, "resend_cooldown");
  assert.equal(w.emails.length, 1, "no second send inside the cooldown");
});

// ── Resend ───────────────────────────────────────────────────────────────────

test("resend: rejected inside the 60-second cooldown with no email, and reports when it becomes available", async () => {
  const w = world();
  await sendFirstCode(w);
  w.advance(30_000);
  const result = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(result.status, "resend_cooldown");
  assert.equal(result.resendAvailableAt, new Date(T0.getTime() + 60_000).toISOString());
  assert.equal(w.emails.length, 1);
});

test("resend: after the cooldown a new code replaces the old one — the old code no longer verifies", async () => {
  const w = world();
  const oldCode = await sendFirstCode(w);
  w.advance(60_000);
  const newCode = await sendFirstCode(w);
  assert.notEqual(oldCode, newCode);

  const [first, second] = w.codes();
  assert.ok(first.superseded_at, "previous code superseded in the same issuance");
  assert.equal(second.superseded_at, null);

  const stale = await submitVerificationCode(w.token, oldCode, w.deps);
  assert.equal(stale.status, "invalid_code");
  assert.equal(w.lifecycle().verification_completed_at, null);
  const fresh = await submitVerificationCode(w.token, newCode, w.deps);
  assert.equal(fresh.status, "verified");
});

test("resend: rapid duplicate clicks (concurrent requests) send exactly one email", async () => {
  const w = world();
  const results = await Promise.all([
    requestVerificationCode(w.token, { requestIp: null }, w.deps),
    requestVerificationCode(w.token, { requestIp: null }, w.deps),
    requestVerificationCode(w.token, { requestIp: null }, w.deps),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["code_sent", "resend_cooldown", "resend_cooldown"]);
  assert.equal(w.emails.length, 1);
  assert.equal(w.codes().filter((c) => !c.superseded_at && !c.consumed_at).length, 1);
});

test("resend: the 5-per-rolling-hour cap blocks a sixth send and reports when the window frees up", async () => {
  const w = world();
  for (let i = 0; i < 5; i++) {
    await sendFirstCode(w);
    w.advance(60_000);
  }
  const blocked = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(blocked.status, "rate_limited");
  assert.equal(blocked.resendAvailableAt, new Date(T0.getTime() + 3_600_000).toISOString());
  assert.equal(w.emails.length, 5);
});

test("resend: never creates, restarts, or extends the activation lifecycle", async () => {
  const w = world();
  const before = { ...w.lifecycle() };
  await sendFirstCode(w);
  w.advance(60_000);
  await sendFirstCode(w);
  assert.equal(w.db.tables.operator_activation_lifecycles.length, 1);
  const after = w.lifecycle();
  for (const key of ["started_at", "deadline_at", "reminder_stage", "expired_at", "released_at", "operator_id"]) {
    assert.equal(after[key], before[key], `${key} changed`);
  }
});

// ── Verify ───────────────────────────────────────────────────────────────────

test("verify: the correct code succeeds, records completion once, and never touches attempt_count", async () => {
  const w = world();
  const code = await sendFirstCode(w);
  const result = await submitVerificationCode(w.token, code, w.deps);
  assert.deepEqual(result, { status: "verified", consumedNow: true, lifecycleId: LIFECYCLE });
  assert.equal(w.lifecycle().verification_completed_at, T0.toISOString());
  assert.equal(w.codes()[0].consumed_at, T0.toISOString());
  assert.equal(w.codes()[0].attempt_count, 0);
});

test("verify: an incorrect code fails, records exactly one attempt, and leaves the operator unverified", async () => {
  const w = world();
  const code = await sendFirstCode(w);
  const wrong = code === "000000" ? "111111" : "000000";
  const result = await submitVerificationCode(w.token, wrong, w.deps);
  assert.equal(result.status, "invalid_code");
  assert.equal(w.codes()[0].attempt_count, 1);
  assert.equal(w.lifecycle().verification_completed_at, null);
});

test("verify: malformed input is rejected before any lookup and never counts as an attempt", async () => {
  const w = world();
  await sendFirstCode(w);
  const readsBefore = w.db.tableReads();
  for (const input of ["12345", "1234567", "12a456", "", null, 123456]) {
    assert.equal((await submitVerificationCode(w.token, input, w.deps)).status, "invalid_format");
  }
  assert.equal(w.db.tableReads(), readsBefore);
  assert.equal(w.codes()[0].attempt_count, 0);
});

test("verify: an expired code fails without comparing or counting, and a new code can then be requested", async () => {
  const w = world();
  const code = await sendFirstCode(w);
  w.advance(10 * 60_000);
  const rpcBefore = w.db.rpcCalls.length;
  const result = await submitVerificationCode(w.token, code, w.deps);
  assert.equal(result.status, "expired");
  assert.equal(w.db.rpcCalls.length, rpcBefore, "no consume/failure call for an expired code");
  assert.equal(w.codes()[0].attempt_count, 0);

  const next = await sendFirstCode(w);
  assert.equal((await submitVerificationCode(w.token, next, w.deps)).status, "verified");
});

test("verify: five incorrect attempts exhaust the code — then even the correct code is rejected", async () => {
  const w = world();
  const code = await sendFirstCode(w);
  const wrong = code === "000000" ? "111111" : "000000";
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await submitVerificationCode(w.token, wrong, w.deps)).status);
  assert.deepEqual(statuses, ["invalid_code", "invalid_code", "invalid_code", "invalid_code", "attempts_exhausted"]);
  assert.equal((await submitVerificationCode(w.token, code, w.deps)).status, "attempts_exhausted");
  assert.equal(w.lifecycle().verification_completed_at, null);
});

test("verify: a used code cannot be reused — a second submission never consumes again", async () => {
  const w = world();
  const code = await sendFirstCode(w);
  await submitVerificationCode(w.token, code, w.deps);
  const completedAt = w.lifecycle().verification_completed_at;
  w.advance(5_000);
  const again = await submitVerificationCode(w.token, code, w.deps);
  assert.deepEqual(again, { status: "verified", consumedNow: false, lifecycleId: LIFECYCLE });
  assert.equal(w.lifecycle().verification_completed_at, completedAt, "completion is recorded exactly once");
  assert.equal(w.codes().filter((c) => c.consumed_at).length, 1);
});

test("verify: concurrent double-submit of the correct code consumes once; only one call may start a session", async () => {
  const w = world();
  const code = await sendFirstCode(w);
  const results = await Promise.all([
    submitVerificationCode(w.token, code, w.deps),
    submitVerificationCode(w.token, code, w.deps),
  ]);
  const consumedNow = results.map((r) => (r.status === "verified" ? r.consumedNow : null)).sort();
  assert.deepEqual(consumedNow, [false, true]);
  assert.equal(w.codes().filter((c) => c.consumed_at).length, 1);
});

test("verify: if recording an incorrect attempt fails, the operator gets a generic error — never 'incorrect' for an unrecorded guess", async () => {
  const w = world({ failRpc: ["record_operator_verification_code_failure"] });
  const code = await sendFirstCode(w);
  const result = await submitVerificationCode(w.token, code === "000000" ? "111111" : "000000", w.deps);
  assert.equal(result.status, "unavailable");
});

test("verify: closed or activated lifecycles never verify", async () => {
  for (const variant of [
    { lifecycle: { released_at: "2026-09-24T00:00:00.000Z" } },
    { lifecycle: { expired_at: "2026-09-24T00:00:00.000Z" } },
    { lifecycle: { deadline_at: "2026-09-25T17:00:00.000Z" } },
    { activatedAt: "2026-09-24T00:00:00.000Z" },
  ]) {
    const w = world(variant);
    assert.equal((await submitVerificationCode(w.token, "123456", w.deps)).status, "unavailable");
    assert.equal(w.lifecycle().verification_completed_at ?? null, null);
  }
});

// ── Session start (continuation into the existing activation) ────────────────

test("session: a verified operator gets a session for the existing create-password step — no auth user is created", async () => {
  const w = world();
  const code = await sendFirstCode(w);
  await submitVerificationCode(w.token, code, w.deps);
  const result = await startSessionAfterVerification(LIFECYCLE, w.deps);
  assert.deepEqual(result, { status: "verified", next: "/operator/create-password" });
  assert.equal(w.db.generateLinkCalls.length, 1);
  assert.equal(w.db.generateLinkCalls[0].type, "recovery");
  assert.equal(w.db.generateLinkCalls[0].email, "owner@venue.example");
  assert.deepEqual(w.sessions, ["hashed-1"]);
  // makeFakeEmailCodeDb's createUser throws if ever called — reaching here proves it wasn't.
});

test("session: an UNVERIFIED verification-required lifecycle can never get a session (no bypass)", async () => {
  const w = world();
  await sendFirstCode(w);
  const result = await startSessionAfterVerification(LIFECYCLE, w.deps);
  assert.equal(result.status, "unavailable");
  assert.equal(w.db.generateLinkCalls.length, 0);
  assert.equal(w.sessions.length, 0);
});

test("session: a legacy lifecycle can never get a session through this path", async () => {
  const w = world({ verificationRequired: false, lifecycle: { verification_completed_at: null } });
  assert.equal((await startSessionAfterVerification(LIFECYCLE, w.deps)).status, "unavailable");
  assert.equal(w.db.generateLinkCalls.length, 0);
});

test("continue: only the browser holding a valid verified-browser proof can resume; the link token alone never can", async () => {
  const w = world();
  const code = await sendFirstCode(w);
  await submitVerificationCode(w.token, code, w.deps);

  const noProof = await continueAfterVerification(w.token, null, w.deps);
  assert.deepEqual(noProof, { status: "verified" });
  const otherLifecycleProof = signVerifiedBrowserProof("33333333-3333-4333-8333-333333333333", SECRET, T0);
  assert.deepEqual(await continueAfterVerification(w.token, otherLifecycleProof, w.deps), { status: "verified" });
  assert.equal(w.db.generateLinkCalls.length, 0);

  const proof = signVerifiedBrowserProof(LIFECYCLE, SECRET, T0);
  const resumed = await continueAfterVerification(w.token, proof, w.deps);
  assert.deepEqual(resumed, { status: "verified", next: "/operator/create-password" });

  w.advance(31 * 60_000);
  assert.deepEqual(await continueAfterVerification(w.token, proof, w.deps), { status: "verified" }, "proof expires");
});

// ── Page state (refresh / back-forward safety) ───────────────────────────────

test("page: loading is read-only — it never issues or consumes a code, however often it is refreshed", async () => {
  const w = world();
  for (let i = 0; i < 3; i++) {
    await loadVerificationPageView(w.token, { sessionUserId: null, verifiedProof: null }, w.deps);
  }
  assert.equal(w.db.rpcCalls.length, 0);
  assert.equal(w.emails.length, 0);
  assert.equal(w.codes().length, 0);
});

test("page: pending states reflect the current code, its expiry, exhaustion, and the resend timer", async () => {
  const w = world();
  const browser = { sessionUserId: null, verifiedProof: null };
  assert.deepEqual(await loadVerificationPageView(w.token, browser, w.deps), {
    view: "pending",
    maskedEmail: "o****@venue.example",
    hasCurrentCode: false,
    notice: null,
    expiresAt: null,
    resendAvailableAt: null,
  });

  const code = await sendFirstCode(w);
  const afterSend = await loadVerificationPageView(w.token, browser, w.deps);
  assert.equal(afterSend.view, "pending");
  if (afterSend.view === "pending") {
    assert.equal(afterSend.hasCurrentCode, true);
    assert.equal(afterSend.expiresAt, new Date(T0.getTime() + 600_000).toISOString());
    assert.equal(afterSend.resendAvailableAt, new Date(T0.getTime() + 60_000).toISOString());
  }

  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, code === "000000" ? "111111" : "000000", w.deps);
  const exhausted = await loadVerificationPageView(w.token, browser, w.deps);
  assert.equal(exhausted.view === "pending" && exhausted.notice, "attempts_exhausted");

  w.advance(11 * 60_000);
  const expired = await loadVerificationPageView(w.token, browser, w.deps);
  assert.equal(expired.view === "pending" && expired.hasCurrentCode, false);
  assert.equal(expired.view === "pending" && expired.resendAvailableAt, null);
});

test("page: verified, activated, closed, legacy, and forged states", async () => {
  const browser = { sessionUserId: null, verifiedProof: null };
  const w = world();
  const code = await sendFirstCode(w);
  await submitVerificationCode(w.token, code, w.deps);
  assert.deepEqual(await loadVerificationPageView(w.token, browser, w.deps), {
    view: "verified",
    maskedEmail: "o****@venue.example",
    continueVia: null,
  });
  const viaSession = await loadVerificationPageView(w.token, { sessionUserId: OPERATOR, verifiedProof: null }, w.deps);
  assert.equal(viaSession.view === "verified" && viaSession.continueVia, "session");
  const viaProof = await loadVerificationPageView(
    w.token,
    { sessionUserId: "someone-else", verifiedProof: signVerifiedBrowserProof(LIFECYCLE, SECRET, T0) },
    w.deps
  );
  assert.equal(viaProof.view === "verified" && viaProof.continueVia, "proof");

  const activated = world({ activatedAt: T0.toISOString() });
  assert.equal((await loadVerificationPageView(activated.token, browser, activated.deps)).view, "activated");
  const released = world({ lifecycle: { released_at: T0.toISOString() } });
  assert.equal((await loadVerificationPageView(released.token, browser, released.deps)).view, "closed");
  const legacy = world({ verificationRequired: false });
  assert.equal((await loadVerificationPageView(legacy.token, browser, legacy.deps)).view, "unavailable");
  assert.equal((await loadVerificationPageView("forged.token", browser, w.deps)).view, "unavailable");
});

// ── First send vs resend (wording only) ──────────────────────────────────────

test("isResend: the first code for a lifecycle is not a resend; every later issuance is — and nothing else changes", async () => {
  const w = world();
  const first = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(first.status, "code_sent");
  assert.equal(first.isResend, false);
  assert.equal(first.resendAvailableAt, new Date(T0.getTime() + 60_000).toISOString(), "cooldown unchanged");
  assert.equal(first.expiresAt, new Date(T0.getTime() + 600_000).toISOString(), "expiry unchanged");

  // A blocked resend inside the cooldown carries no isResend and sends nothing.
  const blocked = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.deepEqual(blocked, { status: "resend_cooldown", resendAvailableAt: new Date(T0.getTime() + 60_000).toISOString() });

  w.advance(60_000);
  const second = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(second.status, "code_sent");
  assert.equal(second.isResend, true);
  assert.equal(w.emails.length, 2);

  // Verification is unaffected: the newest code still verifies.
  assert.equal((await submitVerificationCode(w.token, w.emails[1].code, w.deps)).status, "verified");
});

test("isResend: in-flow (code already issued at submission), the first click on the page IS a resend", async () => {
  const w = world();
  await requestVerificationCode(w.token, { requestIp: null }, w.deps); // stands in for the in-flow issuance
  w.advance(61_000);
  assert.equal((await requestVerificationCode(w.token, { requestIp: null }, w.deps)).isResend, true);
});

test("isResend: an expired first code followed by 'Send a new code' is correctly a resend", async () => {
  const w = world();
  await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  w.advance(11 * 60_000);
  assert.equal((await requestVerificationCode(w.token, { requestIp: null }, w.deps)).isResend, true);
});
