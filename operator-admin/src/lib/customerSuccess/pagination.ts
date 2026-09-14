/**
 * Small page-through-.range() helper shared by the Customer Success
 * foundation's Supabase reads.
 *
 * Exists because PostgREST's default max-rows setting (1,000 on this
 * project) silently truncates any unpaginated `.select()` once a result
 * would exceed it — see supabase/migrations/088_view_event_aggregation_rpcs.sql's
 * header for the incident this caused elsewhere (Founder Control Panel
 * figures silently wrong past that volume). Customer Success queries are
 * per-row selects (not GROUP BY-able the way view counts are, so no RPC
 * shortcut applies here) — paginating defensively is the fix.
 */

const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Calls `buildPage(from, to)` repeatedly with successive `.range()` bounds
 * until a page returns fewer than PAGE_SIZE rows, concatenating every row.
 * Throws on the first page error.
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    all.push(...rows);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}
