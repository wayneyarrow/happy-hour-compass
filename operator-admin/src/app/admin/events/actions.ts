"use server";

import { revalidatePath } from "next/cache";
import { resolveOperatorContext } from "@/lib/impersonation";

export async function deleteEventAction(eventId: string): Promise<void> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    throw new Error(ctx.operatorError ?? "Could not resolve operator.");
  }

  // Event management requires a known operator (Case B orphan venues have no operator).
  if (!ctx.operator) {
    throw new Error("Event management is not available in support mode for unassigned venues.");
  }

  const { error } = await ctx.supabase
    .from("events")
    .delete()
    .eq("id", eventId)
    .eq("created_by_operator_id", ctx.operator.id);

  if (error) {
    console.error("[deleteEventAction] Delete failed:", error);
    throw new Error("Failed to delete event.");
  }

  revalidatePath("/admin/events");
}
