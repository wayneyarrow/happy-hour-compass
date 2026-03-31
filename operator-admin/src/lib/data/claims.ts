import { createAdminClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

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

export type ClaimDetail = {
  id: string;
  venue_id: string;
  first_name: string;
  last_name: string;
  position: string;
  phone: string;
  email: string;
  ip_address: string | null;
  status: string;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  venue: {
    name: string;
    website_url: string | null;
    phone: string | null;
    address_line1: string | null;
    city: string | null;
    region: string | null;
    postal_code: string | null;
    country: string | null;
    lat: number | null;
    lng: number | null;
    claimed_at: string | null;
    claimed_by: string | null;
  } | null;
  prior_claim_count: number;
};

// Supabase returns embedded relations as arrays when there are no generated types.
// Cast via unknown to avoid the overlap error.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstOrObject<T>(val: unknown): T | null {
  if (!val) return null;
  if (Array.isArray(val)) return (val[0] as T) ?? null;
  return val as T;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Fetches all venue claims ordered newest-first, with the linked venue name.
 * Uses the admin client (service-role) — no operator-level RLS applies here.
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
    venue_name: firstOrObject<{ name: string }>(row.venues)?.name ?? null,
  }));

  return { claims, error: null };
}

/**
 * Fetches a single claim by ID with full venue context and a prior-claim count.
 * Returns null claim (not an error) when the id doesn't exist.
 */
export async function getClaimById(id: string): Promise<{
  claim: ClaimDetail | null;
  error: string | null;
}> {
  const supabase = createAdminClient();

  // Fetch the claim row with embedded venue fields.
  const { data, error } = await supabase
    .from("venue_claims")
    .select(
      `id, venue_id, first_name, last_name, position, phone, email,
       ip_address, status, review_notes, reviewed_by, reviewed_at,
       created_at, updated_at,
       venues (
         name, website_url, phone, address_line1,
         city, region, postal_code, country, lat, lng, claimed_at, claimed_by
       )`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[getClaimById]", error.message);
    return { claim: null, error: "Failed to load claim." };
  }

  if (!data) {
    return { claim: null, error: null }; // not found — caller handles
  }

  type VenueShape = {
    name: string;
    website_url: string | null;
    phone: string | null;
    address_line1: string | null;
    city: string | null;
    region: string | null;
    postal_code: string | null;
    country: string | null;
    lat: number | null;
    lng: number | null;
    claimed_at: string | null;
    claimed_by: string | null;
  };

  const venueId = data.venue_id as string;
  const venue = firstOrObject<VenueShape>(data.venues);

  // Count other claims for the same venue (excludes this claim).
  const { count: priorCount } = await supabase
    .from("venue_claims")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .neq("id", id);

  const claim: ClaimDetail = {
    id: data.id as string,
    venue_id: venueId,
    first_name: data.first_name as string,
    last_name: data.last_name as string,
    position: data.position as string,
    phone: data.phone as string,
    email: data.email as string,
    ip_address: data.ip_address as string | null,
    status: data.status as string,
    review_notes: data.review_notes as string | null,
    reviewed_by: data.reviewed_by as string | null,
    reviewed_at: data.reviewed_at as string | null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
    venue: venue
      ? {
          name: venue.name,
          website_url: venue.website_url,
          phone: venue.phone,
          address_line1: venue.address_line1,
          city: venue.city,
          region: venue.region,
          postal_code: venue.postal_code,
          country: venue.country,
          lat: venue.lat,
          lng: venue.lng,
          claimed_at: venue.claimed_at,
          claimed_by: venue.claimed_by,
        }
      : null,
    prior_claim_count: priorCount ?? 0,
  };

  return { claim, error: null };
}
