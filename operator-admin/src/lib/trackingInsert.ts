import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Insert for the pre-existing /api/track/* tables that gained columns in
 * migration 110 (environment, plus website_search_events' search-quality
 * columns).
 *
 * Deploy-order safety net: if this code ever runs before migration 110 is
 * applied, PostgREST rejects the unknown columns (or the ON CONFLICT target)
 * and the WHOLE row would be lost — including venue views that feed
 * Operator Admin analytics and Customer Success milestones. ONLY for that
 * specific "schema not migrated yet" failure does this retry once with the
 * migration-110 columns removed (exactly the row the code wrote before 110).
 * Every other database error (FK violation, CHECK violation, permission,
 * network…) is never retried and is logged server-side, never swallowed
 * silently. Never throws — tracking must not affect the visitor.
 */

/**
 * Errors that mean "migration 110 is not applied yet":
 *   PGRST204 — PostgREST: column not found in the schema cache (insert/upsert payload key)
 *   42703    — Postgres undefined_column
 *   42P10    — Postgres: no unique constraint matching the ON CONFLICT target
 *              (website_search_events.search_id's unique index doesn't exist yet)
 */
const MISSING_MIGRATION_CODES: ReadonlySet<string> = new Set(["PGRST204", "42703", "42P10"]);

type DbError = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingMigration110Error(error: DbError): boolean {
  return !!error?.code && MISSING_MIGRATION_CODES.has(error.code);
}

export type TrackingInsertOutcome = "inserted" | "fallback_inserted" | "failed";

type Logger = (message: string, detail: Record<string, unknown>) => void;

const defaultLogger: Logger = (message, detail) => console.error(message, detail);

export async function insertTrackingRow(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  migration110Keys: readonly string[],
  options?: { onConflict?: string; log?: Logger }
): Promise<TrackingInsertOutcome> {
  const log = options?.log ?? defaultLogger;
  try {
    const first = options?.onConflict
      ? await supabase.from(table).upsert(rows, { onConflict: options.onConflict, ignoreDuplicates: true })
      : await supabase.from(table).insert(rows);
    if (!first.error) return "inserted";

    if (!isMissingMigration110Error(first.error)) {
      log(`[track] ${table} insert failed`, { code: first.error.code, message: first.error.message });
      return "failed";
    }

    log(`[track] ${table}: migration 110 columns unavailable — writing the pre-110 row shape`, {
      code: first.error.code,
      message: first.error.message,
    });
    const strip = (row: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => !migration110Keys.includes(key)));
    const legacy = Array.isArray(rows) ? rows.map(strip) : strip(rows);
    const second = await supabase.from(table).insert(legacy);
    if (second.error) {
      log(`[track] ${table} pre-110 fallback insert failed`, { code: second.error.code, message: second.error.message });
      return "failed";
    }
    return "fallback_inserted";
  } catch (err) {
    log(`[track] ${table} insert threw`, { message: err instanceof Error ? err.message : String(err) });
    return "failed";
  }
}
