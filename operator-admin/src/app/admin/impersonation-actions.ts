"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { IMP_COOKIE_NAME, endImpersonationSession, getValidImpersonationSession } from "@/lib/impersonation";

/**
 * Server action: end the active impersonation session.
 *
 * Called by ImpersonationBanner via <form action={exitImpersonationAction}>.
 * Stamps ended_at on the DB row, clears the cookie, and redirects the
 * operator admin tab back to the Control Panel venues list.
 *
 * Requires: authenticated user who is a CP admin AND whose email matches
 * the founder_email stored on the impersonation session row.
 */
export async function exitImpersonationAction(): Promise<void> {
  // ── Auth + CP admin guard ─────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !await isControlPanelAdmin(user.email)) {
    redirect("/");
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(IMP_COOKIE_NAME)?.value;

  if (sessionId) {
    // Verify the session belongs to the caller before ending it.
    const session = await getValidImpersonationSession(sessionId);
    if (session && session.founder_email === user.email) {
      await endImpersonationSession(sessionId);
    }
    cookieStore.delete(IMP_COOKIE_NAME);
  }

  redirect("/control-panel/venues");
}
