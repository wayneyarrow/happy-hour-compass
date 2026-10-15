/**
 * Scheduled Scout report generation (stage two) — orchestration, no network
 * input. Called only by /api/cron/scout-report; every dependency is injected
 * so the rules can be tested without a database, Slack or the builder.
 *
 * SCHEDULE. Vercel cron expressions are always UTC (vendor docs), so the
 * route is invoked at 17:00/17:20/17:40 and 18:00/18:20/18:40 UTC on Mondays
 * (SCOUT_CRON_SCHEDULES) and this module runs only when it is Monday 10:xx in
 * America/Vancouver: 17:xx UTC under PDT, 18:xx UTC under PST. The other
 * three invocations each week exit without reading anything. The :20 and :40
 * passes are catch-ups — Vercel delivery is best effort (a run can be missed,
 * or delivered twice) and failed invocations are not retried by Vercel.
 *
 * ONE REPORT PER PERIOD. The table's UNIQUE (report_type, environment,
 * period_start) makes the first INSERT the only winner; later passes take
 * over an existing row only by compare-and-swap, and only when:
 *   - it isn't complete (a complete report is a permanent snapshot), and
 *   - it isn't being generated under a fresh lease (STALE_LEASE_MS), and
 *   - fewer than MAX_ATTEMPTS attempts have been made, and
 *   - retrying could help (an incomplete report whose retry advice is
 *     "not_suggested", or a failure classified persistent, is left alone).
 *
 * HONEST STORAGE. A built report is stored whatever its completeness, with
 * its section issues inside the payload. A retry never replaces a complete
 * report and never replaces an incomplete one with a report that has fewer
 * complete sections (kept_previous). A build that throws or times out stores
 * no payload: the row is "failed", or keeps its earlier incomplete payload.
 *
 * NO SIDE EFFECTS beyond the one scout_reports row (and retention of old
 * Scout rows): the builder is read-only, nothing is emailed, no operator is
 * contacted, no AI API is called. A Slack alert to #ops-alerts is sent at
 * most once per period, in Production only, when the period ends up failed
 * or incomplete with no further attempt coming.
 */

import { computeReportWindows, vancouverWeekdayIndex } from "../windows";
import type { ScoutReport } from "../buildScoutReport";
import { classifyFailure, type ReportIssue } from "../issues";
import { REPORT_TIME_ZONE } from "@/lib/searchDiscoveryReporting/config";
import {
  SCOUT_REPORT_TYPE,
  type ScoutReportRow,
  type ScoutReportStore,
  type ScoutStorageEnvironment,
  type StoredFailure,
} from "./types";

export const SCOUT_CRON_PATH = "/api/cron/scout-report";
/** UTC; Monday = 1. Two hours cover PDT (UTC−7) and PST (UTC−8); three passes per hour. */
export const SCOUT_CRON_SCHEDULES = ["0 17 * * 1", "20 17 * * 1", "40 17 * * 1", "0 18 * * 1", "20 18 * * 1", "40 18 * * 1"] as const;
export const LOCAL_RUN_HOUR = 10;
/** Local minute from which a pass is the last one of the morning (the :40 pass). */
export const FINAL_PASS_MINUTE = 40;
export const STALE_LEASE_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
export const BUILD_TIMEOUT_MS = 45_000;
export const RETENTION_WEEKS = 26;

// ── Schedule gate ───────────────────────────────────────────────────────────

const localTime = new Intl.DateTimeFormat("en-US", { timeZone: REPORT_TIME_ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });

export function vancouverHourMinute(now: Date): { hour: number; minute: number } {
  const parts = localTime.formatToParts(now);
  return { hour: Number(parts.find((p) => p.type === "hour")?.value), minute: Number(parts.find((p) => p.type === "minute")?.value) };
}

export type ScheduleDecision = { run: true; finalPass: boolean } | { run: false; reason: "outside_window" };

/** Run only on Monday 10:00–10:59 America/Vancouver (DST-aware). `enforceWindow` is false only for manual staging QA. */
export function scheduleDecision(now: Date, enforceWindow: boolean): ScheduleDecision {
  if (!enforceWindow) return { run: true, finalPass: true };
  const { hour, minute } = vancouverHourMinute(now);
  if (vancouverWeekdayIndex(now) !== 0 || hour !== LOCAL_RUN_HOUR) return { run: false, reason: "outside_window" };
  return { run: true, finalPass: minute >= FINAL_PASS_MINUTE };
}

// ── Claim rules ─────────────────────────────────────────────────────────────

export type SkipReason = "already_complete" | "in_progress" | "attempts_exhausted" | "not_retryable" | "lost_race";

