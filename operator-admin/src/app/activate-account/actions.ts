"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActivateState = {
  error?: string;
  success?: true;
};

// ── Rollback helpers ──────────────────────────────────────────────────────────

/**
 * Attempts to delete the Supabase Auth user created in this flow.
 * Logs a CRITICAL message if deletion fails — the dangling auth user will
 * need manual cleanup before the claimant can retry.
 */
async function rollbackAuthUser(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  context: string,
  email?: string
) {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      `[activateAccountAction] CRITICAL: ${context} — auth user rollback failed.`,
      { userId, rollbackError: error.message }
    );
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Activation Rollback Failed — Auth User Not Deleted",
      message:  `${context} — dangling auth user must be deleted manually before operator can re-activate.`,
      metadata: { Email: email ?? "(unknown)", "User ID": userId, "Rollback Error": error.message },
    });
  }
}

/**
 * Attempts to delete the operators row created in this flow.
 * Logs a CRITICAL message if deletion fails.
 */
async function rollbackOperator(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  context: string,
  email?: string
) {
  const { error } = await supabase.from("operators").delete().eq("id", userId);
  if (error) {
    console.error(
      `[activateAccountAction] CRITICAL: ${context} — operator rollback failed.`,
      { userId, rollbackError: error.message }
    );
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Activation Rollback Failed — Operator Row Not Deleted",
      message:  `${context} — orphaned operator row must be removed manually.`,
      metadata: { Email: email ?? "(unknown)", "User ID": userId, "Rollback Error": error.message },
    });
  }
}

/**
 * Attempts to clear claimed_by / claimed_at on the venue set during this flow.
 * Logs a CRITICAL message if the revert fails.
 */
async function rollbackVenueLink(
  supabase: ReturnType<typeof createAdminClient>,
  venueId: string,
  context: string,
  email?: string
) {
  const { error } = await supabase
    .from("venues")
    .update({ claimed_by: null, claimed_at: null })
    .eq("id", venueId);
  if (error) {
    console.error(
      `[activateAccountAction] CRITICAL: ${context} — venue link rollback failed.`,
      { venueId, rollbackError: error.message }
    );
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Activation Rollback Failed — Venue Link Not Cleared",
      message:  `${context} — venue is incorrectly marked as claimed. Manual fix required.`,
      metadata: { Email: email ?? "(unknown)", "Venue ID": venueId, "Rollback Error": error.message },
    });
  }
}

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Creates an operator account from a valid venue claim activation token.
 *
 * This is a complete-or-fail flow. All five steps must succeed; any failure
 * after user creation triggers a full rollback of everything written so far.
 *
 * Steps:
 *   1. Re-validates the activation token server-side.
 *   2. Creates a Supabase Auth user (email_confirm: true).
 *   3. Inserts an operators row.
 *   4. Links the venue (venues.claimed_by + claimed_at).
 *   5. Nullifies activation_token + activation_expires_at on the claim row.
 *
 * Rollback on failure:
 *   - Step 3 fails → delete auth user.
 *   - Step 4 fails → delete operator row + delete auth user.
 *   - Step 5 fails → revert venue link + delete operator row + delete auth user.
 *
 * All DB writes use createAdminClient() (service role) because RLS blocks
 * unauthenticated writes. Auth user creation also requires the admin API.
 */
export async function activateAccountAction(
  _prevState: ActivateState,
  formData: FormData
): Promise<ActivateState> {
  const token = (formData.get("token") as string | null)?.trim();
  const email = (formData.get("email") as string | null)?.trim();
  const firstName = (formData.get("first_name") as string | null)?.trim() ?? "";
  const lastName = (formData.get("last_name") as string | null)?.trim() ?? "";
  const password = formData.get("password") as string | null;
  const confirmPassword = formData.get("confirm_password") as string | null;

  // ── Basic validation ───────────────────────────────────────────────────────
  if (!token || !email || !password) {
    return { error: "Missing required fields." };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const supabase = createAdminClient();

  // ── Step 1: Re-validate the token ─────────────────────────────────────────
  const { data: claim, error: claimError } = await supabase
    .from("venue_claims")
    .select("id, venue_id, email")
    .eq("activation_token", token)
    .eq("email", email)
    .gt("activation_expires_at", new Date().toISOString())
    .maybeSingle();

  if (claimError || !claim) {
    return { error: "This activation link is invalid or expired." };
  }

  // ── Step 2: Create Supabase Auth user ─────────────────────────────────────
  // email_confirm: true skips the confirmation email — ownership was already
  // verified when the claimant received the approval email.
  const { data: authData, error: createUserError } =
    await supabase.auth.admin.createUser({
      email: claim.email as string,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
      },
    });

  if (createUserError || !authData?.user) {
    console.error(
      "[activateAccountAction] Auth user creation failed:",
      createUserError?.message
    );
    const isDuplicate =
      createUserError?.message?.toLowerCase().includes("already") ||
      (createUserError as { code?: string } | null)?.code === "email_exists";
    if (isDuplicate) {
      return {
        error:
          "An account with this email already exists. Please sign in instead.",
      };
    }
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Account Activation Failed — Auth User Creation",
      message:  "Unexpected auth user creation failure during operator self-activation. Operator cannot activate their account.",
      metadata: {
        Email:       email ?? "(unknown)",
        "Claim ID":  claim.id as string,
        "Venue ID":  claim.venue_id as string,
        Error:       createUserError?.message ?? "unknown",
      },
    });
    return {
      error:
        createUserError?.message ??
        "Failed to create account. Please try again.",
    };
  }

  const userId = authData.user.id;
  const userEmail = claim.email as string;
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

  // ── Step 3: Create operator record ────────────────────────────────────────
  const { error: operatorError } = await supabase.from("operators").insert({
    id: userId,
    email: userEmail,
    first_name: firstName || null,
    last_name: lastName || null,
    name: fullName,
  });

  if (operatorError) {
    console.error(
      "[activateAccountAction] Operator insert failed:",
      operatorError.message
    );
    await rollbackAuthUser(supabase, userId, "operator insert failed", userEmail);
    return { error: "Failed to create operator account. Please try again." };
  }

  // ── Step 4: Link venue to operator ────────────────────────────────────────
  const { error: venueError } = await supabase
    .from("venues")
    .update({
      claimed_by: userId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", claim.venue_id);

  if (venueError) {
    console.error(
      "[activateAccountAction] Venue link failed — rolling back operator + auth user:",
      { venueId: claim.venue_id, operatorId: userId, error: venueError.message }
    );
    await rollbackOperator(supabase, userId, "venue link failed", userEmail);
    await rollbackAuthUser(supabase, userId, "venue link failed", userEmail);
    return { error: "Failed to link your venue to this account. Please try again." };
  }

  // ── Step 5: Clear the activation token (one-time use) ─────────────────────
  const { error: tokenClearError } = await supabase
    .from("venue_claims")
    .update({
      activation_token: null,
      activation_expires_at: null,
    })
    .eq("id", claim.id);

  if (tokenClearError) {
    console.error(
      "[activateAccountAction] Token clear failed — rolling back venue link, operator + auth user:",
      { claimId: claim.id, operatorId: userId, error: tokenClearError.message }
    );
    await rollbackVenueLink(supabase, claim.venue_id as string, "token clear failed", userEmail);
    await rollbackOperator(supabase, userId, "token clear failed", userEmail);
    await rollbackAuthUser(supabase, userId, "token clear failed", userEmail);
    return { error: "Activation could not be completed. Please try again." };
  }

  return { success: true };
}
