/**
 * In-memory stand-in for public.brevo_webhook_events
 * (supabase/migrations/076_brevo_webhook_events.sql), reimplementing its
 * UNIQUE(provider, dedupe_key) constraint against a plain array so
 * webhookHandler.ts can be unit-tested without a real Postgres.
 */
import type { BrevoAdminClient, BrevoUpdateBuilder, BrevoSelectBuilder } from "../../../../src/lib/brevo/supabaseAdminClient";

export type FakeWebhookEventRow = {
  id: string;
  provider: string;
  event_type: string;
  dedupe_key: string;
  email: string | null;
  raw_payload: Record<string, unknown>;
  received_at: string;
  processed_at: string | null;
};

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `fake-webhook-event-${idCounter}`;
}

export function createFakeWebhookEventsStore(): { client: BrevoAdminClient; rows: FakeWebhookEventRow[] } {
  const rows: FakeWebhookEventRow[] = [];

  const client: BrevoAdminClient = {
    from(table: string) {
      if (table !== "brevo_webhook_events") {
        throw new Error(`fakeWebhookEventsStore: unexpected table "${table}"`);
      }
      return {
        update(patch: Record<string, unknown>) {
          return makeUpdateBuilder(rows, patch);
        },
        insert(row: Record<string, unknown>) {
          return {
            select(_columns: string) {
              return {
                async single() {
                  const dedupeKey = row.dedupe_key as string;
                  const conflict = rows.some((r) => r.provider === "brevo" && r.dedupe_key === dedupeKey);
                  if (conflict) {
                    return {
                      data: null,
                      error: { message: "duplicate key value violates unique constraint", code: "23505" },
                    };
                  }
                  const inserted: FakeWebhookEventRow = {
                    id: nextId(),
                    provider: "brevo",
                    event_type: row.event_type as string,
                    dedupe_key: dedupeKey,
                    email: (row.email as string | null) ?? null,
                    raw_payload: row.raw_payload as Record<string, unknown>,
                    received_at: new Date().toISOString(),
                    processed_at: null,
                  };
                  rows.push(inserted);
                  return { data: { id: inserted.id }, error: null };
                },
              };
            },
          };
        },
        select(_columns: string) {
          return makeSelectBuilder(rows);
        },
      };
    },
    async rpc(fn: string) {
      return { data: null, error: { message: `fakeWebhookEventsStore: unknown rpc "${fn}"` } };
    },
  };

  return { client, rows };
}

function getField(row: FakeWebhookEventRow, column: string): unknown {
  return (row as unknown as Record<string, unknown>)[column];
}

function makeSelectBuilder(rows: FakeWebhookEventRow[]): BrevoSelectBuilder {
  const filters: Array<(row: FakeWebhookEventRow) => boolean> = [];
  let sortColumn: string | null = null;
  let sortAscending = true;
  let limitCount: number | null = null;

  const getResults = (): Record<string, unknown>[] => {
    let result = rows.filter((row) => filters.every((f) => f(row)));
    if (sortColumn) {
      const col = sortColumn;
      result = [...result].sort((a, b) => {
        const av = String(getField(a, col));
        const bv = String(getField(b, col));
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortAscending ? cmp : -cmp;
      });
    }
    if (limitCount !== null) result = result.slice(0, limitCount);
    return result.map((r) => ({ ...r }) as Record<string, unknown>);
  };

  const builder: BrevoSelectBuilder = {
    eq(column: string, value: unknown) {
      filters.push((row) => getField(row, column) === value);
      return builder;
    },
    is(column: string, value: null) {
      filters.push((row) => getField(row, column) === value);
      return builder;
    },
    order(column: string, options?: { ascending?: boolean }) {
      sortColumn = column;
      sortAscending = options?.ascending ?? true;
      return builder;
    },
    limit(count: number) {
      limitCount = count;
      return builder;
    },
    async maybeSingle() {
      const results = getResults();
      return { data: results[0] ?? null, error: null };
    },
    then(onfulfilled, onrejected) {
      try {
        return Promise.resolve({ data: getResults(), error: null }).then(onfulfilled, onrejected);
      } catch (err) {
        if (onrejected) return Promise.resolve(onrejected(err));
        throw err;
      }
    },
  };

  return builder;
}

function makeUpdateBuilder(rows: FakeWebhookEventRow[], patch: Record<string, unknown>): BrevoUpdateBuilder {
  const filters: Array<(row: FakeWebhookEventRow) => boolean> = [];

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
