/**
 * Error-propagating variants of getVenueViewCounts()/getEventViewCounts()
 * (src/lib/data/viewCounts.ts) for the Scout report.
 *
 * Same RPCs, same arguments, same counting rule (venue_view_counts() /
 * event_view_counts(), migration 088 + the migration-111 environment rule:
 * legacy NULL + production). The only differences:
 *   - a failed call throws instead of returning an empty map (which every
 *     existing caller renders as 0 views);
 *   - the RPC's row count is requested and compared, so a response cut off
 *     by PostgREST's max-rows limit throws instead of under-counting.
 * Existing callers and viewCounts.ts are unchanged.
 */

import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

/** PostgREST max-rows on this project (see migration 088 / customerSuccess/pagination.ts). */
export const RPC_ROW_LIMIT = 1000;

export class TruncatedResultError extends Error {
  constructor(public source: string, public returned: number, public expected: number | null) {
    super(
      expected === null
        ? `${source}: returned ${returned} rows (at or above the ${RPC_ROW_LIMIT}-row response limit) and the total could not be verified — treating as incomplete.`
        : `${source}: returned ${returned} of ${expected} rows — the response was truncated, so totals would be incomplete.`
    );
  }
}

async function strictCounts(
  admin: AdminClient,
  fn: "venue_view_counts" | "event_view_counts",
  idKey: "venue_id" | "event_id",
  args: Record<string, unknown>
): Promise<Map<string, number>> {
  const { data, error, count } = await admin.rpc(fn, args, { count: "exact" });
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error(`${fn} returned no data`);
  if (typeof count === "number") {
    if (data.length !== count) throw new TruncatedResultError(fn, data.length, count);
  } else if (data.length >= RPC_ROW_LIMIT) {
    throw new TruncatedResultError(fn, data.length, null);
  }
  const map = new Map<string, number>();
  for (const row of data as Record<string, unknown>[]) map.set(String(row[idKey]), Number(row.views));
  return map;
}

/** Same semantics as getVenueViewCounts(since, venueIds), but throws on failure or truncation. */
export async function getVenueViewCountsStrict(admin: AdminClient, since: string | null, venueIds?: string[]): Promise<Map<string, number>> {
  if (venueIds && venueIds.length === 0) return new Map();
  return strictCounts(admin, "venue_view_counts", "venue_id", {
    p_since: since,
    p_venue_ids: venueIds && venueIds.length > 0 ? venueIds : null,
  });
}

/** Same semantics as getEventViewCounts(since, eventIds), but throws on failure or truncation. */
export async function getEventViewCountsStrict(admin: AdminClient, since: string | null, eventIds?: string[]): Promise<Map<string, number>> {
  if (eventIds && eventIds.length === 0) return new Map();
  return strictCounts(admin, "event_view_counts", "event_id", {
    p_since: since,
    p_event_ids: eventIds && eventIds.length > 0 ? eventIds : null,
  });
}

export function sumCounts(m: Map<string, number>): number {
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
}
