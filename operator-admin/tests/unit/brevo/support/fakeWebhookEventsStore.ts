/**
 * In-memory stand-in for public.brevo_webhook_events
 * (supabase/migrations/076_brevo_webhook_events.sql), reimplementing its
 * UNIQUE(provider, dedupe_key) constraint against a plain array so
 * webhookHandler.ts can be unit-tested without a real Postgres.
 */
import type { BrevoAdminClient } from "../../../../src/lib/brevo/supabaseAdminClient";

export type FakeWebhookEventRow = {
  id: string;
  provider: string;
  event_type: string;
  dedupe_key: string;
  email: string | null;
  raw_payload: Record<string, unknown>;
  received_at: string;
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
        update() {
          throw new Error("fakeWebhookEventsStore: update() is not used on brevo_webhook_events");
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
                  };
                  rows.push(inserted);
                  return { data: { id: inserted.id }, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(fn: string) {
      return { data: null, error: { message: `fakeWebhookEventsStore: unknown rpc "${fn}"` } };
    },
  };

  return { client, rows };
}
