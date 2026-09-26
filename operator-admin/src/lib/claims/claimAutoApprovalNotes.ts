import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Claim-level Internal Notes for claim auto-approval.
 *
 * These are written to venue_claim_notes, which the Control Panel venue
 * page already merges into the VENUE's Internal Notes (via
 * getRelatedClaimNotesForVenue, prefixed "(via venue claim)"). One write
 * therefore tells the story on both the claim and the venue, with no
 * duplicate venue_notes row. Structured detail goes in metadata_json; the
 * note text is always a readable sentence.
 *
 * Deterministic event_keys (migration 099's unique index) make every note
 * here safe to retry: a duplicate insert is a no-op.
 */

export const CLAIM_SYSTEM_AUTHOR = "Happy Hour Compass";

export const claimSubmittedEventKey = (claimId: string) => `hhc-claim-submitted:${claimId}`;
export const claimAutoDecisionEventKey = (claimId: string) => `hhc-claim-auto-decision:${claimId}`;
export const claimAutoApprovalFallbackEventKey = (claimId: string) => `hhc-claim-auto-approval-fallback:${claimId}`;
export const claimVerifiedOnActivationEventKey = (claimId: string) => `hhc-claim-verified-on-activation:${claimId}`;

/** Inserts one system note on a claim; a duplicate event_key is treated as already written. Never throws. */
export async function writeClaimSystemNote(
  admin: SupabaseClient,
  {
    claimId,
    note,
    eventType = null,
    eventKey,
    metadata = null,
  }: { claimId: string; note: string; eventType?: string | null; eventKey: string; metadata?: Record<string, unknown> | null }
): Promise<{ ok: boolean }> {
  try {
    const { error } = await admin.from("venue_claim_notes").insert({
      claim_id: claimId,
      note,
      event_type: eventType,
      event_key: eventKey,
      metadata_json: metadata,
      created_by: null,
      created_by_email: CLAIM_SYSTEM_AUTHOR,
    });
    if (error && error.code !== "23505") {
      console.error("[claimAutoApproval] Claim note insert failed.", { claimId, eventKey, error: error.message });
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("[claimAutoApproval] Claim note insert threw.", { claimId, eventKey, error: err instanceof Error ? err.message : String(err) });
    return { ok: false };
  }
}

/** Whether this claim was auto-approved (its auto_decision note records decision "auto_approved"). */
export async function isAutoApprovedClaim(admin: SupabaseClient, claimId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("venue_claim_notes")
    .select("metadata_json")
    .eq("event_key", claimAutoDecisionEventKey(claimId))
    .maybeSingle();
  if (error || !data) return false;
  return (data.metadata_json as { decision?: string } | null)?.decision === "auto_approved";
}
