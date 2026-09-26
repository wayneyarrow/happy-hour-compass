import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { generateLinkWithRetry } from "@/lib/supabase/generateLinkWithRetry";
import { getSiteUrl } from "@/lib/siteUrl";
import { getOperatorVerificationCodeHmacSecret } from "./emailCodeVerificationConfig";
import {
  VERIFICATION_CODE_LIFETIME_MS,
  VERIFICATION_MAX_SENDS_PER_WINDOW,
  VERIFICATION_SEND_WINDOW_MS,
  computeResendAvailableAt,
  computeVerificationCodeDigest,
  evaluateDailyVerificationLimit,
  generateVerificationCode,
  VERIFICATION_DAILY_WINDOW_MS,
  VERIFICATION_MAX_CODES_PER_DAY,
  isVerificationCodeExhausted,
  isVerificationCodeExpired,
  maskEmail,
  parseVerificationCodeInput,
  resolveActivationVerificationMode,
  toClientVerificationStatus,
  verifyVerificationCodeDigest,
} from "./emailCodeVerificationPolicy";
import { isVerifiedBrowserProofValid, readVerificationLinkToken, signVerificationLinkToken } from "./emailCodeVerificationTokens";
import { sendContinueSetupEmail, sendVerificationCodeEmail } from "./emailCodeVerificationEmails";
import { writeActivationNote, type ActivationNoteOrigin } from "./activationNotes";
import { isAutoApprovedClaim } from "@/lib/claims/claimAutoApprovalNotes";
import type {
  ConsumeVerificationCodeOutcome,
  EmailCodeActionResult,
  IssueVerificationCodeOutcome,
  RecordVerificationFailureOutcome,
  VerificationApprovalContext,
  VerificationPageView,
} from "./emailCodeVerificationTypes";

/**
 * Server-side engine for the operator email-code activation flow
 * (email-code initiative, Phase 2B — Model A). Server-only.
 *
 * FLOW: approval provisions the operator and a verification-required
 * lifecycle (see emailCodeActivationStart.ts) → /operator/verify?t=<link
 * token> → the operator requests/enters a six-digit code → on success this
 * module starts a normal Supabase session for that operator → the EXISTING
 * /operator/create-password page (cookie-session path) → the EXISTING
 * completeOperatorAccountActivation(). No parallel onboarding: password
 * creation and activation are exactly the legacy steps.
 *
 * AUTHORITY: every code write goes through migration 100's three
 * SECURITY DEFINER functions (cooldown, 5/hour cap, supersede-on-resend,
 * incorrect-attempt counting, single-use consumption — all enforced under
 * the lifecycle row lock). This module only READS operator_verification_codes
 * (service_role has SELECT only) to find the current code and compute
 * display timestamps; those reads are never the enforcement point.
 *
 * NOTHING HERE RUNS ON PAGE LOAD except reads: a code is only issued by an
 * explicit request (in-flow submission, or a button click), so an email
 * scanner prefetching a link can neither send a code nor consume one.
 *
 * The browser only ever receives EmailCodeActionResult / VerificationPageView
 * — never a digest, code, lifecycle id, operator id, or raw email.
 */

export const OPERATOR_VERIFY_PATH = "/operator/verify";
export const OPERATOR_CREATE_PASSWORD_PATH = "/operator/create-password";

/** Test-only DI — production callers omit every field. */
export type EmailCodeVerificationDeps = {
  adminClient?: SupabaseClient;
  secret?: string | null;
  now?: () => Date;
  generateCode?: () => string;
  sendCodeEmail?: typeof sendVerificationCodeEmail;
  siteUrl?: string;
  /** Exchanges a server-generated recovery token_hash for a cookie session in THIS request. */
  establishSession?: (tokenHash: string) => Promise<{ ok: boolean }>;
  generateLink?: typeof generateLinkWithRetry;
};

type LifecycleContext = {
  lifecycleId: string;
  operatorId: string;
  deadlineAt: string;
  expiredAt: string | null;
  releasedAt: string | null;
  verificationRequired: boolean;
  verificationCompletedAt: string | null;
  email: string;
  firstName: string | null;
  accountActivatedAt: string | null;
  /** The claim/submission whose Internal Notes hold this lifecycle's history. */
  origin: ActivationNoteOrigin | null;
};

type CurrentCode = {
  id: string;
  codeDigest: string;
  expiresAt: string;
  attemptCount: number;
  maxAttempts: number;
};

