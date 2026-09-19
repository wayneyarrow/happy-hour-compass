/**
 * GET/POST /api/cron/operator-activation-reminders
 *
 * Operator activation reminders/expiry (Phase 2A-3). Thin auth + logging
 * wrapper around processActivationReminders() (src/lib/activation/) — all
 * orchestration logic lives there, identical separation-of-concerns
 * convention to /api/cron/customer-success-deliveries.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` — same convention
 * as every other cron route in this codebase. Vercel Cron only executes
 * against Production deployments, not Preview/branch deployments — so on
 * `website`, this route has no automatic scheduled trigger regardless of
 * the schedule in vercel.json.
 *
 * SAFETY: live processing is independently gated by the
 * OPERATOR_ACTIVATION_REMINDERS_ENABLED server-side kill switch
 * (activationReminderConfig.ts) — this route being reachable (correct
 * bearer token) does NOT by itself mean any read, write, email, or Slack
 * call happens. The kill switch is unset today, so even once this route is
 * live on a Production deployment, invoking it is a safe, complete no-op —
 * processActivationReminders() returns immediately, before creating a
 * Supabase client or touching anything.
 *
 * No dependency-injection parameter of any kind is accepted here (query,
 * body, or otherwise) — that seam exists ONLY on the plain, never-network-
 * reachable orchestrator module and its own tests. In particular, this
 * route intentionally has no dryRun parameter: accepting one here would
 * let a network caller weaken production behavior, which the orchestrator
 * itself must never allow from an untrusted input.
 *
 * Never logs the Authorization header or its value.
 */
import { NextRequest, NextResponse } from "next/server";
import { processActivationReminders } from "@/lib/activation/processActivationReminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/operator-activation-reminders] CRON_SECRET is not set — refusing to process");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    console.warn("[cron/operator-activation-reminders] Rejected request — invalid or missing bearer token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processActivationReminders();
  console.log("[cron/operator-activation-reminders] run complete", {
    enabled: result.enabled,
    staleLeasesRecovered: result.staleLeasesRecovered,
    lazilyInitialized: result.lazilyInitialized,
    expiryTransitioned: result.expiryTransitioned,
    expiryNotesWritten: result.expiryNotesWritten,
    expirySlackSent: result.expirySlackSent,
    expiryFounderEmailsSent: result.expiryFounderEmailsSent,
    reminderAttempted: result.reminderAttempted,
    reminderSent: result.reminderSent,
    reminderFailedRetryable: result.reminderFailedRetryable,
    reminderFailedExhausted: result.reminderFailedExhausted,
    reminderSkippedRaced: result.reminderSkippedRaced,
    reminderSkippedActivated: result.reminderSkippedActivated,
    reminderSkippedUnresolvedOrigin: result.reminderSkippedUnresolvedOrigin,
    errors: result.errors.length,
  });

  return NextResponse.json({ status: "ok", result: { ...result, plannedActions: undefined } });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
