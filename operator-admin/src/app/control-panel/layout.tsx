import type { Metadata } from "next";
import { requireControlPanelAdmin } from "@/lib/requireControlPanelAdmin";

export const metadata: Metadata = {
  title: {
    template: "%s — Control Panel",
    default: "Control Panel — Happy Hour Compass",
  },
  icons: { icon: "/hhc-icon.png" },
};
import Image from "next/image";
import ControlPanelSideNav from "./ControlPanelSideNav";
import SignOutButton from "@/app/dashboard/SignOutButton";

/**
 * Admin Control Panel shell layout — wraps every page under /control-panel/*.
 *
 * Access gate — three layers, the page-level check being authoritative:
 *   - middleware.ts: no session → /control-panel-login before anything renders
 *     (defense in depth; it can't check admin eligibility).
 *   - this layout and EVERY page: requireControlPanelAdmin() first —
 *       1. No session       → redirect /control-panel-login  (outside protected tree)
 *       2. Not allowlisted  → redirect /       (consumer home; no information leak)
 *       3. Allowlisted      → render
 *   - server actions: their own per-action admin check (independently callable).
 *
 * Allowlist: CONTROL_PANEL_ADMIN_EMAILS env var (comma or newline separated).
 * Ensure it is enabled for the Production environment in the Vercel dashboard.
 */
export default async function ControlPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Logged out → /control-panel-login; not an admin (or any error) → /.
  // Note: /control-panel-login lives OUTSIDE /control-panel/* to avoid the
  // layout wrapping the login page and creating a redirect loop.
  //
  // This layout gate is NOT sufficient on its own: Next.js renders the page
  // concurrently with the layout, so every page also calls
  // requireControlPanelAdmin() first (shared, cached per request) — see
  // src/lib/requireControlPanelAdmin.ts.
  const admin = await requireControlPanelAdmin();

  return (
    // h-screen (not min-h-screen) is required for the internal scroll model
    // below: <main> uses overflow-y-auto and its parent row uses
    // overflow-hidden so the header stays fixed and only the content area
    // scrolls. With min-h-screen, this outer container has no bounded
    // height, so on pages taller than one viewport it just grows past 100vh
    // and the whole window scrolls instead of <main> scrolling internally —
    // which breaks position: sticky for anything inside <main> (e.g. the
    // Content Engine guide form's completion checklist), since sticky tracks
    // its nearest ancestor's own scroll position, not the window's.
    <div className="h-screen bg-slate-100 flex flex-col">
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
          <span className="text-sm text-gray-600 hidden sm:block">{admin.email}</span>
          <SignOutButton redirectTo="/control-panel-login" />
        </div>
      </header>

      {/* ── Sidebar + content ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <ControlPanelSideNav />
        <main className="flex-1 overflow-y-auto bg-gray-100 p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
