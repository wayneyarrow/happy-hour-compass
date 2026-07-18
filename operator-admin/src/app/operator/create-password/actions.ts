"use server";

import { createClient } from "@/lib/supabase/server";
import { completeOperatorAccountActivation } from "@/lib/operatorActivation";

/**
 * Called by the create-password page immediately after a successful
 * supabase.auth.updateUser({ password }) call. Resolves the operator from
 * the caller's own session (cookie-based, set by the browser client during
 * the recovery/session exchange) — never trusts a client-supplied id.
 *
 * Fires the shared one-time "operator account activated" notification via
 * completeOperatorAccountActivation(), which no-ops on every call after the
 * first for a given operator (see migration 067). Never throws — a
 * notification failure must not block the operator from reaching /admin/home.
 */
export async function completeAccountSetupAction(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false };
  }

  try {
    await completeOperatorAccountActivation({ operatorId: user.id });
  } catch (err) {
    console.error("[completeAccountSetupAction] Unexpected error:", err);
  }

  return { ok: true };
}
