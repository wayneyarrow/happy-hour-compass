import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_CODE_LIFETIME_MS,
  VERIFICATION_CODE_MAX_ATTEMPTS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  VERIFICATION_SEND_WINDOW_MS,
  VERIFICATION_MAX_SENDS_PER_WINDOW,
  EmailCodeVerificationConfigError,
  resolveActivationVerificationMode,
  generateVerificationCode,
  isValidVerificationCodeFormat,
  parseVerificationCodeInput,
  computeVerificationCodeExpiry,
  isVerificationCodeExpired,
  canAttemptVerification,
  isVerificationCodeExhausted,
  remainingVerificationAttempts,
  decideVerificationTransition,
  toClientVerificationStatus,
  computeResendAvailableAt,
  remainingResendCooldownMs,
  isResendCooldownElapsed,
  computeSendWindowStart,
  countIssuancesInSendWindow,
  canIssueWithinSendWindow,
  computeVerificationCodeDigest,
  verifyVerificationCodeDigest,
} from "../../../src/lib/activation/emailCodeVerificationPolicy";
import type { OperatorVerificationCodeRow } from "../../../src/lib/activation/emailCodeVerificationTypes";

/**
 * Pure-function tests for the email-code activation policy (migration 100
 * foundation). No I/O. SECRET below is a test-only fixture, not a real key.
 */

const SECRET = "test-only-fixture-secret-0123456789abcdef";
const OTHER_SECRET = "test-only-fixture-secret-fedcba9876543210";
const LIFECYCLE_A = "8b573190-6cf5-4537-82f7-07c10a3f49c9";
const LIFECYCLE_B = "2edffd2e-b1bc-4434-a7e6-d752a35c3fdd";
const ISSUED = "2026-09-25T12:00:00.000Z";
const MIN = 60 * 1000;

const at = (iso: string, deltaMs = 0) => new Date(new Date(iso).getTime() + deltaMs);

// ── Constants ────────────────────────────────────────────────────────────────

test("policy constants match the locked product decisions", () => {
  assert.equal(VERIFICATION_CODE_LENGTH, 6);
  assert.equal(VERIFICATION_CODE_LIFETIME_MS, 10 * MIN);
  assert.equal(VERIFICATION_CODE_MAX_ATTEMPTS, 5);
  assert.equal(VERIFICATION_RESEND_COOLDOWN_MS, 60 * 1000);
  assert.equal(VERIFICATION_SEND_WINDOW_MS, 60 * MIN);
  assert.equal(VERIFICATION_MAX_SENDS_PER_WINDOW, 5);
});

// ── Legacy behaviour ─────────────────────────────────────────────────────────

test("resolveActivationVerificationMode: verification_required=false is legacy", () => {
  assert.equal(resolveActivationVerificationMode({ verificationRequired: false, verificationCompletedAt: null }), "legacy");
});

test("resolveActivationVerificationMode: default/missing/null lifecycle fields never enter the new flow", () => {
  assert.equal(resolveActivationVerificationMode({}), "legacy");
  assert.equal(resolveActivationVerificationMode({ verificationRequired: null }), "legacy");
  // Even an (invalid, CHECK-forbidden) completed timestamp on a legacy row stays legacy.
  assert.equal(resolveActivationVerificationMode({ verificationRequired: false, verificationCompletedAt: ISSUED }), "legacy");
});

test("resolveActivationVerificationMode: opted-in lifecycles are pending until verified", () => {
  assert.equal(resolveActivationVerificationMode({ verificationRequired: true, verificationCompletedAt: null }), "email_code_pending");
  assert.equal(resolveActivationVerificationMode({ verificationRequired: true, verificationCompletedAt: ISSUED }), "email_code_verified");
});

// ── Code generation and validation ───────────────────────────────────────────

test("generateVerificationCode: always six numeric characters over many real draws", () => {
  for (let i = 0; i < 5000; i++) {
    const code = generateVerificationCode();
    assert.equal(code.length, 6);
    assert.match(code, /^[0-9]{6}$/);
  }
});

