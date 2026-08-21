import { hashWebhookPayload } from "./webhookDedupe";
import { normalizeEmail } from "./config";
import { verifyBrevoWebhookRequest } from "./webhookAuth";
import { getDefaultBrevoAdminClient, type BrevoAdminClient } from "./supabaseAdminClient";
import { reconcileConsumerUnsubscribe } from "./consumerConsentReconciliation";
import { type ConsumerLookupClient } from "./consumerEligibility";
import { maskEmail } from "./maskEmail";
import { sendSlackAlert } from "@/lib/slack";

/**
 * Core logic for POST /api/webhooks/brevo, factored out of the route
 * handler so it's directly unit-testable (a plain function taking a header
 * + raw body string + injectable Supabase clients) without constructing a
 * real NextRequest. The route (src/app/api/webhooks/brevo/route.ts) is a
 * thin adapter that calls this and wraps the result in NextResponse.json().
 *
 * See supabase/migrations/076_brevo_webhook_events.sql for the Phase 1
 * persistence/dedupe scope. Inbound consent reconciliation (this file's
 * `reconcileConsumerUnsubscribe` wiring) is Phase 2B: a recognized
 * `unsubscribe` event additionally attempts to move the matching HHC
 * consumer's marketing_consent to false, via consumerConsentReconciliation.ts.
 *
 * Durability: `brevo_webhook_events.processed_at` (already present in the
 * 076 migration — no schema change was needed for this) is set only once
 * reconciliation has actually completed (successfully, including a safe
 * no-op outcome). A failed reconciliation attempt leaves it NULL, which
 * stays queryable via that migration's own
 * brevo_webhook_events_unprocessed_idx partial index — the durable webhook
 * record itself is never lost even if the Supabase write fails. There is
 * no dedicated automatic-retry cron for this table (unlike
 * brevo_sync_outbox's claim/retry processor) — a genuine reconciliation
 * failure is observable via that index and via the error logged below, but
 * not automatically retried by this code. As an opportunistic (not
 * guaranteed) second chance, a duplicate delivery of the same event
 * (Brevo's own redelivery, or a genuine resend) re-attempts reconciliation
 * if the original attempt never completed.
 */

export type BrevoWebhookOutcome = { status: number; body: Record<string, unknown> };

