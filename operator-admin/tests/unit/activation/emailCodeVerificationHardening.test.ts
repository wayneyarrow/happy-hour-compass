import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDailyVerificationLimit,
  VERIFICATION_MAX_CODES_PER_DAY,
  VERIFICATION_MAX_INCORRECT_PER_DAY,
} from "../../../src/lib/activation/emailCodeVerificationPolicy";
import {
  loadVerificationPageView,
  requestVerificationCode,
  resolvePasswordRecoveryGate,
  resolvePasswordRecoveryGateForEmail,
  sendContinueSetupInsteadOfRecovery,
  submitVerificationCode,
  type EmailCodeVerificationDeps,
} from "../../../src/lib/activation/emailCodeVerificationService";
import { readVerificationLinkToken, signVerificationLinkToken } from "../../../src/lib/activation/emailCodeVerificationTokens";
import { makeFakeEmailCodeDb, untouchableClient } from "./support/fakeEmailCodeDb";

/**
 * Phase 2B hardening: the rolling-24h lifecycle limit on code issuance and
 * incorrect attempts, and the password-recovery gate that stops Forgot
 * Password from skipping a required email-code step. Every provider call
 * is a spy; nothing here reaches a real database, Resend, Auth, or Slack.
 */

const SECRET = "test-hmac-secret-that-is-at-least-32-characters-long";
const LIFECYCLE = "11111111-1111-4111-8111-111111111111";
const OPERATOR = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-09-25T18:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

// ── Pure policy ──────────────────────────────────────────────────────────────

const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();

test("daily limit policy: under both caps is not blocked", () => {
  const result = evaluateDailyVerificationLimit(
    [{ issuedAt: at(-2 * HOUR), attemptCount: 3 }, { issuedAt: at(-HOUR), attemptCount: 2 }],
    T0
  );
  assert.deepEqual(result, { blocked: false, codesInWindow: 2, incorrectInWindow: 5 });
});

test("daily limit policy: the 10th incorrect attempt in 24h blocks until enough attempts age out", () => {
  const codes = [
    { issuedAt: at(-20 * HOUR), attemptCount: 5 },
    { issuedAt: at(-10 * HOUR), attemptCount: 3 },
    { issuedAt: at(-1 * HOUR), attemptCount: 2 },
  ];
  const result = evaluateDailyVerificationLimit(codes, T0);
  assert.equal(result.blocked, true);
  if (result.blocked) {
    assert.equal(result.reason, "incorrect_attempts");
    // Dropping the oldest code (5 attempts) brings the total to 5 < 10.
    assert.equal(result.availableAt, at(-20 * HOUR + 24 * HOUR));
  }
});

test("daily limit policy: the 10th code in 24h blocks issuance until the oldest ages out", () => {
  const codes = Array.from({ length: VERIFICATION_MAX_CODES_PER_DAY }, (_, i) => ({ issuedAt: at(-(20 - i) * HOUR), attemptCount: 0 }));
  const result = evaluateDailyVerificationLimit(codes, T0);
  assert.equal(result.blocked && result.reason, "codes");
  assert.equal(result.blocked && result.availableAt, at(-20 * HOUR + 24 * HOUR));
});

test("daily limit policy: activity older than 24h no longer counts; malformed rows fail closed", () => {
  assert.equal(evaluateDailyVerificationLimit([{ issuedAt: at(-25 * HOUR), attemptCount: 5 }, { issuedAt: at(-24 * HOUR), attemptCount: 5 }], T0).blocked, false);
  assert.equal(evaluateDailyVerificationLimit([{ issuedAt: "not-a-date", attemptCount: 5 }, { issuedAt: at(-HOUR), attemptCount: 5 }], T0).blocked, true);
  assert.equal(evaluateDailyVerificationLimit([{ issuedAt: at(-HOUR), attemptCount: Number.NaN }, { issuedAt: at(-HOUR), attemptCount: 5 }], T0).blocked, true);
});

// ── Service, against the migration-100 model ─────────────────────────────────