test("generateVerificationCode: requests the full 000000-999999 range and preserves leading zeros", () => {
  const calls: Array<[number, number]> = [];
  const fake = (value: number) => (min: number, max: number) => {
    calls.push([min, max]);
    return value;
  };
  assert.equal(generateVerificationCode(fake(0)), "000000");
  assert.equal(generateVerificationCode(fake(7)), "000007");
  assert.equal(generateVerificationCode(fake(42_195)), "042195");
  assert.equal(generateVerificationCode(fake(999_999)), "999999");
  for (const [min, max] of calls) {
    assert.equal(min, 0);
    assert.equal(max, 1_000_000); // exclusive upper bound → uniform over 10^6 values
  }
});

test("generateVerificationCode: rejects an out-of-range random source without leaking the value", () => {
  for (const bad of [-1, 1_000_000, 1.5, Number.NaN]) {
    assert.throws(() => generateVerificationCode(() => bad), (err: Error) => !err.message.includes(String(bad)));
  }
});

test("generateVerificationCode: real draws spread across the range (leading-zero codes occur)", () => {
  let sawLeadingZero = false;
  let sawHigh = false;
  for (let i = 0; i < 20000 && !(sawLeadingZero && sawHigh); i++) {
    const code = generateVerificationCode();
    if (code.startsWith("0")) sawLeadingZero = true;
    if (code >= "900000") sawHigh = true;
  }
  assert.ok(sawLeadingZero, "expected at least one code with a leading zero");
  assert.ok(sawHigh, "expected at least one code >= 900000");
});

test("isValidVerificationCodeFormat / parseVerificationCodeInput: malformed input rejected", () => {
  const malformed: unknown[] = [
    "", "12345", "1234567", "12a456", "12 456", "-12345", "+12345", "12345.", "١٢٣٤٥٦", "１２３４５６",
    123456, null, undefined, {}, ["123456"],
  ];
  for (const value of malformed) {
    assert.equal(isValidVerificationCodeFormat(value), false, `format should reject ${JSON.stringify(value)}`);
    assert.equal(parseVerificationCodeInput(value), null, `parse should reject ${JSON.stringify(value)}`);
  }
});

test("parseVerificationCodeInput: accepts six digits, trimming only surrounding whitespace", () => {
  assert.equal(parseVerificationCodeInput("012345"), "012345");
  assert.equal(parseVerificationCodeInput("  012345\n"), "012345");
  assert.equal(isValidVerificationCodeFormat(" 012345"), false); // format check itself is strict
});

// ── Timing: expiry ───────────────────────────────────────────────────────────

test("computeVerificationCodeExpiry: exactly 10 minutes after issuance", () => {
  assert.equal(computeVerificationCodeExpiry(ISSUED), "2026-09-25T12:10:00.000Z");
  assert.equal(computeVerificationCodeExpiry(new Date(ISSUED)), "2026-09-25T12:10:00.000Z");
});

test("isVerificationCodeExpired: valid just before expiry, expired at the exact boundary and after", () => {
  const expiresAt = computeVerificationCodeExpiry(ISSUED);
  assert.equal(isVerificationCodeExpired(expiresAt, at(expiresAt, -1)), false);
  assert.equal(isVerificationCodeExpired(expiresAt, at(expiresAt)), true);
  assert.equal(isVerificationCodeExpired(expiresAt, at(expiresAt, 1)), true);
});

test("isVerificationCodeExpired: an unparseable expiry fails closed", () => {
  assert.equal(isVerificationCodeExpired("not-a-date", new Date(ISSUED)), true);
});

// ── Timing: cooldown ─────────────────────────────────────────────────────────

test("resend cooldown: 60 seconds, rejected just before, accepted at the exact boundary", () => {
  assert.equal(computeResendAvailableAt(ISSUED), "2026-09-25T12:01:00.000Z");
  assert.equal(isResendCooldownElapsed(ISSUED, at(ISSUED, 60_000 - 1)), false);
  assert.equal(remainingResendCooldownMs(ISSUED, at(ISSUED, 60_000 - 1)), 1);
  assert.equal(isResendCooldownElapsed(ISSUED, at(ISSUED, 60_000)), true);
  assert.equal(remainingResendCooldownMs(ISSUED, at(ISSUED, 60_000)), 0);
  assert.equal(remainingResendCooldownMs(ISSUED, at(ISSUED, 15_000)), 45_000);
});

