import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Image from "next/image";
import AdminSideNav from "./AdminSideNav";
import SignOutButton from "@/app/dashboard/SignOutButton";
import ImpersonationBanner from "./ImpersonationBanner";
import { IMP_COOKIE_NAME, getValidImpersonationSession } from "@/lib/impersonation";
import { updateOperatorLastSeen } from "@/lib/activityTracking";

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

  // Venue cancellation check — skip during impersonation (CP admin can still view).
  // Two lightweight indexed queries: operator by email → venue cancelled_at.
  let isVenueCancelled = false;
  if (!impSession) {
    const { data: opRow } = await supabase
      .from("operators")
      .select("id")
      .eq("email", user.email!)
      .maybeSingle();

    if (opRow) {
      const { data: venueRow } = await supabase
        .from("venues")
        .select("cancelled_at")
        .eq("created_by_operator_id", (opRow as { id: string }).id)
        .maybeSingle();
      isVenueCancelled = !!(venueRow as { cancelled_at: string | null } | null)?.cancelled_at;
    }
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
      <header className="bg-white border-b border-slate-200 shadow-sm px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center">
          <Image
            src="/hhc-icon.png"
            alt="Happy Hour Compass logo"
            width={32}
            height={32}
            className="h-8 w-auto shrink-0"
          />
          <div className="ml-3 flex flex-col leading-tight">
            <span className="text-lg font-semibold text-slate-900">Happy Hour Compass</span>
            <span className="text-xs text-slate-500">Operator Admin</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
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
