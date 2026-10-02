import { sendTransactionalEmail, getFounderNotificationEmail, emailLayout, emailCta } from "@/lib/email";
import { sendSlackAcquisitionNotification, type SlackResult } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { expiryFounderEmailIdempotencyKey } from "@/lib/activation/activationReminderPolicy";
import { formatDateTime } from "@/lib/controlPanelDateTime";
import { escapeHtml } from "@/lib/activation/activationEmailEscape";

/**
 * Post-expiry personal follow-up notifications — the two one-time
 * notifications sent when an operator-activation lifecycle's setup window
 * ends without account setup (migration 103 onward):
 *
 *   - a #customer-success Slack post (the existing customer-success webhook
 *     configuration, SLACK_CUSTOMER_SUCCESS_WEBHOOK_URL) — an actionable
 *     prompt for a personal call/email/visit, NOT an ops alert. Routine
 *     expiries no longer post to #ops-alerts; genuine operational failures
 *     (send/note failures elsewhere in the worker) still do.
 *   - a founder email (deterministic Resend idempotency key).
 *
 * Deliberately no venue/operator/lifecycle mutation of any kind lives here —
 * these are notify-only side effects; see processActivationReminders.ts for
 * the expiry state transition and follow-up bookkeeping.
 *
 * Slack posting is honestly AT-LEAST-ONCE, never exactly-once — an incoming
 * webhook has no dedupe primitive, so a crash (or a lost marker write)
 * between Slack accepting the post and expiry_slack_notified_at being
 * recorded produces one duplicate post on the next pass. A Slack timeout
 * after Slack actually accepted the message is reported as "failed" and is
 * likewise retried, so it can also duplicate. The founder email is safely
 * exactly-once-equivalent via its deterministic idempotency key (within
 * Resend's 24-hour idempotency window).
 *
 * Never includes a setup link, token, or verification code.
 */

export type ActivationExpiryOrigin = "claim" | "submission";

function originLabel(origin: ActivationExpiryOrigin): string {
  return origin === "claim" ? "Claim" : "Add Your Venue submission";
}

function originNoun(origin: ActivationExpiryOrigin): string {
  return origin === "claim" ? "claim" : "submission";
}

export function originControlPanelUrl(origin: ActivationExpiryOrigin, originId: string): string {
  // getSiteUrl() resolves per environment (src/lib/siteUrl.ts) — the
  // established way every HHC notification builds a Control Panel deep link.
  const path = origin === "claim" ? `/control-panel/claims/${originId}` : `/control-panel/operator-submissions/${originId}`;
  return `${getSiteUrl()}${path}`;
}

export function venueControlPanelUrl(venueId: string): string {
  return `${getSiteUrl()}/control-panel/venues/${venueId}`;
}

/** Everything the follow-up notifications show. Contains no link/token. */
export type ActivationExpiryFollowUpDetails = {
  lifecycleId: string;
  venueId: string;
  venueName: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  /** Available phone numbers, already labelled, e.g. { label: "claimant", value: "250-555-0100" }. */
  phones: { label: string; value: string }[];
  origin: ActivationExpiryOrigin;
  originId: string;
  startedAt: string;
  deadlineAt: string;
  /** Total all-time venue views, or null when the count couldn't be read. */
  totalViews: number | null;
  /** Setup emails recorded for this activation, oldest first (from structured Internal Notes). */
  setupEmailHistory: { label: string; at: string }[];
};

function operatorName(d: ActivationExpiryFollowUpDetails): string {
  return [d.firstName, d.lastName].filter(Boolean).join(" ") || "Unknown";
}

function formatViews(totalViews: number | null): string {
  return totalViews === null ? "unavailable" : `${totalViews.toLocaleString("en-US")} total`;
}

function formatHistory(history: ActivationExpiryFollowUpDetails["setupEmailHistory"]): string {
  if (history.length === 0) return "none recorded";
  return history.map((h) => `${h.label} (${formatDateTime(h.at)})`).join(" · ");
}

function formatPhones(phones: ActivationExpiryFollowUpDetails["phones"]): string | null {
  if (phones.length === 0) return null;
  return phones.map((p) => `${p.value} (${p.label})`).join(" · ");
}

// ── Slack (#customer-success, at-least-once) ────────────────────────────────

