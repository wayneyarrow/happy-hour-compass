import { createAdminClient } from "@/lib/supabase/server";

export type ClaimWithVenue = {
  id: string;
  venue_id: string;
  first_name: string;
  last_name: string;
  position: string;
  phone: string;
  email: string;
  status: string;
  created_at: string;
  venue_name: string | null;
};

/**
 * Fetches all venue claims ordered newest-first, with the linked venue name.
 * Uses the admin client (service-role) since the control panel is an internal
 * surface — no operator-level RLS applies here.
 */
export async function getClaimsForReview(): Promise<{
  claims: ClaimWithVenue[];
  error: string | null;
}> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("venue_claims")
    .select(
      `id, venue_id, first_name, last_name, position, phone, email, status, created_at,
       venues ( name )`
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getClaimsForReview]", error.message);
    return { claims: [], error: "Failed to load claims." };
  }

  const claims: ClaimWithVenue[] = (data ?? []).map((row) => ({
    id: row.id as string,
    venue_id: row.venue_id as string,
    first_name: row.first_name as string,
    last_name: row.last_name as string,
    position: row.position as string,
    phone: row.phone as string,
    email: row.email as string,
    status: row.status as string,
    created_at: row.created_at as string,
    venue_name: (row.venues as { name: string } | null)?.name ?? null,
  }));

  return { claims, error: null };
}
