import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware runs on every request (except static assets).
 * Responsibilities:
 *   1. Refresh the Supabase session cookie so it doesn't expire mid-session.
 *   2. Redirect unauthenticated users away from /dashboard/* and /admin/* to /login.
 *   3. Redirect already-authenticated users away from /login to /admin/venue.
 *
 * Route protection boundaries:
 *   /admin/*         — Operator Admin. Middleware enforces authentication here.
 *   /control-panel/* — Admin Control Panel. NOT guarded by middleware; its own
 *                      layout.tsx handles both authentication and CP-admin allowlist.
 *   /activate-account — Public. No auth required.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          // First, reflect new cookies onto the request so downstream
          // server code can read them within this request cycle.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Then recreate the response with the updated request headers and
          // write the new cookies onto the response sent back to the browser.
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() validates the session with the Supabase Auth server.
  // Do NOT use getSession() here — it only reads from cookies and can be
  // spoofed; getUser() performs a network check.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Guard: unauthenticated users cannot access /dashboard or /admin.
  // /control-panel is intentionally excluded — it manages its own auth in layout.tsx.
  if (
    !user &&
    (pathname.startsWith("/dashboard") ||
      pathname.startsWith("/admin"))
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Guard: unauthenticated users cannot access consumer-only pages.
  if (!user && (pathname === "/account" || pathname === "/welcome")) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Convenience: authenticated *operators* visiting /login go straight to
  // admin. Consumer-only (or any other) authenticated users are allowed
  // through to see the login form — they must NOT be silently carried into
  // Operator Admin merely because they hold a valid Auth session elsewhere
  // (Consumer and Operator share one Auth identity store; see CLAUDE.md's
  // Authentication & Email section). This only checks the `operators` table
  // via the session client (RLS permits an operator's own self-read here —
  // see ensureOperator.ts's header comment); it does not check
  // `operator_memberships`, which has RLS enabled with no self-read policy
  // (see migration 037's RLS section) and would require the admin client to
  // query from here — deliberately not introduced into middleware, which
  // runs on every request; doing so would mean granting middleware a
  // privileged (service-role) DB client, a materially bigger change than
  // this convenience redirect warrants. Investigated 2026-09 (Casa de Frida
  // login-flow follow-up) and intentionally left as-is for that reason.
  //
  // That's an acceptable narrowing for THIS convenience redirect only: a
  // team-member-only operator without their own `operators` row simply won't
  // get the auto-redirect here and will see the login form again — neither
  // of the two DEFINITIVE checks has this gap, since both use the admin
  // client and correctly cover owner + member access via hasOperatorAccess()
  // (src/lib/operatorAccess.ts): the Business Login form's post-auth check
  // (src/lib/postAuthAccess.ts) and Operator Admin's own entry gate
  // (src/app/admin/layout.tsx's shouldBlockAdminAccess() check). A
  // member-only operator who submits the form, or navigates straight to
  // /admin/*, is correctly recognized either way.
  if (user && pathname === "/login" && user.email) {
    const { data: operatorRow } = await supabase
      .from("operators")
      .select("id")
      .eq("email", user.email)
      .maybeSingle();
    if (operatorRow) {
      const adminUrl = request.nextUrl.clone();
      adminUrl.pathname = "/admin/venue";
      return NextResponse.redirect(adminUrl);
    }
  }

  // Convenience: signed-in *consumers* visiting /sign-in or /sign-up go to /account.
  // Operators or any auth user without a consumer_profiles row are allowed through
  // so they can create a consumer account without being bounced to /account.
  if (user && (pathname === "/sign-in" || pathname === "/sign-up")) {
    const { data: consumerProfile } = await supabase
      .from("consumer_profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (consumerProfile) {
      const accountUrl = request.nextUrl.clone();
      accountUrl.pathname = "/account";
      return NextResponse.redirect(accountUrl);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