function resolveDeps(deps: EmailCodeVerificationDeps) {
  return {
    admin: deps.adminClient ?? (createAdminClient() as unknown as SupabaseClient),
    secret: deps.secret !== undefined ? deps.secret : getOperatorVerificationCodeHmacSecret(),
    now: deps.now ?? (() => new Date()),
    generateCode: deps.generateCode ?? (() => generateVerificationCode()),
    sendCodeEmail: deps.sendCodeEmail ?? sendVerificationCodeEmail,
    siteUrl: deps.siteUrl ?? getSiteUrl(),
    establishSession: deps.establishSession ?? establishSessionFromTokenHash,
    generateLink: deps.generateLink ?? generateLinkWithRetry,
  };
}

// ── Links ────────────────────────────────────────────────────────────────────

/** Absolute /operator/verify URL for a lifecycle, or null when the HMAC secret is unusable. */
export function buildVerificationContinueUrl(
  lifecycleId: string,
  { secret, siteUrl }: { secret?: string | null; siteUrl?: string } = {}
): string | null {
  const token = signVerificationLinkToken(
    lifecycleId,
    secret !== undefined ? secret : getOperatorVerificationCodeHmacSecret()
  );
  return token ? `${siteUrl ?? getSiteUrl()}${OPERATOR_VERIFY_PATH}?t=${token}` : null;
}

/** Relative in-app path (used for the in-flow redirect), or null when the secret is unusable. */
export function buildVerificationPath(lifecycleId: string, secret?: string | null): string | null {
  const token = signVerificationLinkToken(
    lifecycleId,
    secret !== undefined ? secret : getOperatorVerificationCodeHmacSecret()
  );
  return token ? `${OPERATOR_VERIFY_PATH}?t=${token}` : null;
}

/**
 * Whether a lifecycle uses the email-code flow. Used by the reminder email
 * and founder Resend paths to pick the verify-page link over a Supabase
 * recovery link. A missing row resolves to legacy (false); a read ERROR is
 * returned as such so callers can fail the send rather than silently
 * falling back to a link that skips verification.
 */
