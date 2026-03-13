"use server";

import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";

/**
 * Server-side allowlist check for the Control Panel login page.
 *
 * Called immediately after a successful signInWithPassword so the
 * CONTROL_PANEL_ADMIN_EMAILS env var (server-only, no NEXT_PUBLIC_ prefix)
 * can be read. Returns true only if the current session email is allowlisted.
 */
export async function checkIsControlPanelAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return false;
  return isControlPanelAdmin(user.email);
}