export async function handleBrevoWebhookRequest(
  authorizationHeader: string | null,
  rawBody: string,
  webhookEventsClient: BrevoAdminClient = getDefaultBrevoAdminClient(),
  reconciliation: {
    consumerLookupClient?: ConsumerLookupClient;
    outboxClient?: BrevoAdminClient;
  } = {}
): Promise<BrevoWebhookOutcome> {
  const auth = verifyBrevoWebhookRequest(authorizationHeader);

  if (!auth.ok) {
    if (auth.reason === "missing_config") {
      console.error("[webhook/brevo] BREVO_WEBHOOK_TOKEN is not set — rejecting all deliveries");
      await sendSlackAlert({
        channel: "ops-critical",
        severity: "critical",
        title: "Brevo webhook misconfigured",
        message:
          "BREVO_WEBHOOK_TOKEN is not set — every Brevo webhook delivery is being rejected before processing in this environment.",
        metadata: { environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown" },
      });
      return { status: 500, body: { error: "Webhook not configured" } };
    }

    // missing_token / invalid_token — never log the presented header value.
    console.warn("[webhook/brevo] Rejected request — reason:", auth.reason);
    return { status: 401, body: { error: "Unauthorized" } };
  }

  let parsed: unknown;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    console.warn("[webhook/brevo] Malformed JSON payload");
    return { status: 400, body: { error: "Malformed payload" } };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn("[webhook/brevo] Payload is not a JSON object");
    return { status: 400, body: { error: "Malformed payload" } };
  }

  const record = parsed as Record<string, unknown>;
  const eventType = classifyEventType(record);
  const email = extractEmail(record);
  const normalizedEmail = email ? normalizeEmail(email) : null;
  const dedupeKey = hashWebhookPayload(record);

  const { data: inserted, error } = await webhookEventsClient
    .from("brevo_webhook_events")
    .insert({
      event_type: eventType,
      dedupe_key: dedupeKey,
      email: normalizedEmail,
      raw_payload: record,
    })
    .select("id")
    .single();

  if (error) {
    // Postgres unique_violation on (provider, dedupe_key) means this exact
    // event was already recorded — a duplicate delivery. That's a SUCCESS
    // from Brevo's perspective: acking it prevents Brevo retrying a
    // delivery we already have recorded. If the original attempt never
    // finished reconciling (processed_at still NULL), this redelivery is
    // also treated as an opportunistic second chance to reconcile it now —
    // see this file's top-level doc comment.
    if (error.code === "23505") {
      console.log("[webhook/brevo] duplicate delivery — already recorded", { dedupeKey });

      const { data: existing } = await webhookEventsClient
        .from("brevo_webhook_events")
        .select("id, event_type, email, processed_at")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();

      if (existing && existing.event_type === "unsubscribe" && !existing.processed_at) {
        await attemptReconciliationAndMarkProcessed(
          existing.id as string,
          (existing.email as string | null) ?? null,
          webhookEventsClient,
          reconciliation
        );
      }

      return { status: 200, body: { status: "duplicate" } };
    }
    console.error("[webhook/brevo] Failed to persist event:", error.message);
    return { status: 500, body: { error: "Failed to record event" } };
  }

  console.log("[webhook/brevo] event recorded", {
    provider: "brevo",
    eventType,
    eventId: inserted?.id,
    recognized: eventType === "unsubscribe",
  });

  if (eventType === "unsubscribe" && inserted?.id) {
    await attemptReconciliationAndMarkProcessed(inserted.id, normalizedEmail, webhookEventsClient, reconciliation);
  }

  return { status: 202, body: { status: "accepted", eventType } };
}

async function attemptReconciliationAndMarkProcessed(
  eventId: string,
  email: string | null,
  webhookEventsClient: BrevoAdminClient,
  reconciliation: { consumerLookupClient?: ConsumerLookupClient; outboxClient?: BrevoAdminClient }
): Promise<void> {
  if (!email) {
    // No usable email — nothing to reconcile against, but the event was
    // validly received and classified; mark it processed so it doesn't
    // linger forever in the unprocessed-events index for something that
    // can never be actioned.
    await markEventProcessed(eventId, webhookEventsClient);
    return;
  }

  const result = await reconcileConsumerUnsubscribe(email, reconciliation);

  if (result.ok) {
    console.log("[webhook/brevo] unsubscribe reconciled", {
      eventId,
      outcome: result.outcome,
      email: maskEmail(email),
    });
    await markEventProcessed(eventId, webhookEventsClient);
  } else {
    console.error("[webhook/brevo] unsubscribe reconciliation failed — event remains unprocessed for later retry", {
      eventId,
      email: maskEmail(email),
      error: result.error,
    });
    // processed_at intentionally left NULL — observable via
    // brevo_webhook_events_unprocessed_idx (076 migration).
  }
}

async function markEventProcessed(eventId: string, webhookEventsClient: BrevoAdminClient): Promise<void> {
  const { error } = await webhookEventsClient
    .from("brevo_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventId);

  if (error) {
    console.error("[webhook/brevo] failed to mark event processed:", error.message, { eventId });
  }
}

export function classifyEventType(record: Record<string, unknown>): "unsubscribe" | "unrecognized" {
  const candidates = [record.event, record.msg_status, record.type]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());

  if (candidates.some((v) => v === "unsubscribe" || v === "unsubscribed")) {
    return "unsubscribe";
  }
  return "unrecognized";
}

export function extractEmail(record: Record<string, unknown>): string | null {
  const candidate = record.email ?? record.to;
  return typeof candidate === "string" && candidate.includes("@") ? candidate : null;
}
