/**
 * GET/POST /api/cron/brevo-sync-outbox
 *
 * Processes due rows in public.brevo_sync_outbox
 * (supabase/migrations/075_brevo_sync_outbox.sql) — the outbound sync
 * direction — and, in the same scheduled run, gives any persisted-but-
 * unreconciled Brevo unsubscribe events (public.brevo_webhook_events,
 * `processed_at IS NULL`) a bounded retry opportunity — the inbound
 * direction (src/lib/brevo/webhookEventsProcessor.ts). Both reuse this one
 * cron route rather than a second scheduled endpoint: webhookHandler.ts's
 * inline reconciliation attempt already handles the common case at
 * delivery time, and Brevo cannot be relied on to redeliver an event HHC
 * already returned a successful HTTP response for, so this scheduled pass
 * is what guarantees a failed inline attempt still gets reconciled
 * eventually, without requiring Wayne to manually retry anything.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}`. This is Vercel's
 * own documented convention — when a CRON_SECRET env var is present on a
 * Vercel project, Vercel automatically sends it as a bearer token on
 * requests it makes to that project's cron-invoked routes, and the route is
 * expected to verify it (see Vercel's "Securing Cron Jobs" docs). The same
 * header lets Wayne trigger this manually (e.g. `curl -H "Authorization:
 * Bearer $CRON_SECRET" .../api/cron/brevo-sync-outbox`) for staging
 * testing — which matters because Vercel Cron only executes against
 * Production deployments, not Preview/branch deployments, so the `website`
 * branch has no automatic scheduled trigger for this route today.
 *
 * Deliberately NOT done by this task: adding CRON_SECRET to Vercel, and
 * adding a `crons` entry to vercel.json (Vercel Cron requires Production
 * and depends on the project's plan/frequency limits) — see the foundation
 * report's "external configuration required" section. This route is the
 * callable processing primitive that step wires a schedule to.
 *
 * Phase 1: nothing enqueues real rows into brevo_sync_outbox yet (see
 * src/lib/brevo/contactSync.ts), so in current practice this is a safe
 * no-op — it exists now so the durable processing primitive and its
 * execution path are both built and end-to-end testable ahead of Phase 2.
 */
import { NextRequest, NextResponse } from "next/server";
import { processBrevoOutboxBatch } from "@/lib/brevo/outbox";
import { processUnprocessedWebhookEvents } from "@/lib/brevo/webhookEventsProcessor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/brevo-sync-outbox] CRON_SECRET is not set — refusing to process");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    console.warn("[cron/brevo-sync-outbox] Rejected request — invalid or missing bearer token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processBrevoOutboxBatch();
  console.log("[cron/brevo-sync-outbox] batch processed", result);

  const webhookEventsResult = await processUnprocessedWebhookEvents();
  console.log("[cron/brevo-sync-outbox] webhook events processed", webhookEventsResult);

  return NextResponse.json({ status: "ok", result, webhookEventsResult });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
