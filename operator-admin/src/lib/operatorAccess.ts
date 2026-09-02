import { createAdminClient } from "@/lib/supabase/server";
import { getActiveMemberMembershipByEmail } from "@/lib/memberships";

/**
 * Returns whether a given email has Business/Operator account access —
 * either as an operator owner (a row in `operators`) or an active invited
 * team member (a `role='member'` row in `operator_memberships`).
 *
 * Mirrors the exact account-existence check `forgotPasswordAction`
 * (src/app/forgot-password/actions.ts) already performs before generating a
 * recovery link — extracted here so the same determination can be reused by
 * the Business Login wrong-context check and the Consumer-recovery
 * business-continuation check (src/lib/postAuthAccess.ts) without
 * duplicating the two-step lookup.
 *
 * Uses the admin client — `operator_memberships` has RLS enabled with no
 * permissive self-read policy (see memberships.ts's header comment), so a
 * session-scoped client cannot see member rows at all.
 *
 * Server-only. Never import from a Client Component.
 */
export async function hasOperatorAccess(email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const supabase = createAdminClient();

  const { data: operatorRow } = await supabase
    .from("operators")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (operatorRow?.id) return true;

  const membership = await getActiveMemberMembershipByEmail(normalizedEmail);
  return !!membership;
}
