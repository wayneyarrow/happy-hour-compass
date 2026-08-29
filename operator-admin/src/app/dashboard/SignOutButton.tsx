"use client";

import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { clearActiveVenueOnSignOutAction } from "@/app/admin/signOutActions";

export default function SignOutButton({
  redirectTo = "/login",
}: {
  redirectTo?: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    // Must run BEFORE supabase.auth.signOut() — this is a Next.js Server
    // Action, and middleware.ts redirects any unauthenticated request to
    // /admin/* (which is where this button always renders) straight to
    // /login before the action handler ever runs. Calling signOut() first
    // destroys the session the action's own request would need to reach the
    // server at all, so the cookie was silently never cleared (confirmed via
    // browser QA — the middleware's redirect response was swallowed by the
    // .catch() that used to sit here). Clearing the cookie first, while
    // still authenticated, avoids that race entirely.
    await clearActiveVenueOnSignOutAction().catch(() => {});
    await supabase.auth.signOut();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md border border-gray-200 hover:border-gray-400 transition-colors"
    >
      Sign Out
    </button>
  );
}
