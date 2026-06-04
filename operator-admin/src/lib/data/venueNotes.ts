import { createAdminClient } from "@/lib/supabase/server";

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
