import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth callback route — handles Supabase PKCE code exchange.
 *
 * Supabase redirects here after verifying an invite / recovery / magic-link
 * token. The `code` query parameter contains the PKCE exchange code.
 *
 * Expected URL shape:
 *   /auth/callback?code=<pkce_code>&next=<destination_path>
 *
 * On success: exchanges the code for a session (sets auth cookies) and
 *   redirects to `next` (defaults to /admin/venue).
 * On failure: redirects to / with ?error=auth_callback_failed so the
 *   consumer home is shown rather than a blank page.
 *
 * The `next` parameter is validated to be a relative path only to prevent
 * open-redirect attacks.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Only allow relative paths for `next` to prevent open redirects.
  const rawNext = searchParams.get("next") ?? "/admin/venue";
  const next = rawNext.startsWith("/") ? rawNext : "/admin/venue";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error("[auth/callback] Code exchange failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/?error=auth_callback_failed`);
}
