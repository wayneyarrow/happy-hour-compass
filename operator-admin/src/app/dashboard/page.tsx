import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SignOutButton from "./SignOutButton";

// This is a Server Component.
// The middleware already redirects unauthenticated users, but we double-check
// here so the page is safe even if middleware is ever bypassed.
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Simple DB connectivity check — fetch the 10 most recent venues.
  // Returns an empty array if the table exists but has no rows yet.
  const { data: venues, error: venuesError } = await supabase
    .from("venues")
    .select("id, name, slug, is_published, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            Happy Hour Compass
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Operator Admin Portal</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600 hidden sm:block">
            {user.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      {/* Body */}
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">
            Welcome back. More features are on the way.
          </p>
        </div>

        {/* Auth status card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Session
          </h3>
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-gray-500 w-20 shrink-0">User ID</dt>
              <dd className="text-gray-800 font-mono break-all">{user.id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-500 w-20 shrink-0">Email</dt>
              <dd className="text-gray-800">{user.email}</dd>
            </div>
          </dl>
        </div>

        {/* Venues table / DB check */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Venues (DB connectivity check)
          </h3>

          {venuesError ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <strong>Query error:</strong> {venuesError.message}
              <p className="mt-1 text-xs text-red-500">
                Make sure you have run the SQL migration and that RLS policies
                allow authenticated reads.
              </p>
            </div>
          ) : venues && venues.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {venues.map((v) => (
                <li
                  key={v.id}
                  className="py-2 flex items-center justify-between text-sm"
                >
                  <span className="text-gray-800 font-medium">{v.name}</span>
                  <div className="flex items-center gap-3 text-gray-400">
                    <span className="font-mono text-xs">/{v.slug}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        v.is_published ? "bg-green-400" : "bg-gray-300"
                      }`}
                      title={v.is_published ? "Published" : "Draft"}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">
              No venues yet —{" "}
              <span className="text-green-600 font-medium">
                database connection is working.
              </span>{" "}
              Add venues via the Supabase dashboard or future admin UI.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
