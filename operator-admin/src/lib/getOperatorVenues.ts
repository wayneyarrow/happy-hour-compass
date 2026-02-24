import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal venue fields needed for the dashboard list. */
export type VenueRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  region: string | null;
  is_published: boolean;
};

const VENUE_SELECT = "id, name, slug, city, region, is_published";

/**
 * Fetches all venues owned by the given operator.
 *
 * Ownership is determined by `venues.created_by_operator_id`.
 * The RLS policy "venues: read own" (migration 002) ensures only the
 * matching operator's rows are visible — the `.eq()` here is an explicit
 * filter that also serves as documentation of the ownership column.
 *
 * @param supabase    Authenticated server-side Supabase client.
 * @param operatorId  The `operators.id` UUID of the current user's operator record.
 * @returns           { venues, error } — venues is [] on error or empty result.
 */
export async function getOperatorVenues(
  supabase: SupabaseClient,
  operatorId: string
): Promise<{ venues: VenueRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .eq("created_by_operator_id", operatorId)
    .order("name", { ascending: true });

  if (error) {
    console.error("[getOperatorVenues] Query failed:", error);
    return { venues: [], error: `Failed to load venues: ${error.message}` };
  }

  return { venues: (data as VenueRow[]) ?? [], error: null };
}
