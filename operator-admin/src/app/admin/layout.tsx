import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Image from "next/image";
import AdminSideNav from "./AdminSideNav";
import AdminMobileNav from "./AdminMobileNav";
import SignOutButton from "@/app/dashboard/SignOutButton";
import ImpersonationBanner from "./ImpersonationBanner";
import VenueSwitcher from "./VenueSwitcher";
import {
  IMP_COOKIE_NAME,
  getValidImpersonationSession,
  resolveOperatorContext,
} from "@/lib/impersonation";
import { updateOperatorLastSeen } from "@/lib/activityTracking";
import { hasOperatorAccess } from "@/lib/operatorAccess";
import { shouldBlockAdminAccess } from "@/lib/accessOutcome";

export const metadata: Metadata = {
  title: {
    template: "%s — Operator Admin",
    default: "Operator Admin — Happy Hour Compass",
  },
};

// Admin shell layout — wraps every page under /admin/*.
// Performs a server-side auth check so unauthenticated requests are caught
// here in addition to the middleware guard.
// When an active impersonation session cookie is present, renders the
// ImpersonationBanner above the header.
export default async function AdminLayout({
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

  // Fire-and-forget — conditionally updates last_seen_at at most once per hour.
  // The DB update is a no-op when called within the throttle window.
  void updateOperatorLastSeen(user.email!).catch(() => {});

  // Check for an active impersonation session to show the banner.
  const cookieStore = await cookies();
  const impSessionId = cookieStore.get(IMP_COOKIE_NAME)?.value;
  const impSession = impSessionId
    ? await getValidImpersonationSession(impSessionId)
    : null;

  // Authorization gate — a signed-in identity with no Business/Operator
  // access (owner OR active member) must never reach Operator Admin, and
  // critically must never reach resolveOperatorContext() below: its final
  // fallback (ensureOperatorForSession) auto-provisions a brand-new
  // `operators` row for ANY authenticated user with no existing operator or
  // membership row — a safety net for genuine operators whose owner row is
  // unexpectedly missing (see ensureOperator.ts's header comment), never
  // intended to silently turn a Consumer-only identity into an Operator
  // just because they navigated to /admin/*. Skipped during impersonation —
  // a Founder/CP-admin's own identity is never expected to have Business
  // access itself; that path is authorized separately via the impersonation
  // session cookie, not this check. Mirrors the same check already used at
  // the Business Login form (src/app/login/page.tsx) — see
  // src/lib/operatorAccess.ts's header comment.
  const isOperator = !!user.email && (await hasOperatorAccess(user.email));
  if (shouldBlockAdminAccess({ isImpersonating: !!impSession, hasOperatorAccess: isOperator })) {
    redirect("/login");
  }

  // Shared operator/venue context — also drives the venue switcher below.
  // Resolving it here (rather than a bespoke query) means the cancellation
  // check below is scoped to the operator's ACTIVE venue, not "any venue
  // this operator happens to own" — correct now that one operator can own
  // more than one venue (Phase 1 multi-venue support).
  const ctx = await resolveOperatorContext();

  // Venue cancellation check — skip during impersonation (CP admin can still
  // view) and skip when no active venue is resolved yet (operator owns 2+
  // venues and hasn't selected one — they're on /admin/select-venue, which
  // has nothing to cancel-check).
  let isVenueCancelled = false;
  if (!impSession && ctx.activeVenueId) {
    const { data: venueRow } = await supabase
      .from("venues")
      .select("cancelled_at")
      .eq("id", ctx.activeVenueId)
      .maybeSingle();
    isVenueCancelled = !!(venueRow as { cancelled_at: string | null } | null)?.cancelled_at;
  }

  // Cancelled venue: show farewell screen instead of normal shell.
  if (isVenueCancelled) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col">
        <header className="bg-white border-b border-slate-200 shadow-sm px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center">
            <Image src="/hhc-icon.png" alt="Happy Hour Compass logo" width={32} height={32} className="h-8 w-auto shrink-0" />
            <div className="ml-3 flex flex-col leading-tight">
              <span className="text-lg font-semibold text-slate-900">Happy Hour Compass</span>
              <span className="text-xs text-slate-500">Operator Admin</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 hidden sm:block">{user.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center space-y-4">
            <p className="text-3xl">👋</p>
            <h1 className="text-xl font-bold text-gray-900">Your venue account has been cancelled</h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              Your venue is no longer active on Happy Hour Compass. Historical data and claim history have been preserved.
            </p>
            <p className="text-sm text-gray-500">
              If you&rsquo;d like to reactivate your venue or have questions, please{" "}
              <a href="mailto:hello@happyhourcompass.com" className="text-amber-600 hover:underline">
                get in touch
              </a>
              .
            </p>
            <div className="pt-2">
              <SignOutButton />
            </div>
            <p className="text-xs text-gray-400">
              <a href="https://happyhourcompass.com" className="hover:underline">
                happyhourcompass.com
              </a>
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* ── Impersonation banner (shown above header when session is active) ── */}
      {impSession && (
        <ImpersonationBanner
          venueName={impSession.venue_name ?? "Unknown Venue"}
          operatorEmail={impSession.operator_email}
          founderEmail={impSession.founder_email}
        />
      )}

      {/* ── Top header ─────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 shadow-sm px-4 md:px-6 py-4 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center min-w-0 gap-3">
          {/* Hamburger — desktop AdminSideNav takes over at md: */}
          <AdminMobileNav />
          <Image
            src="/hhc-icon.png"
            alt="Happy Hour Compass logo"
            width={32}
            height={32}
            className="h-8 w-auto shrink-0"
          />
          <div className="min-w-0 flex flex-col leading-tight">
            <span className="text-lg font-semibold text-slate-900 truncate">Happy Hour Compass</span>
            <span className="text-xs text-slate-500 truncate">Operator Admin</span>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {/* Hidden during impersonation and for single-venue operators —
              see VenueSwitcher's own guard for the exact condition. */}
          <VenueSwitcher
            isImpersonating={ctx.isImpersonating}
            venues={ctx.venues}
            activeVenueId={ctx.activeVenueId}
          />
          <span className="text-sm text-gray-600 hidden sm:block">
            {user.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      {/* ── Sidebar + content ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <AdminSideNav />
        <main className="flex-1 overflow-y-auto bg-gray-100 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
