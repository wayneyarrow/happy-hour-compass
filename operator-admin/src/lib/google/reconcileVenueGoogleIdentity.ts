/**
 * Automatic Google identity reconciliation for a single venue.
 *
 * Attempts to find and attach a confident Google Places match for a venue
 * that currently has no Google identity — using the exact same
 * searchGooglePlace() + passesConfidenceGate() logic as the operator
 * submission intake flow (src/lib/google/placesMatch.ts), so a venue is
 * never held to a looser standard on reconciliation than it was at intake.
 *
 * Self-guarding: fetches the venue's CURRENT place_id/google_identity_status
 * fresh before doing anything, and skips entirely if the venue is already
 * matched or has been explicitly marked exempt by a founder. This makes the
 * function safe to call from any lifecycle trigger point (currently: manual
 * Founder approval — see approveAndCreateVenueAction) without every caller
 * having to re-implement the same guard, and guarantees an exempt venue is
 * never silently re-attached without a deliberate founder action clearing
 * the exemption first (see control-panel/venues/[id]/actions.ts).
 *
 * Never attaches an ambiguous or low-confidence candidate — a failed/absent
 * match simply leaves the venue as "unmatched" for a later attempt (the
 * Founder Control Panel fallback, or a future automatic retry point).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { searchGooglePlace, passesConfidenceGate, toVenueGoogleFields } from "./placesMatch";

// ── Minimal client surface ────────────────────────────────────────────────────
//
// Narrowed from the full SupabaseClient type (mirrors the existing pattern in
// src/lib/brevo/supabaseAdminClient.ts) so this function can be unit-tested
// against a small in-memory fake without needing to satisfy the real
// client's full generic shape. Production code gets the real
// createAdminClient() cast to this surface — every method below is a real
// method on the Supabase JS client, used exactly as documented.

export type VenuesGoogleIdentityClient = {
  from(table: "venues"): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
    update(patch: Record<string, unknown>): {
      eq(column: string, value: unknown): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

export function getDefaultVenuesGoogleIdentityClient(): VenuesGoogleIdentityClient {
  return createAdminClient() as unknown as VenuesGoogleIdentityClient;
}

// ── Reconciliation ─────────────────────────────────────────────────────────────

export type ReconcileVenueGoogleIdentityParams = {
  venueId: string;
  /** Canonical business name to search with (submission/venue name). */
  name: string;
  streetAddress: string | null;
  city: string | null;
  province: string | null;
};

export type ReconcileVenueGoogleIdentityResult =
  | { outcome: "matched"; placeId: string; rating: number | null; reviewCount: number | null }
  | { outcome: "no_match" }
  | { outcome: "skipped"; reason: "already_matched" | "exempt" | "insufficient_data" | "venue_not_found" | "update_failed" };

export async function reconcileVenueGoogleIdentity(
  params: ReconcileVenueGoogleIdentityParams,
  client: VenuesGoogleIdentityClient = getDefaultVenuesGoogleIdentityClient()
): Promise<ReconcileVenueGoogleIdentityResult> {
  const { venueId, name, streetAddress, city, province } = params;

  // ── Fresh guard — never trust a caller's assumption about current state ──
  const { data: venueRow, error: fetchError } = await client
    .from("venues")
    .select("id, place_id, google_identity_status")
    .eq("id", venueId)
    .maybeSingle();

  if (fetchError || !venueRow) {
    console.error("[reconcileVenueGoogleIdentity] Venue fetch failed:", fetchError?.message);
    return { outcome: "skipped", reason: "venue_not_found" };
  }

  const placeId = venueRow.place_id as string | null;
  const identityStatus = venueRow.google_identity_status as string | null;

  if (placeId || identityStatus === "matched") {
    return { outcome: "skipped", reason: "already_matched" };
  }
  if (identityStatus === "exempt") {
    console.log("[reconcileVenueGoogleIdentity] Skipping — venue marked exempt.", { venueId });
    return { outcome: "skipped", reason: "exempt" };
  }

  if (!name?.trim() || !city?.trim() || !province?.trim()) {
    console.warn(
      "[reconcileVenueGoogleIdentity] Insufficient data to search — skipping.",
      { venueId, name, city, province }
    );
    return { outcome: "skipped", reason: "insufficient_data" };
  }

  // ── Search + gate (identical rules to intake) ─────────────────────────────
  const candidate = await searchGooglePlace(name, city, province);
  if (!candidate) {
    console.log("[reconcileVenueGoogleIdentity] No candidate found.", { venueId, name, city, province });
    return { outcome: "no_match" };
  }

  const confident = passesConfidenceGate(
    { businessName: name, streetAddress: streetAddress ?? "", city, province },
    candidate
  );
  if (!confident) {
    console.log("[reconcileVenueGoogleIdentity] Candidate failed confidence gate.", {
      venueId,
      candidateName: candidate.name,
      candidatePlaceId: candidate.placeId,
    });
    return { outcome: "no_match" };
  }

  const fields = toVenueGoogleFields(candidate);
  if (!fields.place_id) {
    // Defensive — a confident candidate should always carry a place_id.
    return { outcome: "no_match" };
  }

  const { error: updateError } = await client
    .from("venues")
    .update(fields)
    .eq("id", venueId);

  if (updateError) {
    console.error("[reconcileVenueGoogleIdentity] Update failed:", updateError.message);
    return { outcome: "skipped", reason: "update_failed" };
  }

  console.log("[reconcileVenueGoogleIdentity] Matched and attached.", {
    venueId,
    placeId: fields.place_id,
    rating: fields.google_rating,
    reviewCount: fields.google_review_count,
  });

  return {
    outcome: "matched",
    placeId: fields.place_id,
    rating: fields.google_rating,
    reviewCount: fields.google_review_count,
  };
}
