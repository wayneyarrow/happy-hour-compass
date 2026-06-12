"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { getMembershipRole } from "@/lib/memberships";
import { updateOperatorPlan, getOperatorPlanCode } from "@/lib/subscriptions";
import { parseOperatorPlan, PLAN_LABELS, type OperatorPlan } from "@/lib/plans";
import { revalidatePath } from "next/cache";
import { addSystemVenueNote } from "@/lib/data/venueNotes";
import { logAuditEvent } from "@/lib/auditLog";
import { logPlanChangeEvent } from "@/lib/planChangeEvents";

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

  const oldPlan = await getOperatorPlanCode(operatorId);
  const result  = await updateOperatorPlan(operatorId, parseOperatorPlan(newPlan));

  if (result.ok) {
    revalidatePath("/admin/subscription");
    const actorEmail = ctx.user?.email ?? ctx.operator?.email ?? null;
    await addSystemVenueNote(
      operatorId,
      `Subscription changed from ${PLAN_LABELS[oldPlan]} to ${PLAN_LABELS[parseOperatorPlan(newPlan)]} by ${actorEmail ?? "unknown"}.`,
      actorEmail
    );
    await logAuditEvent({
      actorEmail: actorEmail ?? "unknown",
      action:     "plan_changed",
      entityType: "operator",
      entityId:   operatorId,
      entityName: ctx.operator?.email ?? ctx.user?.email ?? null,
      details: {
        from: PLAN_LABELS[oldPlan]                    ?? oldPlan,
        to:   PLAN_LABELS[parseOperatorPlan(newPlan)] ?? newPlan,
      },
    });
    await logPlanChangeEvent({
      operatorId,
      fromPlan:       oldPlan,
      toPlan:         parseOperatorPlan(newPlan),
      changedByEmail: actorEmail,
      trigger:        ctx.isImpersonating ? "impersonation" : "manual_admin",
    });
  }

  return result;
}
