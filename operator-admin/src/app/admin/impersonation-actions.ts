"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IMP_COOKIE_NAME, endImpersonationSession } from "@/lib/impersonation";

/**
 * Server action: end the active impersonation session.
 *
 * Called by ImpersonationBanner via <form action={exitImpersonationAction}>.
 * Stamps ended_at on the DB row, clears the cookie, and redirects the
 * operator admin tab back to the Control Panel venues list.
 */
export async function exitImpersonationAction(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(IMP_COOKIE_NAME)?.value;

  if (sessionId) {
    await endImpersonationSession(sessionId);
    cookieStore.delete(IMP_COOKIE_NAME);
  }

  redirect("/control-panel/venues");
}
