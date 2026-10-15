/**
 * In-memory ScoutReportStore with the same rules as migration 112 and
 * scoutReportStore.ts: unique (type, environment, period_start), CAS
 * take-over, lease-checked finish, complete rows immutable (the trigger),
 * retention scoped to one type + environment. Async with a yield point so
 * concurrent runs genuinely interleave.
 */

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
} from "../../../src/lib/scoutReport/storage/types";

const tick = () => new Promise((r) => setImmediate(r));

export class MemoryScoutStore implements ScoutReportStore {
  rows: ScoutReportRow[] = [];
  calls: string[] = [];
  private n = 0;
  finishOverride: null | (() => boolean) = null;

  private guard(row: ScoutReportRow) {
    if (row.completeness === "complete") throw new Error("scout_reports: a complete report is a historical snapshot and cannot be modified");
  }

  async insertClaim(claim: NewClaim) {
    this.calls.push("insertClaim");
    await tick();
    if (this.rows.some((r) => r.report_type === claim.report_type && r.environment === claim.environment && r.period_start === claim.period_start)) {
      return { status: "conflict" as const };
    }
    const now = new Date().toISOString();
    const row: ScoutReportRow = {
      id: `report-${++this.n}`,
      ...claim,
      last_attempt_finished_at: null,
      last_attempt_outcome: null,
      last_failure: null,
      failure_alerted_at: null,
      payload: null,
      schema_version: null,
      completeness: null,
      incomplete_sections: [],
      retry_advice: null,
      report_generated_at: null,
      created_at: now,
      updated_at: now,
    };
    this.rows.push(row);
    return { status: "inserted" as const, row: structuredClone(row) };
  }

  async getForPeriod(key: ScoutReportKey) {
    this.calls.push("getForPeriod");
    await tick();
    const r = this.rows.find((x) => x.report_type === key.reportType && x.environment === key.environment && x.period_start === key.periodStart);
    return r ? structuredClone(r) : null;
  }

  async reclaim(id: string, expected: ReclaimExpectation, patch: ReclaimPatch) {
    this.calls.push("reclaim");
    await tick();
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.completeness === "complete") return null;
    if (r.generation_state !== expected.generationState || r.attempt_count !== expected.attemptCount || r.lease_started_at !== expected.leaseStartedAt) return null;
    Object.assign(r, patch, { updated_at: new Date().toISOString() });
    return structuredClone(r);
  }

  async finish(id: string, leaseStartedAt: string, patch: FinishPatch) {
    this.calls.push("finish");
    await tick();
    if (this.finishOverride) return this.finishOverride();
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.generation_state !== "generating" || r.lease_started_at !== leaseStartedAt) return false;
    this.guard(r);
    Object.assign(r, patch, { updated_at: new Date().toISOString() });
    return true;
  }

  async markAlerted(id: string, at: string) {
    this.calls.push("markAlerted");
    const r = this.rows.find((x) => x.id === id);
    if (r && r.failure_alerted_at === null && r.completeness !== "complete") r.failure_alerted_at = at;
  }

  async deleteOlderThan(reportType: ScoutReportType, environment: ScoutStorageEnvironment, cutoff: string) {
    this.calls.push(`deleteOlderThan ${reportType} ${environment} ${cutoff}`);
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.report_type === reportType && r.environment === environment && Date.parse(r.period_start) < Date.parse(cutoff)));
    return before - this.rows.length;
  }

  /** Test helper: seed a row as it would exist after earlier activity. */
  seed(partial: Partial<ScoutReportRow> & Pick<ScoutReportRow, "period_start" | "environment">): ScoutReportRow {
    const now = new Date().toISOString();
    const row: ScoutReportRow = {
      id: `seed-${++this.n}`,
      report_type: "product_usage_and_discovery",
      period_end: partial.period_start,
      period_start_date: "2000-01-01",
      period_end_date: "2000-01-07",
      time_zone: "America/Vancouver",
      generation_state: "generated",
      trigger_source: "scheduled",
      attempt_count: 1,
      lease_started_at: null,
      last_attempt_started_at: now,
      last_attempt_finished_at: now,
      last_attempt_outcome: "stored",
      last_failure: null,
      failure_alerted_at: null,
      builder_version: null,
      payload: null,
      schema_version: null,
      completeness: null,
      incomplete_sections: [],
      retry_advice: null,
      report_generated_at: null,
      created_at: now,
      updated_at: now,
      ...partial,
    };
    this.rows.push(row);
    return row;
  }
}
