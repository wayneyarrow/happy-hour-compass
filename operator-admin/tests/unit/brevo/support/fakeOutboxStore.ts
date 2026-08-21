/**
 * In-memory stand-in for public.brevo_sync_outbox + its two Postgres
 * functions (supabase/migrations/075_brevo_sync_outbox.sql), reimplementing
 * their documented behavior against a plain array so outbox.ts/contactSync.ts
 * can be unit-tested without a real Postgres. This is not a substitute for
 * exercising the real migration against a live database — see the Brevo
 * integration foundation report's "verification limitations" note.
 */
import type { BrevoAdminClient, BrevoUpdateBuilder } from "../../../../src/lib/brevo/supabaseAdminClient";

export type FakeOutboxRow = {
  id: string;
  provider: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  status: string;
  attempt_count: number;
  max_attempts: number;
  last_attempted_at: string | null;
  next_attempt_at: string;
  last_error: string | null;
  last_error_class: string | null;
  completed_at: string | null;
  created_at: string;
};

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `fake-outbox-${idCounter}`;
}

export function createFakeOutboxStore(): { client: BrevoAdminClient; rows: FakeOutboxRow[] } {
  const rows: FakeOutboxRow[] = [];

  const client: BrevoAdminClient = {
    from(table: string) {
      if (table !== "brevo_sync_outbox") {
        throw new Error(`fakeOutboxStore: unexpected table "${table}"`);
      }
      return {
        update(patch: Record<string, unknown>) {
          return makeUpdateBuilder(rows, patch);
        },
        insert() {
          throw new Error("fakeOutboxStore: insert() is not used on brevo_sync_outbox in application code");
        },
        select() {
          throw new Error("fakeOutboxStore: plain select() is not used on brevo_sync_outbox in application code");
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "claim_brevo_outbox_batch") {
        return claimBatch(rows, (args.p_limit as number) ?? 10);
      }
      if (fn === "enqueue_brevo_contact_sync") {
        return enqueue(rows, args);
      }
      return { data: null, error: { message: `fakeOutboxStore: unknown rpc "${fn}"` } };
    },
  };

  return { client, rows };
}

function getField(row: FakeOutboxRow, column: string): unknown {
  return (row as unknown as Record<string, unknown>)[column];
}

function makeUpdateBuilder(rows: FakeOutboxRow[], patch: Record<string, unknown>): BrevoUpdateBuilder {
  const filters: Array<(row: FakeOutboxRow) => boolean> = [];

  const apply = () => {
    const matched = rows.filter((row) => filters.every((f) => f(row)));
    for (const row of matched) Object.assign(row, patch);
    return matched;
  };

  const builder: BrevoUpdateBuilder = {
    eq(column: string, value: unknown) {
      filters.push((row) => getField(row, column) === value);
      return builder;
    },
    lt(column: string, value: unknown) {
      filters.push((row) => {
        const v = getField(row, column);
        return v !== null && v !== undefined && (v as string) < (value as string);
      });
      return builder;
    },
    async select(_columns: string) {
      const matched = apply();
      return { data: matched.map((r) => ({ id: r.id })), error: null };
    },
    then(onfulfilled, onrejected) {
      try {
        apply();
        return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
      } catch (err) {
        if (onrejected) return Promise.resolve(onrejected(err));
        throw err;
      }
    },
  };

  return builder;
}

function claimBatch(rows: FakeOutboxRow[], limit: number) {
  const nowIso = new Date().toISOString();
  const due = rows
    .filter((r) => r.status === "pending" && r.next_attempt_at <= nowIso)
    .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
    .slice(0, limit);

  for (const row of due) {
    row.status = "processing";
    row.last_attempted_at = nowIso;
  }
  return { data: due.map((r) => ({ ...r })), error: null };
}

function enqueue(rows: FakeOutboxRow[], args: Record<string, unknown>) {
  const entityType = args.p_entity_type as string;
  const entityId = args.p_entity_id as string;
  const operation = args.p_operation as string;
  const dedupeKey = args.p_dedupe_key as string;
  const payload = args.p_payload as Record<string, unknown>;
  const maxAttempts = (args.p_max_attempts as number | undefined) ?? 5;

  const existing = rows.find(
    (r) =>
      r.provider === "brevo" &&
      r.dedupe_key === dedupeKey &&
      (r.status === "pending" || r.status === "processing")
  );

  const nowIso = new Date().toISOString();

  if (existing) {
    existing.payload = payload;
    existing.next_attempt_at = nowIso;
    return { data: { ...existing }, error: null };
  }

  const row: FakeOutboxRow = {
    id: nextId(),
    provider: "brevo",
    entity_type: entityType,
    entity_id: entityId,
    operation,
    dedupe_key: dedupeKey,
    payload,
    status: "pending",
    attempt_count: 0,
    max_attempts: maxAttempts,
    last_attempted_at: null,
    next_attempt_at: nowIso,
    last_error: null,
    last_error_class: null,
    completed_at: null,
    created_at: nowIso,
  };
  rows.push(row);
  return { data: { ...row }, error: null };
}
