import { createAdminClient } from "@/lib/supabase/server";
import {
  formatCustomerSuccessMilestoneNote,
  CUSTOMER_SUCCESS_ACTIVITY_AUTHOR_LABEL,
  type CustomerSuccessMilestoneEventRow,
} from "@/lib/customerSuccess/customerSuccessMilestoneNotes";
import type { VenueNote } from "@/lib/data/venueNoteDisplay";

// VenueNote's canonical definition (and resolveNoteAuthor(), the pure
// author-resolution helper) now live in ./venueNoteDisplay — a module with
// no server-only imports, safe for a "use client" component
// (VenueNotesSection.tsx) to import directly. Re-exported here as a
// type-only export so this server module's existing consumers
// (page.tsx, actions.ts) that import VenueNote from "@/lib/data/venueNotes"
// keep working unchanged. See venueNoteDisplay.ts's header for the build
// failure this split fixes.
export type { VenueNote };

// ── System note helper ─────────────────────────────────────────────────────────

/**
 * Inserts a system-generated internal note for a venue.
 *
 * Silently no-ops when the venue can't be resolved. Never throws — note
 * failures must not block the primary action that triggered them.
 *
 * Pass actorEmail to attribute the note to the user who triggered the event
 * (e.g. the owner who changed the plan, the member who accepted the invite).
 * Pass null/undefined for fully automated system events.
 *
 * Pass explicitVenueId when the caller already knows exactly which venue
 * the event applies to (e.g. Phase 2B venue-scoped plan changes) — this
 * skips the operator→venue lookup entirely and is the only correct choice
 * for a multi-venue operator.
 *
 * When explicitVenueId is omitted, falls back to the Phase 1 behavior:
 * resolves "the venue" via `.eq("created_by_operator_id", operatorId).maybeSingle()`,
 * which is ambiguous for an operator who owns 2+ venues — `maybeSingle()`
 * returns no row in that case, so the note is silently dropped rather than
 * misfiled onto the wrong venue. Kept only for call sites that are still
 * genuinely operator-level by nature (team invite/accept) and have no
 * single venue to name.
 */
export async function addSystemVenueNote(
  operatorId: string,
  note: string,
  actorEmail?: string | null,
  explicitVenueId?: string | null
): Promise<void> {
  try {
    const supabase = createAdminClient();

    let venueId: string | undefined = explicitVenueId ?? undefined;

    if (!venueId) {
      const { data: venue } = await supabase
        .from("venues")
        .select("id")
        .eq("created_by_operator_id", operatorId)
        .maybeSingle();
      venueId = (venue as { id?: string } | null)?.id;
    }

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
    .select("id, claim_id, note, event_type, created_by, created_by_email, created_at")
    .in("claim_id", claimIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getRelatedClaimNotesForVenue]", error.message);
    return { notes: [] };
  }

  // Account activation writes the same sentence twice on a claim — a free-
  // text note and its structured "account_activated" twin — so the venue's
  // story would show one event twice. Collapse exact same-claim, same-text
  // pairs to a single entry (display only; both rows stay stored).
  const seen = new Set<string>();
  const deduped = (data ?? []).filter((row) => {
    const key = `${row.claim_id as string}\u0000${row.note as string}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const notes: VenueNote[] = deduped.map((row) => ({
    id:               row.id as string,
    venue_id:         venueId,
    note:             `(via venue claim) ${row.note as string}`,
    created_by:       row.created_by as string | null,
    created_by_email: row.created_by_email as string | null,
    created_at:       row.created_at as string,
  }));

  return { notes };
}

/**
 * Fetches venue-view-milestone Customer Success activity for this venue and
 * formats each event into the same VenueNote shape as the manual/system
 * notes above, for read-only display alongside them on the venue detail
 * page (Phase 1C).
 *
 * customer_success_events remains the sole source of truth — this is a
 * display-only projection computed fresh on every page load, never copied
 * into venue_notes or any other table, and never written to from here.
 * 'superseded' and 'skipped' rows are excluded — 'superseded' (baseline
 * supersession, or a milestone overtaken by a higher one before it could
 * send) is never meaningful to a Founder; 'skipped' is excluded for now
 * because no current code path produces it and its future semantics are
 * undefined (Phase 1C correction — see customerSuccessMilestoneNotes.ts).
 * Both exclusions are also enforced defensively inside
 * formatCustomerSuccessMilestoneNote() itself, along with any other
 * unrecognized status.
 *
 * Uses the admin client, matching every other read on this table. RLS is
 * enabled on customer_success_events with zero permissive policies (see
 * migration 093), so anon/authenticated access is blocked at the API layer
 * regardless of the underlying table GRANTs; this function only ever runs
 * server-side, reached exclusively from the founder-gated Control Panel
 * venue detail page.
 *
 * Each returned note sets author_label (see VenueNote in ./venueNoteDisplay) instead of
 * created_by_email, so it renders with an intentional system label rather
 * than "Unknown" — it never fabricates a human admin identity.
 *
 * Accepts an injectable admin client (defaulting to createAdminClient(),
 * matching the DI convention already used throughout src/lib/customerSuccess/)
 * so this can be exercised in tests against an in-memory fake rather than a
 * real Supabase connection.
 */
export async function getCustomerSuccessNotesForVenue(
  venueId: string,
  admin: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<{ notes: VenueNote[] }> {
  const { data, error } = await admin
    .from("customer_success_events")
    .select(
      "id, milestone_value, communication_status, achieved_at, next_attempt_at, sent_at, last_attempted_at, attempt_count, recipient_email, recipient_blocked_reason, processing_started_at, metadata_json"
    )
    .eq("venue_id", venueId)
    .eq("event_type", "venue_view_milestone")
    .neq("communication_status", "superseded")
    .neq("communication_status", "skipped")
    .order("achieved_at", { ascending: false });

  if (error) {
    console.error("[getCustomerSuccessNotesForVenue]", error.message);
    return { notes: [] };
  }

  const notes: VenueNote[] = (data ?? [])
    .map((row) => formatCustomerSuccessMilestoneNote(row as CustomerSuccessMilestoneEventRow))
    .filter((n): n is NonNullable<typeof n> => n !== null)
    .map((n) => ({
      id:               n.id,
      venue_id:         venueId,
      note:             n.note,
      created_by:       null,
      created_by_email: null,
      author_label:     CUSTOMER_SUCCESS_ACTIVITY_AUTHOR_LABEL,
      created_at:       n.created_at,
    }));

  return { notes };
}
