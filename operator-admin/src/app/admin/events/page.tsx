import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import Link from "next/link";

// Minimal shape expected from the events table.
// If the table doesn't exist yet, eventsError will be set and we show an empty state.
type EventRow = {
  id: string;
  name: string;
  status: string | null;
  recurrence_type: string | null;
};

// Server Component — resolves auth, operator, venue, and events before rendering.
// Ownership is enforced via the venue relationship:
//   operator → venue (created_by_operator_id) → events (venue_id)
export default async function AdminEventsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );

  // Load this operator's venue — enforces ownership at the venue layer.
  const { data: venue, error: venueError } = operator
    ? await supabase
        .from("venues")
        .select("id, name")
        .eq("created_by_operator_id", operator.id)
        .maybeSingle()
    : { data: null, error: null };

  // Load events scoped to this venue.
  // If the events table doesn't exist yet, eventsError captures that gracefully.
  const { data: eventsData, error: eventsError } = venue
    ? await supabase
        .from("events")
        .select("id, name, status, recurrence_type")
        .eq("venue_id", venue.id)
        .order("created_at", { ascending: false })
    : { data: null, error: null };

  const events = (eventsData ?? []) as EventRow[];

  return (
    <div className="max-w-3xl">
      {/* Page heading */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Events</h2>
          {venue?.name && (
            <p className="text-sm text-gray-500 mt-1">{venue.name}</p>
          )}
        </div>
        {venue && (
          <Link
            href="/admin/events/new"
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors"
          >
            + Add event
          </Link>
        )}
      </div>

      {/* Operator error */}
      {operatorError && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
          <strong>Account issue:</strong> {operatorError}
        </div>
      )}

      {/* Venue fetch error */}
      {venueError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <strong>Error loading venue:</strong> {venueError.message}
        </div>
      )}

      {/* No venue yet */}
      {!operatorError && !venueError && operator && !venue && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-700">No venue set up yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">
            Set up your venue first before adding events.
          </p>
          <Link
            href="/admin/venue"
            className="text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
          >
            Go to Venue →
          </Link>
        </div>
      )}

      {/* Events table or empty state */}
      {!operatorError && venue && (
        <>
          {/* Events table fetch error (e.g. table doesn't exist yet) */}
          {eventsError && (
            <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
              <p className="text-sm font-medium text-gray-600">
                Events management is coming soon.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                The events feature is not yet fully set up.
              </p>
            </div>
          )}

          {/* Empty state — table exists but no events */}
          {!eventsError && events.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
              <p className="text-sm font-medium text-gray-600">No events yet</p>
              <p className="text-xs text-gray-400 mt-1 mb-4">
                Add your first event to get started.
              </p>
              <Link
                href="/admin/events/new"
                className="text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
              >
                + Add your first event
              </Link>
            </div>
          )}

          {/* Events table */}
          {!eventsError && events.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">
                      Recurrence
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {events.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {event.name}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                        {event.recurrence_type ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            event.status === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {event.status ?? "Draft"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/events/${event.id}/edit`}
                          className="text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
