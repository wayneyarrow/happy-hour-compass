/**
 * Saved Sync — DB-backed save/unsave and merge helpers.
 *
 * All functions accept a browser SupabaseClient so they work in Client
 * Components without importing browser.ts here (stays testable and universal).
 *
 * RLS: consumer_saved_venues + consumer_saved_events grant SELECT/INSERT/DELETE
 * to authenticated; each policy scopes to auth.uid() = consumer_id.
 *
 * Venue IDs in localStorage may be slugs (legacy) or UUIDs. Only UUID-shaped
 * IDs are written to the DB (FK type constraint). Slugs get migrated to UUIDs
 * the next time the SavedDropdown is opened.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLocalSavedItems,
  saveVenue,
  saveEvent,
  saveGuide,
} from "@/lib/consumer/savedItems";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(id: string): boolean {
  return UUID_RE.test(id);
}

function devLog(...args: unknown[]): void {
  if (process.env.NODE_ENV === "development") {
    console.error("[savedSync]", ...args);
  }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchDbSavedVenueIds(
  supabase: SupabaseClient,
  consumerId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("consumer_saved_venues")
    .select("venue_id")
    .eq("consumer_id", consumerId);
  if (error) {
    devLog("fetchDbSavedVenueIds:", error.message);
    return [];
  }
  return (data ?? []).map((r: { venue_id: string }) => r.venue_id);
}

export async function fetchDbSavedEventIds(
  supabase: SupabaseClient,
  consumerId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("consumer_saved_events")
    .select("event_id")
    .eq("consumer_id", consumerId);
  if (error) {
    devLog("fetchDbSavedEventIds:", error.message);
    return [];
  }
  return (data ?? []).map((r: { event_id: string }) => r.event_id);
}

export async function fetchDbSavedGuideIds(
  supabase: SupabaseClient,
  consumerId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("consumer_saved_guides")
    .select("guide_id")
    .eq("consumer_id", consumerId);
  if (error) {
    devLog("fetchDbSavedGuideIds:", error.message);
    return [];
  }
  return (data ?? []).map((r: { guide_id: string }) => r.guide_id);
}

// ─── Single save/unsave (called on each button click when signed in) ──────────

export async function dbSaveVenue(
  supabase: SupabaseClient,
  consumerId: string,
  venueId: string
): Promise<void> {
  if (!isUUID(venueId)) return;
  const { error } = await supabase
    .from("consumer_saved_venues")
    .upsert(
      { consumer_id: consumerId, venue_id: venueId },
      { onConflict: "consumer_id,venue_id", ignoreDuplicates: true }
    );
  if (error) devLog("dbSaveVenue:", error.message);
}

export async function dbUnsaveVenue(
  supabase: SupabaseClient,
  consumerId: string,
  venueId: string
): Promise<void> {
  if (!isUUID(venueId)) return;
  const { error } = await supabase
    .from("consumer_saved_venues")
    .delete()
    .eq("consumer_id", consumerId)
    .eq("venue_id", venueId);
  if (error) devLog("dbUnsaveVenue:", error.message);
}

export async function dbSaveEvent(
  supabase: SupabaseClient,
  consumerId: string,
  eventId: string
): Promise<void> {
  if (!isUUID(eventId)) return;
  const { error } = await supabase
    .from("consumer_saved_events")
    .upsert(
      { consumer_id: consumerId, event_id: eventId },
      { onConflict: "consumer_id,event_id", ignoreDuplicates: true }
    );
  if (error) devLog("dbSaveEvent:", error.message);
}

export async function dbUnsaveEvent(
  supabase: SupabaseClient,
  consumerId: string,
  eventId: string
): Promise<void> {
  if (!isUUID(eventId)) return;
  const { error } = await supabase
    .from("consumer_saved_events")
    .delete()
    .eq("consumer_id", consumerId)
    .eq("event_id", eventId);
  if (error) devLog("dbUnsaveEvent:", error.message);
}

export async function dbSaveGuide(
  supabase: SupabaseClient,
  consumerId: string,
  guideId: string
): Promise<void> {
  if (!isUUID(guideId)) return;
  const { error } = await supabase
    .from("consumer_saved_guides")
    .upsert(
      { consumer_id: consumerId, guide_id: guideId },
      { onConflict: "consumer_id,guide_id", ignoreDuplicates: true }
    );
  if (error) devLog("dbSaveGuide:", error.message);
}

export async function dbUnsaveGuide(
  supabase: SupabaseClient,
  consumerId: string,
  guideId: string
): Promise<void> {
  if (!isUUID(guideId)) return;
  const { error } = await supabase
    .from("consumer_saved_guides")
    .delete()
    .eq("consumer_id", consumerId)
    .eq("guide_id", guideId);
  if (error) devLog("dbUnsaveGuide:", error.message);
}

// ─── Initial merge sync ───────────────────────────────────────────────────────

/**
 * Merges local saves and DB saves using union semantics.
 *
 * - Local-only items are pushed to DB.
 * - DB-only items are written to localStorage.
 * - Duplicates are prevented by the UNIQUE constraint and Set deduplication.
 * - Fires hhc:savedChanged after writing DB items to localStorage so all UI
 *   components (count badge, heart buttons, dropdown) update immediately.
 *
 * Only call this once per session (use ConsumerAuthProvider for the guard).
 * Venue IDs that look like slugs (not UUIDs) are skipped for DB writes; they
 * will be migrated to UUIDs the next time SavedDropdown is opened.
 */
