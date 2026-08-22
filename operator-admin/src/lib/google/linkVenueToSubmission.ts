/**
 * Backfills venues.source_submission_id after a Case A ("confirmed_auto")
 * operator submission has created both a new venue and its own
 * operator_submissions row.
 *
 * Why this exists as its own step (not part of the venue's own INSERT):
 * venues.source_submission_id has a NOT DEFERRABLE foreign key to
 * operator_submissions.id (migration 013_venue_source_attribution.sql).
 * Setting it directly on the venue's INSERT — using a submission id
 * generated up front, before the operator_submissions row that owns it
 * actually exists — makes the venue INSERT fail immediately with Postgres
 * error 23503 ("insert or update on table venues violates foreign key
 * constraint venues_source_submission_id_fk"). This was the root cause of
 * the Casa de Frida submission failure: every confirmed-match, brand-new
 * venue submission failed this way, deterministically, in production.
 *
 * The correct order is: venue INSERT (source_submission_id left NULL) →
 * operator_submissions INSERT (which already knows venue_id) → this UPDATE,
 * which backfills the reverse link now that both rows exist. See
 * saveOperatorSubmissionAction ((consumer)/suggest/owner/actions.ts) for the
 * call site and pendingSubmissionId's header comment for the full history.
 *
 * Exported from its own module (rather than kept inline in actions.ts, a
 * "use server" file where every export becomes a client-callable Server
 * Action) so it can be unit-tested directly against a fake Supabase client
 * that enforces the real FK — see
 * tests/unit/google/linkVenueToSubmission.test.ts.
 */

/** Narrow surface this module needs from a Supabase client — real or faked in tests. */
export type VenueLinkingClient = {
  from(table: "venues"): {
    update(patch: { source_submission_id: string }): {
      eq(column: "id", value: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export type LinkVenueToSubmissionResult =
  | { ok: true }
  | { ok: false; error: { message: string } };

/**
 * Sets venues.source_submission_id = submissionId for the given venue.
 * Call only once both rows already exist (i.e. only for the venue this
 * submission itself just created — never for an existing venue a
 * submission merely matched/linked to, which must keep whatever
 * source_submission_id it already had).
 */
export async function linkVenueToSubmission(
  client: VenueLinkingClient,
  venueId: string,
  submissionId: string
): Promise<LinkVenueToSubmissionResult> {
  const { error } = await client
    .from("venues")
    .update({ source_submission_id: submissionId })
    .eq("id", venueId);

  if (error) {
    return { ok: false, error };
  }
  return { ok: true };
}