function world(opts: { failTables?: string[] } = {}) {
  let now = T0;
  const db = makeFakeEmailCodeDb({ now: () => now, failTables: opts.failTables });
  db.seedOperator({ id: OPERATOR, email: "owner@venue.example", first_name: "Sam" });
  db.seedLifecycle({ id: LIFECYCLE, operator_id: OPERATOR, deadline_at: "2026-10-09T18:00:00.000Z", verification_required: true });
  const emails: string[] = [];
  let next = 100000;
  const deps: EmailCodeVerificationDeps = {
    adminClient: db.client,
    secret: SECRET,
    now: () => now,
    generateCode: () => String(next++),
    siteUrl: "https://staging.example",
    sendCodeEmail: (async (p: { code: string }) => {
      emails.push(p.code);
      return { ok: true };
    }) as never,
    establishSession: async () => ({ ok: true }),
  };
  return {
    db,
    deps,
    emails,
    token: signVerificationLinkToken(LIFECYCLE, SECRET)!,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    incorrectTotal: () => db.tables.operator_verification_codes.reduce((n, c) => n + (c.attempt_count as number), 0),
  };
}

async function newCode(w: ReturnType<typeof world>) {
  const r = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(r.status, "code_sent");
  return w.emails.at(-1)!;
}
const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000");

test("legitimate use: a few mistyped codes, then the right one, verifies normally", async () => {
  const w = world();
  const code = await newCode(w);
  for (let i = 0; i < 3; i++) assert.equal((await submitVerificationCode(w.token, wrongFor(code), w.deps)).status, "invalid_code");
  assert.equal((await submitVerificationCode(w.token, code, w.deps)).status, "verified");
});

test("legitimate use: an expired code plus a couple of resends stays well inside the limit", async () => {
  const w = world();
  await newCode(w);
  w.advance(11 * MIN);
  await newCode(w);
  w.advance(2 * MIN);
  const code = await newCode(w);
  await submitVerificationCode(w.token, wrongFor(code), w.deps);
  assert.equal((await submitVerificationCode(w.token, code, w.deps)).status, "verified");
});

test("resending never resets the aggregate: 10 incorrect attempts across two codes blocks further guesses AND new codes", async () => {
  const w = world();
  const first = await newCode(w);
  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, wrongFor(first), w.deps); // exhausts code 1
  w.advance(MIN);
  const second = await newCode(w); // fresh per-code budget...
  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, wrongFor(second), w.deps);
  assert.equal(w.incorrectTotal(), VERIFICATION_MAX_INCORRECT_PER_DAY);

  w.advance(MIN);
  const resend = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(resend.status, "rate_limited", "...but a third code can't be issued");
  assert.equal(resend.resendAvailableAt, new Date(T0.getTime() + 24 * HOUR).toISOString());
  assert.equal(w.emails.length, 2, "no email for a blocked resend");
});

test("once blocked, a guess is never evaluated — correct and incorrect codes get identical responses and nothing is recorded", async () => {
  const w = world();
  const first = await newCode(w);
  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, wrongFor(first), w.deps);
  w.advance(MIN);
  const second = await newCode(w);
  for (let i = 0; i < 4; i++) await submitVerificationCode(w.token, wrongFor(second), w.deps);
  // 9 incorrect so far; the 10th reaches the cap.
  assert.equal((await submitVerificationCode(w.token, wrongFor(second), w.deps)).status, "attempts_exhausted");

  const rpcBefore = w.db.rpcCalls.length;
  const right = await submitVerificationCode(w.token, second, w.deps);
  const wrong = await submitVerificationCode(w.token, wrongFor(second), w.deps);
  assert.deepEqual(right, wrong);
  assert.equal(right.status, "rate_limited");
  assert.equal(w.db.rpcCalls.length, rpcBefore, "no consume or failure call once blocked");
  assert.equal(w.db.tables.operator_activation_lifecycles[0].verification_completed_at, null);
});

test("the daily code cap: an 11th code in 24h is refused (the hourly cap alone would allow 5 more per hour)", async () => {
  const w = world();
  for (let i = 0; i < VERIFICATION_MAX_CODES_PER_DAY; i++) {
    await newCode(w);
    w.advance(i === 4 ? HOUR : MIN); // step past the hourly window halfway through
  }
  const blocked = await requestVerificationCode(w.token, { requestIp: null }, w.deps);
  assert.equal(blocked.status, "rate_limited");
  assert.equal(w.emails.length, VERIFICATION_MAX_CODES_PER_DAY);
});

