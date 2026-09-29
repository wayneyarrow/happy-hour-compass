/**
 * Email send registry & open tracking — pure policy (no I/O).
 *
 * Every rule that decides HOW a send is classified, tagged, labelled, or
 * routed lives here so it is unit-testable and there is exactly one place
 * to change it. Design overview: CLAUDE.md, "Email send registry & open tracking".
 *
 * "Opened" means the email's images loaded (Resend's tracking pixel). It is
 * never proof a person read the message — privacy proxies (e.g. Apple Mail
 * Privacy Protection), security scanners, and forwarded copies all report
 * opens. Every user-facing string built here says "Email opened", never
 * "read".
 */

import { createHash } from "node:crypto";
import { formatDateTime } from "@/lib/controlPanelDateTime";

// ── Environment ──────────────────────────────────────────────────────────────

export type EmailEnvironment = "production" | "preview" | "development";

/**
 * Which deployment is running. Staging (the `website` branch) is a Vercel
 * Preview deployment, so it resolves to "preview". Anything not on Vercel
 * (local dev, scripts, tests) is "development".
 */
export function resolveEmailEnvironment(env: NodeJS.ProcessEnv = process.env): EmailEnvironment {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

// ── Open-notification routing ────────────────────────────────────────────────

export type OpenNotification = "none" | "customer_success";

/**
 * Email types whose FIRST open posts to #customer-success. Customer Success
 * emails and operator setup/reminder emails only. Verification-code opens
 * are recorded (and shown in the venue timeline) but deliberately not
 * notified — an operator opening their code email is routine. Consumer,
 * founder/internal, password-reset and every other type are never notified.
 *
 * FUTURE SPECIALS NUDGE: add its `type` here (e.g. "customer_success_specials_nudge")
 * and pass `record: { venueId, operatorId, customerSuccessEventId }` from its sender.
 */
export const CUSTOMER_SUCCESS_OPEN_NOTIFY_TYPES: ReadonlySet<string> = new Set([
  "customer_success_milestone",
  "claim_approval",
  "operator_activation",
  "operator_venue_added",
  "activation_reminder",
]);

/**
 * A continue-setup email sent in reply to a forgot-password request
 * (trigger "recovery_redirect") reuses the setup email's type, but it is a
 * password-reset response — record it, never notify.
 */
export function classifyOpenNotification(emailType: string, context?: EmailSendContext | null): OpenNotification {
  if (context?.trigger === "recovery_redirect") return "none";
  return CUSTOMER_SUCCESS_OPEN_NOTIFY_TYPES.has(emailType) ? "customer_success" : "none";
}

/**
 * Whether a first open may be posted to #customer-success from THIS
 * runtime. Both the email and the running deployment must be production, so
 * staging sends (and a staging deployment that happens to receive a
 * production event) never reach the production channel.
 */
export function isEligibleForOpenSlack(
  row: { open_notification: string; venue_id: string | null; environment: string; first_opened_at: string | null; open_notified_at: string | null },
  runtimeEnvironment: EmailEnvironment
): boolean {
  return (
    row.open_notification === "customer_success" &&
    row.venue_id !== null &&
    row.environment === "production" &&
    runtimeEnvironment === "production" &&
    row.first_opened_at !== null &&
    row.open_notified_at === null
  );
}

// ── Tracked sender (phased rollout) ─────────────────────────────────────────

/**
 * Resend open tracking is a DOMAIN setting: an "Email opened" event can only
 * ever exist for an email sent FROM a domain with open tracking enabled.
 * The root domain (happyhourcompass.com) never has it; the tracked subdomain
 * (EMAIL_TRACKED_SENDER_DOMAIN) does. Every email is still registered, but
 * only the types below are sent from the tracked subdomain — every other
 * email can never report an open.
 *
 * PHASE 1: automated Customer Success milestone emails only. Operator
 * setup/reminder emails stay on the root domain until separately approved.
 * The specials nudge is not automated yet and is not part of this phase.
 */
export const TRACKED_SENDER_EMAIL_TYPES: ReadonlySet<string> = new Set(["customer_success_milestone"]);

/**
 * Permanently on the untracked root domain unless a separate decision
 * changes this list — enforced by usesTrackedSender() even if a type is
 * ever added to TRACKED_SENDER_EMAIL_TYPES by mistake.
 */
export const NEVER_TRACKED_SENDER_EMAIL_TYPES: ReadonlySet<string> = new Set([
  "operator_verification_code",
  "password_reset",
  "consumer_signup_confirmation",
]);

export function usesTrackedSender(emailType: string, context?: EmailSendContext | null): boolean {
  if (NEVER_TRACKED_SENDER_EMAIL_TYPES.has(emailType)) return false;
  if (context?.trigger === "recovery_redirect") return false;
  return TRACKED_SENDER_EMAIL_TYPES.has(emailType);
}

// ── Send keys & Resend tags ──────────────────────────────────────────────────

/**
 * The logical-send identity. A caller-supplied idempotency key IS the
 * identity (every retry of the same logical email reuses one row and one
 * provider message); without one, each call is a distinct send.
 */
export function buildSendKey(idempotencyKey: string | undefined, randomId: () => string): string {
  return idempotencyKey && idempotencyKey.trim() ? idempotencyKey : `hhc-email:${randomId()}`;
}

/**
 * Public, deterministic reference for a send, derived ONLY from its send
 * key (never from a database id). That is what makes every variant of a
 * provider request reproducible on a retry even when the database is down —
 * see trackedSend.ts — and it doesn't expose the key itself.
 */
export function computeSendRef(sendKey: string): string {
  return createHash("sha256").update(sendKey).digest("hex").slice(0, 32);
}

/** Tag carrying the send reference to Resend (echoed back in webhook payloads). */
export const SEND_REF_TAG = "hhc_send_ref";

const SEND_REF_RE = /^[0-9a-f]{32}$/;
export function isSendRef(value: unknown): value is string {
  return typeof value === "string" && SEND_REF_RE.test(value);
}

/** Resend tag names/values allow only ASCII letters, numbers, underscores and dashes (max 256). */
export function sanitizeTagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
}

