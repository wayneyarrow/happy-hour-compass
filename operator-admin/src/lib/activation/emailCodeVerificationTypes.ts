/**
 * Types for the operator email-code activation flow (migration 100).
 * Foundation only — nothing imports these yet.
 *
 * Two deliberately separate groups:
 *
 *   SERVER-ONLY — persistence/security data (code digest, request IP,
 *   attempt counters, current/superseded state). Must never be returned
 *   from a server action, passed as a prop to a Client Component, or
 *   otherwise serialized to the browser.
 *
 *   CLIENT-SAFE — the only shape a future server action/page may hand to
 *   the browser. Contains no digest, IP, counters beyond an optional
 *   product-approved "attempts remaining", or internal ids.
 */

// ── Server-only ──────────────────────────────────────────────────────────────

/** Raw public.operator_verification_codes row (snake_case, as returned by Supabase). */
export type OperatorVerificationCodeRow = {
  id: string;
  lifecycle_id: string;
  code_digest: string;
  issued_at: string;
  expires_at: string;
  /** INCORRECT attempts only — a correct code never increments it. */
  attempt_count: number;
  max_attempts: number;
  consumed_at: string | null;
  superseded_at: string | null;
  request_ip: string | null;
  created_at: string;
};

/** Server-only camelCase record of one issued code. Never serialize to a client. */
export type OperatorVerificationCodeRecord = {
  id: string;
  lifecycleId: string;
  codeDigest: string;
  issuedAt: string;
  expiresAt: string;
  /** INCORRECT attempts only. */
  attemptCount: number;
  maxAttempts: number;
  consumedAt: string | null;
  supersededAt: string | null;
  requestIp: string | null;
  createdAt: string;
};

/**
 * The lifecycle fields that decide which activation flow applies.
 * Optional/nullable on purpose: a row read without these columns (or before
 * migration 100 is applied) must still resolve to legacy.
 */
export type LifecycleVerificationFields = {
  verificationRequired?: boolean | null;
  verificationCompletedAt?: string | null;
};

/**
 * "legacy"              — setup-link flow (every existing lifecycle; the default).
 * "email_code_pending"  — email-code flow, code not yet verified.
 * "email_code_verified" — email-code flow, verified; password not necessarily created.
 */
export type ActivationVerificationMode = "legacy" | "email_code_pending" | "email_code_verified";

/** Lifecycle eligibility outcomes shared by all three migration-100 functions. */
export type LifecycleIneligibleOutcome =
  | "lifecycle_not_found"
  | "lifecycle_closed"
  | "already_activated"
  | "verification_not_required"
  | "already_verified";

/** issue_operator_verification_code() outcome. Only "issued" may be followed by an email. */
export type IssueVerificationCodeOutcome = "issued" | "cooldown" | "rate_limited" | LifecycleIneligibleOutcome;

/** Code-state outcomes shared by the failure-recording and consume functions. */
export type CodeIneligibleOutcome = "code_not_current" | "code_expired" | "code_exhausted";

/** record_operator_verification_code_failure() outcome. */
export type RecordVerificationFailureOutcome = "incorrect" | CodeIneligibleOutcome | LifecycleIneligibleOutcome;

/** consume_operator_verification_code() outcome. */
export type ConsumeVerificationCodeOutcome = "verified" | CodeIneligibleOutcome | LifecycleIneligibleOutcome;

// ── Client-safe ──────────────────────────────────────────────────────────────

/** Generic outcome categories safe to show a user. Never reveal which internal check failed beyond these. */
export type EmailCodeVerificationStatus =
  | "code_sent"
  | "verified"
  | "invalid_code"
  | "expired"
  | "attempts_exhausted"
  | "resend_cooldown"
  | "rate_limited"
  | "unavailable";

/** The only verification state a future server action/page may send to the browser. */
export type EmailCodeVerificationClientState = {
  status: EmailCodeVerificationStatus;
  /** Already masked server-side (e.g. via maskEmail()); never the raw address. */
  maskedEmail: string;
  /** ISO timestamp the current code expires, or null if none is current. */
  expiresAt: string | null;
  /** ISO timestamp a resend becomes available, or null if available now. */
  resendAvailableAt: string | null;
  /** Only if product later approves exposing it; otherwise omit. */
  attemptsRemaining?: number;
};
