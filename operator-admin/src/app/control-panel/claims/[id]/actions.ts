"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendPasswordSetupEmail } from "@/lib/email";

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

// ── Rollback helpers ───────────────────────────────────────────────────────────

async function rollbackAuthUser(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  context: string
) {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      `[reviewClaimAction] CRITICAL: ${context} — auth user rollback failed.`,
      { userId, rollbackError: error.message }
    );
  }
}

async function rollbackOperator(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  context: string
) {
  const { error } = await supabase.from("operators").delete().eq("id", userId);
  if (error) {
    console.error(
      `[reviewClaimAction] CRITICAL: ${context} — operator rollback failed.`,
      { userId, rollbackError: error.message }
    );
  }
}

async function rollbackVenueLink(
  supabase: ReturnType<typeof createAdminClient>,
  venueId: string,
  context: string
) {
  const { error } = await supabase
    .from("venues")
    .update({ claimed_by: null, claimed_at: null, created_by_operator_id: null })
    .eq("id", venueId);
  if (error) {
    console.error(
      `[reviewClaimAction] CRITICAL: ${context} — venue link rollback failed.`,
      { venueId, rollbackError: error.message }
    );
  }
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

  // ── needs_more_info / reject ───────────────────────────────────────────────
  if (action !== "approve") {
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

  // ── Approve: operator onboarding flow ─────────────────────────────────────

  // Step 1: Fetch claim
  const { data: claimRow, error: fetchError } = await supabase
    .from("venue_claims")
    .select("venue_id, email, first_name, last_name, status")
    .eq("id", claimId)
    .single();

  if (fetchError || !claimRow) {
    console.error("[reviewClaimAction] Claim fetch failed:", fetchError?.message);
    return { error: "Claim not found. Please refresh and try again." };
  }

  const claimEmail = claimRow.email as string;
  const firstName  = (claimRow.first_name as string | null) ?? "";
  const lastName   = (claimRow.last_name  as string | null) ?? "";
  const venueId    = claimRow.venue_id as string;
  const fullName   = [firstName, lastName].filter(Boolean).join(" ") || null;

  // Step 2: Create Supabase Auth user
  // email_confirm: true — the claimant proved ownership of this email by
  // receiving and acting on the approval notification.
  // No password is set here; the recovery link lets them choose one.
  let authUserId: string;
  let createdNewAuthUser = false;

  const { data: authData, error: createUserError } =
    await supabase.auth.admin.createUser({
      email: claimEmail,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });

  if (!createUserError) {
    authUserId = authData.user.id;
    createdNewAuthUser = true;
  } else {
    // User already exists (previous partial run). Find their ID from the
    // operators table which was created in the same prior attempt.
    const isDuplicate = createUserError.message?.toLowerCase().includes("already");
    if (!isDuplicate) {
      console.error("[reviewClaimAction] Auth user creation failed:", createUserError.message);
      return { error: `Failed to create operator account: ${createUserError.message}` };
    }

    const { data: existingOp } = await supabase
      .from("operators")
      .select("id")
      .eq("email", claimEmail)
      .maybeSingle();

    if (!existingOp?.id) {
      console.error(
        "[reviewClaimAction] Auth user exists but no operator row found.",
        { claimId, email: claimEmail }
      );
      return {
        error:
          "An account with this email already exists but no operator record was found. " +
          "Check the Supabase Auth dashboard and retry.",
      };
    }

    authUserId = existingOp.id as string;
    console.warn("[reviewClaimAction] Auth user already existed — reusing.", { claimId, authUserId });
  }

  // Step 3: Create operator row (id = auth user UUID)
  let createdNewOperator = false;

  const { error: operatorError } = await supabase.from("operators").insert({
    id:         authUserId,
    email:      claimEmail,
    first_name: firstName || null,
    last_name:  lastName  || null,
    name:       fullName,
  });

  if (!operatorError) {
    createdNewOperator = true;
  } else if (operatorError.code !== "23505") {
    // 23505 = unique_violation → operator row already exists; skip.
    console.error("[reviewClaimAction] Operator insert failed:", operatorError.message);
    if (createdNewAuthUser) await rollbackAuthUser(supabase, authUserId, "operator insert failed");
    return { error: "Failed to create operator record. Please try again." };
  }

  // Step 4: Link venue to operator
  // created_by_operator_id is required for the admin venue page to display
  // the venue for this operator. claimed_by / claimed_at record provenance.
  const now = new Date().toISOString();
  const { error: venueError } = await supabase
    .from("venues")
    .update({
      claimed_by:             authUserId,
      claimed_at:             now,
      created_by_operator_id: authUserId,
    })
    .eq("id", venueId);

  if (venueError) {
    console.error(
      "[reviewClaimAction] Venue link failed — rolling back:",
      { venueId, authUserId, error: venueError.message }
    );
    if (createdNewOperator) await rollbackOperator(supabase, authUserId, "venue link failed");
    if (createdNewAuthUser) await rollbackAuthUser(supabase, authUserId, "venue link failed");
    return { error: "Failed to link venue to operator account. Please try again." };
  }

  // Step 5: Generate Supabase recovery link
  // The link goes through Supabase's /auth/v1/verify endpoint, which verifies
  // the token and redirects to /auth/callback with a PKCE code.
  // /auth/callback exchanges the code for a session, then redirects to
  // /operator/create-password where the operator sets their password.
  const appUrl = getAppUrl();
  const redirectTo = `${appUrl}/auth/callback?next=/operator/create-password`;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type:    "recovery",
    email:   claimEmail,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error(
      "[reviewClaimAction] generateLink failed — rolling back:",
      { claimId, error: linkError?.message }
    );
    await rollbackVenueLink(supabase, venueId, "generateLink failed");
    if (createdNewOperator) await rollbackOperator(supabase, authUserId, "generateLink failed");
    if (createdNewAuthUser) await rollbackAuthUser(supabase, authUserId, "generateLink failed");
    return { error: "Failed to generate password setup link. Please try again." };
  }

  // Step 6: Send password setup email
  const emailResult = await sendPasswordSetupEmail({
    to:        claimEmail,
    firstName: firstName || "there",
    setupLink: linkData.properties.action_link,
  });

  if (!emailResult.ok) {
    console.error(
      "[reviewClaimAction] Password setup email failed — rolling back.",
      { resendError: emailResult.error }
    );
    await rollbackVenueLink(supabase, venueId, "email send failed");
    if (createdNewOperator) await rollbackOperator(supabase, authUserId, "email send failed");
    if (createdNewAuthUser) await rollbackAuthUser(supabase, authUserId, "email send failed");
    return {
      error:
        "Password setup email could not be sent. The claim has not been approved. " +
        "Please try again or check your email configuration.",
    };
  }

  // Step 7: Mark claim as approved (last step — full rollback possible until here)
  const { error: claimUpdateError } = await supabase
    .from("venue_claims")
    .update({
      status:                "approved",
      review_notes:          reviewNotes || null,
      reviewed_by:           user.id,
      reviewed_at:           now,
      // Not used in the Supabase-native flow — leave null.
      activation_token:      null,
      activation_expires_at: null,
    })
    .eq("id", claimId);

  if (claimUpdateError) {
    // The operator account exists and the email was sent — the operator can
    // already log in. The claim row not being marked approved is a data-consistency
    // issue requiring manual recovery.
    console.error(
      "[reviewClaimAction] CRITICAL: Claim update failed after email sent.",
      { claimId, authUserId, venueId, error: claimUpdateError.message }
    );
    await rollbackVenueLink(supabase, venueId, "claim update failed");
    if (createdNewOperator) await rollbackOperator(supabase, authUserId, "claim update failed");
    if (createdNewAuthUser) await rollbackAuthUser(supabase, authUserId, "claim update failed");
    return {
      error:
        "Operator account created and email sent, but the claim record could not be updated. " +
        "Please mark this claim as approved manually in the database.",
    };
  }

  revalidatePath("/control-panel/claims");
  revalidatePath(`/control-panel/claims/${claimId}`);

  return { success: true, successAction: ACTION_LABELS.approve };
}
