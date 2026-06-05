/**
 * Operator Memberships — server-side helpers.
 *
 * operator_memberships (migration 037) stores multi-user access records.
 * V1: one owner per operator + plan-limited team members.
 *
 * All functions use createAdminClient() (service-role) — RLS is enabled with
 * no permissive policies; the admin client bypasses it entirely.
 *
 * Server-side only. Never import from Client Components.
 */

import { createAdminClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MembershipRole   = "owner" | "member";
export type MembershipStatus = "active" | "invited" | "cancelled";

export type MembershipRow = {
  id:           string;
  operator_id:  string;
  auth_user_id: string | null;
  email:        string;
  full_name:    string | null;
  role:         MembershipRole;
  status:       MembershipStatus;
  invite_token: string | null;
  invited_by:   string | null;
  invited_at:   string;
  accepted_at:  string | null;
  created_at:   string;
  updated_at:   string;
};

const MEMBERSHIP_SELECT =
  "id, operator_id, auth_user_id, email, full_name, role, status, " +
  "invite_token, invited_by, invited_at, accepted_at, created_at, updated_at";

// Raw Supabase row before type coercions (no generated types in this project).
type MembershipDbRow = {
  id:           string;
  operator_id:  string;
  auth_user_id: string | null;
  email:        string;
  full_name:    string | null;
  role:         string | null;
  status:       string | null;
  invite_token: string | null;
  invited_by:   string | null;
  invited_at:   string;
  accepted_at:  string | null;
  created_at:   string;
  updated_at:   string;
};

function coerceRow(row: MembershipDbRow): MembershipRow {
  return {
    ...row,
    role:   (row.role   ?? "member")  as MembershipRole,
    status: (row.status ?? "invited") as MembershipStatus,
  };
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/**
 * Returns all active + invited memberships for an operator, owner first.
 */
export async function getOperatorMemberships(
  operatorId: string
): Promise<MembershipRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("operator_memberships")
    .select(MEMBERSHIP_SELECT)
    .eq("operator_id", operatorId)
    .in("status", ["active", "invited"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[getOperatorMemberships]", error.message);
    return [];
  }

  const rows = (data as unknown as MembershipDbRow[]).map(coerceRow);

  // Owner always first, then by created_at (already ordered by Supabase query)
  rows.sort((a, b) => {
    if (a.role === "owner" && b.role !== "owner") return -1;
    if (a.role !== "owner" && b.role === "owner") return  1;
    return 0;
  });

  return rows;
}

/**
 * Returns a pending (status='invited') membership by its invite token.
 * Returns null if the token is invalid, expired, already accepted, or cancelled.
 */
export async function getMembershipByToken(
  token: string
): Promise<MembershipRow | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("operator_memberships")
    .select(MEMBERSHIP_SELECT)
    .eq("invite_token", token)
    .eq("status", "invited")
    .maybeSingle();

  if (error || !data) return null;

  return coerceRow(data as unknown as MembershipDbRow);
}

/**
 * Returns the role ('owner' | 'member') for a user on a specific operator.
 * Returns null if no active membership exists for this operator+email pair.
 */
export async function getMembershipRole(
  operatorId: string,
  email: string
): Promise<MembershipRole | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("operator_memberships")
    .select("role")
    .eq("operator_id", operatorId)
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;

  return ((data as { role?: string | null })?.role ?? "member") as MembershipRole;
}

/**
 * Returns the most recently accepted active member membership for a given email,
 * regardless of auth_user_id state (null, correct, or mislinked to a previous
 * user from a session-mismatch accept).
 *
 * This is the email-based fallback in buildNormalContext(). The fast path
 * (getActiveMembershipForAuthUser) queries by auth_user_id — if the member
 * membership has a null or wrong auth_user_id that path is invisible to it.
 * This broader query finds the membership by email and lets the caller correct
 * auth_user_id so the fast path works on every subsequent login.
 *
 * Only matches role='member' — owner memberships (including trigger-created ones
 * with auth_user_id=null) must NOT be picked up here.
 */
export async function getActiveMemberMembershipByEmail(
  email: string
): Promise<{ id: string; operator_id: string; auth_user_id: string | null } | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("operator_memberships")
    .select("id, operator_id, auth_user_id")
    .eq("email", email)
    .eq("status", "active")
    .eq("role", "member")
    .order("accepted_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const row = data[0] as { id: string; operator_id: string; auth_user_id: string | null };
  return row;
}

/**
 * Returns the most recently accepted active membership for a given Supabase
 * auth user ID. Used by resolveOperatorContext() to route invited team members
 * into the correct operator context without creating an orphan operators row.
 *
 * Query strategy:
 *   - Matches on auth_user_id (set at invite acceptance + backfill for existing owners).
 *   - New operators whose owner membership was created by the DB trigger have
 *     auth_user_id = null, so they return null here and fall through to the
 *     ensureOperatorForSession path (existing behavior preserved).
 *   - Orders by accepted_at DESC so the most recently accepted membership wins.
 *     Add a comment here when multi-venue switching is implemented — this is
 *     where the "which context to load" decision lives.
 */
export async function getActiveMembershipForAuthUser(
  authUserId: string
): Promise<{ operator_id: string; role: MembershipRole } | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("operator_memberships")
    .select("operator_id, role, accepted_at")
    .eq("auth_user_id", authUserId)
    .eq("status", "active")
    // 'member' < 'owner' alphabetically, so ascending role sort puts invited
    // team-member rows first. This ensures a user who is both a team member
    // (invited to another operator) and an owner (of their own account) always
    // resolves into the invited operator context. Most recently accepted wins
    // within the same role (handles future multi-venue).
    .order("role",        { ascending: true  })
    .order("accepted_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[getActiveMembershipForAuthUser]", error.message);
    return null;
  }

  if (!data || data.length === 0) return null;

  const row = data[0] as { operator_id: string; role: string };
  return {
    operator_id: row.operator_id,
    role: (row.role ?? "member") as MembershipRole,
  };
}

/**
 * Counts active + invited members for an operator.
 * Pending invites count toward the plan limit.
 */
export async function countOperatorMembers(operatorId: string): Promise<number> {
  const supabase = createAdminClient();

  const { count, error } = await supabase
    .from("operator_memberships")
    .select("id", { count: "exact", head: true })
    .eq("operator_id", operatorId)
    .in("status", ["active", "invited"]);

  if (error) {
    console.error("[countOperatorMembers]", error.message);
    return 0;
  }

  return count ?? 0;
}
