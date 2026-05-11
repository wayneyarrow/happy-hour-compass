"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  sendOperatorSubmissionMoreInfoEmail,
  sendOperatorSubmissionClosedEmail,
} from "@/lib/email";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubmissionReviewState = {
  success?: true;
  successAction?: string;
  error?: string;
  fieldErrors?: { review_notes?: string };
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
 *   - Requires review_notes (sent verbatim to submitter).
 *   - Updates: status → needs_more_info, review_notes, reviewed_by,
 *     reviewed_at, more_info_requested_at.
 *   - Sends sendOperatorSubmissionMoreInfoEmail (awaited, required).
 *   - If email fails: returns error. Status update is already committed;
 *     the founder knows to contact the submitter directly.
 *
 * close:
 *   - Requires review_notes (internal record of why it was closed).
 *   - Updates: status → closed, review_notes, reviewed_by, reviewed_at,
 *     rejected_at.
 *   - Sends sendOperatorSubmissionClosedEmail (awaited, failure non-blocking).
 *   - Closure always succeeds if the DB update succeeds, even if email fails.
 *     Email is a courtesy; the DB state is the authoritative outcome.
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

  const reviewNotes = (formData.get("review_notes") as string | null)?.trim() ?? "";
  if (!reviewNotes) {
    return {
      fieldErrors: {
        review_notes:
          action === "needs_more_info"
            ? "Review notes are required — they will be sent to the submitter."
            : "Review notes are required to document why this submission is being closed.",
      },
    };
  }

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
    const { error: updateError } = await supabase
      .from("operator_submissions")
      .update({
        status:                 "needs_more_info",
        review_notes:           reviewNotes,
        reviewed_by:            user.id,
        reviewed_at:            now,
        more_info_requested_at: now,
      })
      .eq("id", submissionId);

    if (updateError) {
      console.error("[reviewSubmissionAction] needs_more_info update failed:", updateError.message);
      return { error: "Failed to save review. Please try again." };
    }

    // Email is required for this action: the founder's review note is the
    // communication to the submitter. If it fails the status is updated but
    // the submitter wasn't notified — return a clear error so the founder
    // can follow up directly.
    const emailResult = await sendOperatorSubmissionMoreInfoEmail({
      to:         submitterEmail,
      firstName,
      venueName,
      reviewNote: reviewNotes,
    });

    if (!emailResult.ok) {
      console.error(
        "[reviewSubmissionAction] More-info email failed — status updated but submitter not emailed.",
        { submissionId, submitterEmail, error: emailResult.error }
      );
      return {
        error:
          `Review notes were saved and status updated to "Needs more info", but the email ` +
          `to ${submitterEmail} could not be sent (${emailResult.error ?? "unknown error"}). ` +
          `Please contact the submitter directly.`,
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