test("the limit recovers on its own: once the counted activity is older than 24h, codes and verification work again", async () => {
  const w = world();
  const first = await newCode(w);
  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, wrongFor(first), w.deps);
  w.advance(MIN);
  const second = await newCode(w);
  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, wrongFor(second), w.deps);
  assert.equal((await requestVerificationCode(w.token, { requestIp: null }, w.deps)).status, "rate_limited");

  w.advance(24 * HOUR);
  const fresh = await newCode(w);
  assert.equal((await submitVerificationCode(w.token, fresh, w.deps)).status, "verified");
});

test("rapid duplicate guesses at the edge overshoot by at most the in-flight requests, and the next guess is refused", async () => {
  const w = world();
  const first = await newCode(w);
  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, wrongFor(first), w.deps);
  w.advance(MIN);
  const second = await newCode(w);
  for (let i = 0; i < 4; i++) await submitVerificationCode(w.token, wrongFor(second), w.deps); // 9 counted
  await Promise.all([1, 2, 3].map(() => submitVerificationCode(w.token, wrongFor(second), w.deps)));
  // The database still caps each code at 5, so the second code can only reach 5.
  assert.ok(w.incorrectTotal() <= VERIFICATION_MAX_INCORRECT_PER_DAY + 3);
  assert.ok(w.incorrectTotal() <= 10, "per-code limit still bounds the overshoot here");
  assert.equal((await submitVerificationCode(w.token, second, w.deps)).status, "rate_limited");
});

test("if the limit's usage can't be read, nothing is issued and no guess is compared (fail closed)", async () => {
  const w = world({ failTables: ["operator_verification_codes"] });
  assert.equal((await requestVerificationCode(w.token, { requestIp: null }, w.deps)).status, "unavailable");
  assert.equal((await submitVerificationCode(w.token, "123456", w.deps)).status, "unavailable");
  assert.equal(w.db.rpcCalls.length, 0);
  assert.equal(w.emails.length, 0);
});

test("the page shows the limit (with when it frees up) instead of a code form", async () => {
  const w = world();
  const first = await newCode(w);
  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, wrongFor(first), w.deps);
  w.advance(MIN);
  const second = await newCode(w);
  for (let i = 0; i < 5; i++) await submitVerificationCode(w.token, wrongFor(second), w.deps);
  const view = await loadVerificationPageView(w.token, { sessionUserId: null, verifiedProof: null }, w.deps);
  assert.deepEqual(view, {
    view: "pending",
    maskedEmail: "o****@venue.example",
    hasCurrentCode: false,
    notice: "rate_limited",
    expiresAt: null,
    resendAvailableAt: new Date(T0.getTime() + 24 * HOUR).toISOString(),
  });
});

// ── Password-recovery gate ───────────────────────────────────────────────────

function gateWorld(lifecycle: null | { verification_required: boolean; verification_completed_at?: string | null; released_at?: string | null; origin_type?: "claim" | "submission" }, activatedAt: string | null = null) {
  const db = makeFakeEmailCodeDb({ now: () => T0 });
  db.seedOperator({ id: OPERATOR, email: "owner@venue.example", account_activated_at: activatedAt });
  if (lifecycle) db.seedLifecycle({ id: LIFECYCLE, operator_id: OPERATOR, deadline_at: "2026-10-09T18:00:00.000Z", ...lifecycle });
  return db;
}

