import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasOperatorAccess } from "@/lib/operatorAccess";
import { shouldBlockAdminAccess } from "@/lib/accessOutcome";

/**
 * Shared authorization gate for the deprecated (but still routable)
 * /dashboard/venues/[id]/{edit,events,hours} pages.
 *
 * These pages are unlinked from the live app (superseded by /admin/*) but
 * each independently called ensureOperatorForSession() with no Business-
 * access check first — the same "any authenticated identity gets a
 * lazily-provisioned `operators` row just by reaching the page" gap already
 * closed for /admin/* (see src/app/admin/layout.tsx's header comment for
 * the full explanation of why that fallback exists and why it must never be
 * reached by a non-Operator identity). This layout closes it here too,
 * without touching ensureOperatorForSession, resolveOperatorContext, or any
 * of these pages' existing behavior.
 *
 * None of these three pages support impersonation (they call
 * ensureOperatorForSession directly, not resolveOperatorContext — no
 * imp_session_id cookie handling exists here), so unlike admin/layout.tsx
 * there is no impersonation case to exempt.
 *
 * Scoped to exactly this directory (not a top-level /dashboard/layout.tsx)
 * so it does not affect /dashboard (a deprecated redirect-only stub) or
 * /dashboard/venues/new, neither of which call ensureOperatorForSession.
 *
 * This is additive, not a replacement for each page's own `if (!user)
 * redirect("/login")` check — both are kept intentionally redundant.
 */
export default async function DashboardVenueLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const isOperator = !!user.email && (await hasOperatorAccess(user.email));
  if (shouldBlockAdminAccess({ isImpersonating: false, hasOperatorAccess: isOperator })) {
    redirect("/login");
  }

  return children;
}
