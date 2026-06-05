"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getMembershipByToken } from "@/lib/memberships";
import { sendSlackAlert } from "@/lib/slack";
import { addSystemVenueNote } from "@/lib/data/venueNotes";

export type AcceptInviteState = {
  error?:        string;
  success?:      true;
  existingUser?: true;
};

/**
 * Accepts a team-member invite by creating a Supabase auth user and marking
 * the membership active.
 *
 * Steps:
 *   1. Re-validate the invite token (status must still be 'invited').
 *   2. Create a Supabase auth user with the invite's email + provided password.
 *   3. Update the membership: status='active', auth_user_id, accepted_at, invite_token=null.
 *
 * If the email already has a Supabase auth account, the membership is activated
 * and { existingUser: true } is returned so the client can prompt sign-in.
 *
 * Rollback: if the membership update fails after user creation, the auth user
 * is deleted and an error is returned.
 */
export async function acceptInviteAction(
  _prevState: AcceptInviteState,
  formData: FormData
): Promise<AcceptInviteState> {
  const token           = (formData.get("token") as string | null)?.trim();
  const password        = formData.get("password") as string | null;
  const confirmPassword = formData.get("confirm_password") as string | null;
  const firstName       = (formData.get("first_name") as string | null)?.trim() ?? "";
  const lastName        = (formData.get("last_name") as string | null)?.trim() ?? "";

  if (!token || !password) return { error: "Missing required fields." };
  if (password !== confirmPassword) return { error: "Passwords do not match." };
  if (password.length < 6)         return { error: "Password must be at least 6 characters." };

  // ── Step 1: Re-validate token ──────────────────────────────────────────────

  const membership = await getMembershipByToken(token);
  if (!membership) {
    return { error: "This invitation link is invalid, has already been used, or has been cancelled." };
  }

  const supabase = createAdminClient();

  // ── Step 2: Create Supabase auth user ──────────────────────────────────────

  const { data: authData, error: createError } = await supabase.auth.admin.createUser({
    email:         membership.email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName || undefined,
      last_name:  lastName  || undefined,
    },
  });

  // Handle existing account
  if (createError) {
    const isDuplicate =
      createError.message?.toLowerCase().includes("already") ||
      (createError as { code?: string })?.code === "email_exists";

    if (isDuplicate) {
      // Activate the membership for the existing user — they can then sign in.
      // We don't have their auth_user_id here without a lookup, so we leave it
      // null; it will be lazy-linked by buildNormalContext on next sign-in.
      // Guards: only update member rows in invited state — never touch owner rows.
      await supabase
        .from("operator_memberships")
        .update({
          status:       "active",
          accepted_at:  new Date().toISOString(),
          invite_token: null,
        })
        .eq("id",     membership.id)
        .eq("role",   "member")
        .eq("status", "invited");

      await addSystemVenueNote(
        membership.operator_id,
        `${membership.email} accepted their team member invite.`,
        membership.email
      );

      return { existingUser: true };
    }

    console.error("[acceptInviteAction] Auth user creation failed:", createError.message);
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Invite Acceptance Failed — Auth User Creation",
      message:  "Unexpected auth user creation failure during team-member invite acceptance.",
      metadata: {
        Email:        membership.email,
        MembershipId: membership.id,
        OperatorId:   membership.operator_id,
        Error:        createError.message,
      },
    });
    return { error: createError.message ?? "Failed to create account. Please try again." };
  }

  const userId = authData?.user?.id;
  if (!userId) return { error: "Account creation returned no user. Please try again." };

  // ── Step 3: Activate membership ────────────────────────────────────────────
  // Guards on role='member' and status='invited' are critical:
  //   • Prevents accidentally touching an owner row if IDs somehow collide.
  //   • Prevents double-acceptance (if status is already 'active', 0 rows
  //     are matched, which is safe — the membership is already activated).
  //   • Makes the UPDATE deterministic: it can only succeed for the exact
  //     invited-member row the token belongs to.

  const { error: updateError } = await supabase
    .from("operator_memberships")
    .update({
      status:       "active",
      auth_user_id: userId,
      accepted_at:  new Date().toISOString(),
      invite_token: null,
    })
    .eq("id",     membership.id)
    .eq("role",   "member")
    .eq("status", "invited");

  if (updateError) {
    console.error("[acceptInviteAction] Membership update failed — rolling back auth user:", updateError.message);

    // Roll back the auth user so the invite can be retried.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      await sendSlackAlert({
        channel:  "ops-critical",
        severity: "critical",
        title:    "Invite Acceptance Rollback Failed",
        message:  "Auth user created but membership update failed, and auth user rollback also failed. Manual cleanup required.",
        metadata: {
          Email:        membership.email,
          MembershipId: membership.id,
          UserId:       userId,
          Error:        deleteError.message,
        },
      });
    }

    return { error: "Failed to activate your membership. Please try again." };
  }

  await addSystemVenueNote(
    membership.operator_id,
    `${membership.email} accepted their team member invite.`,
    membership.email
  );

  return { success: true };
}
