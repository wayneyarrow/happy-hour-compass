"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";

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

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Updates a venue_claims row with the reviewer's decision.
 *
 * claimId is bound via .bind(null, claimId) — never read from FormData.
 * The submitted action is read from the button's name="action" value.
 * reviewed_by stores the auth user's UUID (matches the UUID column type).
 *
 * Uses createAdminClient() because RLS on venue_claims denies UPDATE to
 * all non-service-role clients (see 007_venue_claims.sql).
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

  // ── Persist the review decision ────────────────────────────────────────────
  // Use service-role client — RLS blocks UPDATE for all authenticated users.
  const supabase = createAdminClient();

  const { error: updateError } = await supabase
    .from("venue_claims")
    .update({
      status:       STATUS_MAP[action],
      review_notes: reviewNotes || null,
      reviewed_by:  user.id,        // UUID — matches reviewed_by column type
      reviewed_at:  new Date().toISOString(),
    })
    .eq("id", claimId);

  if (updateError) {
    console.error("[reviewClaimAction] Update failed:", updateError.message);
    return { error: "Failed to save review decision. Please try again." };
  }

  // Invalidate both the list and this detail page so navigating back shows
  // the updated status immediately.
  revalidatePath("/control-panel/claims");
  revalidatePath(`/control-panel/claims/${claimId}`);

  return { success: true, successAction: ACTION_LABELS[action] };
}