export async function mergeSavedItems(
  supabase: SupabaseClient,
  consumerId: string
): Promise<void> {
  try {
    const local = getLocalSavedItems();

    const localVenueIds = local.savedVenues.map((v) => v.id).filter(isUUID);
    const localEventIds = local.savedEvents.map((e) => e.id).filter(isUUID);
    const localGuideIds = local.savedGuides.map((g) => g.id).filter(isUUID);

    const [dbVenueIds, dbEventIds, dbGuideIds] = await Promise.all([
      fetchDbSavedVenueIds(supabase, consumerId),
      fetchDbSavedEventIds(supabase, consumerId),
      fetchDbSavedGuideIds(supabase, consumerId),
    ]);

    const dbVenueSet = new Set(dbVenueIds);
    const dbEventSet = new Set(dbEventIds);
    const dbGuideSet = new Set(dbGuideIds);
    const localVenueSet = new Set(localVenueIds);
    const localEventSet = new Set(localEventIds);
    const localGuideSet = new Set(localGuideIds);

    // Items to push from local → DB
    const venuesToInsert = localVenueIds.filter((id) => !dbVenueSet.has(id));
    const eventsToInsert = localEventIds.filter((id) => !dbEventSet.has(id));
    const guidesToInsert = localGuideIds.filter((id) => !dbGuideSet.has(id));

    // Items to pull from DB → localStorage
    const venuesToLocal = dbVenueIds.filter((id) => !localVenueSet.has(id));
    const eventsToLocal = dbEventIds.filter((id) => !localEventSet.has(id));
    const guidesToLocal = dbGuideIds.filter((id) => !localGuideSet.has(id));

    const writes: Promise<void>[] = [];

    if (venuesToInsert.length > 0) {
      writes.push(
        (async () => {
          const { error } = await supabase
            .from("consumer_saved_venues")
            .upsert(
              venuesToInsert.map((id) => ({
                consumer_id: consumerId,
                venue_id: id,
              })),
              { onConflict: "consumer_id,venue_id", ignoreDuplicates: true }
            );
          if (error) devLog("bulk venue insert:", error.message);
        })()
      );
    }

    if (eventsToInsert.length > 0) {
      writes.push(
        (async () => {
          const { error } = await supabase
            .from("consumer_saved_events")
            .upsert(
              eventsToInsert.map((id) => ({
                consumer_id: consumerId,
                event_id: id,
              })),
              { onConflict: "consumer_id,event_id", ignoreDuplicates: true }
            );
          if (error) devLog("bulk event insert:", error.message);
        })()
      );
    }

    if (guidesToInsert.length > 0) {
      writes.push(
        (async () => {
          const { error } = await supabase
            .from("consumer_saved_guides")
            .upsert(
              guidesToInsert.map((id) => ({
                consumer_id: consumerId,
                guide_id: id,
              })),
              { onConflict: "consumer_id,guide_id", ignoreDuplicates: true }
            );
          if (error) devLog("bulk guide insert:", error.message);
        })()
      );
    }

    // Write DB-only items into localStorage. saveVenue/saveEvent/saveGuide
    // each fire hhc:savedChanged, so UI updates automatically as items are written.
    for (const id of venuesToLocal) {
      saveVenue(id);
    }
    for (const id of eventsToLocal) {
      saveEvent(id);
    }
    for (const id of guidesToLocal) {
      saveGuide(id);
    }

    await Promise.all(writes);
  } catch (err) {
    devLog("mergeSavedItems:", err);
  }
}
