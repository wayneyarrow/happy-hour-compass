/**
 * Server-side data helpers for the discover_rail_overrides table.
 * Safe to import only in Server Components, Route Handlers, and Server Actions.
 *
 * For types and constants that are safe for client components, import from
 * discoverOverridesShared.ts instead.
 */

import { createAdminClient } from "@/lib/supabase/server";
export {
  RAIL_KEYS,
  RAIL_LABELS,
  INCLUDE_REASON_TYPES,
  EXCLUDE_REASON_TYPES,
  type RailKey,
  type RailOverrideRow,
} from "./discoverOverridesShared";
import type { RailKey, RailOverrideRow } from "./discoverOverridesShared";
import { RAIL_KEYS } from "./discoverOverridesShared";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToOverride(row: Record<string, unknown>): RailOverrideRow {
  return {
    id:         row.id as string,
    railKey:    row.rail_key as RailKey,
    venueUuid:  row.venue_id as string,
    action:     row.action as "include" | "exclude",
    reasonType: (row.reason_type as string | null) ?? null,
    note:       (row.note as string | null) ?? null,
    createdAt:  row.created_at as string,
    createdBy:  (row.created_by as string | null) ?? null,
    updatedAt:  row.updated_at as string,
    updatedBy:  (row.updated_by as string | null) ?? null,
  };
}

const emptyByRail = (): Record<RailKey, RailOverrideRow[]> => ({
  "spotlight":       [],
  "patio-picks":     [],
  "featured-nearby": [],
  "new-this-week":   [],
  "featured-events": [],
});

// ─── Public fetch helpers ─────────────────────────────────────────────────────

/**
 * Fetches all rail overrides in one query and buckets by rail_key.
 * Used by the consumer home page so all rails share a single DB round-trip.
 */
export async function getAllRailOverrides(): Promise<Record<RailKey, RailOverrideRow[]>> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("discover_rail_overrides")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[getAllRailOverrides] Supabase error:", error);
      return emptyByRail();
    }

    const result = emptyByRail();
    for (const row of data ?? []) {
      const key = row.rail_key as RailKey;
      if (!RAIL_KEYS.includes(key)) continue;
      result[key].push(rowToOverride(row as Record<string, unknown>));
    }
    return result;
  } catch (err) {
    console.error("[getAllRailOverrides] Unexpected error:", err);
    return emptyByRail();
  }
}

/**
 * Fetches overrides for a single rail.
 * Used by the Control Panel discover page for per-rail management.
 */
export async function getRailOverridesForKey(railKey: RailKey): Promise<RailOverrideRow[]> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("discover_rail_overrides")
      .select("*")
      .eq("rail_key", railKey)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[getRailOverridesForKey] Supabase error:", error);
      return [];
    }

    return (data ?? []).map((row) => rowToOverride(row as Record<string, unknown>));
  } catch (err) {
    console.error("[getRailOverridesForKey] Unexpected error:", err);
    return [];
  }
}