export async function readLifecycleVerificationRequired(
  admin: SupabaseClient,
  lifecycleId: string
): Promise<{ ok: true; verificationRequired: boolean } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("operator_activation_lifecycles")
    .select("verification_required, verification_completed_at")
    .eq("id", lifecycleId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const mode = resolveActivationVerificationMode({
    verificationRequired: (data?.verification_required as boolean | null) ?? null,
    verificationCompletedAt: (data?.verification_completed_at as string | null) ?? null,
  });
  return { ok: true, verificationRequired: mode !== "legacy" };
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function loadLifecycleContext(admin: SupabaseClient, lifecycleId: string): Promise<LifecycleContext | null> {
  const { data: lifecycle, error } = await admin
    .from("operator_activation_lifecycles")
    .select(
      "id, operator_id, origin_type, origin_claim_id, origin_submission_id, deadline_at, expired_at, released_at, verification_required, verification_completed_at"
    )
    .eq("id", lifecycleId)
    .maybeSingle();
  if (error || !lifecycle) return null;

  const { data: operator, error: operatorError } = await admin
    .from("operators")
    .select("email, first_name, account_activated_at")
    .eq("id", lifecycle.operator_id as string)
    .maybeSingle();
  if (operatorError || !operator?.email) return null;

  return {
    lifecycleId: lifecycle.id as string,
    operatorId: lifecycle.operator_id as string,
    deadlineAt: lifecycle.deadline_at as string,
    expiredAt: (lifecycle.expired_at as string | null) ?? null,
    releasedAt: (lifecycle.released_at as string | null) ?? null,
    verificationRequired: lifecycle.verification_required === true,
    verificationCompletedAt: (lifecycle.verification_completed_at as string | null) ?? null,
    email: operator.email as string,
    firstName: (operator.first_name as string | null) ?? null,
    accountActivatedAt: (operator.account_activated_at as string | null) ?? null,
    origin:
      lifecycle.origin_type === "claim" && lifecycle.origin_claim_id
        ? { type: "claim", claimId: lifecycle.origin_claim_id as string }
        : lifecycle.origin_type === "submission" && lifecycle.origin_submission_id
          ? { type: "submission", submissionId: lifecycle.origin_submission_id as string }
          : null,
  };
}

// ── Code delivery state ──────────────────────────────────────────────────────
//
// A code row proves a code was ISSUED, not that its email arrived. When the
// email provider rejects the send, issueVerificationCodeForLifecycle()
// records a structured `setup_delivery_failed` Internal Note on the
// lifecycle's claim/submission, keyed to that exact code id. The page then
// treats that code as undelivered (the "send a new code" state) instead of
// claiming it was sent. The key is per code, so a later successful send —
// a new code id — is never affected by an older failure, and the failure
// stays in the notes as history. No schema change: this reuses migration
// 099's event_key column and its unique index (duplicate writes are no-ops).

/** Deterministic Internal Note key for "this code's email was not delivered". */
export function codeDeliveryFailedEventKey(codeId: string): string {
  return `hhc-operator-verification-code-delivery-failed:${codeId}`;
}

async function recordCodeDeliveryFailure(admin: SupabaseClient, ctx: LifecycleContext, codeId: string): Promise<void> {
  if (!ctx.origin) return;
  try {
    const result = await writeActivationNote(
      {
        origin: ctx.origin,
        eventType: "setup_delivery_failed",
        // Operational fact only: never the code, digest, provider error, or credentials.
        note: "Verification code email delivery failed. The operator can request a new code.",
        metadata: { flow: ctx.origin.type },
        eventKey: codeDeliveryFailedEventKey(codeId),
      },
      admin as unknown as Parameters<typeof writeActivationNote>[1]
    );
    if (!result.ok) {
      console.error("[emailCodeVerification] Could not record code delivery failure.", { lifecycleId: ctx.lifecycleId, error: result.error });
    }
  } catch (err) {
    console.error("[emailCodeVerification] Could not record code delivery failure.", {
      lifecycleId: ctx.lifecycleId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Whether any code already issued for this lifecycle reached the operator (i.e. has no delivery-failure record). */
async function hasDeliveredPriorCode(admin: SupabaseClient, ctx: LifecycleContext): Promise<boolean> {
  const { data: prior } = await admin
    .from("operator_verification_codes")
    .select("id")
    .eq("lifecycle_id", ctx.lifecycleId)
    .order("issued_at", { ascending: false })
    .limit(VERIFICATION_MAX_CODES_PER_DAY);
  const ids = (prior ?? []).map((r) => r.id as string);
  if (ids.length === 0) return false;
  if (!ctx.origin) return true;
  const table = ctx.origin.type === "claim" ? "venue_claim_notes" : "operator_submission_notes";
  const { data: failures, error } = await admin
    .from(table)
    .select("event_key")
    .in("event_key", ids.map(codeDeliveryFailedEventKey));
  if (error) return true;
  return (failures?.length ?? 0) < ids.length;
}

/**
 * Whether this code's email is known to have failed. A read error answers
 * "not known to have failed" — the pre-fix behaviour — rather than hiding a
 * code that was most likely delivered.
 */
async function isCodeDeliveryFailed(admin: SupabaseClient, ctx: LifecycleContext, codeId: string): Promise<boolean> {
  if (!ctx.origin) return false;
  const table = ctx.origin.type === "claim" ? "venue_claim_notes" : "operator_submission_notes";
  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq("event_key", codeDeliveryFailedEventKey(codeId))
    .maybeSingle();
  if (error) {
    console.error("[emailCodeVerification] Code delivery-state read failed.", { lifecycleId: ctx.lifecycleId, error: error.message });
    return false;
  }
  return !!data;
}

function isLifecycleClosed(ctx: LifecycleContext, now: Date): boolean {
  return ctx.releasedAt !== null || ctx.expiredAt !== null || new Date(ctx.deadlineAt).getTime() <= now.getTime();
}

async function loadCurrentCode(admin: SupabaseClient, lifecycleId: string): Promise<CurrentCode | null> {
  const { data } = await admin
    .from("operator_verification_codes")
    .select("id, code_digest, expires_at, attempt_count, max_attempts")
    .eq("lifecycle_id", lifecycleId)
    .is("consumed_at", null)
    .is("superseded_at", null)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    codeDigest: data.code_digest as string,
    expiresAt: data.expires_at as string,
    attemptCount: data.attempt_count as number,
    maxAttempts: data.max_attempts as number,
  };
}

/**
 * Display-only mirror of the cooldown + rolling cap, from the most recent
 * issuances. issue_operator_verification_code() is the enforcement point;
 * this just tells the UI when the button will work.
 */
async function computeResendAvailability(admin: SupabaseClient, lifecycleId: string, now: Date): Promise<string | null> {
  const { data } = await admin
    .from("operator_verification_codes")
    .select("issued_at")
    .eq("lifecycle_id", lifecycleId)
    .order("issued_at", { ascending: false })
    .limit(VERIFICATION_MAX_SENDS_PER_WINDOW);
  const issued = (data ?? []).map((r) => new Date(r.issued_at as string).getTime()).filter((ms) => !Number.isNaN(ms));
  if (issued.length === 0) return null;

  let availableMs = new Date(computeResendAvailableAt(new Date(issued[0]))).getTime();
  const inWindow = issued.filter((ms) => ms > now.getTime() - VERIFICATION_SEND_WINDOW_MS);
  if (inWindow.length >= VERIFICATION_MAX_SENDS_PER_WINDOW) {
    availableMs = Math.max(availableMs, Math.min(...inWindow) + VERIFICATION_SEND_WINDOW_MS);
  }
  return availableMs > now.getTime() ? new Date(availableMs).toISOString() : null;
}

/**
 * Rolling-24h usage for the daily lifecycle limit. `null` means the usage
 * could not be read — callers must then refuse (fail closed): never issue a
 * code or compare a guess without knowing the aggregate is under the cap.
 */
async function checkDailyLimit(
  admin: SupabaseClient,
  lifecycleId: string,
  now: Date
): Promise<ReturnType<typeof evaluateDailyVerificationLimit> | null> {
  const { data, error } = await admin
    .from("operator_verification_codes")
    .select("issued_at, attempt_count")
    .eq("lifecycle_id", lifecycleId)
    .gt("issued_at", new Date(now.getTime() - VERIFICATION_DAILY_WINDOW_MS).toISOString());
  if (error || !data) {
    console.error("[emailCodeVerification] Daily limit usage read failed — refusing.", {
      lifecycleId,
      error: error?.message ?? "no data",
    });
    return null;
  }
  return evaluateDailyVerificationLimit(
    data.map((r) => ({ issuedAt: r.issued_at as string, attemptCount: r.attempt_count as number })),
    now
  );
}

type ResolvedToken =
  | { ok: true; ctx: LifecycleContext; secret: string }
  | { ok: false; view: "unavailable" };

async function resolveToken(token: unknown, admin: SupabaseClient, secret: string | null): Promise<ResolvedToken> {
  if (!secret) return { ok: false, view: "unavailable" };
  const lifecycleId = readVerificationLinkToken(token, secret);
  if (!lifecycleId) return { ok: false, view: "unavailable" };
  const ctx = await loadLifecycleContext(admin, lifecycleId);
  if (!ctx || !ctx.verificationRequired) return { ok: false, view: "unavailable" };
  return { ok: true, ctx, secret };
}

// ── Page state ───────────────────────────────────────────────────────────────

/**
 * Read-only: the approval confirmation for a lifecycle that came from an
 * AUTO-APPROVED claim, or undefined. Everything is derived from this
 * lifecycle's own origin row (never from the URL): the claim must still be
 * approved, its auto_decision note must record "auto_approved", and the
 * venue name comes from the claim's venue. Submissions, founder-approved
 * claims, and any read failure resolve to undefined — the page then simply
 * shows the plain verification step.
 */
async function loadApprovalContext(
  admin: SupabaseClient,
  origin: ActivationNoteOrigin | null
): Promise<VerificationApprovalContext | undefined> {
  if (origin?.type !== "claim") return undefined;
  try {
    const { data: claim, error } = await admin
      .from("venue_claims")
      .select("status, venue_id")
      .eq("id", origin.claimId)
      .maybeSingle();
    if (error || !claim || claim.status !== "approved" || !claim.venue_id) return undefined;
    if (!(await isAutoApprovedClaim(admin, origin.claimId))) return undefined;
    const { data: venue } = await admin.from("venues").select("name").eq("id", claim.venue_id as string).maybeSingle();
    const venueName = typeof venue?.name === "string" ? venue.name.trim() : "";
    return venueName ? { kind: "claim_auto_approved", venueName } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read-only: what /operator/verify shows. Never issues or consumes
 * anything, so reloading (or a scanner prefetch) is always harmless.
 */
export async function loadVerificationPageView(
  token: unknown,
  browser: { sessionUserId: string | null; verifiedProof: string | null },
  deps: EmailCodeVerificationDeps = {}
): Promise<VerificationPageView> {
  const d = resolveDeps(deps);
  const resolved = await resolveToken(token, d.admin, d.secret);
  if (!resolved.ok) return { view: resolved.view };
  const { ctx, secret } = resolved;
  const now = d.now();

  if (ctx.accountActivatedAt) return { view: "activated" };
  if (isLifecycleClosed(ctx, now)) return { view: "closed" };

  const maskedEmail = maskEmail(ctx.email);
  if (ctx.verificationCompletedAt) {
    const continueVia =
      browser.sessionUserId === ctx.operatorId
        ? "session"
        : isVerifiedBrowserProofValid(browser.verifiedProof, ctx.lifecycleId, secret, now)
          ? "proof"
          : null;
    return { view: "verified", maskedEmail, continueVia };
  }

  const daily = await checkDailyLimit(d.admin, ctx.lifecycleId, now);
  if (!daily) return { view: "unavailable" };
  const approval = await loadApprovalContext(d.admin, ctx.origin);
  const withApproval = approval ? { approval } : {};
  if (daily.blocked) {
    return {
      view: "pending",
      maskedEmail,
      hasCurrentCode: false,
      notice: "rate_limited",
      expiresAt: null,
      resendAvailableAt: daily.availableAt,
      ...withApproval,
    };
  }

  const code = await loadCurrentCode(d.admin, ctx.lifecycleId);
  const resendAvailableAt = await computeResendAvailability(d.admin, ctx.lifecycleId, now);
  let notice: "expired" | "attempts_exhausted" | "delivery_failed" | null = null;
  let hasCurrentCode = false;
  if (code) {
    if (isVerificationCodeExpired(code.expiresAt, now)) notice = "expired";
    else if (isVerificationCodeExhausted(code.attemptCount, code.maxAttempts)) notice = "attempts_exhausted";
    else if (await isCodeDeliveryFailed(d.admin, ctx, code.id)) notice = "delivery_failed";
    else hasCurrentCode = true;
  }
  return {
    view: "pending",
    maskedEmail,
    hasCurrentCode,
    notice,
    expiresAt: hasCurrentCode && code ? code.expiresAt : null,
    resendAvailableAt,
    ...withApproval,
  };
}

// ── Issue / resend ───────────────────────────────────────────────────────────

type IssueRow = {
  outcome: IssueVerificationCodeOutcome;
  code_id: string | null;
  code_expires_at: string | null;
  resend_available_at: string | null;
};

/**
 * Issues (or re-issues) a code for a lifecycle and emails it — but ONLY
 * when the database function returns 'issued'. A rapid second click waits
 * on the lifecycle lock, sees the first request's code, and gets
 * 'cooldown': no second email is possible. Issuing supersedes the
 * previous code in the same transaction, so an older emailed code stops
 * working the moment a newer one exists.
 */
export async function issueVerificationCodeForLifecycle(
  lifecycleId: string,
  { requestIp }: { requestIp: string | null },
  deps: EmailCodeVerificationDeps = {}
): Promise<EmailCodeActionResult> {
  const d = resolveDeps(deps);
  if (!d.secret) return { status: "unavailable" };
  const ctx = await loadLifecycleContext(d.admin, lifecycleId);
  if (!ctx) return { status: "unavailable" };

  // Daily lifecycle limit — checked before anything is issued or emailed.
  // Race-free for issuance: the database function's 60-second cooldown
  // serializes issuance, so two requests can't both slip past a count of 9.
  const daily = await checkDailyLimit(d.admin, ctx.lifecycleId, d.now());
  if (!daily) return { status: "unavailable" };
  if (daily.blocked) return { status: "rate_limited", resendAvailableAt: daily.availableAt };

  // Display only: whether an earlier code was actually DELIVERED, so the
  // screen says "a code" for the first code the operator receives and "a
  // new code" for a genuine resend (a code whose email failed never reached
  // them, so it doesn't count). Read before issuing — issuance decides
  // nothing from it; a read failure just means the neutral first-send wording.
  const isResend = await hasDeliveredPriorCode(d.admin, ctx);

  // The plaintext code lives only in this scope: digested for the
  // database, rendered into the email, then discarded.
  const code = d.generateCode();
  const digest = computeVerificationCodeDigest({ code, lifecycleId: ctx.lifecycleId, secret: d.secret });

  const { data, error } = await d.admin.rpc("issue_operator_verification_code", {
    p_lifecycle_id: ctx.lifecycleId,
    p_code_digest: digest,
    p_request_ip: requestIp,
  });
  const row = (Array.isArray(data) ? data[0] : data) as IssueRow | null | undefined;
  if (error || !row) {
    console.error("[emailCodeVerification] issue_operator_verification_code failed.", {
      lifecycleId: ctx.lifecycleId,
      error: error?.message ?? "no row",
    });
    return { status: "unavailable" };
  }

  if (row.outcome !== "issued" || !row.code_id) {
    return { status: toClientVerificationStatus(row.outcome), resendAvailableAt: row.resend_available_at ?? null };
  }

  const continueUrl = buildVerificationContinueUrl(ctx.lifecycleId, { secret: d.secret, siteUrl: d.siteUrl });
  const sent = await d.sendCodeEmail({
    to: ctx.email,
    firstName: ctx.firstName,
    code,
    expiresInMinutes: Math.round(VERIFICATION_CODE_LIFETIME_MS / 60000),
    continueUrl: continueUrl ?? `${d.siteUrl}${OPERATOR_VERIFY_PATH}`,
    idempotencyKey: `hhc-operator-verification-code:${row.code_id}`,
  });
  if (!sent.ok) {
    // The code row exists (and counts toward the 60-second cooldown and the
    // hourly/daily caps — all enforced by migration 100's function), but
    // nobody got it. Never report "sent": record the failure against this
    // code so the page shows the "send a new code" state on this and every
    // later load (including the in-flow redirect, which ignores this
    // return value). The provider failure already escalated via
    // sendTransactionalEmail's critical routing.
    console.error("[emailCodeVerification] Verification code email failed.", { lifecycleId: ctx.lifecycleId });
    await recordCodeDeliveryFailure(d.admin, ctx, row.code_id);
    return { status: "send_failed", resendAvailableAt: row.resend_available_at ?? null };
  }

  return {
    status: "code_sent",
    expiresAt: row.code_expires_at ?? null,
    resendAvailableAt: row.resend_available_at ?? null,
    isResend,
  };
}

/** Browser-triggered "Send code" / "Resend code". The token is the only client input. */
export async function requestVerificationCode(
  token: unknown,
  { requestIp }: { requestIp: string | null },
  deps: EmailCodeVerificationDeps = {}
): Promise<EmailCodeActionResult> {
  const d = resolveDeps(deps);
  const resolved = await resolveToken(token, d.admin, d.secret);
  if (!resolved.ok) return { status: "unavailable" };
  return issueVerificationCodeForLifecycle(resolved.ctx.lifecycleId, { requestIp }, { ...deps, adminClient: d.admin, secret: d.secret });
}

// ── Verify ───────────────────────────────────────────────────────────────────

export type SubmitVerificationCodeResult =
  | { status: "verified"; consumedNow: boolean; lifecycleId: string }
  | { status: "rate_limited"; resendAvailableAt: string }
  | { status: Exclude<EmailCodeActionResult["status"], "verified" | "rate_limited">; attemptsRemaining?: number };

/**
 * Checks a submitted code. Order mirrors the database functions: not
 * current → expired → exhausted are rejected WITHOUT comparing, so a
 * rejection never reveals whether the code was right. A match consumes via
 * consume_operator_verification_code(); a mismatch is recorded via
 * record_operator_verification_code_failure() — and if that recording
 * fails, the caller gets "unavailable", never "incorrect" for an
 * unrecorded guess.
 *
 * Concurrency: two identical submissions both compare equal, but only one
 * consume can win the lifecycle lock; the other sees 'already_verified'
 * (consumedNow: false) and must not start a second session on its own.
 */
export async function submitVerificationCode(
  token: unknown,
  rawCode: unknown,
  deps: EmailCodeVerificationDeps = {}
): Promise<SubmitVerificationCodeResult> {
  const code = parseVerificationCodeInput(rawCode);
  if (!code) return { status: "invalid_format" };

  const d = resolveDeps(deps);
  const resolved = await resolveToken(token, d.admin, d.secret);
  if (!resolved.ok) return { status: "unavailable" };
  const { ctx, secret } = resolved;
  const now = d.now();

  if (ctx.accountActivatedAt || isLifecycleClosed(ctx, now)) return { status: "unavailable" };
  if (ctx.verificationCompletedAt) return { status: "verified", consumedNow: false, lifecycleId: ctx.lifecycleId };

  // Daily lifecycle limit — checked BEFORE comparing, so a blocked guess is
  // never evaluated and the response is identical whether it was right or
  // wrong. If usage can't be read, refuse rather than compare unmetered.
  // Concurrent wrong guesses that all pass this pre-check can overshoot the
  // cap by at most the code's remaining per-code attempts, which the
  // database function still enforces under its lock.
  const daily = await checkDailyLimit(d.admin, ctx.lifecycleId, now);
  if (!daily) return { status: "unavailable" };
  if (daily.blocked) return { status: "rate_limited", resendAvailableAt: daily.availableAt };

  const current = await loadCurrentCode(d.admin, ctx.lifecycleId);
  if (!current || isVerificationCodeExpired(current.expiresAt, now)) return { status: "expired" };
  if (isVerificationCodeExhausted(current.attemptCount, current.maxAttempts)) return { status: "attempts_exhausted" };

  const isMatch = verifyVerificationCodeDigest({
    candidate: code,
    storedDigest: current.codeDigest,
    lifecycleId: ctx.lifecycleId,
    secret,
  });

  if (isMatch) {
    const { data, error } = await d.admin.rpc("consume_operator_verification_code", {
      p_lifecycle_id: ctx.lifecycleId,
      p_code_id: current.id,
    });
    const row = (Array.isArray(data) ? data[0] : data) as { outcome: ConsumeVerificationCodeOutcome } | null | undefined;
    if (error || !row) {
      console.error("[emailCodeVerification] consume_operator_verification_code failed.", {
        lifecycleId: ctx.lifecycleId,
        error: error?.message ?? "no row",
      });
      return { status: "unavailable" };
    }
    if (row.outcome === "verified") return { status: "verified", consumedNow: true, lifecycleId: ctx.lifecycleId };
    if (row.outcome === "already_verified") return { status: "verified", consumedNow: false, lifecycleId: ctx.lifecycleId };
    return { status: toClientVerificationStatus(row.outcome) as Exclude<EmailCodeActionResult["status"], "verified" | "rate_limited"> };
  }

  const { data, error } = await d.admin.rpc("record_operator_verification_code_failure", {
    p_lifecycle_id: ctx.lifecycleId,
    p_code_id: current.id,
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { outcome: RecordVerificationFailureOutcome; attempts_remaining: number | null }
    | null
    | undefined;
  if (error || !row) {
    console.error("[emailCodeVerification] record_operator_verification_code_failure failed.", {
      lifecycleId: ctx.lifecycleId,
      error: error?.message ?? "no row",
    });
    return { status: "unavailable" };
  }
  if (row.outcome === "already_verified") return { status: "verified", consumedNow: false, lifecycleId: ctx.lifecycleId };
  const status = toClientVerificationStatus(row.outcome, row.attempts_remaining) as Exclude<
    EmailCodeActionResult["status"],
    "verified" | "rate_limited"
  >;
  return row.outcome === "incorrect" ? { status, attemptsRemaining: row.attempts_remaining ?? 0 } : { status };
}

// ── Session start ────────────────────────────────────────────────────────────

/**
 * Default session exchange: the cookie-bound SSR client verifies a
 * server-generated recovery token_hash, which writes the operator's
 * session cookies onto THIS response — the same verifyOtp({token_hash})
 * shape /operator/create-password already uses, but run server-side
 * immediately after verification, so no single-use Supabase link ever
 * leaves the server or sits in an inbox to be prefetched.
 */
async function establishSessionFromTokenHash(tokenHash: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) console.error("[emailCodeVerification] Session exchange failed.", { error: error.message });
  return { ok: !error };
}

/**
 * Starts an authenticated session for a VERIFIED, still-unactivated
 * operator with a live lifecycle, so they can continue on the existing
 * create-password page. Re-checks everything fresh — callers only reach
 * this after a consume in the same request, or with a valid
 * verified-browser proof. Never creates an auth user: generateLink only
 * works for an existing one.
 */
export async function startSessionAfterVerification(
  lifecycleId: string,
  deps: EmailCodeVerificationDeps = {}
): Promise<EmailCodeActionResult> {
  const d = resolveDeps(deps);
  const ctx = await loadLifecycleContext(d.admin, lifecycleId);
  const now = d.now();
  if (!ctx || !ctx.verificationRequired || !ctx.verificationCompletedAt) return { status: "unavailable" };
  if (ctx.accountActivatedAt || isLifecycleClosed(ctx, now)) return { status: "unavailable" };

  const { data, error } = await d.generateLink(d.admin, {
    type: "recovery",
    email: ctx.email,
    options: { redirectTo: `${d.siteUrl}${OPERATOR_CREATE_PASSWORD_PATH}` },
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("[emailCodeVerification] generateLink failed after verification.", {
      lifecycleId,
      error: error?.message ?? "no hashed_token",
    });
    return { status: "unavailable" };
  }

  const session = await d.establishSession(tokenHash);
  if (!session.ok) return { status: "unavailable" };
  return { status: "verified", next: OPERATOR_CREATE_PASSWORD_PATH };
}

/**
 * "Continue" after a refresh, or retry after a failed session start. Only
 * the browser holding a valid verified-browser proof may use it — the link
 * token alone is never enough once verification is complete.
 */
export async function continueAfterVerification(
  token: unknown,
  verifiedProof: string | null,
  deps: EmailCodeVerificationDeps = {}
): Promise<EmailCodeActionResult> {
  const d = resolveDeps(deps);
  const resolved = await resolveToken(token, d.admin, d.secret);
  if (!resolved.ok) return { status: "unavailable" };
  const { ctx, secret } = resolved;
  if (!ctx.verificationCompletedAt) return { status: "unavailable" };
  // Verified, but not by this browser (or the proof lapsed): report
  // "verified" with no `next` — the page then points at Forgot password.
  if (!isVerifiedBrowserProofValid(verifiedProof, ctx.lifecycleId, secret, d.now())) return { status: "verified" };
  return startSessionAfterVerification(ctx.lifecycleId, { ...deps, adminClient: d.admin, secret: d.secret });
}

// ── Password-recovery gate (Phase 2B hardening) ──────────────────────────────

export type PasswordRecoveryGate =
  /** Normal recovery behaviour: activated operators, legacy lifecycles, verified email-code lifecycles, no lifecycle. */
  | { kind: "allow" }
  /** Unactivated operator whose live lifecycle requires an email code that hasn't been verified yet. */
  | { kind: "requires_email_code"; lifecycleId: string; origin: "claim" | "submission" }
  /** The lifecycle couldn't be read — callers must not issue a recovery link. */
  | { kind: "error" };

/**
 * Whether a password-recovery/activation path must defer to email-code
 * verification. A Supabase recovery link would otherwise give an operator
 * whose lifecycle is verification_required = true (and not yet verified) a
 * session and a password — and through create-password, completed
 * activation — without the required code step.
 *
 *   - account_activated_at set → "allow" with NO reads (activated operators'
 *     Forgot Password is untouched)
 *   - no live lifecycle, or a legacy one (verification_required = false) → "allow"
 *   - verification-required and verified → "allow" (the code step is done;
 *     Forgot Password is this state's recovery path, e.g. from another device)
 *   - verification-required and NOT verified → "requires_email_code"
 */
export async function resolvePasswordRecoveryGate(
  admin: SupabaseClient,
  operator: { id: string; accountActivatedAt: string | null }
): Promise<PasswordRecoveryGate> {
  if (operator.accountActivatedAt) return { kind: "allow" };
  const { data, error } = await admin
    .from("operator_activation_lifecycles")
    .select("id, origin_type, verification_required, verification_completed_at")
    .eq("operator_id", operator.id)
    .is("expired_at", null)
    .is("released_at", null)
    .maybeSingle();
  if (error) {
    console.error("[emailCodeVerification] Recovery gate lifecycle read failed.", { operatorId: operator.id, error: error.message });
    return { kind: "error" };
  }
  const mode = resolveActivationVerificationMode({
    verificationRequired: (data?.verification_required as boolean | null) ?? null,
    verificationCompletedAt: (data?.verification_completed_at as string | null) ?? null,
  });
  if (data && mode === "email_code_pending") {
    return {
      kind: "requires_email_code",
      lifecycleId: data.id as string,
      origin: data.origin_type === "submission" ? "submission" : "claim",
    };
  }
  return { kind: "allow" };
}

/** Same gate, starting from an email address (for flows that don't already hold the operator row). */
export async function resolvePasswordRecoveryGateForEmail(admin: SupabaseClient, email: string): Promise<PasswordRecoveryGate> {
  const { data: operator, error } = await admin
    .from("operators")
    .select("id, account_activated_at")
    .eq("email", email)
    .maybeSingle();
  if (error) {
    console.error("[emailCodeVerification] Recovery gate operator read failed.", { error: error.message });
    return { kind: "error" };
  }
  if (!operator?.id) return { kind: "allow" };
  return resolvePasswordRecoveryGate(admin, {
    id: operator.id as string,
    accountActivatedAt: (operator.account_activated_at as string | null) ?? null,
  });
}

/**
 * For "requires_email_code": sends the existing continue-setup email (link
 * to the /operator/verify code screen) INSTEAD of a recovery link, so the
 * operator still gets a way forward and the request still looks identical
 * to the caller (anti-enumeration unchanged). Never generates a Supabase
 * link. A missing HMAC secret sends nothing (fail closed).
 */
export async function sendContinueSetupInsteadOfRecovery(
  {
    gate,
    to,
    firstName,
  }: { gate: Extract<PasswordRecoveryGate, { kind: "requires_email_code" }>; to: string; firstName: string | null | undefined },
  deps: { sendContinueEmail?: typeof sendContinueSetupEmail; buildContinueUrl?: (lifecycleId: string) => string | null } = {}
): Promise<{ ok: boolean }> {
  const continueUrl = (deps.buildContinueUrl ?? ((id: string) => buildVerificationContinueUrl(id)))(gate.lifecycleId);
  if (!continueUrl) {
    console.error("[emailCodeVerification] Recovery requested for an unverified email-code lifecycle, but the HMAC secret is unavailable — nothing sent.", {
      lifecycleId: gate.lifecycleId,
    });
    return { ok: false };
  }
  const sent = await (deps.sendContinueEmail ?? sendContinueSetupEmail)({ to, firstName, origin: gate.origin, continueUrl });
  return { ok: sent.ok };
}
