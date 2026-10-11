import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";

/**
 * Founder Control Panel authorization — the check every /control-panel page
 * (and the layout) runs FIRST, before reading or rendering anything.
 *
 * Why every page, not just the layout: Next.js renders a layout and its page
 * concurrently. A layout-only redirect() sets the response to 307, but the
 * page may already have rendered — and its RSC payload was still sent in the
 * redirect body (and in full, with a 200 + NEXT_REDIRECT, for client
 * navigation requests). Found in October 2026: unauthenticated requests to
 * Control Panel pages returned operator, claim and venue data. Calling this
 * at the top of the page means a non-admin request never reaches a data read.
 *
 * Eligibility is unchanged: isControlPanelAdmin() (active platform_admins
 * row, or the CONTROL_PANEL_ADMIN_EMAILS fallback). Fails closed: any error
 * while reading the session or checking eligibility is treated as "not
 * authorized". Server actions keep their own per-action checks (they are
 * callable independently of any page).
 */

export type ControlPanelAdmin = { userId: string; email: string };

export type ControlPanelAccess =
  | { ok: true; admin: ControlPanelAdmin }
  | { ok: false; reason: "no_session" | "not_admin" | "error"; redirectTo: "/control-panel-login" | "/" };

export type ControlPanelAccessDeps = {
  getUser: () => Promise<{ id: string; email?: string | null } | null>;
  isAdmin: (email: string) => Promise<boolean>;
};

async function defaultGetUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ? { id: data.user.id, email: data.user.email } : null;
}

const DEFAULT_DEPS: ControlPanelAccessDeps = { getUser: defaultGetUser, isAdmin: isControlPanelAdmin };

/** Pure decision (dependency-injectable for tests). Never throws. */
export async function resolveControlPanelAccess(deps: ControlPanelAccessDeps = DEFAULT_DEPS): Promise<ControlPanelAccess> {
  let user: { id: string; email?: string | null } | null;
  try {
    user = await deps.getUser();
  } catch {
    return { ok: false, reason: "error", redirectTo: "/control-panel-login" };
  }
  if (!user || !user.email) return { ok: false, reason: "no_session", redirectTo: "/control-panel-login" };
  let allowed = false;
  try {
    allowed = await deps.isAdmin(user.email);
  } catch {
    return { ok: false, reason: "error", redirectTo: "/" };
  }
  if (!allowed) return { ok: false, reason: "not_admin", redirectTo: "/" };
  return { ok: true, admin: { userId: user.id, email: user.email } };
}

/**
 * Returns the signed-in Control Panel admin, or redirects (logged out →
 * /control-panel-login; not an admin or any error → /). Deduplicated per
 * request, so the layout and the page share one check.
 */
export const requireControlPanelAdmin = cache(async (): Promise<ControlPanelAdmin> => {
  const access = await resolveControlPanelAccess();
  if (!access.ok) {
    console.error(`[ControlPanel] Access denied (${access.reason}) — redirecting to ${access.redirectTo}.`);
    redirect(access.redirectTo);
  }
  return access.admin;
});
