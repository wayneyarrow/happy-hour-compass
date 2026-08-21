import { getDefaultBrevoAdminClient, type BrevoAdminClient } from "./supabaseAdminClient";
import { reconcileConsumerUnsubscribe } from "./consumerConsentReconciliation";
import { type ConsumerLookupClient } from "./consumerEligibility";
import { maskEmail } from "./maskEmail";

/**
 * Bounded scheduled retry for persisted-but-unreconciled Brevo unsubscribe
 * events — closes the one durability gap webhookHandler.ts's inline
 * reconciliation attempt leaves: once HHC has returned a successful HTTP
 * response for a webhook delivery, Brevo has no reason to redeliver it, so
 * a failed inline reconciliation attempt cannot rely on Brevo's own
 * redelivery for a second chance. This gives every `processed_at IS NULL`
 * unsubscribe event a guaranteed further processing opportunity on the
 * next scheduled run, with no dependency on Brevo resending anything.
 *
 * Called from the same cron route as the outbound outbox processor
 * (src/app/api/cron/brevo-sync-outbox/route.ts) — reuses the existing
 * scheduled execution rather than a second cron endpoint/architecture.
 *
 * No claim/lock mechanism, deliberately: reconcileConsumerUnsubscribe() is
 * itself idempotent (an already-false consumer is a safe no-op), so two
 * concurrent processor runs picking up the same row is harmless — at worst
 * duplicate work, never incorrect state or a double-write hazard. This
 * matches Part 3's explicit "don't build elaborate locking unless needed
 * for correctness" — it genuinely isn't needed here.
 */

export type WebhookEventsProcessResult = {
  claimed: number;
  processed: number;
  failed: number;
};

const DEFAULT_BATCH_LIMIT = 25;

export async function processUnprocessedWebhookEvents(
  limit = DEFAULT_BATCH_LIMIT,
  webhookEventsClient: BrevoAdminClient = getDefaultBrevoAdminClient(),
  consumerLookupClient?: ConsumerLookupClient,
  outboxClient?: BrevoAdminClient
): Promise<WebhookEventsProcessResult> {
  const result: WebhookEventsProcessResult = { claimed: 0, processed: 0, failed: 0 };

  // Only unsubscribe events are ever actioned — "unrecognized" events are
  // never reconciled against consumer state, matching webhookHandler.ts's
  // own rule (they're never marked processed there either, so they'd
  // otherwise show up here forever; excluding them by event_type keeps
  // this processor scoped to work it can actually complete).
  const { data, error } = await webhookEventsClient
    .from("brevo_webhook_events")
    .select("id, email")
    .eq("event_type", "unsubscribe")
    .is("processed_at", null)
    .order("received_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[brevo/webhookEventsProcessor] failed to select unprocessed events:", error.message);
    return result;
  }

  const rows = (data ?? []) as { id: string; email: string | null }[];
  result.claimed = rows.length;

  for (const row of rows) {
    // One bad/throwing event must never block the rest of the bounded batch.
    try {
      const succeeded = await processOneEvent(row, webhookEventsClient, consumerLookupClient, outboxClient);
      if (succeeded) result.processed++;
      else result.failed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[brevo/webhookEventsProcessor] unexpected error processing event — continuing batch", {
        eventId: row.id,
        error: message,
      });
      result.failed++;
    }
  }

  return result;
}

async function processOneEvent(
  row: { id: string; email: string | null },
  webhookEventsClient: BrevoAdminClient,
  consumerLookupClient: ConsumerLookupClient | undefined,
  outboxClient: BrevoAdminClient | undefined
): Promise<boolean> {
  if (!row.email) {
    // Nothing to reconcile against — mark processed so it doesn't linger
    // forever for work that can never be actioned (matches
    // webhookHandler.ts's identical rule for the inline path).
    await markProcessed(row.id, webhookEventsClient);
    return true;
  }

  const outcome = await reconcileConsumerUnsubscribe(row.email, { consumerLookupClient, outboxClient });

  if (outcome.ok) {
    console.log("[brevo/webhookEventsProcessor] retry reconciled", {
      eventId: row.id,
      outcome: outcome.outcome,
      email: maskEmail(row.email),
    });
    await markProcessed(row.id, webhookEventsClient);
    return true;
  }

  console.error("[brevo/webhookEventsProcessor] retry failed — remains unprocessed for a future attempt", {
    eventId: row.id,
    email: maskEmail(row.email),
    error: outcome.error,
  });
  return false;
}

async function markProcessed(eventId: string, webhookEventsClient: BrevoAdminClient): Promise<void> {
  const { error } = await webhookEventsClient
    .from("brevo_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventId);

  if (error) {
    console.error("[brevo/webhookEventsProcessor] failed to mark event processed:", error.message, { eventId });
  }
}
