import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminSideNav from "./AdminSideNav";
import SignOutButton from "@/app/dashboard/SignOutButton";

// Admin shell layout — wraps every page under /admin/*.
// Performs a server-side auth check so unauthenticated requests are caught
// here in addition to the middleware guard.
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Top header ─────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <p className="text-lg font-bold text-gray-900">Happy Hour Compass</p>
          <p className="text-xs text-gray-400 mt-0.5">Operator Admin</p>
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
        <main className="flex-1 overflow-y-auto p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
