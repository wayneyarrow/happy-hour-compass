import { buildResendTags, type EmailEnvironment } from "./emailTrackingPolicy";

/**
 * Chooses the provider request for ONE logical send and guarantees tracking
 * can never cost the email, never duplicate it, and never turn a delivered
 * email into a reported failure. Pure orchestration over an injected
 * `attempt` (the real Resend call lives in sendTransactionalEmail), so every
 * branch is unit-tested — including against a simulated Resend idempotency
 * store (tests/unit/emailTracking/idempotentRetry.test.ts).
 *
 * VARIANTS — every one is derived only from (send key, email type,
 * environment, config), never from database state, so a retry can always
 * rebuild exactly what an earlier attempt sent:
 *   untracked      caller's From/Reply-To, no tags   (== the pre-tracking request)
 *   tagged_root    caller's From/Reply-To + tags
 *   tagged_tracked From on the tracked subdomain (Reply-To kept on the real
 *                  inbox) + tags — only for usesTrackedSender() types
 *
 * ORDER: tracking on ⇒ the planned variant first (tagged_tracked for tracked
 * sender types, else tagged_root), then untracked, then any remaining
 * tagged variant. Tracking off ⇒ untracked first (the legacy request, byte-
 * for-byte), then the tagged variants.
 *
 * WHEN THE NEXT VARIANT IS TRIED (same idempotency key every time):
 *   - 409 invalid_idempotent_request: Resend already processed a request
 *     with this key but a DIFFERENT payload — e.g. attempt 1 went out before
 *     tracking was switched on (or off) and its success was never recorded.
 *     Resend refuses a mismatched request outright (nothing is sent); the
 *     variant that matches the original makes Resend REPLAY the original
 *     result — same message id, no new email.
 *   - a validation/configuration rejection of a TAGGED variant (e.g. the
 *     tracked subdomain isn't verified): refused before sending; the
 *     untracked variant is tried next and other tagged variants are skipped.
 * Anything else (rate limit, outage) is returned as-is to the caller's own
 * retry/escalation handling. Because every attempt carries the caller's
 * idempotency key, no variant can ever produce a second email for a send
 * that has one.
 */

export type Tag = { name: string; value: string };
export type SendRequestVariant = { kind: "untracked" | "tagged_root" | "tagged_tracked"; from: string; replyTo?: string; tags?: Tag[] };
export type SendAttemptResult = { ok: true; id?: string } | { ok: false; error: string; errorName?: string };
export type SendAttempt = (p: { from: string; replyTo?: string; tags?: Tag[] }) => Promise<SendAttemptResult>;

export const TAGGED_REJECTION_ERROR_NAMES: ReadonlySet<string> = new Set([
  "validation_error",
  "invalid_from_address",
  "invalid_parameter",
  "missing_required_field",
]);
export const IDEMPOTENCY_MISMATCH_ERROR_NAME = "invalid_idempotent_request";

/**
 * Resend error names that mean the request was REJECTED before anything was
 * sent (validation, auth, quota/rate limit). Every other failure — a thrown
 * network error (no error name), a provider 5xx, an unknown error name, or
 * an idempotency mismatch (an earlier request with the key WAS accepted) —
 * leaves delivery uncertain: the provider may have accepted the email.
 */
export const DEFINITE_REJECTION_ERROR_NAMES: ReadonlySet<string> = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_from_address",
  "invalid_parameter",
  "invalid_attachment",
  "invalid_idempotency_key",
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_access",
  "not_found",
  "method_not_allowed",
  "security_error",
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
]);

/** Pure: whether a failed send might still have been delivered. */
export function isDeliveryUncertain(errorName: string | undefined): boolean {
  return !errorName || !DEFINITE_REJECTION_ERROR_NAMES.has(errorName);
}

/** Bare email address from "Name <local@domain>" or "local@domain". */
export function senderAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

export function senderDomain(from: string): string {
  return senderAddress(from).split("@")[1]?.toLowerCase() ?? "";
}

