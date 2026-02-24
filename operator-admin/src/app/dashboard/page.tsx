import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { getOperatorVenues } from "@/lib/getOperatorVenues";
import { redirect } from "next/navigation";
import Link from "next/link";
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
      <div className="max-w-4xl mx-auto p-6 space-y-8">

        {/* Page heading */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage your venues and settings.
          </p>
        </div>

        {/* ── Your Venues (primary section) ────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800">
              Your venues
            </h3>
            {operator && (
              <Link
                href="/dashboard/venues/new"
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors"
              >
                + Add venue
              </Link>
            )}
          </div>

          {/* Operator error */}
          {operatorError && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <strong>Account issue:</strong> {operatorError}
            </div>
          )}

          {/* Venues error */}
          {venuesError && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <strong>Could not load venues.</strong>{" "}
              <span className="text-xs">{venuesError}</span>
            </div>
          )}

          {/* Empty state */}
          {!operatorError && !venuesError && operator && venues.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 py-12 px-6 flex flex-col items-center text-center gap-3">
              <p className="text-sm font-medium text-gray-600">
                No venues yet
              </p>
              <p className="text-xs text-gray-400 max-w-xs">
                Add your first venue to start managing your happy hours,
                business hours, and events.
              </p>
              <Link
                href="/dashboard/venues/new"
                className="mt-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Create your first venue
              </Link>
            </div>
          )}

          {/* Venue cards */}
          {!operatorError && !venuesError && venues.length > 0 && (
            <div className="space-y-4">
              {venues.map((v) => (
                <div
                  key={v.id}
                  className="bg-white rounded-xl border border-gray-200 p-5"
                >
                  {/* Venue header */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-gray-900 truncate">
                        {v.name}
                      </p>
                      {(v.city || v.region) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {[v.city, v.region].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full ${
                        v.is_published
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {v.is_published ? "Live" : "Draft"}
                    </span>
                  </div>

                  {/* Action groups */}
                  <div className="border-t border-gray-100 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Core setup */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        Core setup
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <Link
                          href={`/dashboard/venues/${v.id}/edit`}
                          className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-center"
                        >
                          Edit details
                        </Link>
                        <Link
                          href={`/dashboard/venues/${v.id}/hours`}
                          className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-center"
                        >
                          Business hours
                        </Link>
                      </div>
                    </div>

                    {/* Promotions & events */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        Promotions &amp; events
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <Link
                          href={`/dashboard/venues/${v.id}/happyhour`}
                          className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-center"
                        >
                          Happy hour
                        </Link>
                        <Link
                          href={`/dashboard/venues/${v.id}/events`}
                          className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-center"
                        >
                          Events
                        </Link>
                      </div>
                    </div>

                    {/* Content */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        Content
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <Link
                          href={`/dashboard/venues/${v.id}/media`}
                          className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-center"
                        >
                          Media
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Account (compact, secondary) ─────────────────────────────────── */}
        {operator && (
          <section>
            <h3 className="text-base font-semibold text-gray-800 mb-4">
              Account
            </h3>
            <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between gap-6">
              <dl className="space-y-1 text-sm">
                <div className="flex gap-2 items-center">
                  <dt className="text-gray-400 text-xs w-20 shrink-0">
                    Email
                  </dt>
                  <dd className="text-gray-700 text-sm">{operator.email}</dd>
                </div>
                <div className="flex gap-2 items-center">
                  <dt className="text-gray-400 text-xs w-20 shrink-0">
                    Status
                  </dt>
                  <dd>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        operator.is_approved
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {operator.is_approved ? "Approved" : "Pending approval"}
                    </span>
                  </dd>
                </div>
              </dl>
              <Link
                href="/dashboard/settings"
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                Account settings
              </Link>
            </div>
          </section>
        )}

      </div>
    </main>
  );
}
