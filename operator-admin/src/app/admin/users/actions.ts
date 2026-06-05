"use server";

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveOperatorContext } from "@/lib/impersonation";
import { getMembershipRole, countOperatorMembers } from "@/lib/memberships";
import { maxUsers, parseOperatorPlan } from "@/lib/plans";
import { sendMemberInviteEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function assertOwner(operatorId: string): Promise<
  | { ok: true; ctx: Awaited<ReturnType<typeof resolveOperatorContext>> }
  | { ok: false; error: string }
> {
  const ctx = await resolveOperatorContext();

  if (!ctx.operator && !ctx.isImpersonating) {
    return { ok: false, error: "Not authenticated." };
  }
  if (!ctx.isImpersonating && ctx.operator?.id !== operatorId) {
    return { ok: false, error: "Unauthorized." };
  }

  const userEmail = ctx.user?.email ?? ctx.operator?.email;
  if (!userEmail) return { ok: false, error: "Could not determine current user." };

  const role = await getMembershipRole(operatorId, userEmail);
  if (role !== "owner") {
    return { ok: false, error: "Only the account owner can manage users." };
  }

  return { ok: true, ctx };
}

// ── Invite user ───────────────────────────────────────────────────────────────

export async function inviteUserAction(
  operatorId: string,
  email: string,
  fullName: string | null
): Promise<{ ok: boolean; error?: string }> {
  const auth = await assertOwner(operatorId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const { ctx } = auth;

  // Validate email format
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  // Check plan limit
  const plan = parseOperatorPlan(ctx.operator?.plan);
  const userLimit = maxUsers(plan);
  const currentCount = await countOperatorMembers(operatorId);
  if (userLimit !== Infinity && currentCount >= userLimit) {
    const { usersNudge } = await import("@/lib/planNudges");
    const { atLimitMsg, upgradeSuggestion } = usersNudge(plan);
    const detail = upgradeSuggestion ?? "Contact us if you need more access.";
    return { ok: false, error: `${atLimitMsg} ${detail}` };
  }

  const supabase = createAdminClient();

  // Fetch venue name + inviter name up front — needed for email in all paths.
  const { data: venueData } = await supabase
    .from("venues")
    .select("name")
    .eq("created_by_operator_id", operatorId)
    .maybeSingle();
  const venueName = (venueData as { name?: string } | null)?.name ?? "your venue";

  const inviterName =
    ctx.operator?.name ??
    ctx.operator?.first_name ??
    ctx.operator?.email ??
    "The venue owner";

  // Generate token early — needed before the duplicate-check branch returns.
  const token = randomBytes(32).toString("hex");

  // Check for any existing membership row for this (operator, email) pair.
  // The UNIQUE constraint on (operator_id, email) means at most one row exists.
  // We must inspect all statuses: a 'cancelled' row blocks a new INSERT, so we
  // UPDATE it instead of inserting to avoid a unique-constraint DB error.
  const { data: existing } = await supabase
    .from("operator_memberships")
    .select("id, status")
    .eq("operator_id", operatorId)
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; status: string };
    if (row.status === "active")  return { ok: false, error: "This email already has access to your account." };
    if (row.status === "invited") return { ok: false, error: "This email already has a pending invitation." };

    if (row.status === "cancelled") {
      // Re-use the cancelled slot: UPDATE it into a fresh invite.
      const { error: reuseError } = await supabase
        .from("operator_memberships")
        .update({
          role:         "member",
          status:       "invited",
          full_name:    fullName?.trim() || null,
          invite_token: token,
          invited_by:   operatorId,
          invited_at:   new Date().toISOString(),
          accepted_at:  null,
          auth_user_id: null,
        })
        .eq("id",     row.id)
        .eq("status", "cancelled");  // guard: only overwrite cancelled rows

      if (reuseError) {
        console.error("[inviteUserAction] Cancelled-row reuse failed:", reuseError.message);
        return { ok: false, error: "Failed to create invitation. Please try again." };
      }
      // Row is now a fresh invite — fall through to email sending below.
    }
  } else {
    // No existing row — INSERT a fresh membership.
    const { error: insertError } = await supabase
      .from("operator_memberships")
      .insert({
        operator_id:  operatorId,
        email:        normalizedEmail,
        full_name:    fullName?.trim() || null,
        role:         "member",
        status:       "invited",
        invite_token: token,
        invited_by:   operatorId,
      });

    if (insertError) {
      console.error("[inviteUserAction] Insert failed:", insertError.message);
      return { ok: false, error: "Failed to create invitation. Please try again." };
    }
  }

  // Send invite email (shared path for both new INSERT and cancelled-row reuse).
  const inviteUrl = `${getAppUrl()}/operator/invite/${token}`;
  const firstName = fullName?.trim().split(/\s+/)[0] ?? "there";

  const emailResult = await sendMemberInviteEmail({
    to:          normalizedEmail,
    firstName,
    venueName,
    inviterName,
    inviteUrl,
  });

  if (!emailResult.ok) {
    // Email failed — invalidate the invite token so the link doesn't dangle.
    // Sets status back to 'cancelled' regardless of whether this was a fresh
    // INSERT or a cancelled-row reuse, so the slot can be cleanly re-invited.
    await supabase
      .from("operator_memberships")
      .update({ status: "cancelled", invite_token: null })
      .eq("invite_token", token);
    return { ok: false, error: "Failed to send the invitation email. Please try again." };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

// ── Remove active member ──────────────────────────────────────────────────────

export async function removeMemberAction(
  operatorId: string,
  membershipId: string
): Promise<{ ok: boolean; error?: string }> {
  const auth = await assertOwner(operatorId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = createAdminClient();

  const { data: target } = await supabase
    .from("operator_memberships")
    .select("id, email, role, status")
    .eq("id", membershipId)
    .eq("operator_id", operatorId)
    .maybeSingle();

  if (!target) return { ok: false, error: "Membership not found." };

  const t = target as { role: string; status: string };
  if (t.role === "owner")    return { ok: false, error: "You cannot remove the account owner." };
  if (t.status !== "active") return { ok: false, error: "This user is not an active member." };

  const { error } = await supabase
    .from("operator_memberships")
    .delete()
    .eq("id", membershipId)
    .eq("operator_id", operatorId);

  if (error) {
    console.error("[removeMemberAction]", error.message);
    return { ok: false, error: "Failed to remove user. Please try again." };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

// ── Cancel pending invite ─────────────────────────────────────────────────────

export async function cancelInviteAction(
  operatorId: string,
  membershipId: string
): Promise<{ ok: boolean; error?: string }> {
  const auth = await assertOwner(operatorId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = createAdminClient();

  // Mark cancelled; clear token so the link no longer works.
  const { error } = await supabase
    .from("operator_memberships")
    .update({ status: "cancelled", invite_token: null })
    .eq("id", membershipId)
    .eq("operator_id", operatorId)
    .eq("status", "invited");

  if (error) {
    console.error("[cancelInviteAction]", error.message);
    return { ok: false, error: "Failed to cancel invitation. Please try again." };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
