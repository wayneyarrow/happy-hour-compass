"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { RailKey } from "@/lib/data/discoverOverridesShared";
import { RAIL_KEYS } from "@/lib/data/discoverOverridesShared";

// ─── Shared auth helper ───────────────────────────────────────────────────────

async function getAdmin(): Promise<{ id: string; email: string | null } | null> {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

// ─── Internal note helper ─────────────────────────────────────────────────────
// Awaited after each main action so the insert completes before the serverless
// context is torn down. Errors are logged but never surfaced to the caller —
// a failed note must not roll back the main discover action.

async function appendVenueNote(
  venueUuid: string,
  note: string,
  admin: { id: string; email: string | null } | null
): Promise<void> {
  if (!admin) return;
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("venue_notes").insert({
      venue_id:         venueUuid,
      note,
      created_by:       admin.id,
      created_by_email: admin.email,
    });
    if (error) {
      console.error("[appendVenueNote] Insert failed:", error.message, { venueUuid, note });
    }
  } catch (err) {
    console.error("[appendVenueNote] Unexpected error:", err, { venueUuid });
  }
}

// ─── Result types ─────────────────────────────────────────────────────────────

export type ActionResult = { success: true } | { success: false; error: string };

// ─── Venue-level discover controls ───────────────────────────────────────────

/**
 * Updates venues.internal_boost for a single venue.
 * Bound action — venueUuid is never read from FormData.
 */