/** Same display name and local part, on `domain`. */
export function rewriteSenderDomain(from: string, domain: string): string {
  const local = senderAddress(from).split("@")[0];
  const rewritten = `${local}@${domain}`;
  return from.includes("<") ? from.replace(/<[^>]+>/, `<${rewritten}>`) : rewritten;
}

export function planSendVariants(p: {
  from: string;
  replyTo?: string;
  emailType: string;
  sendRef: string;
  environment: EmailEnvironment;
  trackingEnabled: boolean;
  /** Configured tracked subdomain, or null. */
  trackedDomain: string | null;
  /** usesTrackedSender(type, context). */
  useTrackedSender: boolean;
}): SendRequestVariant[] {
  const tags = buildResendTags({ sendRef: p.sendRef, emailType: p.emailType, environment: p.environment });
  const untracked: SendRequestVariant = { kind: "untracked", from: p.from, replyTo: p.replyTo };
  const taggedRoot: SendRequestVariant = { kind: "tagged_root", from: p.from, replyTo: p.replyTo, tags };
  const taggedTracked: SendRequestVariant | null =
    p.useTrackedSender && p.trackedDomain
      ? { kind: "tagged_tracked", from: rewriteSenderDomain(p.from, p.trackedDomain), replyTo: p.replyTo ?? senderAddress(p.from), tags }
      : null;

  const ordered = p.trackingEnabled
    ? [taggedTracked ?? taggedRoot, untracked, taggedTracked ? taggedRoot : null]
    : [untracked, taggedRoot, taggedTracked];
  return ordered.filter((v): v is SendRequestVariant => v !== null);
}

export async function sendWithVariants(params: {
  attempt: SendAttempt;
  variants: SendRequestVariant[];
  /** Without an idempotency key a 409 cannot occur, and a retry could duplicate — so only the first variant is ever used for a 409. */
  hasIdempotencyKey: boolean;
  logContext: { type: string };
}): Promise<SendAttemptResult & { variant: SendRequestVariant; attempts: number }> {
  const { attempt, variants } = params;
  const tried = new Set<string>();
  let skipTagged = false;
  let last: (SendAttemptResult & { variant: SendRequestVariant; attempts: number }) | null = null;
  let attempts = 0;

  for (const variant of variants) {
    if (tried.has(variant.kind)) continue;
    if (skipTagged && variant.kind !== "untracked") continue;
    tried.add(variant.kind);
    attempts++;

    const result = await attempt({ from: variant.from, replyTo: variant.replyTo, ...(variant.tags ? { tags: variant.tags } : {}) });
    last = { ...result, variant, attempts };
    if (result.ok) return last;

    const name = result.errorName ?? "";
    if (name === IDEMPOTENCY_MISMATCH_ERROR_NAME && params.hasIdempotencyKey) {
      console.warn("[emailTracking] Idempotency key already used with another request variant — trying the next variant.", {
        type: params.logContext.type,
        variant: variant.kind,
      });
      continue;
    }
    if (TAGGED_REJECTION_ERROR_NAMES.has(name) && variant.kind !== "untracked") {
      console.warn("[emailTracking] Tracked request rejected — retrying untracked.", { type: params.logContext.type, variant: variant.kind, errorName: name });
      skipTagged = true;
      continue;
    }
    return last;
  }

  if (last && !last.ok && last.errorName === IDEMPOTENCY_MISMATCH_ERROR_NAME) {
    // Every reproducible variant was refused as a mismatch: an earlier
    // request with this key was accepted with a payload we can no longer
    // rebuild (only possible if the tracked subdomain setting was changed
    // within Resend's 24h key window). Nothing was sent by these attempts.
    return {
      ...last,
      error:
        "An earlier request with this idempotency key was already accepted by Resend with a different payload; " +
        "no new email was sent. Check the Resend log before retrying.",
    };
  }
  return last!;
}
