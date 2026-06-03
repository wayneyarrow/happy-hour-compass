"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { RailKey } from "@/lib/data/discoverOverridesShared";
import { RAIL_KEYS } from "@/lib/data/discoverOverridesShared";

// ─── Shared auth helper ───────────────────────────────────────────────────────

async function getAdminEmail(): Promise<string | null> {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
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
  const adminEmail = await getAdminEmail();
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
          updated_by:  adminEmail,
          // created_at / created_by only set on first insert (upsert ignoreDuplicates=false)
          created_by: adminEmail,
        },
        { onConflict: "rail_key,venue_id" }
      );

    if (error) {
      console.error("[addToRailAction] Supabase error:", error);
      return { success: false, error: "Failed to add venue to rail." };
    }

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
  const adminEmail = await getAdminEmail();
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
          updated_by:  adminEmail,
          created_by:  adminEmail,
        },
        { onConflict: "rail_key,venue_id" }
      );

    if (error) {
      console.error("[removeFromRailAction] Supabase error:", error);
      return { success: false, error: "Failed to remove venue from rail." };
    }

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

    revalidatePath("/control-panel/discover");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[restoreToAlgorithmAction] Unexpected error:", err);
    return { success: false, error: "Unexpected error." };
  }
}