export function takeOverDecision(row: ScoutReportRow, now: Date): { takeOver: true } | { takeOver: false; reason: SkipReason } {
  if (row.completeness === "complete") return { takeOver: false, reason: "already_complete" };
  if (row.generation_state === "generating" && row.lease_started_at && now.getTime() - Date.parse(row.lease_started_at) < STALE_LEASE_MS) {
    return { takeOver: false, reason: "in_progress" };
  }
  if (row.attempt_count >= MAX_ATTEMPTS) return { takeOver: false, reason: "attempts_exhausted" };
  if (row.generation_state === "generated" && row.retry_advice === "not_suggested") return { takeOver: false, reason: "not_retryable" };
  if (row.generation_state === "failed" && row.last_failure?.kind === "persistent") return { takeOver: false, reason: "not_retryable" };
  return { takeOver: true };
}

// ── Storage decisions ───────────────────────────────────────────────────────

const completeSectionCount = (payload: unknown): number => {
  const sections = (payload as { sections?: Record<string, { status?: string }> } | null)?.sections ?? {};
  return Object.values(sections).filter((s) => s?.status === "complete").length;
};

/** A new report replaces a stored one only if it has at least as many complete sections. */
export function shouldStoreNewReport(previousPayload: unknown | null, report: Pick<ScoutReport, "sections">): boolean {
  if (previousPayload === null || previousPayload === undefined) return true;
  return completeSectionCount(report) >= completeSectionCount(previousPayload);
}

const EMAIL_RE = /[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g;
/** Any scheme://… (https, postgres, redis…) — connection strings can carry usernames and passwords. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const TOKEN_RE = /\b(?:eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}|(?:sk|pk|rk|sb|re)_[A-Za-z0-9_]{12,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9+/]{40,}={0,2})\b/g;
const BEARER_RE = /\bBearer\s+\S+/gi;

/** Strips anything that could be a credential, URL or email address, and bounds the length. */
export function sanitizeFailureMessage(message: string): string {
  const clean = message
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(URL_RE, "[url redacted]")
    .replace(EMAIL_RE, "[email redacted]")
    .replace(TOKEN_RE, "[token redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 300 ? `${clean.slice(0, 297)}...` : clean;
}

export function toStoredFailure(issue: ReportIssue, at: string): StoredFailure {
  return { part: issue.part, kind: issue.kind, message: sanitizeFailureMessage(issue.message), at };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export type ScoutAlert = { title: string; message: string; metadata: Record<string, string | number | null> };

export type ScheduledGenerationDeps = {
  enabled: boolean;
  /**
   * "scheduled" — the cron route (always; it accepts no input). In Production the Monday 10:xx Vancouver
   * window is enforced. "manual" — in-process only (a reviewed local verification harness): no window, and
   * the row is recorded honestly as trigger_source = 'manual'. Not reachable from the network.
   */
  trigger: "scheduled" | "manual";
  /** resolveAnalyticsEnvironment(): only "production" and "staging" may write. */
  environment: string;
  now: () => Date;
  /** Called only after the kill switch, environment and schedule gates pass. */
  createStore: () => ScoutReportStore;
  build: (now: Date) => Promise<ScoutReport>;
  sendAlert: (alert: ScoutAlert) => Promise<unknown>;
  builderVersion: string | null;
  buildTimeoutMs?: number;
};

export type ScheduledGenerationResult = {
  outcome:
    | "disabled"
    | "environment_not_allowed"
    | "outside_window"
    | "skipped"
    | "stored_complete"
    | "stored_incomplete"
    | "kept_previous"
    | "failed"
    | "lease_lost"
    | "abandoned_resolved"
    | "store_error";
  reason?: SkipReason;
  reportId?: string;
  periodStartDate?: string;
  attempt?: number;
  alerted?: boolean;
  retentionDeleted?: number | null;
  errors: string[];
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Report generation timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    );
  });
}

