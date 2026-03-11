"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendApprovalEmail } from "@/lib/email";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReviewState = {
  success?: true;
  /** Human-readable label of the action that succeeded (for the success banner). */
  successAction?: string;
  error?: string;
  fieldErrors?: { review_notes?: string };
};

type ReviewAction = "approve" | "needs_more_info" | "reject";

const ACTION_LABELS: Record<ReviewAction, string> = {
  approve:         "Approved",
  needs_more_info: "Requested more info",
  reject:          "Rejected",
};

const STATUS_MAP: Record<ReviewAction, string> = {
  approve:         "approved",
  needs_more_info: "needs_more_info",
  reject:          "rejected",
};

// ── Token helper ──────────────────────────────────────────────────────────────

function generateActivationToken(): string {
  return randomBytes(32).toString("hex"); // 64-char hex, cryptographically secure
}

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Updates a venue_claims row with the reviewer's decision.
 *
 * For "approve":
 *   - Fetches the claimant email + first_name from Supabase.
 *   - Generates a secure activation token (stored on the claim row).
 *   - Sets activation_expires_at = now + 7 days.
 *   - Updates the DB first (reliable).
 *   - Sends an approval email with the /activate-account?token=... link.
 *   - If email fails: the claim IS approved in the DB, but a clear error is
 *     surfaced to the admin so they know to follow up manually.
 *
 * For "needs_more_info" / "reject":
 *   - Updates status + review metadata only (no token).
 *
 * claimId is bound via .bind(null, claimId) — never read from FormData.
 * reviewed_by stores the auth user's UUID (matches the UUID column type).
 * Uses createAdminClient() because RLS blocks UPDATE for all non-service-role clients.
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

  // Request More Info requires a note — validate server-side
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

  // ── Approve: DB update → email → rollback on email failure ──────────────
  if (action === "approve") {
    // Fetch claimant contact info + current state so we can roll back precisely
    // if the email step fails.
    const { data: claimRow, error: fetchError } = await supabase
      .from("venue_claims")
      .select("email, first_name, status, review_notes, reviewed_by, reviewed_at")
      .eq("id", claimId)
      .single();

    if (fetchError || !claimRow) {
      console.error("[reviewClaimAction] Claim fetch failed:", fetchError?.message);
      return { error: "Claim not found. Please refresh and try again." };
    }

    const token = generateActivationToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Step 1: persist the approval to the DB.
    const { error: updateError } = await supabase
      .from("venue_claims")
      .update({
        status:                "approved",
        review_notes:          reviewNotes || null,
        reviewed_by:           user.id,
        reviewed_at:           now,
        activation_token:      token,
        activation_expires_at: expiresAt,
      })
      .eq("id", claimId);

    if (updateError) {
      console.error("[reviewClaimAction] Approve DB update failed:", updateError.message);
      return { error: "Failed to approve claim. Please try again." };
    }

    // Step 2: send the approval email.
    const emailResult = await sendApprovalEmail({
      to:        claimRow.email as string,
      firstName: claimRow.first_name as string,
      token,
    });

    // Step 3: if email failed, roll back all changed fields to their prior values
    // so the claim is left in exactly the state it was before this action.
    if (!emailResult.ok) {
      console.error("[reviewClaimAction] Approval email failed — rolling back DB.", { resendError: emailResult.error });

      const { error: rollbackError } = await supabase
        .from("venue_claims")
        .update({
          status:                claimRow.status,
          review_notes:          claimRow.review_notes,
          reviewed_by:           claimRow.reviewed_by,
          reviewed_at:           claimRow.reviewed_at,
          activation_token:      null,
          activation_expires_at: null,
        })
        .eq("id", claimId);

      if (rollbackError) {
        // Rollback failed — claim is incorrectly marked approved with no email sent.
        // Log with full context for manual recovery.
        console.error(
          "[reviewClaimAction] CRITICAL: Email failed AND rollback failed.",
          { claimId, token, rollbackError: rollbackError.message }
        );
        return {
          error:
            "Approval email could not be sent and the database could not be reverted. " +
            "Please contact support — manual recovery required.",
        };
      }

      return {
        error:
          "Approval email could not be sent. The claim has not been approved. " +
          "Please try again or check your email configuration.",
      };
    }

    revalidatePath("/control-panel/claims");
    revalidatePath(`/control-panel/claims/${claimId}`);

    return { success: true, successAction: ACTION_LABELS.approve };
  }

  // ── needs_more_info / reject: status + review metadata only ───────────────
  const { error: updateError } = await supabase
    .from("venue_claims")
    .update({
      status:       STATUS_MAP[action],
      review_notes: reviewNotes || null,
      reviewed_by:  user.id,
      reviewed_at:  new Date().toISOString(),
    })
    .eq("id", claimId);

  if (updateError) {
    console.error("[reviewClaimAction] Update failed:", updateError.message);
    return { error: "Failed to save review decision. Please try again." };
  }

  revalidatePath("/control-panel/claims");
  revalidatePath(`/control-panel/claims/${claimId}`);

  return { success: true, successAction: ACTION_LABELS[action] };
}