test("gate A — activated operator: normal Forgot Password, decided with zero reads", async () => {
  const gate = await resolvePasswordRecoveryGate(untouchableClient(), { id: OPERATOR, accountActivatedAt: "2026-09-01T00:00:00.000Z" });
  assert.deepEqual(gate, { kind: "allow" });
  const db = gateWorld({ verification_required: true }, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(await resolvePasswordRecoveryGateForEmail(db.client, "owner@venue.example"), { kind: "allow" });
});

test("gate B — grandfathered legacy lifecycle (verification_required = false): unchanged, recovery allowed", async () => {
  const db = gateWorld({ verification_required: false });
  assert.deepEqual(await resolvePasswordRecoveryGate(db.client, { id: OPERATOR, accountActivatedAt: null }), { kind: "allow" });
});

test("gate C — unverified email-code lifecycle: recovery is refused and routed to the code step, for both origins", async () => {
  for (const origin of ["claim", "submission"] as const) {
    const db = gateWorld({ verification_required: true, origin_type: origin });
    assert.deepEqual(await resolvePasswordRecoveryGate(db.client, { id: OPERATOR, accountActivatedAt: null }), {
      kind: "requires_email_code",
      lifecycleId: LIFECYCLE,
      origin,
    });
    assert.equal((await resolvePasswordRecoveryGateForEmail(db.client, "owner@venue.example")).kind, "requires_email_code");
  }
});

test("gate D — verified email-code lifecycle: Forgot Password is its recovery path (e.g. finishing on another device)", async () => {
  const db = gateWorld({ verification_required: true, verification_completed_at: "2026-09-25T17:00:00.000Z" });
  assert.deepEqual(await resolvePasswordRecoveryGate(db.client, { id: OPERATOR, accountActivatedAt: null }), { kind: "allow" });
});

test("gate: no operator row (pure consumer / team member), no lifecycle, or a released lifecycle → allow", async () => {
  const db = makeFakeEmailCodeDb({ now: () => T0 });
  assert.deepEqual(await resolvePasswordRecoveryGateForEmail(db.client, "consumer@example.com"), { kind: "allow" });
  assert.deepEqual(await resolvePasswordRecoveryGate(gateWorld(null).client, { id: OPERATOR, accountActivatedAt: null }), { kind: "allow" });
  const released = gateWorld({ verification_required: true, released_at: "2026-09-24T00:00:00.000Z" });
  assert.deepEqual(await resolvePasswordRecoveryGate(released.client, { id: OPERATOR, accountActivatedAt: null }), { kind: "allow" });
});

test("gate: read errors report 'error' so callers issue no recovery link", async () => {
  const lifecycleDown = makeFakeEmailCodeDb({ now: () => T0, failTables: ["operator_activation_lifecycles"] });
  lifecycleDown.seedOperator({ id: OPERATOR, email: "owner@venue.example" });
  assert.deepEqual(await resolvePasswordRecoveryGate(lifecycleDown.client, { id: OPERATOR, accountActivatedAt: null }), { kind: "error" });
  const operatorsDown = makeFakeEmailCodeDb({ now: () => T0, failTables: ["operators"] });
  assert.deepEqual(await resolvePasswordRecoveryGateForEmail(operatorsDown.client, "owner@venue.example"), { kind: "error" });
});

test("gate is read-only: no lifecycle, code, or auth user is ever created by checking it", async () => {
  const db = gateWorld({ verification_required: true });
  await resolvePasswordRecoveryGate(db.client, { id: OPERATOR, accountActivatedAt: null });
  await resolvePasswordRecoveryGateForEmail(db.client, "owner@venue.example");
  assert.equal(db.tables.operator_activation_lifecycles.length, 1);
  assert.equal(db.tables.operators.length, 1);
  assert.equal(db.tables.operator_verification_codes.length, 0);
  assert.equal(db.rpcCalls.length + db.generateLinkCalls.length, 0);
});

test("instead of a recovery link, case C gets the continue-setup email to its own code screen — no Supabase link", async () => {
  const sent: { to: string; origin: string; continueUrl: string }[] = [];
  const result = await sendContinueSetupInsteadOfRecovery(
    { gate: { kind: "requires_email_code", lifecycleId: LIFECYCLE, origin: "submission" }, to: "owner@venue.example", firstName: "Sam" },
    {
      buildContinueUrl: (id) => `https://staging.example/operator/verify?t=${signVerificationLinkToken(id, SECRET)}`,
      sendContinueEmail: (async (p: { to: string; origin: string; continueUrl: string }) => {
        sent.push(p);
        return { ok: true };
      }) as never,
    }
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].origin, "submission");
  assert.equal(readVerificationLinkToken(new URL(sent[0].continueUrl).searchParams.get("t"), SECRET), LIFECYCLE);
});

test("with no HMAC secret, case C gets nothing (never a recovery-link fallback)", async () => {
  let sends = 0;
  const result = await sendContinueSetupInsteadOfRecovery(
    { gate: { kind: "requires_email_code", lifecycleId: LIFECYCLE, origin: "claim" }, to: "a@b.example", firstName: null },
    { buildContinueUrl: () => null, sendContinueEmail: (async () => { sends++; return { ok: true }; }) as never }
  );
  assert.deepEqual(result, { ok: false });
  assert.equal(sends, 0);
});