export async function updateBoostAction(
  venueUuid: string,
  boost: number
): Promise<ActionResult> {
  const clampedBoost = Math.max(0, Math.min(100, Math.round(boost)));
  const admin = await getAdmin();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("venues")
      .update({ internal_boost: clampedBoost })
      .eq("id", venueUuid);

    if (error) {
      console.error("[updateBoostAction] Supabase error:", error);
      return { success: false, error: "Failed to save boost." };
    }

    await appendVenueNote(venueUuid, `Internal boost set to ${clampedBoost}.`, admin);

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[updateBoostAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

/**
 * Toggles venues.spotlight_eligible for a single venue.
 */
export async function updateSpotlightEligibleAction(
  venueUuid: string,
  value: boolean
): Promise<ActionResult> {
  const admin = await getAdmin();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("venues")
      .update({ spotlight_eligible: value })
      .eq("id", venueUuid);

    if (error) {
      console.error("[updateSpotlightEligibleAction] Supabase error:", error);
      return { success: false, error: "Failed to update Spotlight Eligible." };
    }

    await appendVenueNote(
      venueUuid,
      `Spotlight eligible ${value ? "enabled" : "disabled"}.`,
      admin
    );

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[updateSpotlightEligibleAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

/**
 * Toggles venues.exclude_from_discover for a single venue.
 * This is a venue-wide flag — affects all rails.
 */
export async function updateExcludeFromDiscoverAction(
  venueUuid: string,
  value: boolean
): Promise<ActionResult> {
  const admin = await getAdmin();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("venues")
      .update({ exclude_from_discover: value })
      .eq("id", venueUuid);

    if (error) {
      console.error("[updateExcludeFromDiscoverAction] Supabase error:", error);
      return { success: false, error: "Failed to update Exclude From Discover." };
    }

    await appendVenueNote(
      venueUuid,
      value
        ? "Venue excluded from discover (all rails)."
        : "Venue restored to discover eligibility.",
      admin
    );

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[updateExcludeFromDiscoverAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

// ─── Rail override actions ────────────────────────────────────────────────────

/**
 * Adds a venue to a specific rail (include override).
 * Uses upsert so clicking "Add" twice is idempotent.
 * Geography and discover eligibility are enforced by the engine at read time.
 */
export async function addToRailAction(
  railKey: RailKey,
  venueUuid: string,
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  if (!RAIL_KEYS.includes(railKey)) {
    return { success: false, error: "Invalid rail." };
  }

  const reasonType = (formData.get("reason_type") as string | null) || null;
  const note       = (formData.get("note") as string | null)?.trim() || null;
  const admin      = await getAdmin();
  const now        = new Date().toISOString();

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("discover_rail_overrides")
      .upsert(
        {
          rail_key:    railKey,
          venue_id:    venueUuid,
          action:      "include",
          reason_type: reasonType,
          note,
          updated_at:  now,
          updated_by:  admin?.email ?? null,
          created_by:  admin?.email ?? null,
        },
        { onConflict: "rail_key,venue_id" }
      );

    if (error) {
      console.error("[addToRailAction] Supabase error:", error);
      return { success: false, error: "Failed to add venue to rail." };
    }

    const reasonSuffix = reasonType ? ` Reason: ${reasonType}.` : "";
    const noteSuffix   = note ? ` "${note}"` : "";
    await appendVenueNote(
      venueUuid,
      `Added to ${railKey} rail via override.${reasonSuffix}${noteSuffix}`,
      admin
    );

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[addToRailAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

/**
 * Removes a venue from a specific rail (exclude override).
 * Uses upsert so it's idempotent and handles switching a prior 'include' to 'exclude'.
 */
export async function removeFromRailAction(
  railKey: RailKey,
  venueUuid: string,
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  if (!RAIL_KEYS.includes(railKey)) {
    return { success: false, error: "Invalid rail." };
  }

  const reasonType = (formData.get("reason_type") as string | null) || null;
  const note       = (formData.get("note") as string | null)?.trim() || null;
  const admin      = await getAdmin();
  const now        = new Date().toISOString();

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("discover_rail_overrides")
      .upsert(
        {
          rail_key:    railKey,
          venue_id:    venueUuid,
          action:      "exclude",
          reason_type: reasonType,
          note,
          updated_at:  now,
          updated_by:  admin?.email ?? null,
          created_by:  admin?.email ?? null,
        },
        { onConflict: "rail_key,venue_id" }
      );

    if (error) {
      console.error("[removeFromRailAction] Supabase error:", error);
      return { success: false, error: "Failed to remove venue from rail." };
    }

    const reasonSuffix = reasonType ? ` Reason: ${reasonType}.` : "";
    const noteSuffix   = note ? ` "${note}"` : "";
    await appendVenueNote(
      venueUuid,
      `Removed from ${railKey} rail via nix override.${reasonSuffix}${noteSuffix}`,
      admin
    );

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[removeFromRailAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

/**
 * Restores a venue to the algorithm (deletes its rail override).
 * After deletion the engine's normal logic determines whether the venue appears.
 */
export async function restoreToAlgorithmAction(
  railKey: RailKey,
  venueUuid: string
): Promise<ActionResult> {
  const admin = await getAdmin();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("discover_rail_overrides")
      .delete()
      .eq("rail_key", railKey)
      .eq("venue_id", venueUuid);

    if (error) {
      console.error("[restoreToAlgorithmAction] Supabase error:", error);
      return { success: false, error: "Failed to restore venue." };
    }

    await appendVenueNote(
      venueUuid,
      `Restored to algorithm on ${railKey} rail (override removed).`,
      admin
    );

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[restoreToAlgorithmAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

// ─── Event-level discover controls (Featured Events rail) ─────────────────────

/**
 * Updates events.internal_boost for a single event.
 * Bound action — eventUuid is never read from FormData.
 */
export async function updateEventBoostAction(
  eventUuid: string,
  boost: number
): Promise<ActionResult> {
  const clampedBoost = Math.max(0, Math.min(100, Math.round(boost)));
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("events")
      .update({ internal_boost: clampedBoost })
      .eq("id", eventUuid);

    if (error) {
      console.error("[updateEventBoostAction] Supabase error:", error);
      return { success: false, error: "Failed to save event boost." };
    }

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[updateEventBoostAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

/**
 * Toggles events.exclude_from_discover for a single event.
 * When true the event is hidden from all discover rails.
 */
export async function updateEventExcludeFromDiscoverAction(
  eventUuid: string,
  value: boolean
): Promise<ActionResult> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("events")
      .update({ exclude_from_discover: value })
      .eq("id", eventUuid);

    if (error) {
      console.error("[updateEventExcludeFromDiscoverAction] Supabase error:", error);
      return { success: false, error: "Failed to update Exclude From Discover." };
    }

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[updateEventExcludeFromDiscoverAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

/**
 * Adds a specific event to a rail (include override).
 * Uses upsert so clicking "Add" twice is idempotent.
 */
export async function addEventToRailAction(
  railKey: RailKey,
  eventUuid: string,
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  if (!RAIL_KEYS.includes(railKey)) {
    return { success: false, error: "Invalid rail." };
  }

  const reasonType = (formData.get("reason_type") as string | null) || null;
  const note       = (formData.get("note") as string | null)?.trim() || null;
  const admin      = await getAdmin();
  const now        = new Date().toISOString();

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("discover_event_overrides")
      .upsert(
        {
          rail_key:    railKey,
          event_id:    eventUuid,
          action:      "include",
          reason_type: reasonType,
          note,
          updated_at:  now,
          updated_by:  admin?.email ?? null,
          created_by:  admin?.email ?? null,
        },
        { onConflict: "rail_key,event_id" }
      );

    if (error) {
      console.error("[addEventToRailAction] Supabase error:", error);
      return { success: false, error: "Failed to add event to rail." };
    }

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[addEventToRailAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

/**
 * Removes a specific event from a rail (exclude override / nix).
 * Uses upsert so it's idempotent and handles switching a prior 'include' to 'exclude'.
 */
export async function removeEventFromRailAction(
  railKey: RailKey,
  eventUuid: string,
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  if (!RAIL_KEYS.includes(railKey)) {
    return { success: false, error: "Invalid rail." };
  }

  const reasonType = (formData.get("reason_type") as string | null) || null;
  const note       = (formData.get("note") as string | null)?.trim() || null;
  const admin      = await getAdmin();
  const now        = new Date().toISOString();

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("discover_event_overrides")
      .upsert(
        {
          rail_key:    railKey,
          event_id:    eventUuid,
          action:      "exclude",
          reason_type: reasonType,
          note,
          updated_at:  now,
          updated_by:  admin?.email ?? null,
          created_by:  admin?.email ?? null,
        },
        { onConflict: "rail_key,event_id" }
      );

    if (error) {
      console.error("[removeEventFromRailAction] Supabase error:", error);
      return { success: false, error: "Failed to nix event from rail." };
    }

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[removeEventFromRailAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}

/**
 * Restores a nixed event to the algorithm (deletes its event-level override).
 * After deletion the engine's normal logic determines whether the event appears.
 */
export async function restoreEventToAlgorithmAction(
  railKey: RailKey,
  eventUuid: string
): Promise<ActionResult> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("discover_event_overrides")
      .delete()
      .eq("rail_key", railKey)
      .eq("event_id", eventUuid);

    if (error) {
      console.error("[restoreEventToAlgorithmAction] Supabase error:", error);
      return { success: false, error: "Failed to restore event." };
    }

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[restoreEventToAlgorithmAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}
