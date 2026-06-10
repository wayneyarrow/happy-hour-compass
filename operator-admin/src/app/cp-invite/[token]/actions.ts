"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getPlatformAdminByToken } from "@/lib/platformAdmins";

export type AcceptCpInviteState = {
  error?:        string;
  success?:      true;
  existingUser?: true;
  email?:        string;
};

/**
 * Accepts a platform admin invite.
 *
 * Steps:
 *   1. Re-validate the token (status must still be 'invited', not expired).
 *   2. Create a Supabase auth user with the invite's email + provided password.
 *      If the email already has an auth account, skip creation and mark existing.
 *   3. Set platform_admins status='active', accepted_at=now(), invite_token=null.
 *
 * Rollback: if step 3 fails after user creation, the auth user is deleted.
 */
export async function acceptCpInviteAction(
  _prevState: AcceptCpInviteState,
  formData: FormData
): Promise<AcceptCpInviteState> {
  const token           = (formData.get("token") as string | null)?.trim();
  const password        = formData.get("password") as string | null;
  const confirmPassword = formData.get("confirm_password") as string | null;

  if (!token || !password) return { error: "Missing required fields." };
  if (password !== confirmPassword) return { error: "Passwords do not match." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  // ── Step 1: Re-validate token ──────────────────────────────────────────────
  const admin = await getPlatformAdminByToken(token);
  if (!admin) {
    return { error: "This invitation link is invalid, has expired, or has already been used." };
  }

  const supabase = createAdminClient();

  // ── Step 2: Create Supabase auth user ──────────────────────────────────────
  const { data: authData, error: createError } = await supabase.auth.admin.createUser({
    email:         admin.email,
    password,
    email_confirm: true,
  });

  if (createError) {
    const isDuplicate =
      createError.message?.toLowerCase().includes("already") ||
      (createError as { code?: string })?.code === "email_exists";

    if (isDuplicate) {
      // Existing Supabase auth account — activate the platform_admins row.
      // The user already has a password; they can sign in via /control-panel-login.
      await supabase
        .from("platform_admins")
        .update({
          status:       "active",
          accepted_at:  new Date().toISOString(),
          invite_token: null,
        })
        .eq("id", admin.id)
        .eq("status", "invited");

      return { existingUser: true, email: admin.email };
    }

    console.error("[acceptCpInviteAction] Auth user creation failed:", createError.message);
    return { error: createError.message ?? "Failed to create account. Please try again." };
  }

  const userId = authData?.user?.id;
  if (!userId) return { error: "Account creation returned no user. Please try again." };

  // ── Step 3: Activate platform admin row ────────────────────────────────────
  const { error: updateError } = await supabase
    .from("platform_admins")
    .update({
      status:       "active",
      accepted_at:  new Date().toISOString(),
      invite_token: null,
    })
    .eq("id", admin.id)
    .eq("status", "invited");

  if (updateError) {
    console.error("[acceptCpInviteAction] Row update failed — rolling back auth user:", updateError.message);
    await supabase.auth.admin.deleteUser(userId);
    return { error: "Failed to activate your account. Please try again." };
  }

  return { success: true, email: admin.email };
}
