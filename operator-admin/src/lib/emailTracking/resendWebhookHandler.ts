import { Resend } from "resend";
import { sendSlackAlert } from "@/lib/slack";
import { getResendWebhookSecret } from "./emailTrackingConfig";
import { SEND_REF_TAG, isSendRef } from "./emailTrackingPolicy";
import { isStoreError } from "./emailTrackingStore";
import { processOpenEvent, resolveOpenProcessingDeps, type OpenProcessingDeps } from "./emailOpenProcessing";

/**
 * Core logic for POST /api/webhooks/resend — factored out of the route so
 * it is unit-testable without a NextRequest (same split as the Brevo
 * webhook).
 *
 * SECURITY:
 *   - Every delivery is signature-verified with Resend's own SDK
 *     (resend.webhooks.verify → Standard Webhooks / Svix HMAC-SHA256 over
 *     `${id}.${timestamp}.${rawBody}`), against the RAW request body. The
 *     verifier also rejects timestamps outside its tolerance window
 *     (replay protection).
 *   - RESEND_WEBHOOK_SECRET missing ⇒ 500 for everything + one
 *     #ops-critical alert per server instance (fail closed; not per request,
 *     so unauthenticated traffic can't flood the channel).
 *   - Bad/missing signature ⇒ 401. Header values, the secret, and the body
 *     are never logged.
 *   - Only `email.opened` is acted on; any other verified type is
 *     acknowledged (200) and ignored.
 *
 * DURABILITY: the event is persisted (deduplicated by the webhook delivery
 * id) BEFORE any processing. Persist failure ⇒ 500 so Resend redelivers.
 * Once persisted, the response is 2xx regardless of processing outcome —
 * the email-open-tracking cron retries anything left unprocessed.
 */

let misconfiguredAlertSent = false;

/** Test-only: reset the once-per-instance misconfiguration alert latch. */
export function __resetMisconfiguredAlertForTests(): void {
  misconfiguredAlertSent = false;
}

export type ResendWebhookOutcome = { status: number; body: Record<string, unknown> };

export type ResendWebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type ResendWebhookDeps = OpenProcessingDeps & {
  secret?: string | null;
  /** Test seam — defaults to the Resend SDK's verifier. Throws on invalid. */
  verify?: (args: { payload: string; headers: { id: string; timestamp: string; signature: string }; webhookSecret: string }) => unknown;
  alertMisconfigured?: () => Promise<void>;
};

function defaultVerify(args: { payload: string; headers: { id: string; timestamp: string; signature: string }; webhookSecret: string }): unknown {
  // webhooks.verify() is purely local (no network), but the Resend
  // constructor insists on some API key string being present.
  return new Resend(process.env.RESEND_API_KEY || "re_webhook_verify_only").webhooks.verify(args);
}

async function defaultAlertMisconfigured(): Promise<void> {
  await sendSlackAlert({
    channel: "ops-critical",
    severity: "critical",
    title: "Resend webhook misconfigured",
    message: "RESEND_WEBHOOK_SECRET is not set — every Resend webhook delivery is being rejected before processing in this environment.",
    metadata: { environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown" },
  });
}

function parseOpenedEvent(payload: unknown): { providerMessageId: string | null; taggedSendRef: string | null; occurredAt: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "email.opened") return null;
  const data = (typeof p.data === "object" && p.data !== null ? p.data : {}) as Record<string, unknown>;
  const tags = (typeof data.tags === "object" && data.tags !== null ? data.tags : {}) as Record<string, unknown>;
  const occurred = typeof p.created_at === "string" && !Number.isNaN(Date.parse(p.created_at)) ? new Date(p.created_at).toISOString() : new Date().toISOString();
  const tagged = tags[SEND_REF_TAG];
  return {
    providerMessageId: typeof data.email_id === "string" && data.email_id ? data.email_id : null,
    taggedSendRef: isSendRef(tagged) ? tagged : null,
    occurredAt: occurred,
  };
}

export async function handleResendWebhookRequest(
  headers: ResendWebhookHeaders,
  rawBody: string,
  deps: ResendWebhookDeps = {}
): Promise<ResendWebhookOutcome> {
  const secret = deps.secret !== undefined ? deps.secret : getResendWebhookSecret();
  if (!secret) {
    console.error("[webhook/resend] RESEND_WEBHOOK_SECRET is not set — rejecting all deliveries");
    // At most one alert per server instance: this branch is reachable by
    // any unauthenticated POST, so alerting per request would let anyone
    // flood #ops-critical while the secret is unset.
    if (!misconfiguredAlertSent) {
      misconfiguredAlertSent = true;
      await (deps.alertMisconfigured ?? defaultAlertMisconfigured)();
    }
    return { status: 500, body: { error: "Webhook not configured" } };
  }

  if (!headers.id || !headers.timestamp || !headers.signature) {
    console.warn("[webhook/resend] Rejected request — missing signature headers");
    return { status: 401, body: { error: "Unauthorized" } };
  }

  let payload: unknown;
  try {
    payload = (deps.verify ?? defaultVerify)({
      payload: rawBody,
      headers: { id: headers.id, timestamp: headers.timestamp, signature: headers.signature },
      webhookSecret: secret,
    });
  } catch {
    console.warn("[webhook/resend] Rejected request — signature verification failed");
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const type = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).type : undefined;
  const opened = parseOpenedEvent(payload);
  if (!opened) {
    return { status: 200, body: { status: "ignored", type: typeof type === "string" ? type : "unknown" } };
  }

  const d = resolveOpenProcessingDeps(deps);
  const inserted = await d.store.insertProviderEvent({
    provider_event_id: headers.id,
    event_type: "email.opened",
    provider_message_id: opened.providerMessageId,
    tagged_send_ref: opened.taggedSendRef,
    occurred_at: opened.occurredAt,
  });

  if (isStoreError(inserted)) {
    console.error("[webhook/resend] Failed to persist open event:", inserted.error);
    return { status: 500, body: { error: "Failed to record event" } };
  }

  const event = "row" in inserted ? inserted.row : inserted.duplicate;
  if ("duplicate" in inserted && inserted.duplicate.processed_at) {
    return { status: 200, body: { status: "duplicate" } };
  }

  const outcome = await processOpenEvent(event, d);
  console.log("[webhook/resend] open event recorded", { eventId: event.id, outcome });
  return { status: 200, body: { status: "accepted", outcome } };
}