/** Slack mrkdwn escaping for user-supplied values (&, <, > are control characters). */
function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Pure — the exact #customer-success text. */
export function buildActivationExpiryFollowUpSlackText(d: ActivationExpiryFollowUpDetails): string {
  const phones = formatPhones(d.phones);
  const lines = [
    `🧭 *Setup window ended — personal follow-up opportunity*`,
    ``,
    `*${slackEscape(d.venueName)}* never finished account setup, and automatic setup reminders have stopped.`,
    ``,
    `*Contact:* ${slackEscape(operatorName(d))} — ${slackEscape(d.email)}`,
  ];
  if (phones) lines.push(`*Phone:* ${slackEscape(phones)}`);
  lines.push(
    `*Venue views:* ${formatViews(d.totalViews)}`,
    `*Setup emails:* ${slackEscape(formatHistory(d.setupEmailHistory))}`,
    `*Origin:* ${originLabel(d.origin)} · started ${formatDateTime(d.startedAt)}`,
    `*Setup window ended:* ${formatDateTime(d.deadlineAt)}`,
    ``,
    `*Next step:* consider a personal call, email or visit. From the ${originNoun(d.origin)} page you can send a final ` +
      `setup email or copy a setup link — neither restarts reminders or extends the window. If the save doesn't ` +
      `work out, release the venue from the same page.`,
    ``,
    `<${originControlPanelUrl(d.origin, d.originId)}|Open ${originNoun(d.origin)}> · <${venueControlPanelUrl(d.venueId)}|Open venue>`
  );
  return lines.join("\n");
}

/** Test-only DI — the real orchestrator always omits this. */
export type ActivationExpirySlackDeps = {
  sendSlack?: typeof sendSlackAcquisitionNotification;
};

export async function sendActivationExpirySlackNotification(
  details: ActivationExpiryFollowUpDetails,
  deps: ActivationExpirySlackDeps = {}
): Promise<SlackResult> {
  const sendSlack = deps.sendSlack ?? sendSlackAcquisitionNotification;
  return sendSlack({ channel: "customer-success", text: buildActivationExpiryFollowUpSlackText(details) });
}

// ── Founder email (deterministic idempotency, exactly-once-equivalent) ─────

/** Test-only DI — the real orchestrator always omits this. */
export type ActivationExpiryFounderEmailDeps = {
  sendEmail?: typeof sendTransactionalEmail;
};

export async function sendActivationExpiryFounderEmail(
  d: ActivationExpiryFollowUpDetails,
  deps: ActivationExpiryFounderEmailDeps = {}
): Promise<{ ok: boolean; error?: string }> {
  const sendEmail = deps.sendEmail ?? sendTransactionalEmail;
  const name = operatorName(d);
  const originUrl = originControlPanelUrl(d.origin, d.originId);
  const venueUrl = venueControlPanelUrl(d.venueId);
  const deadlineDisplay = formatDateTime(d.deadlineAt);
  const phones = formatPhones(d.phones);
  const views = formatViews(d.totalViews);
  const history = formatHistory(d.setupEmailHistory);
  const noun = originNoun(d.origin);
  // Escaped copies for HTML interpolation ONLY — the plain-text body keeps
  // the raw values. URLs are never escaped here.
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(d.email);
  const safeVenueName = escapeHtml(d.venueName);
  const safePhones = phones ? escapeHtml(phones) : null;
  const safeHistory = escapeHtml(history);

  const html = emailLayout(
    `
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Setup window ended &mdash; personal follow-up</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            ${safeName} (${safeEmail}) never finished account setup for ${safeVenueName}. The setup window ended on
            ${deadlineDisplay}, and automatic setup reminders have stopped.
          </p>
          <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6;">
            ${safePhones ? `Phone: ${safePhones}<br>` : ""}Venue views: ${views}<br>Setup emails: ${safeHistory}
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Consider a personal call, email or visit. From the ${noun} page you can send a final setup email or copy a
            setup link &mdash; neither restarts reminders or extends the window. If the save doesn&rsquo;t work out,
            release the venue from the same page. Nothing has changed automatically: the venue is still claimed and linked.
          </p>
          ${emailCta(originUrl, `Open ${noun} &rarr;`)}
          <p style="margin:0;font-size:13px;color:#64748b;">Venue page: <a href="${venueUrl}" style="color:#b45309;">${venueUrl}</a></p>`,
    "Happy Hour Compass &middot; Control Panel notification"
  );

  const text = `Setup window ended — personal follow-up: ${d.venueName}

${name} (${d.email}) never finished account setup for ${d.venueName}. The setup window ended on ${deadlineDisplay}, and automatic setup reminders have stopped.

${phones ? `Phone: ${phones}\n` : ""}Venue views: ${views}
Setup emails: ${history}

Consider a personal call, email or visit. From the ${noun} page you can send a final setup email or copy a setup link — neither restarts reminders or extends the window. If the save doesn't work out, release the venue from the same page. Nothing has changed automatically: the venue is still claimed and linked.

Open ${noun}: ${originUrl}
Venue page: ${venueUrl}

—
Happy Hour Compass Control Panel`;

  return sendEmail({
    type: "activation_expiry_founder_notification",
    to: getFounderNotificationEmail(),
    subject: `Setup window ended — personal follow-up: ${d.venueName}`,
    html,
    text,
    criticality: "important",
    idempotencyKey: expiryFounderEmailIdempotencyKey(d.lifecycleId),
  });
}
