"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
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

  // For non-impersonation sessions, verify the caller owns this operator record.
  if (!ctx.isImpersonating && ctx.operator?.id !== operatorId) {
    return { ok: false, error: "Unauthorized." };
  }

  const result = await updateOperatorPlan(operatorId, parseOperatorPlan(newPlan));

  if (result.ok) {
    revalidatePath("/admin/billing");
  }

  return result;
}
