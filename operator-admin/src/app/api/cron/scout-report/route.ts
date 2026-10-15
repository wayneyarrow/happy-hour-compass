/**
 * GET/POST /api/cron/scout-report
 *
 * Scheduled Scout report generation (stage two). Thin auth + logging wrapper
 * around runScheduledScoutReport() (src/lib/scoutReport/storage/), the same
 * separation as /api/cron/operator-activation-reminders.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, the codebase's cron
 * convention (Vercel sends it automatically). Vercel Cron only invokes
 * Production deployments; on staging this route runs only when called
 * manually with the secret.
 *
 * SAFETY:
 *   - Gated by SCOUT_REPORT_GENERATION_ENABLED (generationConfig.ts), checked
 *     before anything is read or written. Unset everywhere until reviewed.
 *   - No request input of any kind is read (no query, body or headers beyond
 *     the bearer token), so a caller can't choose the period, the
 *     environment or bypass the schedule window.
 *   - Writes only the one scout_reports row for the period (plus retention of
 *     old Scout rows). No email, no operator contact, no AI API. A failure
 *     alert goes to #ops-alerts at most once per period, Production only.
 *
 * Never logs the Authorization header, report contents or failure details
 * beyond the sanitized outcome.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveAnalyticsEnvironment } from "@/lib/analyticsEnvironment";
import { sendSlackAlert } from "@/lib/slack";
import { buildScoutReport } from "@/lib/scoutReport/buildScoutReport";
import { isScoutReportGenerationEnabled } from "@/lib/scoutReport/storage/generationConfig";
import { runScheduledScoutReport } from "@/lib/scoutReport/storage/scheduledGeneration";
import { createSupabaseScoutReportStore } from "@/lib/scoutReport/storage/scoutReportStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/scout-report] CRON_SECRET is not set — refusing to process");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    console.warn("[cron/scout-report] Rejected request — invalid or missing bearer token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = isScoutReportGenerationEnabled();
  const result = await runScheduledScoutReport({
    enabled,
    // Always "scheduled": the network surface can never bypass the Production Monday window.
    trigger: "scheduled",
    environment: resolveAnalyticsEnvironment(),
    now: () => new Date(),
    // Called only after the kill switch, environment and schedule gates pass.
    createStore: () => createSupabaseScoutReportStore(createAdminClient()),
    build: (now) => buildScoutReport({ now }),
    sendAlert: (a) => sendSlackAlert({ channel: "ops-alerts", severity: "warning", title: a.title, message: a.message, metadata: a.metadata }),
    builderVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
  });

  console.log("[cron/scout-report] run complete", {
    outcome: result.outcome,
    reason: result.reason ?? null,
    period: result.periodStartDate ?? null,
    attempt: result.attempt ?? null,
    alerted: result.alerted ?? false,
    retentionDeleted: result.retentionDeleted ?? null,
    errors: result.errors.length,
  });
  // A storage failure is surfaced as 500 so it shows as a failed invocation in the cron logs.
  const status = result.outcome === "store_error" ? 500 : 200;
  return NextResponse.json({ status: status === 200 ? "ok" : "error", result }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
