import { createAdminClient } from "@/lib/supabase/server";

// ── System note helper ─────────────────────────────────────────────────────────

/**
 * Inserts a system-generated internal note for the venue owned by operatorId.
 *
 * Silently no-ops when the operator has no venue yet. Never throws — note
 * failures must not block the primary action that triggered them.
 *
 * Pass actorEmail to attribute the note to the user who triggered the event
 * (e.g. the owner who changed the plan, the member who accepted the invite).
 * Pass null/undefined for fully automated system events.
 */
export async function addSystemVenueNote(
  operatorId: string,
  note: string,
  actorEmail?: string | null
): Promise<void> {
  try {
    const supabase = createAdminClient();

    const { data: venue } = await supabase
      .from("venues")
      .select("id")
      .eq("created_by_operator_id", operatorId)
      .maybeSingle();

    const venueId = (venue as { id?: string } | null)?.id;
    if (!venueId) return;

    const { error } = await supabase
      .from("venue_notes")
      .insert({
        venue_id:         venueId,
        note,
        created_by_email: actorEmail ?? null,
      });

    if (error) {
      console.error("[addSystemVenueNote] Insert failed:", error.message);
    }
  } catch (err) {
    console.error("[addSystemVenueNote] Unexpected error:", err);
  }
}

export type VenueNote = {
  id: string;
  venue_id: string;
  note: string;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
};

/**
 * Fetches internal notes for a single venue, newest first.
 * Uses the admin client — RLS blocks non-service-role reads on venue_notes.
 */
export async function getVenueNotes(venueId: string): Promise<{ notes: VenueNote[] }> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("venue_notes")
    .select("id, venue_id, note, created_by, created_by_email, created_at")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getVenueNotes]", error.message);
    return { notes: [] };
  }

  const notes: VenueNote[] = (data ?? []).map((row) => ({
    id:               row.id as string,
    venue_id:         row.venue_id as string,
    note:             row.note as string,
    created_by:       row.created_by as string | null,
    created_by_email: row.created_by_email as string | null,
    created_at:       row.created_at as string,
  }));

  return { notes };
}
