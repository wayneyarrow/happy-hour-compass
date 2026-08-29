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
 *
 * Phase 1 multi-venue limitation (2026-08-29): resolves "the venue" via
 * `.eq("created_by_operator_id", operatorId).maybeSingle()`, which is
 * ambiguous for an operator who owns 2+ venues — `maybeSingle()` returns no
 * row in that case, so the note is silently dropped rather than misfiled
 * onto the wrong venue. This is intentionally left as a documented gap
 * rather than reworked to accept an explicit venueId: it's an internal
 * audit-trail convenience (visible only in the Founder Control Panel), not
 * a security or data-correctness issue, and every call site (team
 * invite/accept, plan changes) is operator-level by nature already. Revisit
 * if/when these events become venue-scoped.
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

/**
 * Fetches Add Your Venue submission lifecycle notes for submissions linked to
 * this venue (operator_submissions.venue_id), for display alongside the
 * venue's own notes on the venue detail page.
 *
 * Read-only cross-reference via the existing venue_id relationship — the
 * canonical record stays in operator_submission_notes; this does not
 * duplicate storage. A submission can be linked to a venue at different
 * points (auto-confirmed at submit time, or manually approved later), so
 * this naturally picks up notes whenever that link exists, with no separate
 * backfill needed.
 *
 * Each note is prefixed to make its origin clear without requiring a new
 * "source" affordance in the shared NoteEntry UI.
 */
export async function getRelatedSubmissionNotesForVenue(
  venueId: string
): Promise<{ notes: VenueNote[] }> {
  const supabase = createAdminClient();

  const { data: submissions, error: submissionsError } = await supabase
    .from("operator_submissions")
    .select("id")
    .eq("venue_id", venueId);

  if (submissionsError) {
    console.error("[getRelatedSubmissionNotesForVenue]", submissionsError.message);
    return { notes: [] };
  }

  const submissionIds = (submissions ?? []).map((row) => row.id as string);
  if (submissionIds.length === 0) return { notes: [] };

  const { data, error } = await supabase
    .from("operator_submission_notes")
    .select("id, submission_id, note, created_by, created_by_email, created_at")
    .in("submission_id", submissionIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getRelatedSubmissionNotesForVenue]", error.message);
    return { notes: [] };
  }

  const notes: VenueNote[] = (data ?? []).map((row) => ({
    id:               row.id as string,
    venue_id:         venueId,
    note:             `(via Add Your Venue submission) ${row.note as string}`,
    created_by:       row.created_by as string | null,
    created_by_email: row.created_by_email as string | null,
    created_at:       row.created_at as string,
  }));

  return { notes };
}

/**
 * Fetches Claim Your Venue lifecycle notes for claims linked to this venue
 * (venue_claims.venue_id), for display alongside the venue's own notes on the
 * venue detail page. Mirrors getRelatedSubmissionNotesForVenue exactly.
 *
 * Read-only cross-reference via the existing venue_id relationship — the
 * canonical record stays in venue_claim_notes; this does not duplicate
 * storage. A venue can have more than one claim over time (e.g. a rejected
 * claim followed by a later approved one), so this picks up notes from all
 * of them.
 *
 * Each note is prefixed to make its origin clear without requiring a new
 * "source" affordance in the shared NoteEntry UI.
 */
export async function getRelatedClaimNotesForVenue(
  venueId: string
): Promise<{ notes: VenueNote[] }> {
  const supabase = createAdminClient();

  const { data: claims, error: claimsError } = await supabase
    .from("venue_claims")
    .select("id")
    .eq("venue_id", venueId);

  if (claimsError) {
    console.error("[getRelatedClaimNotesForVenue]", claimsError.message);
    return { notes: [] };
  }

  const claimIds = (claims ?? []).map((row) => row.id as string);
  if (claimIds.length === 0) return { notes: [] };

  const { data, error } = await supabase
    .from("venue_claim_notes")
    .select("id, claim_id, note, created_by, created_by_email, created_at")
    .in("claim_id", claimIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getRelatedClaimNotesForVenue]", error.message);
    return { notes: [] };
  }

  const notes: VenueNote[] = (data ?? []).map((row) => ({
    id:               row.id as string,
    venue_id:         venueId,
    note:             `(via venue claim) ${row.note as string}`,
    created_by:       row.created_by as string | null,
    created_by_email: row.created_by_email as string | null,
    created_at:       row.created_at as string,
  }));

  return { notes };
}
