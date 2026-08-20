/**
 * POST /api/webhooks/brevo
 *
 * Receives Brevo's outbound Marketing webhook (Token authentication).
 *
 * Phase 1 scope: recognizes and durably, idempotently records the
 * `unsubscribed` Marketing event only (see
 * supabase/migrations/076_brevo_webhook_events.sql). It deliberately does
 * NOT update consumer_profiles.marketing_consent yet — connecting a
 * recorded event to an actual consent change is explicit Phase 2 scope per
 * the Brevo integration foundation report, kept separate so this endpoint
 * can be reviewed, deployed, and pointed at by a real Brevo webhook
 * (configured after this ships — see src/lib/brevo/webhookAuth.ts) before
 * any consumer state is touched by it.
 *
 * All actual logic lives in src/lib/brevo/webhookHandler.ts (auth check,
 * payload validation, dedupe, persistence) so it's directly unit-testable
 * without constructing a NextRequest — this route is a thin adapter.
 */
import { NextRequest, NextResponse } from "next/server";
import { handleBrevoWebhookRequest } from "@/lib/brevo/webhookHandler";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text().catch(() => null);

  if (rawBody === null) {
    console.error("[webhook/brevo] Failed to read request body");
    return NextResponse.json({ error: "Failed to read body" }, { status: 400 });
  }

  const outcome = await handleBrevoWebhookRequest(request.headers.get("authorization"), rawBody);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
