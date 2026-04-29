// Always fetch fresh data — bypasses Next.js full-route and router caches.
export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import Link from "next/link";
import EventsManager from "./EventsManager";
import type { EventRow } from "./EventForm";

export default async function AdminEventsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await resolveOperatorContext();
  const { operator, operatorError, isImpersonating, impersonatingVenueId } = ctx;

  // Load venue — by operator ownership (normal/Case A) or directly by id (Case B).
  let venueData: { id: string; name: string } | null = null;
  let venueError: { message: string } | null = null;

  if (operator) {
    const { data, error } = await ctx.supabase
      .from("venues")
      .select("id, name")
      .eq("created_by_operator_id", operator.id)
      .maybeSingle();
    venueData = data as { id: string; name: string } | null;
    venueError = error as { message: string } | null;
  } else if (isImpersonating && impersonatingVenueId) {
    const { data, error } = await ctx.supabase
      .from("venues")
      .select("id, name")
      .eq("id", impersonatingVenueId)
      .maybeSingle();
    venueData = data as { id: string; name: string } | null;
    venueError = error as { message: string } | null;
  }

  const venue = venueData;

  // Events require an assigned operator (EventsManager uses operatorId for writes).
  // In Case B (orphan venue), show an informational message instead.
  const canManageEvents = !!operator && !!venue;

  const { data: eventsData, error: eventsError } =
    canManageEvents
      ? await ctx.supabase
          .from("events")
          .select("id, title, description, first_date, start_time, end_time, recurrence, event_time, event_frequency, is_published, venue_id, image_url, created_by_operator_id, updated_by_operator_id")
          .eq("venue_id", venue!.id)
          .order("first_date", { ascending: false })
          .order("title", { ascending: true })
      : { data: null, error: null };

  const initialEvents = (eventsData as EventRow[] | null) ?? [];

  return (
    <div>
      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Events</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage events for your venue.
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

      {/* No venue yet (normal mode only) */}
      {!operatorError && !venueError && operator && !venue && !isImpersonating && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-700">
            No venue set up yet
          </p>
          <p className="text-xs text-gray-400 mt-1 mb-4">
            Set up your venue before adding events.
          </p>
          <Link
            href="/admin/venue"
            className="text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
          >
            Go to Venue →
          </Link>
        </div>
      )}

      {/* Case B: venue found but no operator — event management unavailable */}
      {isImpersonating && !operator && venue && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-6 text-center">
          <p className="text-sm font-medium text-gray-700">
            Event management requires an operator to be assigned to this venue.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            This venue has no linked operator account. Assign an operator first.
          </p>
        </div>
      )}

      {/* Non-fatal event load error */}
      {canManageEvents && eventsError && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
          <strong>Note:</strong> Could not load existing events. You can still
          create a new one.
        </div>
      )}

      {/* Events manager — list + form (requires operator) */}
      {!operatorError && canManageEvents && (
        <EventsManager
          initialEvents={initialEvents}
          operatorId={operator!.id}
          venueId={venue!.id}
        />
      )}
    </div>
  );
}
