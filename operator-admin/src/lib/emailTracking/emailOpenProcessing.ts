import { sendSlackAcquisitionNotification, type SlackResult } from "@/lib/slack";
import {
  buildEmailOpenedSlackText,
  isEligibleForOpenSlack,
  isSendRef,
  resolveEmailEnvironment,
  sanitizeTrackingError,
  type EmailEnvironment,
  type EmailSendContext,
} from "./emailTrackingPolicy";
import {
  createSupabaseEmailTrackingStore,
  isStoreError,
  type EmailMessageRow,
  type EmailTrackingStore,
  type ProviderEventRow,
} from "./emailTrackingStore";

/**
 * Matching a persisted `email.opened` event to its email_messages row,
 * recording the FIRST open atomically, and the #customer-success
 * notification — shared by the Resend webhook (immediate path) and the
 * email-open-tracking cron (retry path).
 *
 * MATCHING (verified against Resend's documented email.opened payload,
 * which carries both `data.email_id` and the send-time `data.tags`):
 *   1. data.email_id → email_messages.provider_message_id (primary; always
 *      present on every Resend email event).
 *   2. data.tags.hhc_send_ref → email_messages.send_ref (fallback; covers
 *      an open that arrives before recordEmailSendResult() stored the
 *      provider id — the row is registered before the send, see
 *      emailSendRegistry.ts). Only trusted because the whole payload passed
 *      signature verification, and only when it names an existing row.
 *   3. Neither → left unprocessed; the cron retries matching for
 *      UNMATCHED_RETRY_WINDOW_MS, then records it as "unmatched" (e.g. an
 *      email sent before registration existed, or while the flag was off).
 *
 * FIRST OPEN: setFirstOpenIfUnset() is one conditional UPDATE (… WHERE
 * first_opened_at IS NULL) — exactly one event can ever "win", however many
 * opens, duplicates, webhook retries, or concurrent deliveries arrive. Only
 * the winner may notify. A later-processed but EARLIER-occurring event just
 * moves first_opened_at back (never re-notifies).
 *
 * SLACK: claim (conditional UPDATE) → post → mark notified. A failed post
 * releases the claim and counts an attempt; the cron retries up to
 * MAX_OPEN_NOTIFY_ATTEMPTS. A crash between post and mark can at worst
 * repeat one post after the claim goes stale — never silently drop it.
 */

export const UNMATCHED_RETRY_WINDOW_MS = 72 * 60 * 60 * 1000;
export const OPEN_NOTIFY_CLAIM_STALE_MS = 10 * 60 * 1000;
export const MAX_OPEN_NOTIFY_ATTEMPTS = 5;

export type OpenProcessingDeps = {
  store?: EmailTrackingStore;
  now?: () => Date;
  runtimeEnvironment?: EmailEnvironment;
  sendSlack?: (text: string) => Promise<SlackResult>;
};

type Resolved = {
  store: EmailTrackingStore;
  now: () => Date;
  runtimeEnvironment: EmailEnvironment;
  sendSlack: (text: string) => Promise<SlackResult>;
};

export function resolveOpenProcessingDeps(deps: OpenProcessingDeps = {}): Resolved {
  return {
    store: deps.store ?? createSupabaseEmailTrackingStore(),
    now: deps.now ?? (() => new Date()),
    runtimeEnvironment: deps.runtimeEnvironment ?? resolveEmailEnvironment(),
    sendSlack: deps.sendSlack ?? ((text) => sendSlackAcquisitionNotification({ channel: "customer-success", text })),
  };
}

export type OpenEventOutcome = "first_open" | "repeat_open" | "unmatched_pending" | "unmatched" | "error";

async function matchEvent(event: ProviderEventRow, store: EmailTrackingStore): Promise<EmailMessageRow | null> {
  if (event.provider_message_id) {
    const byProvider = await store.findEmailMessageByProviderId(event.provider_message_id);
    if (byProvider) return byProvider;
  }
  if (isSendRef(event.tagged_send_ref)) {
    const byTag = await store.findEmailMessageBySendRef(event.tagged_send_ref);
    // A tag names our row; if that row already has a DIFFERENT provider id,
    // the tag is still authoritative (it identifies the logical send — a
    // retry after the provider's idempotency window can yield a new id).
    if (byTag) return byTag;
  }
  return null;
}

