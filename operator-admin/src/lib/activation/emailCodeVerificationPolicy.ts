/**
 * Pure policy + security functions for the operator email-code activation
 * flow (email-code initiative, Phase 1B foundation — migration 100).
 *
 * NO I/O — no Supabase, no email, no Slack, no environment reads. Nothing
 * imports this module yet; it has zero runtime effect. The HMAC secret is
 * always passed in explicitly (see getOperatorVerificationCodeHmacSecret()
 * in emailCodeVerificationConfig.ts) so this module stays testable and
 * fails closed when configuration is missing.
 *
 * Server-only (uses node:crypto) — never import into a Client Component.
 *
 * PLAINTEXT CODES: a generated code exists only in memory long enough to be
 * digested and emailed. It is never persisted, logged, or included in a
 * thrown error message by anything in this module.
 *
 * BOUNDARY CONVENTIONS (each pinned by tests):
 *   - Expiry: a code is expired once now >= expiresAt (the exact 10-minute
 *     boundary is expired).
 *   - Cooldown: a resend is allowed once now >= lastIssuedAt + 60s (the
 *     exact boundary is allowed).
 *   - Rolling window: an issuance counts while issuedAt > now - 60 min (one
 *     issued exactly 60 minutes ago has left the window).
 *   - Attempts: attemptCount counts INCORRECT attempts only. A code accepts
 *     a submission (correct or incorrect) while attemptCount < maxAttempts;
 *     incorrect attempts 1-5 each add one; the fifth exhausts the code, after
 *     which even the correct code is rejected. A correct code never adds one.
 *
 * AUTHORITY: cooldown, the rolling send cap, attempt counting, and
 * single-use consumption are ENFORCED inside migration 100's database
 * functions (issue_operator_verification_code(),
 * record_operator_verification_code_failure(),
 * consume_operator_verification_code()) under a per-lifecycle row lock. The
 * timing/attempt helpers here mirror those rules for pre-checks, display
 * (e.g. "resend available at"), and tests — they are never a substitute
 * for the database check. Per-IP/per-email cross-lifecycle limits are NOT
 * implemented anywhere yet.
 */

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH } from "./emailCodeVerificationConfig";
import type {
  ActivationVerificationMode,
  ConsumeVerificationCodeOutcome,
  EmailCodeVerificationStatus,
  IssueVerificationCodeOutcome,
  LifecycleVerificationFields,
  RecordVerificationFailureOutcome,
} from "./emailCodeVerificationTypes";

export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_LIFETIME_MS = 10 * 60 * 1000;
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5;
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
export const VERIFICATION_SEND_WINDOW_MS = 60 * 60 * 1000;
export const VERIFICATION_MAX_SENDS_PER_WINDOW = 5;

/** Exclusive upper bound of the code space: 000000-999999. */
const CODE_SPACE = 10 ** VERIFICATION_CODE_LENGTH;
const CODE_PATTERN = /^[0-9]{6}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Domain-separation prefix; bump the version if the digest input ever changes. */
const DIGEST_CONTEXT = "hhc-operator-email-code:v1";

/** Thrown when the HMAC secret is missing or too weak. Never contains a secret or code. */
export class EmailCodeVerificationConfigError extends Error {
  constructor() {
    super("Operator email-code verification is not configured.");
    this.name = "EmailCodeVerificationConfigError";
  }
}

// ── Legacy / flow selection ──────────────────────────────────────────────────

/**
 * Which activation flow a lifecycle uses. Anything other than an explicit
 * verification_required === true is legacy — including missing/null fields
 * — so every existing lifecycle stays on the setup-link flow.
 */
export function resolveActivationVerificationMode(lifecycle: LifecycleVerificationFields): ActivationVerificationMode {
  if (lifecycle.verificationRequired !== true) return "legacy";
  return lifecycle.verificationCompletedAt ? "email_code_verified" : "email_code_pending";
}

// ── Code generation and validation ───────────────────────────────────────────

/**
 * Uniform, cryptographically secure six-digit code, 000000-999999,
 * leading zeros preserved. `randomIntFn` is a test seam only.
 */
export function generateVerificationCode(
  randomIntFn: (min: number, max: number) => number = randomInt
): string {
  const value = randomIntFn(0, CODE_SPACE);
  if (!Number.isInteger(value) || value < 0 || value >= CODE_SPACE) {
    throw new Error("generateVerificationCode: random source returned an out-of-range value.");
  }
  return String(value).padStart(VERIFICATION_CODE_LENGTH, "0");
}

/** True only for exactly six ASCII digits (a string). */
export function isValidVerificationCodeFormat(input: unknown): input is string {
  return typeof input === "string" && CODE_PATTERN.test(input);
}

/**
 * Normalizes user input by trimming surrounding whitespace only, then
 * validates. Returns null for anything malformed — callers must reject
 * before any digest comparison or attempt reservation.
 */
