/**
 * Shared per-venue / per-event view-count aggregation.
 *
 * Backs CPanel Analytics (founderDashboard.ts), Action Center (actionCenter.ts),
 * and CPanel Venue Detail (venueHealth.ts) — anywhere that needs a view COUNT
 * grouped by venue or event, rather than a single platform-wide total.
 *
 * Calls the venue_view_counts()/event_view_counts() Postgres RPCs (migration
 * 088_view_event_aggregation_rpcs.sql), which GROUP BY server-side and return
 * one row per venue/event with at least one matching view — never raw
 * venue_view_events/event_view_events rows. This is what makes the result
 * immune to PostgREST's default row-return cap: the response size is bounded
 * by the number of distinct venues/events with any views, not by total
 * pageviews. See that migration's header for the full history — this
 * replaces a raw-row-fetch + JS-aggregation pattern that silently truncated
 * once 30-day platform-wide view volume crossed the cap.
 *
 * `since = null` means all-time (no lower bound) — the same RPC serves both
 * the existing 30-day figures and the newly added all-time figures.
 */

import { createAdminClient } from "@/lib/supabase/server";

type RpcCountRow<IdKey extends string> = { [K in IdKey]: string } & { views: number | string };

/**
 * Per-venue view counts.
 *
 * @param since     ISO timestamp lower bound (inclusive), or null for all-time.
 * @param venueIds  Restrict to these venues. Omit for platform-wide. An
 *                  explicit empty array short-circuits to an empty map
 *                  without a network call, matching every pre-existing
 *                  call site's `ids.length > 0 ? fetch(...) : []` guard.
 */
export async function getVenueViewCounts(
  since: string | null,
  venueIds?: string[]
): Promise<Map<string, number>> {
  if (venueIds && venueIds.length === 0) return new Map();

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("venue_view_counts", {
    p_since: since,
    p_venue_ids: venueIds && venueIds.length > 0 ? venueIds : null,
  });

  const map = new Map<string, number>();
  if (error || !data) return map;
  for (const row of data as RpcCountRow<"venue_id">[]) {
    map.set(row.venue_id, Number(row.views));
  }
  return map;
}

/**
 * Per-event view counts. Same semantics as getVenueViewCounts() above.
 */
export async function getEventViewCounts(
  since: string | null,
  eventIds?: string[]
): Promise<Map<string, number>> {
  if (eventIds && eventIds.length === 0) return new Map();

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("event_view_counts", {
    p_since: since,
    p_event_ids: eventIds && eventIds.length > 0 ? eventIds : null,
  });

  const map = new Map<string, number>();
  if (error || !data) return map;
  for (const row of data as RpcCountRow<"event_id">[]) {
    map.set(row.event_id, Number(row.views));
  }
  return map;
}

/** Sum of every value in a view-count map — the platform/scope total. */
export function sumViews(counts: Map<string, number>): number {
  let total = 0;
  for (const v of counts.values()) total += v;
  return total;
}
