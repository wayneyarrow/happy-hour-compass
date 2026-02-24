import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { getOperatorVenues } from "@/lib/getOperatorVenues";
import { redirect } from "next/navigation";
import SignOutButton from "./SignOutButton";

// Server Component — double-checked auth even though middleware already guards.
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Ensure an operators row exists for this user. Idempotent.
  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );

  // Fetch this operator's venues — only runs when we have a valid operator row.
  const { venues, error: venuesError } = operator
    ? await getOperatorVenues(supabase, operator.id)
    : { venues: [], error: null };

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

        {/* ── Operator Account ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Operator Account
          </h3>

          {operatorError ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <strong>No operator record found for this user.</strong>
              <p className="mt-1 text-xs text-amber-600">{operatorError}</p>
            </div>
          ) : operator ? (
            <dl className="space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-gray-500 w-24 shrink-0">Operator ID</dt>
                <dd className="text-gray-800 font-mono break-all">
                  {operator.id}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-500 w-24 shrink-0">Email</dt>
                <dd className="text-gray-800">{operator.email}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-500 w-24 shrink-0">Role</dt>
                <dd className="text-gray-800">{operator.role}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-500 w-24 shrink-0">Approved</dt>
                <dd>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      operator.is_approved
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {operator.is_approved ? "Yes" : "Pending"}
                  </span>
                </dd>
              </div>
            </dl>
          ) : null}
        </div>

        {/* ── Your Venues ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Your Venues
          </h3>

          {/* Operator row missing — can't scope venues query */}
          {!operator && !operatorError && null}

          {venuesError ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <strong>Could not load venues.</strong>
              <p className="mt-1 text-xs text-amber-600">{venuesError}</p>
            </div>
          ) : !operator ? (
            <p className="text-sm text-gray-400">
              Resolve the operator account issue above to see your venues.
            </p>
          ) : venues.length === 0 ? (
            /* Empty state */
            <div className="py-6 text-center">
              <p className="text-sm font-medium text-gray-500">No venues yet</p>
              <p className="text-xs text-gray-400 mt-1">
                You&rsquo;ll see your venues here once they&rsquo;re added.
              </p>
            </div>
          ) : (
            /* Venue list */
            <ul className="divide-y divide-gray-100">
              {venues.map((v) => (
                <li key={v.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{v.name}</p>
                    {(v.city || v.region) && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[v.city, v.region].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      v.is_published ? "bg-green-400" : "bg-gray-300"
                    }`}
                    title={v.is_published ? "Published" : "Draft"}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Auth Session ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Auth Session
          </h3>
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-gray-500 w-24 shrink-0">Auth User ID</dt>
              <dd className="text-gray-800 font-mono break-all">{user.id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-500 w-24 shrink-0">Email</dt>
              <dd className="text-gray-800">{user.email}</dd>
            </div>
          </dl>
        </div>
      </div>
    </main>
  );
}