test("resend cooldown: never-sent is available; unparseable last-issued fails closed", () => {
  assert.equal(isResendCooldownElapsed(null, new Date(ISSUED)), true);
  assert.equal(isResendCooldownElapsed("garbage", new Date(ISSUED)), false);
});

// ── Attempts (attempt_count = incorrect attempts only) ───────────────────────

test("attempts: 0-4 recorded incorrect attempts still accept a submission; 5 exhausts the code", () => {
  for (let count = 0; count <= 4; count++) {
    assert.equal(canAttemptVerification(count), true, `count ${count}`);
    assert.equal(isVerificationCodeExhausted(count), false, `count ${count}`);
    assert.equal(remainingVerificationAttempts(count), 5 - count);
  }
  assert.equal(canAttemptVerification(5), false);
  assert.equal(isVerificationCodeExhausted(5), true);
  assert.equal(remainingVerificationAttempts(5), 0);
});

test("attempts: an exhausted or invalid counter is rejected", () => {
  for (const bad of [6, 100, -1, 1.5, Number.NaN]) {
    assert.equal(canAttemptVerification(bad), false, `count ${bad}`);
  }
  assert.equal(remainingVerificationAttempts(-1), 0);
});

test("attempts: a per-row max_attempts is honoured", () => {
  assert.equal(canAttemptVerification(2, 3), true);
  assert.equal(canAttemptVerification(3, 3), false);
});

// ── Rolling-window send limits ───────────────────────────────────────────────

test("send window: five sends in the rolling hour are allowed; a sixth is rejected", () => {
  const now = at(ISSUED, 30 * MIN);
  const sends: string[] = [];
  for (let i = 0; i < 5; i++) {
    assert.equal(canIssueWithinSendWindow(sends, now), true, `send #${i + 1}`);
    sends.push(at(ISSUED, i * MIN).toISOString());
  }
  assert.equal(countIssuancesInSendWindow(sends, now), 5);
  assert.equal(canIssueWithinSendWindow(sends, now), false);
});

test("send window: a send exactly 60 minutes old has left the window; one just inside still counts", () => {
  const now = at(ISSUED, 60 * MIN);
  assert.equal(computeSendWindowStart(now), ISSUED);
  assert.equal(countIssuancesInSendWindow([ISSUED], now), 0);
  assert.equal(countIssuancesInSendWindow([at(ISSUED, 1).toISOString()], now), 1);
});

test("send window: sends outside the rolling window are excluded from the cap", () => {
  const now = at(ISSUED, 3 * 60 * MIN);
  const old = [0, 1, 2, 3, 4, 5].map((i) => at(ISSUED, i * MIN)); // two+ hours ago
  const recent = [at(now.toISOString(), -10 * MIN), at(now.toISOString(), -5 * MIN)];
  assert.equal(countIssuancesInSendWindow([...old, ...recent], now), 2);
  assert.equal(canIssueWithinSendWindow([...old, ...recent], now), true);
});

test("send window: unparseable timestamps count against the cap (fail closed); limit is overridable", () => {
  const now = new Date(ISSUED);
  assert.equal(countIssuancesInSendWindow(["garbage"], now), 1);
  assert.equal(canIssueWithinSendWindow([ISSUED], at(ISSUED, 1), 1), false);
});

// ── Digest / security ────────────────────────────────────────────────────────

test("digest: same code/lifecycle/secret gives a stable 64-char lowercase hex HMAC", () => {
  const a = computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret: SECRET });
  const b = computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret: SECRET });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A.toUpperCase(), secret: SECRET }), a);
});

