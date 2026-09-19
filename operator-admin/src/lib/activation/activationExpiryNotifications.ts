import { sendTransactionalEmail, getFounderNotificationEmail, emailLayout, emailCta } from "@/lib/email";
import { sendSlackAlert, type SlackResult } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { expiryFounderEmailIdempotencyKey } from "@/lib/activation/activationReminderPolicy";
import { formatDateTime } from "@/lib/controlPanelDateTime";
import { escapeHtml } from "@/lib/activation/activationEmailEscape";

/**
 * Expiry notification builders (Phase 2A-3) — the two one-time
 * notifications sent when an operator-activation lifecycle's deadline
 * passes unactivated. Deliberately no automatic venue/operator mutation of
 * any kind lives here or anywhere this module touches — these are
 * notify-only side effects; see processActivationReminders.ts for the
 * expiry state transition itself.
 *
 * Slack posting here is honestly AT-LEAST-ONCE, never exactly-once — a
 * plain incoming webhook has no dedupe primitive this codebase can rely
 * on, so a crash between a successful POST and recording that fact can
 * produce a duplicate post on retry. The founder email is safely
 * exactly-once-equivalent via a deterministic Resend idempotency key.
 */

export type ActivationExpiryOrigin = "claim" | "submission";

function originLabel(origin: ActivationExpiryOrigin): string {
  return origin === "claim" ? "Claim" : "Add Your Venue submission";
}

function controlPanelUrl(origin: ActivationExpiryOrigin, originId: string): string {
  // getSiteUrl() resolves per environment (src/lib/siteUrl.ts) — this is
  // the established, environment-aware way every other HHC email builds a
  // Control Panel deep link (never a hardcoded domain). In practice this
  // notification only ever fires from a live enabled pass, which only ever
  // runs from Vercel Cron against a Production deployment — so this
  // resolves to the real production Control Panel URL whenever it actually
  // sends, satisfying "must be the production ... detail path" without
  // hardcoding a domain string.
  const path = origin === "claim" ? `/control-panel/claims/${originId}` : `/control-panel/operator-submissions/${originId}`;
  return `${getSiteUrl()}${path}`;
}

// ── Slack (#ops-alerts, at-least-once) ──────────────────────────────────────

export type ActivationExpirySlackParams = {
  venueName: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  origin: ActivationExpiryOrigin;
  originId: string;
  startedAt: string;
  deadlineAt: string;
};

/** Test-only DI — the real orchestrator always omits this and gets the real sendSlackAlert. */
export type ActivationExpirySlackDeps = {
  sendSlack?: typeof sendSlackAlert;
};

export async function sendActivationExpirySlackNotification(
  params: ActivationExpirySlackParams,
  deps: ActivationExpirySlackDeps = {}
): Promise<SlackResult> {
  const sendSlack = deps.sendSlack ?? sendSlackAlert;
  const operatorName = [params.firstName, params.lastName].filter(Boolean).join(" ") || "Unknown";

  return sendSlack({
    channel: "ops-alerts",
    severity: "warning",
    title: "Operator activation expired — review required",
    message: "No action has been taken automatically — the venue remains claimed and linked.",
    metadata: {
      Venue: params.venueName,
      Operator: `${operatorName} — ${params.email}`,
      Origin: originLabel(params.origin),
      Started: formatDateTime(params.startedAt),
      "Deadline was": formatDateTime(params.deadlineAt),
      Review: controlPanelUrl(params.origin, params.originId),
    },
  });
}

// ── Founder email (deterministic idempotency, exactly-once-equivalent) ─────

export type ActivationExpiryFounderEmailParams = {
  lifecycleId: string;
  venueName: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  origin: ActivationExpiryOrigin;
  originId: string;
  deadlineAt: string;
};

/** Test-only DI — the real orchestrator always omits this and gets the real sendTransactionalEmail. */
export type ActivationExpiryFounderEmailDeps = {
  sendEmail?: typeof sendTransactionalEmail;
};

export async function sendActivationExpiryFounderEmail(
  params: ActivationExpiryFounderEmailParams,
  deps: ActivationExpiryFounderEmailDeps = {}
): Promise<{ ok: boolean; error?: string }> {
  const sendEmail = deps.sendEmail ?? sendTransactionalEmail;
  const operatorName = [params.firstName, params.lastName].filter(Boolean).join(" ") || "Unknown";
  const reviewUrl = controlPanelUrl(params.origin, params.originId);
  const deadlineDisplay = formatDateTime(params.deadlineAt);
  // Escaped copies for HTML interpolation ONLY — the plain-text body below
  // keeps the raw values. reviewUrl is a URL, never escaped here.
  const safeOperatorName = escapeHtml(operatorName);
  const safeEmail = escapeHtml(params.email);
  const safeVenueName = escapeHtml(params.venueName);

  const html = emailLayout(
    `
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Operator activation expired</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            ${safeOperatorName} (${safeEmail}) never completed account setup for ${safeVenueName}.
            Their 14-day activation window ended on ${deadlineDisplay}.
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            No automatic action has been taken &mdash; the venue remains claimed and linked. Review this record
            and decide whether to resend or extend it here:
          </p>
          ${emailCta(reviewUrl, "Review in Control Panel &rarr;")}
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>`,
    "Happy Hour Compass &middot; Control Panel notification"
  );

  const text = `Operator activation expired — ${params.venueName}

${operatorName} (${params.email}) never completed account setup for ${params.venueName}. Their 14-day activation window ended on ${deadlineDisplay}.

No automatic action has been taken — the venue remains claimed and linked. Review this record and decide whether to resend or extend it here:
${reviewUrl}

—
Happy Hour Compass Control Panel`;

  return sendEmail({
    type: "activation_expiry_founder_notification",
    to: getFounderNotificationEmail(),
    subject: `Operator activation expired — ${params.venueName}`,
    html,
    text,
    criticality: "important",
    idempotencyKey: expiryFounderEmailIdempotencyKey(params.lifecycleId),
  });
}
