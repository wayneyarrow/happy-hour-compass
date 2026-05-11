"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  sendOperatorSubmissionMoreInfoEmail,
  sendOperatorSubmissionClosedEmail,
} from "@/lib/email";

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubmissionReviewState = {
  success?: true;
  successAction?: string;
  error?: string;
  fieldErrors?: { review_notes?: string };
};

export type SaveNotesState = {
  success?: true;
  error?: string;
};

type ReviewAction = "needs_more_info" | "close";

const ACTION_LABELS: Record<ReviewAction, string> = {
  needs_more_info: "More info requested — email sent to submitter",
  close:           "Submission closed",
};

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Handles founder review actions on Needs Review operator submissions.
 *
 * needs_more_info:
 *   - Updates: status → needs_more_info, reviewed_by, reviewed_at,
 *     more_info_requested_at. Saves review_notes if provided.
 *   - Sends sendOperatorSubmissionMoreInfoEmail (awaited, required).
 *   - If email fails: returns error. Status update is already committed;
 *     the founder knows to contact the submitter directly.
 *
 * close:
 *   - Updates: status → closed, reviewed_by, reviewed_at, rejected_at.
 *     Saves review_notes if provided.
 *   - Sends sendOperatorSubmissionClosedEmail (awaited, failure non-blocking).
 *   - Closure always succeeds if the DB update succeeds, even if email fails.
 *
 * submissionId is bound via .bind(null, submissionId) — never read from FormData.
 * All DB writes use createAdminClient() (service role) — RLS blocks writes.
 *
 * Does NOT: create/link operators, create/link venues, or send activation emails.
 */
export async function reviewSubmissionAction(
  submissionId: string,
  _prevState: SubmissionReviewState,
  formData: FormData
): Promise<SubmissionReviewState> {
  // ── Validate action ────────────────────────────────────────────────────────
  const rawAction = formData.get("action") as string | null;
  if (!rawAction || !["needs_more_info", "close"].includes(rawAction)) {
    return { error: "Invalid action. Please try again." };
  }
  const action = rawAction as ReviewAction;

  // Notes are optional for both actions — saved internally, never sent to the submitter.
  const reviewNotes = (formData.get("review_notes") as string | null)?.trim() || null;

  // ── Resolve admin identity ─────────────────────────────────────────────────
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();

  // ── Fetch submission (need email + name for emails) ─────────────────────────
  const { data: submissionRow, error: fetchError } = await supabase
    .from("operator_submissions")
    .select("email, first_name, venue_name, status")
    .eq("id", submissionId)
    .single();

  if (fetchError || !submissionRow) {
    console.error("[reviewSubmissionAction] Fetch failed:", fetchError?.message);
    return { error: "Submission not found. Please refresh and try again." };
  }

  const submitterEmail = submissionRow.email as string;
  const firstName      = (submissionRow.first_name as string | null)?.trim() || "there";
  const venueName      = submissionRow.venue_name as string;
  const now            = new Date().toISOString();

  // ── needs_more_info ────────────────────────────────────────────────────────
  if (action === "needs_more_info") {
    // Generate a secure 64-char hex token (32 random bytes). This IS the
    // credential for the public more-info form — never log the token value.
    const token     = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("operator_submissions")
      .update({
        status:                 "needs_more_info",
        review_notes:           reviewNotes,
        reviewed_by:            user.id,
        reviewed_at:            now,
        more_info_requested_at: now,
        // Token for the structured more-info form (overwrites any prior token)
        more_info_token:        token,
        more_info_expires_at:   expiresAt,
        more_info_completed_at: null, // clear any prior completion
      })
      .eq("id", submissionId);

    if (updateError) {
      console.error("[reviewSubmissionAction] needs_more_info update failed:", updateError.message);
      return { error: "Failed to save review. Please try again." };
    }

    const appUrl     = getAppUrl();
    const moreInfoUrl = `${appUrl}/suggest/owner/more-info/${token}`;

    // Email is required for this action. If it fails, the token is stored but
    // the submitter has no link — return a clear error so the founder knows to
    // retry. On retry, a new token overwrites the current one.
    const emailResult = await sendOperatorSubmissionMoreInfoEmail({
      to:          submitterEmail,
      firstName,
      venueName,
      moreInfoUrl,
    });

    if (!emailResult.ok) {
      console.error(
        "[reviewSubmissionAction] More-info email failed — status updated but submitter not emailed.",
        { submissionId, submitterEmail, error: emailResult.error }
      );
      return {
        error:
          `Status updated to "Needs more info", but the email to ${submitterEmail} could not ` +
          `be sent (${emailResult.error ?? "unknown error"}). Please contact the submitter directly.`,
      };
    }

    console.log("[reviewSubmissionAction] needs_more_info — complete.", {
      submissionId,
      submitterEmail,
    });

    revalidatePath("/control-panel/operator-submissions");
    revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
    return { success: true, successAction: ACTION_LABELS.needs_more_info };
  }

  // ── close ──────────────────────────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from("operator_submissions")
    .update({
      status:       "closed",
      review_notes: reviewNotes,
      reviewed_by:  user.id,
      reviewed_at:  now,
      rejected_at:  now,
    })
    .eq("id", submissionId);

  if (updateError) {
    console.error("[reviewSubmissionAction] close update failed:", updateError.message);
    return { error: "Failed to save review. Please try again." };
  }

  // Closure email: awaited but non-blocking on failure. The submission is
  // correctly closed regardless of whether the courtesy email reaches the
  // submitter. Failure is logged for monitoring.
  const emailResult = await sendOperatorSubmissionClosedEmail({
    to:        submitterEmail,
    firstName,
    venueName,
  });

  if (!emailResult.ok) {
    console.error(
      "[reviewSubmissionAction] Closure email failed — submission closed but submitter not emailed.",
      { submissionId, submitterEmail, error: emailResult.error }
    );
    // Do not return error — closure succeeded. Founder can contact manually.
  }

  console.log("[reviewSubmissionAction] close — complete.", {
    submissionId,
    emailSent: emailResult.ok,
  });

  revalidatePath("/control-panel/operator-submissions");
  revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  return { success: true, successAction: ACTION_LABELS.close };
}

// ── Save internal notes (independent of review actions) ───────────────────────

/**
 * Saves founder-only internal notes on an operator submission without changing
 * the submission status. Notes are never exposed to the submitter.
 *
 * submissionId is bound via .bind(null, submissionId).
 */
export async function saveSubmissionNotesAction(
  submissionId: string,
  _prevState: SaveNotesState,
  formData: FormData
): Promise<SaveNotesState> {
  const notes = (formData.get("review_notes") as string | null)?.trim() || null;

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("operator_submissions")
    .update({ review_notes: notes })
    .eq("id", submissionId);

  if (error) {
    console.error("[saveSubmissionNotesAction] Update failed:", error.message);
    return { error: "Failed to save notes. Please try again." };
  }

  revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  return { success: true };
}
