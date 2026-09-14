/**
 * GET/POST /api/cron/customer-success-deliveries
 *
 * Customer Success (Phase 1B) — venue-view milestone email delivery. Runs
 * detection, then processes due deliveries (claim, send/retry, Slack) via
 * processCustomerSuccessDeliveries() (src/lib/customerSuccess/). All
 * orchestration logic lives there — this route is only auth + logging, the
 * same separation-of-concerns convention as /api/cron/brevo-sync-outbox.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` — Vercel's own
 * documented convention (see that route's header comment for the full
 * reasoning; identical here). Vercel Cron only executes against Production
 * deployments, not Preview/branch deployments — so on `website`, this
 * route has no automatic scheduled trigger regardless of the schedule in
 * vercel.json; it's reachable only via an authenticated manual call for
 * staging testing.
 *
 * SAFETY: live sending is independently gated by the
 * CUSTOMER_SUCCESS_EMAILS_ENABLED server-side kill switch
 * (customerSuccessConfig.ts) — this route being reachable (correct bearer
 * token) does NOT by itself mean any email gets sent. Detection and
 * scheduling bookkeeping still run either way; the Resend call is the one
 * thing gated by the switch.
 *
 * Scheduled via the `crons` entry in vercel.json — hourly, so a single
 * schedule naturally covers the ~3pm initial send plus the ~4pm/~5pm
 * retries and every venue's own local timezone (Section 7).
 */
import { NextRequest, NextResponse } from "next/server";
import { processCustomerSuccessDeliveries } from "@/lib/customerSuccess/processCustomerSuccessDeliveries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/customer-success-deliveries] CRON_SECRET is not set — refusing to process");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    console.warn("[cron/customer-success-deliveries] Rejected request — invalid or missing bearer token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processCustomerSuccessDeliveries();
  console.log("[cron/customer-success-deliveries] run complete", {
    enabled: result.enabled,
    staleRecovered: result.staleRecovered,
    newlyScheduled: result.newlyScheduled,
    successNotificationsRetried: result.successNotificationsRetried,
    attempted: result.attempted,
    sent: result.sent,
    retried: result.retried,
    failedTerminal: result.failedTerminal,
    recipientBlocked: result.recipientBlocked,
    errors: result.errors.length,
  });

  return NextResponse.json({ status: "ok", result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
