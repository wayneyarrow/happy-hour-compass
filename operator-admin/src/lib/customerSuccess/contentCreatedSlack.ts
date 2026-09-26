/**
 * #customer-success Slack notification when an operator creates a Daily
 * Special or an Event.
 *
 * Channel/config: the existing "customer-success" channel of
 * sendSlackAcquisitionNotification() (src/lib/slack.ts), webhook env var
 * SLACK_CUSTOMER_SUCCESS_WEBHOOK_URL — the same channel the Customer
 * Success milestone notifications already use (customerSuccessSlack.ts).
 * Unset webhook ⇒ silently skipped.
 *
 * WHEN IT FIRES (enforced by shouldNotifyContentCreated() + call sites):
 *   - Only on the INSERT branch of saveDailySpecialAction()/saveEventAction(),
 *     after the insert has succeeded — never on edit/update.
 *   - Only for a genuine, non-impersonated operator session
 *     (isGenuineOperatorContext()) — never for seeded/platform content,
 *     HHC staff using "Open as Operator", or unclaimed-venue support mode.
 *   - Once per created row: each successful insert returns one new id and
 *     sends one message. A recurring Special/Event is a single row, so its
 *     generated occurrences never notify. There is no automatic Slack retry,
 *     so a Slack failure cannot produce a duplicate either.
 *   - Never throws; awaited after the row has committed, so a Slack failure
 *     cannot undo or fail the save (same convention as the other proactive
 *     notifications, e.g. src/lib/email.ts).
 */

import { sendSlackAcquisitionNotification, type SlackResult } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { isGenuineOperatorContext, type GenuineOperatorContext } from "./featureAdoption";
import { formatDaysOfWeek } from "@/lib/dailySpecialSchedule";
import type { DailySpecialSchedule } from "@/lib/dailySpecialTypes";

export function shouldNotifyContentCreated(ctx: GenuineOperatorContext): boolean {
  return isGenuineOperatorContext(ctx);
}

/** "Tue, Sep 29, 2026" from "2026-09-29" — calendar date only, no timezone shift. */
export function formatIsoDateForSlack(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function describeDailySpecialSchedule(schedule: DailySpecialSchedule): string {
  if (schedule.scheduleType === "one_time") {
    return `One-time — ${formatIsoDateForSlack(schedule.oneTimeDate)}`;
  }
  let text = `Weekly — ${formatDaysOfWeek(schedule.daysOfWeek, "long")}`;
  if (schedule.recurrenceStartDate) text += `, from ${formatIsoDateForSlack(schedule.recurrenceStartDate)}`;
  if (schedule.recurrenceEndDate) text += `, until ${formatIsoDateForSlack(schedule.recurrenceEndDate)}`;
  return text;
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export function describeEventSchedule(params: { firstDate: string | null; recurrence: string; startTime: string | null }): string {
  const date = params.firstDate ? formatIsoDateForSlack(params.firstDate) : "No date set";
  const time = params.startTime ? ` at ${params.startTime.slice(0, 5)}` : "";
  const repeat = RECURRENCE_LABELS[params.recurrence];
  return repeat ? `${repeat}, starting ${date}${time}` : `${date}${time}`;
}

/** Escapes Slack mrkdwn control characters in operator-entered text. */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildContentCreatedSlackText(params: {
  kind: "daily_special" | "event";
  venueName: string;
  venueId: string;
  title: string;
  schedule: string;
  isPublished: boolean;
  siteUrl: string;
}): string {
  const heading = params.kind === "daily_special" ? "🍽️ *New Daily Special created*" : "📅 *New Event created*";
  const venueUrl = `${params.siteUrl}/control-panel/venues/${params.venueId}`;
  return [
    heading,
    ``,
    `*Venue:* ${escapeSlackText(params.venueName)}`,
    `*${params.kind === "daily_special" ? "Special" : "Event"}:* ${escapeSlackText(params.title)}`,
    `*When:* ${params.schedule}`,
    `*Status:* ${params.isPublished ? "Published" : "Draft"}`,
    `<${venueUrl}|View venue in Control Panel →>`,
  ].join("\n");
}

export async function notifyContentCreated(
  params: Omit<Parameters<typeof buildContentCreatedSlackText>[0], "siteUrl">
): Promise<SlackResult> {
  try {
    return await sendSlackAcquisitionNotification({
      channel: "customer-success",
      text: buildContentCreatedSlackText({ ...params, siteUrl: getSiteUrl() }),
    });
  } catch (err) {
    console.error("[notifyContentCreated] unexpected error:", params.kind, params.venueId, err);
    return "failed";
  }
}
