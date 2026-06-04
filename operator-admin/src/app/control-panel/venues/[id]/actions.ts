"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VenueNoteState = {
  success?: true;
  error?: string;
  fieldError?: string;
};

export type VenueActionResult = { success: true } | { success: false; error: string };

// ── Auth helper ───────────────────────────────────────────────────────────────

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

// ── Add venue note ────────────────────────────────────────────────────────────

/**
 * Appends a new internal note to venue_notes.
 * Notes are internal only — never surfaced to venue operators.
 * venueId is bound via .bind(null, venueId) — never read from FormData.
 */
export async function addVenueNoteAction(
  venueId: string,
  _prevState: VenueNoteState,
  formData: FormData
): Promise<VenueNoteState> {
  const note = (formData.get("note") as string | null)?.trim() ?? "";

  if (!note) {
    return { fieldError: "Note cannot be empty." };
  }

  const admin = await getAdmin();
  if (!admin) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("venue_notes").insert({
    venue_id:         venueId,
    note,
    created_by:       admin.id,
    created_by_email: admin.email,
  });

  if (error) {
    console.error("[addVenueNoteAction] Insert failed:", error.message);
    return { error: "Failed to save note. Please try again." };
  }

  revalidatePath(`/control-panel/venues/${venueId}`);
  return { success: true };
}

// ── Toggle Exclude From Discover ──────────────────────────────────────────────

/**
 * Toggles venues.exclude_from_discover from the venue detail page.
 * Appends an internal note and revalidates the venue detail, discover, and home pages.
 * venueId is bound via .bind(null, venueId).
 */
export async function updateVenueExcludeFromDiscoverAction(
  venueId: string,
  value: boolean
): Promise<VenueActionResult> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired." };

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("venues")
    .update({ exclude_from_discover: value })
    .eq("id", venueId);

  if (error) {
    console.error("[updateVenueExcludeFromDiscoverAction]", error.message);
    return { success: false, error: "Failed to update Exclude From Discover." };
  }

  const { error: noteError } = await supabase.from("venue_notes").insert({
    venue_id:         venueId,
    note:             value
      ? "Venue excluded from discover (all rails)."
      : "Venue restored to discover eligibility.",
    created_by:       admin.id,
    created_by_email: admin.email,
  });
  if (noteError) {
    console.error("[updateVenueExcludeFromDiscoverAction] Note insert failed:", noteError.message);
  }

  revalidatePath(`/control-panel/venues/${venueId}`);
  revalidatePath("/control-panel/discover");
  revalidatePath("/");
  return { success: true };
}
