/**
 * Scout report storage — row shape and store interface (migration
 * 112_scout_reports.sql). Server-only. The interface is the seam between the
 * generation orchestrator and the database, so the orchestrator can be
 * tested against an in-memory store with the same rules.
 */

export const SCOUT_REPORT_TYPE = "product_usage_and_discovery" as const;
export type ScoutReportType = typeof SCOUT_REPORT_TYPE;
export type ScoutStorageEnvironment = "production" | "staging";
export type GenerationState = "generating" | "generated" | "failed";
export type Completeness = "complete" | "incomplete";
export type AttemptOutcome = "stored" | "kept_previous" | "failed";

/** Sanitized failure of an attempt — never credentials, tokens or personal data. */
export type StoredFailure = { part: string; kind: string; message: string; at: string };

export type ScoutReportRow = {
  id: string;
  report_type: ScoutReportType;
  environment: ScoutStorageEnvironment;
  period_start: string;
  period_end: string;
  period_start_date: string;
  period_end_date: string;
  time_zone: string;
  generation_state: GenerationState;
  trigger_source: "scheduled" | "manual";
  attempt_count: number;
  lease_started_at: string | null;
  last_attempt_started_at: string;
  last_attempt_finished_at: string | null;
  last_attempt_outcome: AttemptOutcome | null;
  last_failure: StoredFailure | null;
  failure_alerted_at: string | null;
  builder_version: string | null;
  payload: unknown | null;
  schema_version: string | null;
  completeness: Completeness | null;
  incomplete_sections: string[];
  retry_advice: string | null;
  report_generated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ScoutReportKey = { reportType: ScoutReportType; environment: ScoutStorageEnvironment; periodStart: string };

export type NewClaim = Pick<
  ScoutReportRow,
  | "report_type"
  | "environment"
  | "period_start"
  | "period_end"
  | "period_start_date"
  | "period_end_date"
  | "time_zone"
  | "trigger_source"
  | "lease_started_at"
  | "last_attempt_started_at"
  | "builder_version"
> & { generation_state: "generating"; attempt_count: 1 };

/** What an existing row must still look like for a take-over to succeed. */
export type ReclaimExpectation = { generationState: GenerationState; leaseStartedAt: string | null; attemptCount: number };

export type ReclaimPatch = Pick<ScoutReportRow, "lease_started_at" | "attempt_count" | "last_attempt_started_at" | "builder_version" | "trigger_source"> & {
  generation_state: "generating";
  last_attempt_finished_at: null;
};

export type FinishPatch = Partial<
  Pick<
    ScoutReportRow,
    | "generation_state"
    | "last_attempt_finished_at"
    | "last_attempt_outcome"
    | "last_failure"
    | "payload"
    | "schema_version"
    | "completeness"
    | "incomplete_sections"
    | "retry_advice"
    | "report_generated_at"
  >
> & { lease_started_at: null };

export interface ScoutReportStore {
  /** Atomic claim of a period. "conflict" = a row for the period already exists (unique constraint). */
  insertClaim(row: NewClaim): Promise<{ status: "inserted"; row: ScoutReportRow } | { status: "conflict" }>;
  getForPeriod(key: ScoutReportKey): Promise<ScoutReportRow | null>;
  /** Compare-and-swap take-over: applies only if the row still matches `expected`. Null = lost the race. */
  reclaim(id: string, expected: ReclaimExpectation, patch: ReclaimPatch): Promise<ScoutReportRow | null>;
  /** Finishes an attempt only if this caller still holds the lease. False = the lease was taken over. */
  finish(id: string, leaseStartedAt: string, patch: FinishPatch): Promise<boolean>;
  /** Records that a failure alert was sent (never applied to a complete report). */
  markAlerted(id: string, at: string): Promise<void>;
  /** Retention: deletes this type + environment's rows whose period started before `cutoff`. Returns the count. */
  deleteOlderThan(reportType: ScoutReportType, environment: ScoutStorageEnvironment, cutoff: string): Promise<number>;
}