test("digest: correct code verifies; a different code fails", () => {
  const stored = computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret: SECRET });
  assert.equal(verifyVerificationCodeDigest({ candidate: "012345", storedDigest: stored, lifecycleId: LIFECYCLE_A, secret: SECRET }), true);
  assert.equal(verifyVerificationCodeDigest({ candidate: "012346", storedDigest: stored, lifecycleId: LIFECYCLE_A, secret: SECRET }), false);
  assert.equal(verifyVerificationCodeDigest({ candidate: "12345", storedDigest: stored, lifecycleId: LIFECYCLE_A, secret: SECRET }), false);
});

test("digest: a digest cannot be reused for a different lifecycle", () => {
  const stored = computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret: SECRET });
  assert.notEqual(computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_B, secret: SECRET }), stored);
  assert.equal(verifyVerificationCodeDigest({ candidate: "012345", storedDigest: stored, lifecycleId: LIFECYCLE_B, secret: SECRET }), false);
});

test("digest: the wrong secret fails", () => {
  const stored = computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret: SECRET });
  assert.notEqual(computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret: OTHER_SECRET }), stored);
  assert.equal(verifyVerificationCodeDigest({ candidate: "012345", storedDigest: stored, lifecycleId: LIFECYCLE_A, secret: OTHER_SECRET }), false);
});

test("digest: a missing or weak secret fails closed with a config error (never a false 'wrong code')", () => {
  const stored = computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret: SECRET });
  for (const secret of [undefined, null, "", "   ", "too-short"]) {
    assert.throws(() => computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret }), EmailCodeVerificationConfigError);
    assert.throws(
      () => verifyVerificationCodeDigest({ candidate: "012345", storedDigest: stored, lifecycleId: LIFECYCLE_A, secret }),
      EmailCodeVerificationConfigError
    );
  }
});

test("digest: malformed candidate, stored digest, or lifecycle id is rejected before comparison", () => {
  const stored = computeVerificationCodeDigest({ code: "012345", lifecycleId: LIFECYCLE_A, secret: SECRET });
  for (const candidate of ["01234", "0123456", "01234a", " 012345", 12345, null]) {
    assert.equal(verifyVerificationCodeDigest({ candidate, storedDigest: stored, lifecycleId: LIFECYCLE_A, secret: SECRET }), false);
  }
  for (const storedDigest of ["", "012345", stored.toUpperCase(), stored.slice(0, 63), `${stored}0`]) {
    assert.equal(verifyVerificationCodeDigest({ candidate: "012345", storedDigest, lifecycleId: LIFECYCLE_A, secret: SECRET }), false);
  }
  assert.equal(verifyVerificationCodeDigest({ candidate: "012345", storedDigest: stored, lifecycleId: "not-a-uuid", secret: SECRET }), false);
});

test("digest: errors for malformed input never contain the plaintext code", () => {
  for (const code of ["98765", "9876543", "98x765"]) {
    assert.throws(
      () => computeVerificationCodeDigest({ code, lifecycleId: LIFECYCLE_A, secret: SECRET }),
      (err: Error) => !err.message.includes(code)
    );
  }
  assert.throws(
    () => computeVerificationCodeDigest({ code: "987654", lifecycleId: "not-a-uuid", secret: SECRET }),
    (err: Error) => !err.message.includes("987654")
  );
  assert.throws(
    () => computeVerificationCodeDigest({ code: "987654", lifecycleId: LIFECYCLE_A, secret: undefined }),
    (err: Error) => !err.message.includes("987654") && !err.message.includes(SECRET)
  );
});

test("persisted row shape carries only the digest — no plaintext code field or value", () => {
  const code = generateVerificationCode();
  const row: OperatorVerificationCodeRow = {
    id: "00000000-0000-4000-8000-000000000001",
    lifecycle_id: LIFECYCLE_A,
    code_digest: computeVerificationCodeDigest({ code, lifecycleId: LIFECYCLE_A, secret: SECRET }),
    issued_at: ISSUED,
    expires_at: computeVerificationCodeExpiry(ISSUED),
    attempt_count: 0,
    max_attempts: VERIFICATION_CODE_MAX_ATTEMPTS,
    consumed_at: null,
    superseded_at: null,
    request_ip: null,
    created_at: ISSUED,
  };
  const keys = Object.keys(row);
  assert.ok(!keys.some((k) => /^(code|plaintext|otp|token|password|link)$/i.test(k)), `unexpected key in ${keys.join(",")}`);
  const serialized = JSON.stringify(row);
  // The digest is hex; the six-digit code must not appear as a standalone JSON value.
  assert.ok(!Object.values(row).includes(code));
  assert.match(row.code_digest, /^[0-9a-f]{64}$/);
  assert.ok(!serialized.includes(`"${code}"`));
});

