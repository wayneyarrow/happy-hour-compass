"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendPasswordSetupEmail, sendClaimMoreInfoEmail } from "@/lib/email";
import { provisionOperatorForVenue } from "@/lib/operatorActivation";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AddClaimNoteState = {
  success?: true;
  error?: string;
  fieldError?: string;
};

export type ReviewState = {
  success?: true;
  /** Human-readable label of the action that succeeded (for the success banner). */
  successAction?: string;
  error?: string;
  fieldErrors?: { review_notes?: string };
};

type ReviewAction = "approve" | "needs_more_info" | "reject";

const ACTION_LABELS: Record<ReviewAction, string> = {
  approve:         "Approved — password setup email sent",
  needs_more_info: "Requested more info",
  reject:          "Rejected",
};

const STATUS_MAP: Record<ReviewAction, string> = {
  approve:         "approved",
  needs_more_info: "needs_more_info",
  reject:          "rejected",
};

// ── App URL helper ─────────────────────────────────────────────────────────────

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Updates a venue_claims row with the reviewer's decision.
 *
 * For "approve":
 *   Complete-or-fail operator onboarding flow:
 *   1. Fetch claim (email, first_name, last_name, venue_id).
 *   2. Create Supabase Auth user (email_confirm: true, no password yet).
 *      If user already exists, look up their ID from the operators table.
 *   3. Insert operators row (id = auth user UUID). Idempotent on 23505 conflict.
 *   4. Link venue: set claimed_by, claimed_at, created_by_operator_id.
 *   5. Generate Supabase recovery link (auth.admin.generateLink) pointing to
 *      /auth/callback?next=/operator/create-password.
 *   6. Send password setup email via Resend with the Supabase link.
 *   7. Update claim: status=approved, reviewed_by, reviewed_at.
 *
 *   Rollback on any post-user-creation failure:
 *   - Step 3 fails  → delete auth user (if we created it).
 *   - Step 4 fails  → delete operator (if new) + auth user (if new).
 *   - Step 5/6 fail → revert venue link + operator (if new) + auth user (if new).
 *   - Step 7 fails  → full rollback (claim stays unmodified).
 *
 * For "needs_more_info" / "reject":
 *   Updates status + review metadata only.
 *
 * claimId is bound via .bind(null, claimId) — never read from FormData.
 * All DB writes use createAdminClient() (service role) — RLS blocks non-owner writes.
 */
