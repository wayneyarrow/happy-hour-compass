/**
 * What happened to an approval's setup email, for founder-facing notes,
 * banners and notifications. Shared by every approval path so none of them
 * says "sent" for an email that was only queued, may not have arrived, or
 * failed.
 *
 *   sent        — the provider accepted it.
 *   queued      — another email to this operator held the setup-contact
 *                 claim; the hourly operator-activation worker sends it
 *                 (setupContactAutomatic.ts / deferredInitialSetup.ts).
 *   unconfirmed — the provider's response was unclear (network error, 5xx,
 *                 unknown): it may or may not have been accepted.
 *   failed      — definitely not sent (rejected, link generation failed, or
 *                 neither claimed nor queued).
 *
 * Pure (no I/O) and client-safe.
 */

export type SetupEmailOutcome = "sent" | "queued" | "unconfirmed" | "failed";

/** From a send result. A failure without an explicit `deliveryUncertain: false` counts as unconfirmed (conservative). */
export function setupEmailOutcomeOf(result: { ok: boolean; queued?: boolean; deliveryUncertain?: boolean }): SetupEmailOutcome {
  if (result.queued) return "queued";
  if (result.ok) return "sent";
  return result.deliveryUncertain === false ? "failed" : "unconfirmed";
}

/** Verification-code statuses that mean a code went (or was just going) out. */
const CODE_SENT_STATUSES = new Set(["code_sent", "resend_cooldown"]);

/** From deliverDeferredActivationStart()'s result; null when no email was needed (operator already activated/verified). */
export function setupEmailOutcomeOfDelivery(
  delivery:
    | { kind: "continue_email_sent" | "legacy_fallback_sent" | "setup_email_queued" | "nothing_to_send" }
    | { kind: "code_issued"; codeStatus?: string }
    | { kind: "failed"; uncertain?: boolean }
): SetupEmailOutcome | null {
  switch (delivery.kind) {
    case "continue_email_sent":
    case "legacy_fallback_sent":
      return "sent";
    case "setup_email_queued":
      return "queued";
    case "nothing_to_send":
      return null;
    case "code_issued":
      if (delivery.codeStatus === "verified") return null;
      return delivery.codeStatus === undefined || CODE_SENT_STATUSES.has(delivery.codeStatus) ? "sent" : "failed";
    case "failed":
      return delivery.uncertain ? "unconfirmed" : "failed";
  }
}

/** A sentence fragment for an Internal Note, e.g. "setup email sent to a@b.c". */
export function describeSetupEmail(outcome: SetupEmailOutcome, email: string): string {
  switch (outcome) {
    case "sent":
      return `setup email sent to ${email}`;
    case "queued":
      return `setup email to ${email} queued — another email to this operator was being sent, so it goes out automatically within about an hour`;
    case "unconfirmed":
      return `setup email to ${email} unconfirmed — the email provider's response was unclear, so it may or may not have arrived (check the Resend log before resending)`;
    case "failed":
      return `setup email to ${email} could not be sent — use Resend setup email`;
  }
}

/** The founder's success banner after an approval. */
export function approvalBanner(prefix: string, outcome: SetupEmailOutcome | null): string {
  switch (outcome) {
    case null:
      return prefix;
    case "sent":
      return `${prefix} — setup email sent`;
    case "queued":
      return `${prefix} — setup email queued (another email to this operator was being sent; it goes out automatically within about an hour)`;
    case "unconfirmed":
      return `${prefix} — setup email delivery unconfirmed. Check the Resend log before using Resend setup email.`;
    case "failed":
      return `${prefix} — but the setup email could not be sent. Use Resend setup email.`;
  }
}