export async function runScheduledScoutReport(deps: ScheduledGenerationDeps): Promise<ScheduledGenerationResult> {
  // Kill switch first: nothing is read, written or sent while disabled.
  if (!deps.enabled) return { outcome: "disabled", errors: [] };
  if (deps.environment !== "production" && deps.environment !== "staging") return { outcome: "environment_not_allowed", errors: [] };
  const environment = deps.environment as ScoutStorageEnvironment;

  const now = deps.now(); // captured once: schedule gate, period, lease and report all use it
  const schedule = scheduleDecision(now, environment === "production" && deps.trigger === "scheduled");
  if (!schedule.run) return { outcome: "outside_window", errors: [] };

  const period = computeReportWindows(now).current;
  try {
    const triggerSource = deps.trigger === "scheduled" && environment === "production" ? "scheduled" : "manual";
    return await generateForPeriod(deps, deps.createStore(), environment, now, schedule.finalPass, period, triggerSource);
  } catch (e) {
    // A store failure (database unreachable, table missing, unexpected rejection). The detail stays in the
    // sanitized result/log; the alert carries no raw error text. Not deduplicated (the database may be the
    // problem), so it is sent on the final pass only — at most once per Monday.
    const message = sanitizeFailureMessage(e instanceof Error ? e.message : String(e));
    const result: ScheduledGenerationResult = { outcome: "store_error", periodStartDate: period.startDate, errors: [`Store: ${message}`] };
    if (environment === "production" && schedule.finalPass) {
      try {
        await deps.sendAlert({
          title: "Scout weekly report could not be stored",
          message: `Report storage failed for ${period.startDate} to ${period.endDateInclusive}. See the cron log for the sanitized error.`,
          metadata: { Period: `${period.startDate} → ${period.endDateInclusive}`, Outcome: "store_error", Environment: environment },
        });
        result.alerted = true;
      } catch {
        result.errors.push("Alert: delivery failed");
      }
    }
    return result;
  }
}

type Period = ReturnType<typeof computeReportWindows>["current"];

