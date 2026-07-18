"use server";

import { createClient } from "@/lib/supabase/server";
import { completeOperatorAccountActivation } from "@/lib/operatorActivation";

/**
 * Called by the create-password page immediately after a successful
 * supabase.auth.updateUser({ password }) call.
 *
 * Identity is resolved by asking Supabase Auth to verify the access token the
 * caller passes in (supabase.auth.getUser(accessToken)) — NOT by reading the
 * cookie-based session via a bare getUser() call with no argument. The
 * browser client's cookie write from the just-completed setSession()/
 * updateUser() calls is not guaranteed to have propagated to this request by
 * the time it's dispatched; a bare getUser() read the stale/absent cookie,
 * silently resolved no user, and skipped the activation notification
 * entirely with no error surfaced anywhere. Verifying an explicit token is
 * immune to that timing gap and no less secure — Supabase Auth validates the
 * token server-side; it is not client-trusted data.
 */
export async function completeAccountSetupAction(
  accessToken: string
): Promise<{ ok: boolean }> {
  if (!accessToken) {
    console.error("[completeAccountSetupAction] No access token provided.");
    return { ok: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    console.error(
      "[completeAccountSetupAction] Could not resolve user from access token.",
      { error: error?.message }
    );
    return { ok: false };
  }

  try {
    await completeOperatorAccountActivation({ operatorId: user.id });
  } catch (err) {
    console.error("[completeAccountSetupAction] Unexpected error:", err);
  }

  return { ok: true };
}
