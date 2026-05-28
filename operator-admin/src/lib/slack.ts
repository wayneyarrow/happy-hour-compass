/**
 * Slack notification helper — server-side only.
 *
 * Uses Incoming Webhooks for channel delivery. Never throws — Slack failures
 * fall back to console.error so primary workflows are never interrupted.
 *
 * Required env vars (optional per channel — alerts silently skipped if unset):
 *   SLACK_OPS_CRITICAL_WEBHOOK_URL   Webhook URL for #ops-critical
 *   SLACK_OPS_ALERTS_WEBHOOK_URL     Webhook URL for #ops-alerts
 */

export type SlackChannel = "ops-critical" | "ops-alerts";
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

function getWebhookUrl(channel: SlackChannel): string | null {
  return process.env[WEBHOOK_ENV[channel]] ?? null;
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
