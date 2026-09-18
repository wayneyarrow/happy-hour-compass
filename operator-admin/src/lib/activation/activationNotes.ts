import { createAdminClient } from "@/lib/supabase/server";
import type { ActivationEventType } from "./activationEvents";

/**
 * Structured Internal Note writer for the shared operator-activation
 * lifecycle — writes to venue_claim_notes or operator_submission_notes
 * (migration 098 added event_type/metadata_json to both) depending on which
 * flow originated the record.
 *
 * SYSTEM-AUTHOR ATTRIBUTION: both tables' existing Control Panel note lists
 * (ClaimNotesSection.tsx / InternalNotesSection.tsx) render a note's author
 * as `created_by_email ?? (created_by ? uid:######## : "Unknown")` — there is
 * currently NO rendering path that turns a null author into "Happy Hour
 * Compass" (verified by reading both components; every existing
 * system-generated note in this codebase, e.g. operatorActivation.ts's
 * "Operator account setup completed..." note, today renders as "Unknown").
 * Rather than changing Control Panel presentation code (out of scope for
 * this phase — see the task's explicit "must not yet: change Control Panel
 * presentation" boundary), this writer satisfies "attributed to Happy Hour
 * Compass" entirely on the WRITE side: created_by stays null (this is not a
 * real user id — never invent one), and created_by_email is set to the
 * literal display string below, which the EXISTING unmodified rendering
 * logic already surfaces verbatim. This is a deliberate, narrow choice — see
 * the Phase 1A task report for the alternative considered (a presentation
 * fix in both NoteEntry components) and why this was safer for this phase.
 */
export const SYSTEM_AUTHOR_EMAIL = "Happy Hour Compass";

export type ActivationNoteOrigin =
  | { type: "claim"; claimId: string }
  | { type: "submission"; submissionId: string };

export type ActivationNoteMetadata = Record<string, unknown>;

/**
 * Writes one structured, immutable system-generated Internal Note.
 *
 * `metadata` must contain operational information ONLY — never an OTP,
 * access token, setup link, password, or any other secret value. This is
 * enforced by caller discipline (every current call site in this phase
 * passes only a deadline timestamp and a flow-type string — see
 * src/lib/operatorActivation.ts), matching how this codebase already relies
 * on written convention rather than a runtime scanner for what goes into
 * note/email bodies (see customer_success_events.metadata_json's identical
 * documented convention). This function does not attempt to scan `metadata`
 * for secret-shaped values — a scanner would give false confidence without
 * actually preventing a caller from passing the wrong object; the actual
 * safeguard is that no call site in this phase has a secret in scope to pass
 * in the first place.
 *
 * Best-effort, matches every other note-insert in this codebase: failures
 * are returned (never thrown) so a caller can log them without failing the
 * user-facing operation the note is describing.
 */
export async function writeActivationNote(
  {
    origin,
    eventType,
    note,
    metadata,
  }: {
    origin: ActivationNoteOrigin;
    eventType: ActivationEventType;
    note: string;
    metadata?: ActivationNoteMetadata;
  },
  /** Injectable for tests only — every real call site omits this and gets
   *  the real admin client. Not exported as a type; tests pass a minimal
   *  fake matching only the .from().insert() shape this function uses. */
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<{ ok: boolean; error?: string }> {
  const supabase = client;

  const payload = {
    note,
    event_type: eventType,
    metadata_json: metadata ?? null,
    created_by: null,
    created_by_email: SYSTEM_AUTHOR_EMAIL,
  };

  const { error } =
    origin.type === "claim"
      ? await supabase.from("venue_claim_notes").insert({ claim_id: origin.claimId, ...payload })
      : await supabase.from("operator_submission_notes").insert({ submission_id: origin.submissionId, ...payload });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
