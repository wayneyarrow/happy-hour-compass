import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { redirect } from "next/navigation";
import Image from "next/image";
import ControlPanelSideNav from "./ControlPanelSideNav";
import SignOutButton from "@/app/dashboard/SignOutButton";

/**
 * Admin Control Panel shell layout — wraps every page under /control-panel/*.
 *
 * Access gate (two layers):
 *   1. Middleware: redirects unauthenticated users to /login.
 *   2. Here: checks the CONTROL_PANEL_ADMIN_EMAILS allowlist. Authenticated
 *      users who are not CP admins are redirected away silently.
 */
export default async function ControlPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Layer 1: must be authenticated
  if (!user) {
    redirect("/login");
  }

  // Layer 2: must be a Control Panel admin
  if (!isControlPanelAdmin(user.email)) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
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
            <span className="text-xs font-medium text-amber-600 tracking-wide uppercase">
              Admin Control Panel
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600 hidden sm:block">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      {/* ── Sidebar + content ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <ControlPanelSideNav />
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
