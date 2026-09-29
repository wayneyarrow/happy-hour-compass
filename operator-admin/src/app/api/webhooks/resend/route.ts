/**
 * POST /api/webhooks/resend
 *
 * Receives Resend webhook deliveries (subscribe the endpoint to
 * `email.opened` only). Signature-verified against RESEND_WEBHOOK_SECRET;
 * records the first open of each HHC-registered email. All logic lives in
 * src/lib/emailTracking/resendWebhookHandler.ts — this route is a thin
 * adapter that hands it the RAW body (signature verification requires the
 * exact bytes Resend signed).
 */
import { NextRequest, NextResponse } from "next/server";
import { handleResendWebhookRequest } from "@/lib/emailTracking/resendWebhookHandler";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text().catch(() => null);

  if (rawBody === null) {
    console.error("[webhook/resend] Failed to read request body");
    return NextResponse.json({ error: "Failed to read body" }, { status: 400 });
  }

  const outcome = await handleResendWebhookRequest(
    {
      id: request.headers.get("svix-id") ?? request.headers.get("webhook-id"),
      timestamp: request.headers.get("svix-timestamp") ?? request.headers.get("webhook-timestamp"),
      signature: request.headers.get("svix-signature") ?? request.headers.get("webhook-signature"),
    },
    rawBody
  );
  return NextResponse.json(outcome.body, { status: outcome.status });
}
