/**
 * GET/POST /api/cron/email-open-tracking
 *
 * Retry path for Resend open tracking (src/lib/emailTracking/):
 *   1. re-attempts matching for open events that arrived before their
 *      send was recorded, or whose processing failed transiently;
 *   2. re-attempts #customer-success "Email opened" notifications that
 *      failed. Only a Production deployment ever posts to Slack.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, identical to the other
 * cron routes. Vercel Cron only runs against Production deployments, so on
 * staging this route runs only via an authenticated manual call. No request
 * parameters are read.
 */
import { NextRequest, NextResponse } from "next/server";
import { runEmailOpenTracking } from "@/lib/emailTracking/emailOpenProcessing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/email-open-tracking] CRON_SECRET is not set — refusing to process");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    console.warn("[cron/email-open-tracking] Rejected request — invalid or missing bearer token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runEmailOpenTracking();
  console.log("[cron/email-open-tracking] run complete", result);
  return NextResponse.json({ status: "ok", result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