export function buildResendTags(params: { sendRef: string; emailType: string; environment: EmailEnvironment }): { name: string; value: string }[] {
  return [
    { name: SEND_REF_TAG, value: params.sendRef },
    { name: "hhc_email_type", value: sanitizeTagValue(params.emailType) },
    { name: "hhc_env", value: params.environment },
  ];
}

// ── Send context (labelling only) ────────────────────────────────────────────

export type EmailSendContext = {
  /** Why this send happened, when it isn't the normal first send. */
  trigger?: "founder_resend" | "legacy_resume" | "continue_setup" | "recovery_redirect";
  reminderStage?: number;
  milestone?: number;
};

/** Keeps only known, primitive keys — never links, tokens, codes, or subjects. */
export function sanitizeSendContext(ctx: EmailSendContext | undefined): EmailSendContext | null {
  if (!ctx) return null;
  const out: EmailSendContext = {};
  const triggers = ["founder_resend", "legacy_resume", "continue_setup", "recovery_redirect"] as const;
  if (ctx.trigger && (triggers as readonly string[]).includes(ctx.trigger)) out.trigger = ctx.trigger;
  if (Number.isInteger(ctx.reminderStage)) out.reminderStage = ctx.reminderStage;
  if (Number.isInteger(ctx.milestone)) out.milestone = ctx.milestone;
  return Object.keys(out).length ? out : null;
}

// ── Labels ───────────────────────────────────────────────────────────────────

const EMAIL_TYPE_LABELS: Record<string, string> = {
  customer_success_milestone: "View milestone email",
  claim_approval: "Claim approved — account setup email",
  operator_activation: "Venue added — account setup email",
  operator_venue_added: "Venue added to existing account email",
  activation_reminder: "Account setup reminder",
  operator_verification_code: "Verification code email",
};

export function describeEmail(emailType: string, context: EmailSendContext | null): string {
  let label = EMAIL_TYPE_LABELS[emailType] ?? emailType.replace(/_/g, " ");
  if (emailType === "customer_success_milestone" && context?.milestone) {
    label = `${context.milestone.toLocaleString("en-US")}-view milestone email`;
  }
  if (emailType === "activation_reminder" && context?.reminderStage) {
    label = `Account setup reminder ${context.reminderStage} of 3`;
  }
  if (context?.trigger === "founder_resend") label += " (resent by founder)";
  if (context?.trigger === "legacy_resume") label += " (activation tracking started)";
  if (context?.trigger === "continue_setup" || context?.trigger === "recovery_redirect") label += " (continue setup link)";
  return label;
}

function elapsed(fromIso: string | null, toIso: string): string | null {
  if (!fromIso) return null;
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// ── Slack (#customer-success) ────────────────────────────────────────────────

export function buildEmailOpenedSlackText(params: {
  venueName: string;
  emailType: string;
  sendContext: EmailSendContext | null;
  recipientEmail: string;
  sentAt: string | null;
  firstOpenedAt: string;
}): string {
  const after = elapsed(params.sentAt, params.firstOpenedAt);
  return (
    `📬 *Email opened*\n\n` +
    `*Venue:* ${params.venueName}\n` +
    `*Email:* ${describeEmail(params.emailType, params.sendContext)}\n` +
    `*Recipient:* ${params.recipientEmail}\n` +
    `*Sent:* ${params.sentAt ? formatDateTime(params.sentAt) : "unknown"} · ` +
    `*First opened:* ${formatDateTime(params.firstOpenedAt)}${after ? ` (${after} later)` : ""}\n\n` +
    `_An open means the email's images loaded. Privacy features or security scanners can trigger it._`
  );
}

// ── Venue Internal Notes timeline ────────────────────────────────────────────

export function buildEmailOpenedNoteText(params: {
  emailType: string;
  sendContext: EmailSendContext | null;
  recipientEmail: string;
  sentAt: string | null;
}): string {
  const sent = params.sentAt ? `, sent ${formatDateTime(params.sentAt)}` : "";
  return `Email opened — ${describeEmail(params.emailType, params.sendContext)} to ${params.recipientEmail}${sent}.`;
}

/** Bounded, secret-free error text for storage. */
export function sanitizeTrackingError(message: string | null | undefined): string {
  return (message ?? "unknown error").replace(/\s+/g, " ").slice(0, 300);
}
