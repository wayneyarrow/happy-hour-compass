import { hashWebhookPayload } from "./webhookDedupe";
import { normalizeEmail } from "./config";
import { verifyBrevoWebhookRequest } from "./webhookAuth";
import { getDefaultBrevoAdminClient, type BrevoAdminClient } from "./supabaseAdminClient";
import { sendSlackAlert } from "@/lib/slack";

/**
 * Core logic for POST /api/webhooks/brevo, factored out of the route
 * handler so it's directly unit-testable (a plain function taking a header
 * + raw body string + injectable Supabase client) without constructing a
 * real NextRequest. The route (src/app/api/webhooks/brevo/route.ts) is a
 * thin adapter that calls this and wraps the result in NextResponse.json().
 *
 * See supabase/migrations/076_brevo_webhook_events.sql for the Phase 1
 * scope and dedupe-strategy rationale.
 */

export type BrevoWebhookOutcome = { status: number; body: Record<string, unknown> };

export async function handleBrevoWebhookRequest(
  authorizationHeader: string | null,
  rawBody: string,
  supabase: BrevoAdminClient = getDefaultBrevoAdminClient()
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
  const dedupeKey = hashWebhookPayload(record);

  const { data: inserted, error } = await supabase
    .from("brevo_webhook_events")
    .insert({
      event_type: eventType,
      dedupe_key: dedupeKey,
      email: email ? normalizeEmail(email) : null,
      raw_payload: record,
    })
    .select("id")
    .single();

  if (error) {
    // Postgres unique_violation on (provider, dedupe_key) means this exact
    // event was already recorded — a duplicate delivery. That's a SUCCESS
    // from Brevo's perspective: acking it prevents Brevo retrying a
    // delivery we already have recorded.
    if (error.code === "23505") {
      console.log("[webhook/brevo] duplicate delivery — already recorded", { dedupeKey });
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

  return { status: 202, body: { status: "accepted", eventType } };
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