export async function reviewClaimAction(
  claimId: string,
  _prevState: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  // ── Validate action ────────────────────────────────────────────────────────
  const rawAction = formData.get("action") as string | null;
  const action = rawAction as ReviewAction | null;

  if (!action || !STATUS_MAP[action]) {
    return { error: "Invalid action. Please try again." };
  }

  const reviewNotes = (formData.get("review_notes") as string | null)?.trim() ?? "";

  if (action === "needs_more_info" && !reviewNotes) {
    return {
      fieldErrors: {
        review_notes: "A message is required when requesting more information.",
      },
    };
  }

  // ── Resolve the reviewing admin's identity ─────────────────────────────────
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();

  // ── reject ────────────────────────────────────────────────────────────────
  if (action === "reject") {
    const { error: updateError } = await supabase
      .from("venue_claims")
      .update({
        status:       "rejected",
        review_notes: reviewNotes || null,
        reviewed_by:  user.id,
        reviewed_at:  new Date().toISOString(),
      })
      .eq("id", claimId);

    if (updateError) {
      console.error("[reviewClaimAction] Reject update failed:", updateError.message);
      return { error: "Failed to save review decision. Please try again." };
    }

    revalidatePath("/control-panel/claims");
    revalidatePath(`/control-panel/claims/${claimId}`);
    return { success: true, successAction: ACTION_LABELS.reject };
  }

  // ── needs_more_info: tokenised structured form ────────────────────────────
  if (action === "needs_more_info") {
    // Fetch claim to get claimant contact + venue name for the email.
    const { data: claimRow, error: fetchError } = await supabase
      .from("venue_claims")
      .select("email, first_name, venue_id")
      .eq("id", claimId)
      .single();

    if (fetchError || !claimRow) {
      console.error("[reviewClaimAction] Claim fetch failed for more-info:", fetchError?.message);
      return { error: "Claim not found. Please refresh and try again." };
    }

    const { data: venueRow } = await supabase
      .from("venues")
      .select("name")
      .eq("id", claimRow.venue_id as string)
      .single();

    const claimantEmail = claimRow.email as string;
    const firstName     = ((claimRow.first_name as string | null) ?? "").trim() || "there";
    const venueName     = (venueRow?.name as string | null) ?? "your venue";

    // Generate a secure 64-char hex token (32 random bytes).
    // This IS the credential for the public more-info form — never log it.
    const token     = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const now       = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("venue_claims")
      .update({
        status:                 "needs_more_info",
        review_notes:           reviewNotes || null,
        reviewed_by:            user.id,
        reviewed_at:            now,
        more_info_token:        token,
        more_info_expires_at:   expiresAt,
        more_info_completed_at: null, // clear any prior completion
      })
      .eq("id", claimId);

    if (updateError) {
      console.error("[reviewClaimAction] needs_more_info update failed:", updateError.message);
      return { error: "Failed to save review decision. Please try again." };
    }

    const appUrl     = getAppUrl();
    const moreInfoUrl = `${appUrl}/claim/more-info/${token}`;

    // Email is required — the claimant needs the link.
    // If it fails the token is stored but undelivered; return an error so the
    // founder knows to retry. On retry a new token overwrites the current one.
    const emailResult = await sendClaimMoreInfoEmail({
      to: claimantEmail,
      firstName,
      venueName,
      moreInfoUrl,
    });

    if (!emailResult.ok) {
      console.error(
        "[reviewClaimAction] More-info email failed — status updated but claimant not emailed.",
        { claimId, claimantEmail, error: emailResult.error }
      );
      return {
        error:
          `Status updated to "Needs more info", but the email to ${claimantEmail} ` +
          `could not be sent (${emailResult.error ?? "unknown error"}). ` +
          `Please contact the claimant directly.`,
      };
    }

    // Append internal note.
    await supabase.from("venue_claim_notes").insert({
      claim_id:         claimId,
      note:             `More info requested — structured verification form emailed to ${claimantEmail}. Token expires in 72 h.`,
      created_by:       user.id,
      created_by_email: user.email ?? null,
    });

    console.log("[reviewClaimAction] needs_more_info — complete.", { claimId, claimantEmail });

    revalidatePath("/control-panel/claims");
    revalidatePath(`/control-panel/claims/${claimId}`);
    return { success: true, successAction: ACTION_LABELS.needs_more_info };
  }

  // ── Approve: operator onboarding flow ─────────────────────────────────────

  // Fetch claim (email, names, venue, status)
  const { data: claimRow, error: fetchError } = await supabase
    .from("venue_claims")
    .select("venue_id, email, first_name, last_name, status")
    .eq("id", claimId)
    .single();

  if (fetchError || !claimRow) {
    console.error("[reviewClaimAction] Claim fetch failed:", fetchError?.message);
    return { error: "Claim not found. Please refresh and try again." };
  }

  // Eligibility guards
  if ((claimRow.status as string) === "approved") {
    return { error: "This claim has already been approved." };
  }

  const claimEmail = claimRow.email as string;
  const firstName  = (claimRow.first_name as string | null) ?? "";
  const lastName   = (claimRow.last_name  as string | null) ?? "";
  const venueId    = claimRow.venue_id as string;

  if (!claimEmail) {
    return { error: "Claim has no email address — cannot provision operator." };
  }
  if (!venueId) {
    return { error: "Claim is not linked to a venue — cannot provision operator." };
  }

  // Provision: create auth user, operator row, link venue, generate recovery
  // link, send setup email. Full rollback on any step failure.
  const provisionResult = await provisionOperatorForVenue({
    email:     claimEmail,
    firstName,
    lastName,
    venueId,
    logTag:    "[reviewClaimAction]",
    sendEmail: (setupLink) =>
      sendPasswordSetupEmail({
        to:        claimEmail,
        firstName: firstName || "there",
        setupLink,
      }),
  });

  if (!provisionResult.ok) {
    return { error: provisionResult.error };
  }

  // Mark claim approved — last step so full rollback was still possible above.
  // If this fails: operator is live and email was sent; log for manual recovery.
  const now = new Date().toISOString();

  const { error: claimUpdateError } = await supabase
    .from("venue_claims")
    .update({
      status:                "approved",
      reviewed_by:           user.id,
      reviewed_at:           now,
      activation_token:      null,
      activation_expires_at: null,
    })
    .eq("id", claimId);

  if (claimUpdateError) {
    console.error(
      "[reviewClaimAction] CRITICAL: Claim update failed after provisioning complete.",
      { claimId, authUserId: provisionResult.authUserId, venueId, error: claimUpdateError.message }
    );
    return {
      error:
        "Operator account created and setup email sent, but the claim record could not be " +
        "marked approved. Please update the claim status manually in the database.",
    };
  }

  // Append internal note
  await supabase.from("venue_claim_notes").insert({
    claim_id:         claimId,
    note:             `Claim approved — operator account provisioned and setup email sent to ${claimEmail}.`,
    created_by:       user.id,
    created_by_email: user.email ?? null,
  });

  revalidatePath("/control-panel/claims");
  revalidatePath(`/control-panel/claims/${claimId}`);

  return { success: true, successAction: ACTION_LABELS.approve };
}

// ── Append internal claim note ────────────────────────────────────────────────

/**
 * Appends a new internal note to venue_claim_notes.
 * Does NOT overwrite previous notes — each call inserts a new row.
 * Notes are internal only; never shared with claimants.
 *
 * claimId is bound via .bind(null, claimId).
 */
export async function addClaimNoteAction(
  claimId: string,
  _prevState: AddClaimNoteState,
  formData: FormData
): Promise<AddClaimNoteState> {
  const note = (formData.get("note") as string | null)?.trim() ?? "";

  if (!note) {
    return { fieldError: "Note cannot be empty." };
  }

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("venue_claim_notes")
    .insert({
      claim_id:         claimId,
      note,
      created_by:       user.id,
      created_by_email: user.email ?? null,
    });

  if (error) {
    console.error("[addClaimNoteAction] Insert failed:", error.message);
    return { error: "Failed to save note. Please try again." };
  }

  revalidatePath(`/control-panel/claims/${claimId}`);
  return { success: true };
}