// ── Verification transitions (mirror of the migration-100 functions) ─────────

const CURRENT_CODE = {
  attemptCount: 0,
  maxAttempts: VERIFICATION_CODE_MAX_ATTEMPTS,
  expiresAt: computeVerificationCodeExpiry(ISSUED),
  consumedAt: null,
  supersededAt: null,
};
const BEFORE_EXPIRY = at(ISSUED, 5 * MIN);

test("transition: a correct code consumes without incrementing attempt_count", () => {
  for (let count = 0; count <= 4; count++) {
    assert.deepEqual(
      decideVerificationTransition({ ...CURRENT_CODE, attemptCount: count }, true, BEFORE_EXPIRY),
      { action: "consume", attemptCountAfter: count }
    );
  }
});

test("transition: incorrect attempts 1-5 each add exactly one; the fifth exhausts the code", () => {
  let attemptCount = 0;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const t = decideVerificationTransition({ ...CURRENT_CODE, attemptCount }, false, BEFORE_EXPIRY);
    assert.equal(t.action, "record_incorrect");
    if (t.action !== "record_incorrect") return;
    assert.equal(t.attemptCountAfter, attempt);
    assert.equal(t.exhaustedAfter, attempt === 5);
    attemptCount = t.attemptCountAfter;
  }
  assert.equal(attemptCount, 5);
});

test("transition: after exhaustion the correct code is rejected, identically to an incorrect one", () => {
  const exhausted = { ...CURRENT_CODE, attemptCount: 5 };
  const correct = decideVerificationTransition(exhausted, true, BEFORE_EXPIRY);
  const incorrect = decideVerificationTransition(exhausted, false, BEFORE_EXPIRY);
  assert.deepEqual(correct, { action: "reject", reason: "code_exhausted" });
  assert.deepEqual(incorrect, correct);
});

test("transition: consumed, superseded, or expired codes never gain attempts or consume", () => {
  const cases = [
    [{ ...CURRENT_CODE, consumedAt: ISSUED }, BEFORE_EXPIRY, "code_not_current"],
    [{ ...CURRENT_CODE, supersededAt: ISSUED }, BEFORE_EXPIRY, "code_not_current"],
    [CURRENT_CODE, at(CURRENT_CODE.expiresAt), "code_expired"],
  ] as const;
  for (const [code, now, reason] of cases) {
    for (const isCorrect of [true, false]) {
      assert.deepEqual(decideVerificationTransition(code, isCorrect, now), { action: "reject", reason });
    }
  }
});

test("status mapping: correct and incorrect submissions against the same bad code look identical", () => {
  assert.equal(toClientVerificationStatus("code_exhausted"), "attempts_exhausted");
  assert.equal(toClientVerificationStatus("incorrect", 0), "attempts_exhausted");
  assert.equal(toClientVerificationStatus("incorrect", 3), "invalid_code");
  assert.equal(toClientVerificationStatus("code_expired"), "expired");
  assert.equal(toClientVerificationStatus("code_not_current"), "expired");
  assert.equal(toClientVerificationStatus("verified"), "verified");
  assert.equal(toClientVerificationStatus("issued"), "code_sent");
  assert.equal(toClientVerificationStatus("cooldown"), "resend_cooldown");
  assert.equal(toClientVerificationStatus("rate_limited"), "rate_limited");
  for (const o of ["lifecycle_not_found", "lifecycle_closed", "already_activated", "verification_not_required"] as const) {
    assert.equal(toClientVerificationStatus(o), "unavailable", o);
  }
});
