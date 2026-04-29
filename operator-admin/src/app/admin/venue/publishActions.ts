"use server";

import { resolveOperatorContext } from "@/lib/impersonation";

export async function updatePublishStatusAction(
  venueId: string,
  isPublished: boolean
): Promise<{ error: string | null }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const updates: Record<string, unknown> = {
    is_published: isPublished,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  let q = ctx.supabase
    .from("venues")
    .update(updates, { count: "exact" })
    .eq("id", venueId);

  if (ctx.operator) {
    q = q.eq("created_by_operator_id", ctx.operator.id);
  }

  const { error, count } = await q;

  if (error) {
    console.error("[updatePublishStatusAction] Update failed:", error);
    return { error: `Failed to save: ${error.message}` };
  }

  if (count === 0) {
    return { error: "Venue not found or you don't have permission to edit it." };
  }

  return { error: null };
}
