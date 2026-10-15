/**
 * Supabase-backed Scout report store (migration 112_scout_reports.sql).
 * Server-only, service-role client. Every write is scoped to the one row (or,
 * for retention, one report type + environment) it concerns.
 *
 * Also exports read helpers for a future founder-only Scout page: list finished
 * reports by period (metadata only) and open one exact finished report, always
 * scoped to one environment. They don't authorize: the calling server boundary
 * must (requireControlPanelAdmin() for a Control Panel page).
 */

import type { createAdminClient } from "@/lib/supabase/server";
import type {
  FinishPatch,
  NewClaim,
  ReclaimExpectation,
  ReclaimPatch,
  ScoutReportKey,
  ScoutReportRow,
  ScoutReportStore,
  ScoutReportType,
  ScoutStorageEnvironment,
} from "./types";

type Admin = ReturnType<typeof createAdminClient>;

const TABLE = "scout_reports";
const UNIQUE_VIOLATION = "23505";

/** Columns for history listings — everything except the payload. */
export const SCOUT_REPORT_LIST_COLUMNS =
  "id, report_type, environment, period_start, period_end, period_start_date, period_end_date, time_zone, generation_state, trigger_source, attempt_count, last_attempt_started_at, last_attempt_finished_at, last_attempt_outcome, last_failure, schema_version, completeness, incomplete_sections, retry_advice, report_generated_at, created_at, updated_at";

export function createSupabaseScoutReportStore(admin: Admin): ScoutReportStore {
  return {
    async insertClaim(row: NewClaim) {
      const { data, error } = await admin.from(TABLE).insert(row).select("*").single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return { status: "conflict" as const };
        throw new Error(`scout_reports insert failed: ${error.message}`);
      }
      return { status: "inserted" as const, row: data as ScoutReportRow };
    },

    async getForPeriod(key: ScoutReportKey) {
      const { data, error } = await admin
        .from(TABLE)
        .select("*")
        .eq("report_type", key.reportType)
        .eq("environment", key.environment)
        .eq("period_start", key.periodStart)
        .maybeSingle();
      if (error) throw new Error(`scout_reports read failed: ${error.message}`);
      return (data as ScoutReportRow | null) ?? null;
    },

    async reclaim(id: string, expected: ReclaimExpectation, patch: ReclaimPatch) {
      let q = admin
        .from(TABLE)
        .update(patch)
        .eq("id", id)
        .eq("generation_state", expected.generationState)
        .eq("attempt_count", expected.attemptCount)
        // A complete report is never taken over (the trigger enforces this too).
        .or("completeness.is.null,completeness.eq.incomplete");
      q = expected.leaseStartedAt === null ? q.is("lease_started_at", null) : q.eq("lease_started_at", expected.leaseStartedAt);
      const { data, error } = await q.select("*");
      if (error) throw new Error(`scout_reports take-over failed: ${error.message}`);
      return ((data as ScoutReportRow[] | null) ?? [])[0] ?? null;
    },

    async finish(id: string, leaseStartedAt: string, patch: FinishPatch) {
      const { data, error } = await admin
        .from(TABLE)
        .update(patch)
        .eq("id", id)
        .eq("generation_state", "generating")
        .eq("lease_started_at", leaseStartedAt)
        .select("id");
      if (error) throw new Error(`scout_reports finish failed: ${error.message}`);
      return ((data as { id: string }[] | null) ?? []).length === 1;
    },

    async markAlerted(id: string, at: string) {
      const { error } = await admin
        .from(TABLE)
        .update({ failure_alerted_at: at })
        .eq("id", id)
        .is("failure_alerted_at", null)
        .or("completeness.is.null,completeness.eq.incomplete");
      if (error) throw new Error(`scout_reports alert marker failed: ${error.message}`);
    },

    async deleteOlderThan(reportType: ScoutReportType, environment: ScoutStorageEnvironment, cutoff: string) {
      const { data, error } = await admin
        .from(TABLE)
        .delete()
        .eq("report_type", reportType)
        .eq("environment", environment)
        .lt("period_start", cutoff)
        .select("id");
      if (error) throw new Error(`scout_reports retention cleanup failed: ${error.message}`);
      return ((data as { id: string }[] | null) ?? []).length;
    },
  };
}

// ── Reads for a future founder-only page (authorize first) ──────────────────

export type ScoutReportListItem = Omit<ScoutReportRow, "payload" | "lease_started_at" | "failure_alerted_at" | "builder_version">;

/**
 * Finished reports only: generation_state = 'generated', which (by the table's constraints) always has a stored
 * payload. Rows still generating or failed without a payload are never returned. Environment is required, so
 * staging QA rows and production reports are never mixed. These helpers do NOT authorize — the server boundary
 * calling them (a founder-only page with requireControlPanelAdmin(), or a reviewed retrieval route) must.
 */
export const FINISHED_STATE = "generated" as const;

/** Finished stored reports for one type + environment, newest period first. Metadata only (no payload). Throws on failure. */
export async function listScoutReports(
  admin: Admin,
  opts: { reportType: ScoutReportType; environment: ScoutStorageEnvironment; limit?: number }
): Promise<ScoutReportListItem[]> {
  const { data, error } = await admin
    .from(TABLE)
    .select(SCOUT_REPORT_LIST_COLUMNS)
    .eq("report_type", opts.reportType)
    .eq("environment", opts.environment)
    .eq("generation_state", FINISHED_STATE)
    .order("period_start", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 30, 1), 100));
  if (error) throw new Error(`scout_reports list failed: ${error.message}`);
  return (data as unknown as ScoutReportListItem[]) ?? [];
}

/** One exact finished report in the given environment, including its payload. Null if absent, unfinished or in another environment. Throws on failure. */
export async function getScoutReportById(admin: Admin, opts: { id: string; environment: ScoutStorageEnvironment }): Promise<ScoutReportRow | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select("*")
    .eq("id", opts.id)
    .eq("environment", opts.environment)
    .eq("generation_state", FINISHED_STATE)
    .maybeSingle();
  if (error) throw new Error(`scout_reports read failed: ${error.message}`);
  return (data as ScoutReportRow | null) ?? null;
}
