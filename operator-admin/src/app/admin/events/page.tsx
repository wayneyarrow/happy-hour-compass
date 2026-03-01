// Always fetch fresh data — bypasses Next.js full-route and router caches.
export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import Link from "next/link";
import EventForm from "./EventForm";
import type { EventRow } from "./EventForm";

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

  // Load this operator's single venue.
  const { data: venueData, error: venueError } = operator
    ? await supabase
        .from("venues")
        .select("id, name")
        .eq("created_by_operator_id", operator.id)
        .maybeSingle()
    : { data: null, error: null };

  const venue = venueData as { id: string; name: string } | null;

  // Load the operator's first event (v1: one event per operator).
  // Ownership enforced by created_by_operator_id — no venue join needed.
  const { data: eventData, error: eventError } =
    operator && venue
      ? await supabase
          .from("events")
          .select(
            "id, title, description, event_time, event_frequency, is_published, venue_id, created_by_operator_id"
          )
          .eq("created_by_operator_id", operator.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
      : { data: null, error: null };

  const initialEvent = eventData as EventRow | null;

  return (
    <div className="max-w-2xl">
      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Events</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage your recurring event details.
        </p>
      </div>

      {/* Operator error */}
      {operatorError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Account error:</strong> {operatorError}
        </div>
      )}

      {/* Venue fetch error */}
      {venueError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Error loading venue:</strong> {venueError.message}
        </div>
      )}

      {/* No venue yet */}
      {!operatorError && !venueError && operator && !venue && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-700">
            No venue set up yet
          </p>
          <p className="text-xs text-gray-400 mt-1 mb-4">
            Set up your venue before adding an event.
          </p>
          <Link
            href="/admin/venue"
            className="text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
          >
            Go to Venue →
          </Link>
        </div>
      )}

      {/* Non-fatal event load error — let the user create a new one anyway */}
      {operator && venue && eventError && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
          <strong>Note:</strong> Could not load existing event data. You can
          still fill in the form to create one.
        </div>
      )}

      {/* Event form */}
      {!operatorError && operator && venue && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <EventForm
            initialEvent={initialEvent}
            operatorId={operator.id}
            venueId={venue.id}
          />
        </div>
      )}
    </div>
  );
}
