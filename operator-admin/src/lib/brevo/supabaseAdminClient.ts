import { createAdminClient } from "@/lib/supabase/server";

/**
 * Minimal Supabase admin-client surface actually used by the Brevo
 * integration (outbox.ts, contactSync.ts, webhookHandler.ts) — narrowed
 * from the full SupabaseClient type so tests can supply a small in-memory
 * fake (tests/unit/brevo/support/) without needing to satisfy the real
 * client's full shape. Production code gets the real createAdminClient()
 * cast to this surface; every method below is a real method on the
 * Supabase JS client, used exactly as documented.
 */
export type BrevoAdminClient = {
  from(table: string): BrevoTableClient;
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export type BrevoTableClient = {
  update(patch: Record<string, unknown>): BrevoUpdateBuilder;
  insert(row: Record<string, unknown>): BrevoInsertBuilder;
  select(columns: string): BrevoSelectBuilder;
};

export type BrevoSelectBuilder = {
  eq(column: string, value: unknown): BrevoSelectBuilder;
  is(column: string, value: null): BrevoSelectBuilder;
  order(column: string, options?: { ascending?: boolean }): BrevoSelectBuilder;
  limit(count: number): BrevoSelectBuilder;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
} & PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;

export type BrevoUpdateBuilder = {
  eq(column: string, value: unknown): BrevoUpdateBuilder;
  lt(column: string, value: unknown): BrevoUpdateBuilder;
  select(columns: string): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
} & PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type BrevoInsertBuilder = {
  select(columns: string): BrevoInsertSelectBuilder;
};

export type BrevoInsertSelectBuilder = {
  single(): Promise<{ data: { id: string } | null; error: { message: string; code?: string } | null }>;
};

/** Real Supabase admin client, narrowed to the surface above. */
export function getDefaultBrevoAdminClient(): BrevoAdminClient {
  return createAdminClient() as unknown as BrevoAdminClient;
}
