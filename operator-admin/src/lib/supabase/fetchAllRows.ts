/**
 * Complete, verified reads past PostgREST's 1,000-row response cap.
 *
 * PostgREST returns at most 1,000 rows per request (verified 2026-10-11), and
 * an unpaginated `.select()` silently truncates beyond that. fetchAllRows():
 *   1. takes an exact COUNT for the same filters,
 *   2. refuses (ReportTooLargeError) if it exceeds MAX_ROWS_PER_READ,
 *   3. reads every page (1,000 rows, ordered, a few in parallel),
 *   4. verifies rows read = count, ids unique, and an unchanged re-count
 *      (retry once, else IncompleteReadError) — see its doc comment.
 * The result is either complete or an explicit error — never silently
 * truncated.
 *
 * Originally written for the Founder Control Panel "Search & Discovery"
 * report (src/lib/data/searchDiscoveryReport.ts, which re-exports it
 * unchanged) and shared from here so other Control Panel screens (e.g. the
 * Venues list) can read complete datasets the same way. Server-only callers:
 * pass createAdminClient().
 */

import type { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

export const PAGE_SIZE = 1000;
export const MAX_ROWS_PER_READ = 150_000;
const PAGE_CONCURRENCY = 6;

export class ReportTooLargeError extends Error {
  constructor(public table: string, public rows: number) {
    super(`${table}: ${rows.toLocaleString()} rows in this range exceeds the ${MAX_ROWS_PER_READ.toLocaleString()}-row limit for complete in-app aggregation.`);
  }
}
export class IncompleteReadError extends Error {
  constructor(public table: string, public expected: number, public read: number) {
    super(`${table}: read ${read.toLocaleString()} of ${expected.toLocaleString()} rows — totals would be incomplete, so nothing is shown. Refresh to retry.`);
  }
}

/**
 * Reads every row matching `filter` (applied identically to every count and
 * page). `order` must be deterministic (end with a unique column) and
 * `columns` must include `id`.
 *
 * Read consistency (offset pagination, so pages could shift if rows were
 * added to or removed from the window mid-read):
 *   1. exact COUNT before reading;
 *   2. every page read (in parallel);
 *   3. rows read must equal that count AND every id must be unique;
 *   4. exact COUNT again after reading — it must be unchanged.
 * Any concurrent change inside the window therefore surfaces as a mismatch
 * (never as silently missing or duplicated rows); the read is retried once,
 * then IncompleteReadError is shown. Normal tracking inserts can't trigger
 * this: the window ends 30s before the request (resolveRange) and
 * occurred_at/searched_at are set by the database at insert time, so new
 * rows fall after `until`. Only a write held open >30s, a back-dated row
 * or a deletion inside the window could — the visible result is a
 * temporary "refresh to retry" error, never wrong totals.
 */
export async function fetchAllRows<T extends { id: unknown }>(
  admin: Admin,
  table: string,
  columns: string,
  filter: (q: Query) => Query,
  order: string[],
  attempt = 1
): Promise<T[]> {
  const count = async () => {
    const res = await filter(admin.from(table).select("*", { count: "exact", head: true }));
    if (res.error) throw new Error(`${table} count failed: ${res.error.message}`);
    return (res.count ?? 0) as number;
  };
  const total = await count();
  if (total > MAX_ROWS_PER_READ) throw new ReportTooLargeError(table, total);
  if (total === 0) return [];

  const pages = Math.ceil(total / PAGE_SIZE);
  const results: T[][] = new Array(pages);
  let next = 0;
  async function worker() {
    while (next < pages) {
      const i = next++;
      let q = filter(admin.from(table).select(columns));
      for (const col of order) q = q.order(col, { ascending: true });
      const res = await q.range(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE - 1);
      if (res.error) throw new Error(`${table} page ${i} failed: ${res.error.message}`);
      results[i] = res.data as T[];
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pages) }, worker));
  const rows = results.flat();
  const uniqueIds = new Set(rows.map((r) => r.id)).size;
  const after = await count();
  if (rows.length !== total || uniqueIds !== rows.length || after !== total) {
    if (attempt < 2) return fetchAllRows<T>(admin, table, columns, filter, order, attempt + 1);
    throw new IncompleteReadError(table, total, uniqueIds);
  }
  return rows;
}