export function parseVerificationCodeInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return isValidVerificationCodeFormat(trimmed) ? trimmed : null;
}

// ── Timing ───────────────────────────────────────────────────────────────────

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** issuedAt + 10 minutes, as an ISO string. */
export function computeVerificationCodeExpiry(issuedAt: Date | string): string {
  return new Date(toMs(issuedAt) + VERIFICATION_CODE_LIFETIME_MS).toISOString();
}

/** Expired once now >= expiresAt. An unparseable expiry is treated as expired. */
export function isVerificationCodeExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  const expiresMs = toMs(expiresAt);
  if (Number.isNaN(expiresMs)) return true;
  return now.getTime() >= expiresMs;
}

// ── Attempts (attemptCount = INCORRECT attempts only) ────────────────────────

/**
 * Whether the code still accepts a submission — correct or incorrect —
 * given its incorrect-attempt count (attemptCount < maxAttempts).
 */
export function canAttemptVerification(
  attemptCount: number,
  maxAttempts: number = VERIFICATION_CODE_MAX_ATTEMPTS
): boolean {
  if (!Number.isInteger(attemptCount) || attemptCount < 0) return false;
  return attemptCount < maxAttempts;
}

/** Whether the code is exhausted (attemptCount >= maxAttempts); even the correct code is then rejected. */
export function isVerificationCodeExhausted(
  attemptCount: number,
  maxAttempts: number = VERIFICATION_CODE_MAX_ATTEMPTS
): boolean {
  return !canAttemptVerification(attemptCount, maxAttempts);
}

/** Incorrect attempts left before exhaustion. */
export function remainingVerificationAttempts(
  attemptCount: number,
  maxAttempts: number = VERIFICATION_CODE_MAX_ATTEMPTS
): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 0) return 0;
  return Math.max(0, maxAttempts - attemptCount);
}

export type VerificationCodeSnapshot = {
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date | string;
  consumedAt: string | null;
  supersededAt: string | null;
};

export type VerificationTransition =
  | { action: "consume"; attemptCountAfter: number }
  | { action: "record_incorrect"; attemptCountAfter: number; exhaustedAfter: boolean }
  | { action: "reject"; reason: "code_not_current" | "code_expired" | "code_exhausted" };

/**
 * Pure mirror of the migration-100 verification transitions for ONE
 * submission against a code snapshot, in the same check order as the
 * database functions: not current → expired → exhausted → correctness.
 * Exhaustion is checked BEFORE correctness, so the correct code is
 * rejected once attemptCount >= maxAttempts, and a rejection never reveals
 * whether the submitted code was right. A correct code consumes without
 * changing attemptCount; an incorrect code adds exactly one.
 */
export function decideVerificationTransition(
  code: VerificationCodeSnapshot,
  isCorrect: boolean,
  now: Date = new Date()
): VerificationTransition {
  if (code.consumedAt !== null || code.supersededAt !== null) return { action: "reject", reason: "code_not_current" };
  if (isVerificationCodeExpired(code.expiresAt, now)) return { action: "reject", reason: "code_expired" };
  if (!canAttemptVerification(code.attemptCount, code.maxAttempts)) return { action: "reject", reason: "code_exhausted" };
  if (isCorrect) return { action: "consume", attemptCountAfter: code.attemptCount };
  const attemptCountAfter = code.attemptCount + 1;
  return { action: "record_incorrect", attemptCountAfter, exhaustedAfter: attemptCountAfter >= code.maxAttempts };
}

/**
 * Maps a database-function outcome to the generic client status. Every
 * lifecycle-ineligibility reason collapses to "unavailable", and the same
 * code-state outcome maps to the same status whichever function produced
 * it — so a correct and an incorrect submission against an exhausted,
 * expired, or superseded code are indistinguishable to the client.
 */
export function toClientVerificationStatus(
  outcome: IssueVerificationCodeOutcome | RecordVerificationFailureOutcome | ConsumeVerificationCodeOutcome,
  attemptsRemaining?: number | null
): EmailCodeVerificationStatus {
  switch (outcome) {
    case "issued":
      return "code_sent";
    case "cooldown":
      return "resend_cooldown";
    case "rate_limited":
      return "rate_limited";
    case "verified":
    case "already_verified":
      return "verified";
    case "incorrect":
      return attemptsRemaining === 0 ? "attempts_exhausted" : "invalid_code";
    case "code_exhausted":
      return "attempts_exhausted";
    case "code_expired":
    case "code_not_current":
      return "expired";
    case "lifecycle_not_found":
    case "lifecycle_closed":
    case "already_activated":
    case "verification_not_required":
      return "unavailable";
  }
}

// ── Resend cooldown ──────────────────────────────────────────────────────────