async function generateForPeriod(
  deps: ScheduledGenerationDeps,
  store: ScoutReportStore,
  environment: ScoutStorageEnvironment,
  now: Date,
  finalPass: boolean,
  period: Period,
  triggerSource: "scheduled" | "manual"
): Promise<ScheduledGenerationResult> {
  const nowIso = now.toISOString();
  const key = { reportType: SCOUT_REPORT_TYPE, environment, periodStart: period.startUtc };
  const base = { periodStartDate: period.startDate, errors: [] as string[] };

  /** One alert per period, Production only, when the period ends failed or incomplete with nothing better coming. */
  const maybeAlert = async (row: ScoutReportRow, finalCompleteness: "complete" | "incomplete" | null, noFurtherAttempt: boolean, outcome: string, failure: StoredFailure | null) => {
    if (environment !== "production" || finalCompleteness === "complete" || row.failure_alerted_at !== null || !noFurtherAttempt) return false;
    try {
      await deps.sendAlert({
        title: finalCompleteness === null ? "Scout weekly report failed" : "Scout weekly report incomplete",
        message:
          finalCompleteness === null
            ? `No Scout report could be generated for ${period.startDate} to ${period.endDateInclusive}. ${failure?.message ?? ""}`.trim()
            : `The stored Scout report for ${period.startDate} to ${period.endDateInclusive} is incomplete. Complete sections may be used with caveats; see the report's completeness block.`,
        metadata: { "Report ID": row.id, Period: `${period.startDate} → ${period.endDateInclusive}`, Attempt: row.attempt_count, Outcome: outcome, Environment: environment },
      });
      await store.markAlerted(row.id, new Date().toISOString());
      return true;
    } catch (e) {
      base.errors.push(`Alert: ${sanitizeFailureMessage(e instanceof Error ? e.message : String(e))}`);
      return false;
    }
  };

  // 1. Claim the period (atomic insert), or take over an abandoned / retryable row (CAS).
  let row: ScoutReportRow;
  let previousPayload: unknown | null = null;
  const inserted = await store.insertClaim({
    report_type: SCOUT_REPORT_TYPE,
    environment,
    period_start: period.startUtc,
    period_end: period.endUtc,
    period_start_date: period.startDate,
    period_end_date: period.endDateInclusive,
    time_zone: period.timeZone,
    generation_state: "generating",
    trigger_source: triggerSource,
    attempt_count: 1,
    lease_started_at: nowIso,
    last_attempt_started_at: nowIso,
    builder_version: deps.builderVersion,
  });
  if (inserted.status === "inserted") {
    row = inserted.row;
  } else {
    const existing = await store.getForPeriod(key);
    if (!existing) return { ...base, outcome: "skipped", reason: "lost_race" };
    const decision = takeOverDecision(existing, now);
    if (!decision.takeOver) {
      // An abandoned FINAL attempt (stale lease, attempts used up) is resolved — never left "generating" forever.
      // Any stored payload is kept; the row becomes "generated" (with that payload) or "failed" (without one).
      if (decision.reason === "attempts_exhausted" && existing.generation_state === "generating" && existing.lease_started_at) {
        const failure: StoredFailure = {
          part: "Report generation",
          kind: "abandoned",
          message: "The final attempt stopped before finishing (interrupted or timed out). No further attempts will be made for this period.",
          at: nowIso,
        };
        const hasPayload = existing.payload !== null && existing.payload !== undefined;
        const resolved = await store.finish(existing.id, existing.lease_started_at, {
          generation_state: hasPayload ? "generated" : "failed",
          lease_started_at: null,
          last_attempt_finished_at: nowIso,
          last_attempt_outcome: "failed",
          last_failure: failure,
        });
        if (!resolved) return { ...base, outcome: "skipped", reason: "lost_race", reportId: existing.id };
        const alerted = await maybeAlert(existing, hasPayload ? "incomplete" : null, true, "abandoned_resolved", failure);
        return { ...base, outcome: "abandoned_resolved", reportId: existing.id, attempt: existing.attempt_count, alerted };
      }
      return { ...base, outcome: "skipped", reason: decision.reason, reportId: existing.id, attempt: existing.attempt_count };
    }
    const taken = await store.reclaim(
      existing.id,
      { generationState: existing.generation_state, leaseStartedAt: existing.lease_started_at, attemptCount: existing.attempt_count },
      {
        generation_state: "generating",
        lease_started_at: nowIso,
        attempt_count: existing.attempt_count + 1,
        last_attempt_started_at: nowIso,
        last_attempt_finished_at: null,
        builder_version: deps.builderVersion,
        trigger_source: existing.trigger_source,
      }
    );
    if (!taken) return { ...base, outcome: "skipped", reason: "lost_race", reportId: existing.id };
    row = taken;
    previousPayload = existing.payload ?? null;
  }
  const attempt = row.attempt_count;

  // 2. Build (read-only), bounded in time.
  let report: ScoutReport | null = null;
  let failure: StoredFailure | null = null;
  try {
    report = await withTimeout(deps.build(now), deps.buildTimeoutMs ?? BUILD_TIMEOUT_MS);
  } catch (e) {
    failure = toStoredFailure(classifyFailure("Report generation", e), new Date().toISOString());
  }

  // 3. Finish under our lease.
  const finishedAt = new Date().toISOString();
  let outcome: ScheduledGenerationResult["outcome"];
  let finalCompleteness: "complete" | "incomplete" | null;
  let finalRetry: string | null;
  let ok: boolean;
  if (report && shouldStoreNewReport(previousPayload, report)) {
    const payload = JSON.parse(JSON.stringify(report));
    ok = await store.finish(row.id, nowIso, {
      generation_state: "generated",
      lease_started_at: null,
      last_attempt_finished_at: finishedAt,
      last_attempt_outcome: "stored",
      last_failure: null,
      payload,
      schema_version: report.schemaVersion,
      completeness: report.status,
      incomplete_sections: [...report.incompleteSections],
      retry_advice: report.completeness.retry,
      report_generated_at: report.generatedAt,
    });
    outcome = report.status === "complete" ? "stored_complete" : "stored_incomplete";
    finalCompleteness = report.status;
    finalRetry = report.completeness.retry;
  } else if (report) {
    ok = await store.finish(row.id, nowIso, {
      generation_state: "generated",
      lease_started_at: null,
      last_attempt_finished_at: finishedAt,
      last_attempt_outcome: "kept_previous",
      last_failure: { part: "Report", kind: "kept_previous", message: "This attempt produced fewer complete sections than the stored report, so the stored report was kept.", at: finishedAt },
    });
    outcome = "kept_previous";
    finalCompleteness = "incomplete";
    finalRetry = row.retry_advice;
  } else {
    ok = await store.finish(row.id, nowIso, {
      generation_state: previousPayload === null ? "failed" : "generated",
      lease_started_at: null,
      last_attempt_finished_at: finishedAt,
      last_attempt_outcome: "failed",
      last_failure: failure,
    });
    outcome = "failed";
    finalCompleteness = previousPayload === null ? null : "incomplete";
    finalRetry = failure?.kind === "persistent" ? "not_suggested" : "suggested";
  }
  if (!ok) return { ...base, outcome: "lease_lost", reportId: row.id, attempt };

  // 4. One alert per period, Production only, when nothing better is coming.
  const alerted = await maybeAlert(row, finalCompleteness, finalPass || attempt >= MAX_ATTEMPTS || finalRetry === "not_suggested", outcome, failure);

  // 5. Retention: this report type + environment only, periods older than 26 weeks.
  let retentionDeleted: number | null = null;
  try {
    const cutoff = new Date(Date.parse(period.startUtc) - RETENTION_WEEKS * 7 * 24 * 3_600_000).toISOString();
    retentionDeleted = await store.deleteOlderThan(SCOUT_REPORT_TYPE, environment, cutoff);
  } catch (e) {
    base.errors.push(`Retention: ${sanitizeFailureMessage(e instanceof Error ? e.message : String(e))}`);
  }

  return { ...base, outcome, reportId: row.id, attempt, alerted, retentionDeleted };
}
