import type { DeferredInitialSetupStore, QueuedSetupLifecycle } from "../../../../src/lib/activation/deferredInitialSetup";

type Row = Record<string, unknown>;

/**
 * In-memory DeferredInitialSetupStore over the SAME operator rows the
 * setup-contact store writes (so a queue request written by
 * withAutomaticSetupContact / deferInitialSetup is what the worker reads),
 * plus a live-lifecycle map. Every write is a compare-and-swap on the exact
 * value, and timestamps compare as instants — like the Postgres version.
 */
export function createMemoryDeferredSetupStore(rows: Row[], lifecycles: Map<string, QueuedSetupLifecycle> = new Map()) {
  const t = (v: unknown) => (typeof v === "string" ? new Date(v).getTime() : NaN);
  const same = (a: unknown, b: unknown) => (typeof a === "string" && typeof b === "string" ? t(a) === t(b) : a === b);
  const find = (id: string) => rows.find((r) => r.id === id);
  const reset = (r: Row) =>
    Object.assign(r, {
      initial_setup_deferred_at: null,
      initial_setup_deferred_attempt_started_at: null,
      initial_setup_deferred_attempts: 0,
      initial_setup_deferred_last_error: null,
    });
  const store: DeferredInitialSetupStore = {
    async listQueued(limit) {
      return rows
        .filter((r) => r.initial_setup_deferred_at && !r.account_activated_at)
        .sort((a, b) => t(a.initial_setup_deferred_at) - t(b.initial_setup_deferred_at))
        .slice(0, limit)
        .map((r) => ({
          operatorId: r.id as string,
          email: r.email as string,
          firstName: (r.first_name as string | null) ?? null,
          queuedAt: r.initial_setup_deferred_at as string,
        }));
    },
    async clearActivated() {
      const hit = rows.filter((r) => r.initial_setup_deferred_at && r.account_activated_at);
      hit.forEach(reset);
      return hit.length;
    },
    async readState(operatorId) {
      const r = find(operatorId);
      if (!r) return null;
      return {
        activated: !!r.account_activated_at,
        queuedAt: (r.initial_setup_deferred_at as string | null) ?? null,
        attemptStartedAt: (r.initial_setup_deferred_attempt_started_at as string | null) ?? null,
        attempts: (r.initial_setup_deferred_attempts as number | undefined) ?? 0,
        acceptedAt: (r.last_setup_email_accepted_at as string | null) ?? null,
      };
    },
    async findLiveLifecycle(operatorId) {
      return lifecycles.get(operatorId) ?? null;
    },
    async markAttempt(operatorId, queuedAt, at) {
      const r = find(operatorId);
      if (!r || !same(r.initial_setup_deferred_at, queuedAt) || r.initial_setup_deferred_attempt_started_at) return false;
      r.initial_setup_deferred_attempt_started_at = at;
      return true;
    },
    async clearAttempt(operatorId, attemptAt) {
      const r = find(operatorId);
      if (!r || !same(r.initial_setup_deferred_attempt_started_at, attemptAt)) return false;
      r.initial_setup_deferred_attempt_started_at = null;
      return true;
    },
    async clear(operatorId, queuedAt) {
      const r = find(operatorId);
      if (!r || !same(r.initial_setup_deferred_at, queuedAt)) return false;
      reset(r);
      return true;
    },
    async recordFailure(operatorId, queuedAt, attempts, error) {
      const r = find(operatorId);
      if (!r || !same(r.initial_setup_deferred_at, queuedAt)) return false;
      Object.assign(r, { initial_setup_deferred_attempt_started_at: null, initial_setup_deferred_attempts: attempts, initial_setup_deferred_last_error: error });
      return true;
    },
  };
  return { store, lifecycles };
}
