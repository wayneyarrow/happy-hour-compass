/**
 * Slack notification helper — server-side only.
 *
 * Uses Incoming Webhooks for channel delivery. Never throws — Slack failures
 * fall back to console.error so primary workflows are never interrupted.
 *
 * Required env vars (optional per channel — alerts silently skipped if unset):
 *   SLACK_OPS_CRITICAL_WEBHOOK_URL        Webhook URL for #ops-critical
 *   SLACK_OPS_ALERTS_WEBHOOK_URL          Webhook URL for #ops-alerts
 *   SLACK_VENUE_SUGGESTIONS_WEBHOOK_URL   Webhook URL for #venue-suggestions
 *   SLACK_VENUE_SUBMISSIONS_WEBHOOK_URL   Webhook URL for #venue-submissions
 *   SLACK_VENUE_CLAIMS_WEBHOOK_URL        Webhook URL for #venue-claims
 *   SLACK_WEBSITE_CONTACT_WEBHOOK_URL     Webhook URL for #website-contact
 *   SLACK_VENUE_CHURN_WEBHOOK_URL         Webhook URL for #venue-churn
 *   SLACK_CONSUMER_SIGNUP_WEBHOOK_URL     Webhook URL for #consumer-signup
 */

export type SlackChannel = "ops-critical" | "ops-alerts";
export type AcquisitionChannel = "venue-suggestions" | "venue-submissions" | "venue-claims" | "website-contact" | "venue-churn" | "consumer-signup";
export type SlackSeverity = "critical" | "warning" | "info" | "success";

type SlackAlertParams = {
  channel: SlackChannel;
  severity: SlackSeverity;
  title: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

const SEVERITY_EMOJI: Record<SlackSeverity, string> = {
  critical: "🚨",
  warning:  "⚠️",
  info:     "ℹ️",
  success:  "✅",
};

const WEBHOOK_ENV: Record<SlackChannel, string> = {
  "ops-critical": "SLACK_OPS_CRITICAL_WEBHOOK_URL",
  "ops-alerts":   "SLACK_OPS_ALERTS_WEBHOOK_URL",
};

const ACQUISITION_WEBHOOK_ENV: Record<AcquisitionChannel, string> = {
  "venue-suggestions": "SLACK_VENUE_SUGGESTIONS_WEBHOOK_URL",
  "venue-submissions": "SLACK_VENUE_SUBMISSIONS_WEBHOOK_URL",
  "venue-claims":      "SLACK_VENUE_CLAIMS_WEBHOOK_URL",
  "website-contact":   "SLACK_WEBSITE_CONTACT_WEBHOOK_URL",
  "venue-churn":       "SLACK_VENUE_CHURN_WEBHOOK_URL",
  "consumer-signup":   "SLACK_CONSUMER_SIGNUP_WEBHOOK_URL",
};

function getWebhookUrl(channel: SlackChannel): string | null {
  return process.env[WEBHOOK_ENV[channel]] ?? null;
}

function getAcquisitionWebhookUrl(channel: AcquisitionChannel): string | null {
  return process.env[ACQUISITION_WEBHOOK_ENV[channel]] ?? null;
}

export type SlackResult = "delivered" | "no-webhook" | "failed";

/**
 * Sends an operational alert to a Slack channel.
 *
 * Returns:
 *   "no-webhook" — env var not set (silently skipped; safe for local dev)
 *   "delivered"  — fetch completed without throwing
 *   "failed"     — timeout or network error (logged to console.error)
 *
 * Never throws — Slack must not interrupt user-facing flows.
 * Timeout: 4 seconds.
 */
export async function sendSlackAlert({
  channel,
  severity,
  title,
  message,
  metadata,
}: SlackAlertParams): Promise<SlackResult> {
  const webhookUrl = getWebhookUrl(channel);
  if (!webhookUrl) return "no-webhook";

  const emoji = SEVERITY_EMOJI[severity];

  let body = `${emoji} *${title}*\n\n${message}`;

  if (metadata) {
    const lines = Object.entries(metadata)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `*${k}:* ${v}`);
    if (lines.length > 0) body += `\n\n${lines.join("\n")}`;
  }

  const payload = {
    text:   `${emoji} ${title}`, // notification / mobile fallback
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: body },
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);

  try {
    await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });
    return "delivered";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SLACK] Alert delivery failed:", { channel, severity, title, error: msg });
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a concise acquisition notification to a channel-specific Slack webhook.
 *
 * Used for proactive notifications on new venue suggestions, submissions, claims,
 * and contact messages — distinct from the ops-alert escalation path.
 *
 * `text` is plain mrkdwn. Use `<url|label>` for links.
 * Never throws — Slack must not interrupt user-facing flows.
 * Timeout: 4 seconds.
 */
export async function sendSlackAcquisitionNotification({
  channel,
  text,
}: {
  channel: AcquisitionChannel;
  text: string;
}): Promise<SlackResult> {
  const webhookUrl = getAcquisitionWebhookUrl(channel);
  if (!webhookUrl) return "no-webhook";

  const payload = {
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);

  try {
    await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });
    return "delivered";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SLACK] Acquisition notification failed:", { channel, error: msg });
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
