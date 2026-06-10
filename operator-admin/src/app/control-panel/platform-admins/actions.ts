"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { getPlatformAdminByEmail, hasOtherActivePlatformAdmin } from "@/lib/platformAdmins";
import { sendPlatformAdminInviteEmail } from "@/lib/email";

// ── Types ─────────────────────────────────────────────────────────────────────

export type InviteAdminState = {
  success?: true;
  error?:   string;
};

export type RevokeAdminState = {
  success?: true;
  error?:   string;
};

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getCallerEmail(): Promise<string | null> {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user?.email) return null;
    if (!await isControlPanelAdmin(user.email)) return null;
    return user.email;
  } catch {
    return null;
  }
}

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ── Invite action ─────────────────────────────────────────────────────────────

/**
 * Creates an invited platform_admins row and sends the invite email.
 *
 * Steps:
 *   1. Auth guard — caller must be a CP admin.
 *   2. Validate + normalise the email.
 *   3. Check for duplicate active or invited record (idempotent for revoked).
 *   4. Generate a 7-day token.
 *   5. Insert the invited row (or re-invite a revoked admin).
 *   6. Send invite email — roll back row on email failure.
 */
export async function invitePlatformAdminAction(
  _prevState: InviteAdminState,
  formData: FormData
): Promise<InviteAdminState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const rawEmail = (formData.get("email") as string | null)?.trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes("@")) {
    return { error: "Please enter a valid email address." };
  }

  // ── Duplicate guard ──────────────────────────────────────────────────────────
  const existing = await getPlatformAdminByEmail(rawEmail);
  if (existing) {
    if (existing.status === "active") {
      return { error: `${rawEmail} is already an active platform admin.` };
    }
    if (existing.status === "invited") {
      return { error: `An invitation has already been sent to ${rawEmail}. Revoke it first to re-invite.` };
    }
    // status === "revoked" → allow re-invite (falls through to upsert below)
  }

  // ── Generate token ────────────────────────────────────────────────────────────
  const token      = randomBytes(32).toString("hex");
  const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const inviteUrl  = `${getAppUrl()}/cp-invite/${token}`;

  // ── Upsert platform_admins row ────────────────────────────────────────────────
  const supabase = createAdminClient();

  let rowId: string | null = null;

  if (existing?.status === "revoked") {
    // Re-invite a previously revoked admin.
    const { data: updated, error: updateError } = await supabase
      .from("platform_admins")
      .update({
        status:            "invited",
        invite_token:      token,
        invite_expires_at: expiresAt,
        invited_by_email:  callerEmail,
        invited_at:        new Date().toISOString(),
        accepted_at:       null,
        revoked_at:        null,
        revoked_by_email:  null,
      })
      .eq("id", existing.id)
      .select("id")
      .single();

    if (updateError || !updated) {
      console.error("[invitePlatformAdminAction] Update error:", updateError?.message);
      return { error: "Failed to create invitation. Please try again." };
    }
    rowId = (updated as { id: string }).id;
  } else {
    // Fresh invite.
    const { data: inserted, error: insertError } = await supabase
      .from("platform_admins")
      .insert({
        email:             rawEmail,
        status:            "invited",
        invite_token:      token,
        invite_expires_at: expiresAt,
        invited_by_email:  callerEmail,
        invited_at:        new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      console.error("[invitePlatformAdminAction] Insert error:", insertError?.message);
      return { error: "Failed to create invitation. Please try again." };
    }
    rowId = (inserted as { id: string }).id;
  }

  // ── Send invite email — roll back row on failure ──────────────────────────────
  const emailResult = await sendPlatformAdminInviteEmail({
    to:           rawEmail,
    inviterEmail: callerEmail,
    inviteUrl,
  });

  if (!emailResult.ok) {
    // Roll back the row so the invite can be retried.
    await supabase
      .from("platform_admins")
      .update({ status: "revoked", invite_token: null })
      .eq("id", rowId!);

    console.error("[invitePlatformAdminAction] Email failed:", emailResult.error);
    return { error: `Invitation created but email failed to send. Please try again. (${emailResult.error})` };
  }

  revalidatePath("/control-panel/platform-admins");
  return { success: true };
}

// ── Revoke action ─────────────────────────────────────────────────────────────

/**
 * Revokes a platform admin's access.
 *
 * Guards:
 *   - Caller must be a CP admin.
 *   - Caller cannot revoke themselves unless another active admin exists.
 *
 * adminId is bound via .bind(null, adminId) — never read from FormData.
 */
export async function revokePlatformAdminAction(
  adminId: string,
  _prevState: RevokeAdminState,
  _formData: FormData
): Promise<RevokeAdminState> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { error: "Unauthorized." };

  const supabase = createAdminClient();

  // Fetch the target row.
  const { data: target, error: fetchError } = await supabase
    .from("platform_admins")
    .select("id, email, status")
    .eq("id", adminId)
    .maybeSingle();

  if (fetchError || !target) {
    return { error: "Platform admin not found." };
  }

  const targetRow = target as { id: string; email: string; status: string };

  if (targetRow.status === "revoked") {
    return { error: "This admin has already been revoked." };
  }

  // Prevent self-revocation if no other active admin exists.
  if (targetRow.email.toLowerCase() === callerEmail.toLowerCase()) {
    const hasOther = await hasOtherActivePlatformAdmin(callerEmail);
    if (!hasOther) {
      return { error: "You cannot revoke yourself when you are the only active admin." };
    }
  }

  const { error: updateError } = await supabase
    .from("platform_admins")
    .update({
      status:           "revoked",
      revoked_at:       new Date().toISOString(),
      revoked_by_email: callerEmail,
      invite_token:     null,
    })
    .eq("id", adminId);

  if (updateError) {
    console.error("[revokePlatformAdminAction] Update error:", updateError.message);
    return { error: "Failed to revoke access. Please try again." };
  }

  revalidatePath("/control-panel/platform-admins");
  return { success: true };
}
