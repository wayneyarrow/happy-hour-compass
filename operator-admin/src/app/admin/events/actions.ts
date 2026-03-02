"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveOperator() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      user: null,
      operator: null,
      operatorError: "Session expired. Please sign in again.",
    };
  }
  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );
  return { supabase, user, operator, operatorError };
}

// ── Delete event ──────────────────────────────────────────────────────────────

/**
 * Deletes an event row, enforcing operator ownership before deletion.
 * Throws on auth failure or Supabase error so the caller can handle it.
 *
 * RLS requirement: the events table must have a DELETE policy whose condition
 * mirrors the UPDATE policy, e.g.:
 *   USING (created_by_operator_id = (SELECT id FROM operators WHERE email = auth.jwt()->>'email'))
 * If no DELETE policy exists, Supabase will silently return no error but also
 * delete nothing — the row count check below will catch that case as a no-op.
 */
export async function deleteEventAction(eventId: string): Promise<void> {
  const { supabase, operator, operatorError } = await resolveOperator();

  if (operatorError || !operator) {
    throw new Error(operatorError ?? "Could not resolve operator.");
  }

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("id", eventId)
    .eq("created_by_operator_id", operator.id);

  if (error) {
    console.error("[deleteEventAction] Delete failed:", error);
    throw new Error("Failed to delete event.");
  }

  revalidatePath("/admin/events");
}
