/**
 * Slack notifications for Customer Success milestone delivery (Phase 1B,
 * Sections 9-11). Message-building is pure/testable; sendX() wrappers are
 * thin calls into the existing sendSlackAcquisitionNotification() helper
 * (src/lib/slack.ts) — no hardcoded webhook/token, same channel-specific
 * env var convention as every other proactive Slack notification in this
 * codebase (#customer-success → SLACK_CUSTOMER_SUCCESS_WEBHOOK_URL).
 *
 * Never throws, never includes secrets or raw provider payloads.
 */

import { sendSlackAcquisitionNotification, type SlackResult } from "@/lib/slack";
import type { DeliveryBlockedReason } from "./recipientResolution";
import { MAX_DELIVERY_ATTEMPTS } from "./deliveryRetryPolicy";

// ── Message builders (pure) ─────────────────────────────────────────────────

export function buildMilestoneSuccessSlackText(params: {
  venueName: string;
  displayValue: string;
  recipientFirstName: string;
  recipientEmail: string;
}): string {
  return (
    `🎉 *Venue milestone email sent*\n\n` +
    `*Venue:* ${params.venueName}\n` +
    `*Milestone:* ${params.displayValue} views\n` +
    `*Recipient:* ${params.recipientFirstName} — ${params.recipientEmail}`
  );
}

export function buildMilestoneFailureSlackText(params: {
  venueName: string;
  displayValue: string;
  recipientEmail: string | null;
  attemptNumber: number;
  willRetry: boolean;
  nextRetryAt: Date | null;
  errorSummary: string;
}): string {
  const lines = [
    `⚠️ *Customer Success email failed*`,
    ``,
    `*Venue:* ${params.venueName}`,
    `*Milestone:* ${params.displayValue} views`,
    `*Recipient:* ${params.recipientEmail ?? "unknown"}`,
    `*Attempt:* ${params.attemptNumber} of ${MAX_DELIVERY_ATTEMPTS}`,
  ];

  if (params.willRetry && params.nextRetryAt) {
    lines.push(`*Next retry:* ${params.nextRetryAt.toISOString()}`);
  } else {
    lines.push(`*Final attempt failed — manual attention required.*`);
  }

  lines.push(`*Error:* ${params.errorSummary}`);
  return lines.join("\n");
}

const BLOCKED_REASON_TEXT: Record<DeliveryBlockedReason, string> = {
  ambiguous_recipient: "multiple active operator users, no designated admin recipient",
  no_active_recipient: "no active operator user found for this venue",
  no_resolvable_timezone: "no resolvable market/timezone for this venue — cannot compute a send time",
};

/** Distinct wording from a delivery failure — this is a data-resolution issue, not a provider failure. */
export function buildRecipientBlockedSlackText(params: {
  venueName: string;
  displayValue: string;
  reason: DeliveryBlockedReason;
}): string {
  const reasonText = BLOCKED_REASON_TEXT[params.reason];

  return (
    `⚠️ *Customer Success email blocked* — ${params.venueName} — ${params.displayValue} views — ${reasonText}.\n\n` +
    `This is a data-resolution issue, not an email-provider failure. No delivery attempt was made. ` +
    `The milestone remains recoverable and will send automatically once resolved.`
  );
}

// ── Senders (thin wrappers) ─────────────────────────────────────────────────

export function sendMilestoneSuccessSlackNotification(
  params: Parameters<typeof buildMilestoneSuccessSlackText>[0]
): Promise<SlackResult> {
  return sendSlackAcquisitionNotification({ channel: "customer-success", text: buildMilestoneSuccessSlackText(params) });
}

export function sendMilestoneFailureSlackNotification(
  params: Parameters<typeof buildMilestoneFailureSlackText>[0]
): Promise<SlackResult> {
  return sendSlackAcquisitionNotification({ channel: "customer-success", text: buildMilestoneFailureSlackText(params) });
}

export function sendRecipientBlockedSlackNotification(
  params: Parameters<typeof buildRecipientBlockedSlackText>[0]
): Promise<SlackResult> {
  return sendSlackAcquisitionNotification({ channel: "customer-success", text: buildRecipientBlockedSlackText(params) });
}