/** When a resend becomes available (lastIssuedAt + 60s), as an ISO string. */
export function computeResendAvailableAt(lastIssuedAt: Date | string): string {
  return new Date(toMs(lastIssuedAt) + VERIFICATION_RESEND_COOLDOWN_MS).toISOString();
}

/** Milliseconds until a resend is allowed; 0 when allowed now or never sent. */
export function remainingResendCooldownMs(lastIssuedAt: Date | string | null, now: Date = new Date()): number {
  if (lastIssuedAt === null) return 0;
  const lastMs = toMs(lastIssuedAt);
  if (Number.isNaN(lastMs)) return VERIFICATION_RESEND_COOLDOWN_MS; // fail closed
  return Math.max(0, lastMs + VERIFICATION_RESEND_COOLDOWN_MS - now.getTime());
}

export function isResendCooldownElapsed(lastIssuedAt: Date | string | null, now: Date = new Date()): boolean {
  return remainingResendCooldownMs(lastIssuedAt, now) === 0;
}

// ── Rolling-window send limits ───────────────────────────────────────────────

/** Start (exclusive) of the rolling send window ending at `now`. Usable as a query bound (issued_at > start). */
export function computeSendWindowStart(now: Date = new Date()): string {
  return new Date(now.getTime() - VERIFICATION_SEND_WINDOW_MS).toISOString();
}

/** Issuances with issuedAt > now - 60 min. Unparseable timestamps count (fail closed). */
export function countIssuancesInSendWindow(issuedAts: ReadonlyArray<Date | string>, now: Date = new Date()): number {
  const windowStartMs = now.getTime() - VERIFICATION_SEND_WINDOW_MS;
  return issuedAts.filter((issuedAt) => {
    const ms = toMs(issuedAt);
    return Number.isNaN(ms) || ms > windowStartMs;
  }).length;
}

/**
 * Whether one more issuance fits under `limit` within the rolling window
 * (default: the per-lifecycle cap, 5/hour). Mirror only — the cap is
 * enforced atomically inside issue_operator_verification_code(). No per-IP
 * or per-email cap exists yet.
 */
export function canIssueWithinSendWindow(
  issuedAts: ReadonlyArray<Date | string>,
  now: Date = new Date(),
  limit: number = VERIFICATION_MAX_SENDS_PER_WINDOW
): boolean {
  return countIssuancesInSendWindow(issuedAts, now) < limit;
}

// ── Digest (HMAC) ────────────────────────────────────────────────────────────

function assertUsableSecret(secret: string | null | undefined): asserts secret is string {
  if (typeof secret !== "string" || secret.trim().length < OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH) {
    throw new EmailCodeVerificationConfigError();
  }
}

function hmacHex(code: string, lifecycleId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${DIGEST_CONTEXT}:${lifecycleId.toLowerCase()}:${code}`)
    .digest("hex");
}

/**
 * HMAC-SHA256 (lowercase hex) of a code, keyed by the dedicated server
 * secret and bound to the lifecycle id. A six-digit code space is trivially
 * enumerable, so an unkeyed hash would let a leaked digest be reversed
 * offline in milliseconds; the key makes that impossible without the
 * secret, and the lifecycle binding prevents reusing a digest elsewhere.
 *
 * Throws EmailCodeVerificationConfigError on a missing/weak secret, and a
 * generic Error on malformed input — neither message includes the code.
 */
export function computeVerificationCodeDigest(params: {
  code: string;
  lifecycleId: string;
  secret: string | null | undefined;
}): string {
  assertUsableSecret(params.secret);
  if (!isValidVerificationCodeFormat(params.code)) {
    throw new Error("computeVerificationCodeDigest: code must be exactly 6 digits.");
  }
  if (!UUID_PATTERN.test(params.lifecycleId)) {
    throw new Error("computeVerificationCodeDigest: lifecycleId must be a UUID.");
  }
  return hmacHex(params.code, params.lifecycleId, params.secret);
}

/**
 * Constant-time check of a candidate code against a stored digest.
 * Malformed candidates, stored digests, or lifecycle ids return false
 * BEFORE any HMAC is computed. Throws EmailCodeVerificationConfigError
 * (rather than returning false) on a missing/weak secret, so a
 * misconfiguration is never mistaken for — or charged as — a wrong guess.
 */
export function verifyVerificationCodeDigest(params: {
  candidate: unknown;
  storedDigest: string;
  lifecycleId: string;
  secret: string | null | undefined;
}): boolean {
  assertUsableSecret(params.secret);
  if (!isValidVerificationCodeFormat(params.candidate)) return false;
  if (typeof params.storedDigest !== "string" || !DIGEST_PATTERN.test(params.storedDigest)) return false;
  if (!UUID_PATTERN.test(params.lifecycleId)) return false;

  const expected = Buffer.from(hmacHex(params.candidate, params.lifecycleId, params.secret), "hex");
  const stored = Buffer.from(params.storedDigest, "hex");
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}
