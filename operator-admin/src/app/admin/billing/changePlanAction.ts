"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { getMembershipRole } from "@/lib/memberships";
import { updateOperatorPlan } from "@/lib/subscriptions";
import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";
import { revalidatePath } from "next/cache";

export async function changePlanAction(
  operatorId: string,
  newPlan: OperatorPlan
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await resolveOperatorContext();

  if (!ctx.operator && !ctx.isImpersonating) {
    return { ok: false, error: "Not authenticated." };
  }

  // For non-impersonation sessions, verify the caller is in this operator's context.
  if (!ctx.isImpersonating && ctx.operator?.id !== operatorId) {
    return { ok: false, error: "Unauthorized." };
  }

  // Plan changes are owner-only. Members may view the subscription page but
  // cannot change the plan. Impersonation sessions bypass this check.
  if (!ctx.isImpersonating) {
    const userEmail = ctx.user?.email;
    if (!userEmail) return { ok: false, error: "Could not determine current user." };

    const role = await getMembershipRole(operatorId, userEmail);
    if (role !== "owner") {
      return { ok: false, error: "Only the account owner can change the plan." };
    }
  }

  const result = await updateOperatorPlan(operatorId, parseOperatorPlan(newPlan));

  if (result.ok) {
    revalidatePath("/admin/billing");
  }

  return result;
}
