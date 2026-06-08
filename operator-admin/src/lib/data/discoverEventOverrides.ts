/**
 * Server-only data helpers for event-level discover rail overrides.
 * Must only be imported from Server Components, Route Handlers, or Server Actions.
 * Client-safe constants and types live in discoverOverridesShared.ts.
 */

import { createAdminClient } from "@/lib/supabase/server";
import type { RailKey, EventRailOverride } from "@/lib/data/discoverOverridesShared";

export type { EventRailOverride } from "@/lib/data/discoverOverridesShared";

// ─── Full row type (includes audit fields not needed by the engine) ───────────

export type EventRailOverrideRow = EventRailOverride & {
  reasonType: string | null;
  note: string | null;
  createdBy: string | null;
  updatedBy: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetches all event-level overrides for a single rail.
 * Returns the full row shape (including audit fields) so callers can display
 * reason/note metadata.  The full row also satisfies EventRailOverride for
 * engine functions that only need eventUuid + action.
 * Returns an empty array on any error so callers never hard-crash.
 */
export async function getEventOverridesForRail(
  railKey: RailKey
): Promise<EventRailOverrideRow[]> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("discover_event_overrides")
      .select("event_id, action, reason_type, note, created_by, updated_by")
      .eq("rail_key", railKey);

    if (error) {
      console.error("[getEventOverridesForRail] Supabase error:", error);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((row: Record<string, any>) => ({
      eventUuid:  row.event_id as string,
      action:     row.action as "include" | "exclude",
      reasonType: (row.reason_type as string | null) ?? null,
      note:       (row.note as string | null) ?? null,
      createdBy:  (row.created_by as string | null) ?? null,
      updatedBy:  (row.updated_by as string | null) ?? null,
    }));
  } catch (err) {
    console.error("[getEventOverridesForRail] Unexpected error:", err);
    return [];
  }
}
