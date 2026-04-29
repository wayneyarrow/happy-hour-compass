/**
 * POST /api/impersonate/start
 *
 * Creates a Control Panel → Operator Admin impersonation session.
 * Invoked by a plain HTML <form method="post" target="_blank"> on the CP
 * venue detail page — no client JS needed, no popup-blocker issues.
 *
 * Security:
 *   • Caller must be authenticated (Supabase Auth session cookie)
 *   • Caller must be in CONTROL_PANEL_ADMIN_EMAILS allowlist
 *   • venue_id is validated against the DB before session creation
 *   • The session ID is set as an httpOnly cookie (not in the URL)
 *   • Cookie is Secure in production, SameSite=Lax
 *
 * On success: sets imp_session_id cookie and redirects to /admin/venue
 * On failure: redirects to /control-panel/venues with an error param
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import {
  createImpersonationSession,
  IMP_COOKIE_NAME,
  SESSION_DURATION_MS,
} from "@/lib/impersonation";

export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const errorRedirect = `${origin}/control-panel/venues?imp_error=1`;

  // ── 1. Authenticate ─────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(errorRedirect, { status: 303 });
  }

  // ── 2. Verify CP allowlist ──────────────────────────────────────────────────
  if (!isControlPanelAdmin(user.email)) {
    console.error(
      "[impersonate/start] Access denied — not a CP admin:",
      user.email
    );
    return NextResponse.redirect(errorRedirect, { status: 303 });
  }

  // ── 3. Parse venue_id from form body ───────────────────────────────────────
  let venueId: string | null = null;
  try {
    const body = await request.formData();
    venueId = (body.get("venue_id") as string | null)?.trim() ?? null;
  } catch {
    return NextResponse.redirect(errorRedirect, { status: 303 });
  }

  if (!venueId) {
    return NextResponse.redirect(errorRedirect, { status: 303 });
  }

  // ── 4. Verify venue exists and resolve operator_id ─────────────────────────
  const adminClient = createAdminClient();
  const { data: venue } = await adminClient
    .from("venues")
    .select("id, created_by_operator_id")
    .eq("id", venueId)
    .maybeSingle();

  if (!venue) {
    console.error("[impersonate/start] Venue not found:", venueId);
    return NextResponse.redirect(errorRedirect, { status: 303 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const operatorId = (venue as Record<string, any>).created_by_operator_id as string | null;

  // ── 5. Create impersonation session ────────────────────────────────────────
  const { sessionId, error } = await createImpersonationSession({
    founderEmail: user.email!,
    founderUserId: user.id,
    venueId,
    operatorId,
  });

  if (error || !sessionId) {
    console.error("[impersonate/start] Session creation failed:", error);
    return NextResponse.redirect(errorRedirect, { status: 303 });
  }

  // ── 6. Set httpOnly cookie and redirect to Operator Admin ──────────────────
  const response = NextResponse.redirect(`${origin}/admin/venue`, {
    status: 303,
  });

  response.cookies.set(IMP_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000), // seconds
    path: "/",
  });

  return response;
}