/** Processes one persisted, not-yet-processed open event. Never throws. */
export async function processOpenEvent(event: ProviderEventRow, deps: OpenProcessingDeps = {}): Promise<OpenEventOutcome> {
  const d = resolveOpenProcessingDeps(deps);
  try {
    const message = await matchEvent(event, d.store);
    const nowIso = d.now().toISOString();

    if (!message) {
      const age = d.now().getTime() - new Date(event.received_at).getTime();
      if (age < UNMATCHED_RETRY_WINDOW_MS) return "unmatched_pending";
      await d.store.markProviderEventProcessed(event.id, { outcome: "unmatched", emailMessageId: null, at: nowIso });
      return "unmatched";
    }

    const won = await d.store.setFirstOpenIfUnset(message.id, event.occurred_at, event.id);
    if (isStoreError(won)) {
      console.error("[emailTracking] First-open update failed — event left for retry.", { eventId: event.id, error: won.error });
      return "error";
    }

    if (won) {
      await d.store.markProviderEventProcessed(event.id, { outcome: "first_open", emailMessageId: message.id, at: nowIso });
      await notifyFirstOpen(won, d);
      return "first_open";
    }

    await d.store.lowerFirstOpenIfEarlier(message.id, event.occurred_at, event.id);
    await d.store.markProviderEventProcessed(event.id, { outcome: "repeat_open", emailMessageId: message.id, at: nowIso });
    return "repeat_open";
  } catch (err) {
    console.error("[emailTracking] Processing open event threw — left for retry.", {
      eventId: event.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return "error";
  }
}

export type NotifyOutcome = "not_eligible" | "already_claimed" | "delivered" | "failed";

/** Posts the one #customer-success notification for a first open, if eligible. Never throws. */
export async function notifyFirstOpen(row: EmailMessageRow, deps: OpenProcessingDeps = {}): Promise<NotifyOutcome> {
  const d = resolveOpenProcessingDeps(deps);

  if (!isEligibleForOpenSlack(row, d.runtimeEnvironment)) return "not_eligible";
  if (row.open_notify_attempt_count >= MAX_OPEN_NOTIFY_ATTEMPTS) return "not_eligible";

  try {
    const now = d.now();
    const claimed = await d.store.claimOpenNotification(
      row.id,
      now.toISOString(),
      new Date(now.getTime() - OPEN_NOTIFY_CLAIM_STALE_MS).toISOString()
    );
    if (isStoreError(claimed)) {
      console.error("[emailTracking] Open-notification claim failed.", { emailMessageId: row.id, error: claimed.error });
      return "failed";
    }
    if (!claimed) return "already_claimed";

    const venueName = (claimed.venue_id && (await d.store.getVenueName(claimed.venue_id))) || "Unknown venue";
    const text = buildEmailOpenedSlackText({
      venueName,
      emailType: claimed.email_type,
      sendContext: (claimed.send_context as EmailSendContext | null) ?? null,
      recipientEmail: claimed.recipient_email,
      sentAt: claimed.sent_at,
      firstOpenedAt: claimed.first_opened_at as string,
    });

    const result = await d.sendSlack(text);
    if (result === "delivered") {
      const marked = await d.store.markOpenNotified(claimed.id, d.now().toISOString());
      if (isStoreError(marked)) {
        console.error("[emailTracking] Slack delivered but marking notified failed.", { emailMessageId: claimed.id, error: marked.error });
      }
      return "delivered";
    }

    await d.store.releaseOpenNotificationClaim(claimed.id, {
      error: sanitizeTrackingError(`slack ${result}`),
      attemptCount: claimed.open_notify_attempt_count + 1,
    });
    return "failed";
  } catch (err) {
    console.error("[emailTracking] Open notification threw.", {
      emailMessageId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

export type EmailOpenTrackingRunResult = {
  eventsExamined: number;
  firstOpens: number;
  repeatOpens: number;
  stillUnmatched: number;
  expiredUnmatched: number;
  eventErrors: number;
  notificationsAttempted: number;
  notificationsDelivered: number;
  notificationsFailed: number;
};

/**
 * Cron entry: (1) retry matching for unprocessed open events (early
 * arrivals, transient failures), (2) retry undelivered #customer-success
 * notifications. Only a production deployment ever posts to Slack.
 */
export async function runEmailOpenTracking(deps: OpenProcessingDeps = {}, limits = { events: 100, notifications: 25 }): Promise<EmailOpenTrackingRunResult> {
  const d = resolveOpenProcessingDeps(deps);
  const result: EmailOpenTrackingRunResult = {
    eventsExamined: 0,
    firstOpens: 0,
    repeatOpens: 0,
    stillUnmatched: 0,
    expiredUnmatched: 0,
    eventErrors: 0,
    notificationsAttempted: 0,
    notificationsDelivered: 0,
    notificationsFailed: 0,
  };

  const pending = await d.store.listUnprocessedProviderEvents(limits.events);
  if (isStoreError(pending)) {
    console.error("[emailTracking] Listing unprocessed open events failed.", { error: pending.error });
  } else {
    for (const event of pending) {
      result.eventsExamined++;
      const outcome = await processOpenEvent(event, d);
      if (outcome === "first_open") result.firstOpens++;
      else if (outcome === "repeat_open") result.repeatOpens++;
      else if (outcome === "unmatched_pending") result.stillUnmatched++;
      else if (outcome === "unmatched") result.expiredUnmatched++;
      else result.eventErrors++;
    }
  }

  if (d.runtimeEnvironment !== "production") return result;

  const toNotify = await d.store.listPendingOpenNotifications({
    environment: "production",
    limit: limits.notifications,
    maxAttempts: MAX_OPEN_NOTIFY_ATTEMPTS,
  });
  if (isStoreError(toNotify)) {
    console.error("[emailTracking] Listing pending open notifications failed.", { error: toNotify.error });
    return result;
  }
  for (const row of toNotify) {
    result.notificationsAttempted++;
    const outcome = await notifyFirstOpen(row, d);
    if (outcome === "delivered") result.notificationsDelivered++;
    else if (outcome === "failed") result.notificationsFailed++;
  }
  return result;
}
