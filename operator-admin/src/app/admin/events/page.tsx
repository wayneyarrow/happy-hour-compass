// Always fetch fresh data — bypasses Next.js full-route and router caches.
export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext, assertActiveVenueSelected } from "@/lib/impersonation";
import { parseOperatorPlan } from "@/lib/plans";
import { getMembershipRole } from "@/lib/memberships";
import EventsManager from "./EventsManager";
import EmptyState from "@/components/EmptyState";
import type { EventRow } from "./EventForm";

export default async function AdminEventsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await resolveOperatorContext();
  const { operator, operatorError, isImpersonating } = ctx;

  // Redirects to /admin/select-venue if this operator owns 2+ venues and
  // hasn't chosen one yet. No-op otherwise (0/1 venues, or impersonating).
  assertActiveVenueSelected(ctx);

  const currentEmail = user.email ?? operator?.email ?? "";
  const currentRole = operator ? await getMembershipRole(operator.id, currentEmail) : null;
  const isOwner = isImpersonating || currentRole === "owner";

  // Load the active venue — server-validated by resolveOperatorContext().
  let venueData: { id: string; name: string } | null = null;
  let venueError: { message: string } | null = null;

  if (ctx.activeVenueId) {
    let query = ctx.supabase.from("venues").select("id, name").eq("id", ctx.activeVenueId);
    if (operator) {
      query = query.eq("created_by_operator_id", operator.id);
    }
    const { data, error } = await query.maybeSingle();
    venueData = data as { id: string; name: string } | null;
    venueError = error as { message: string } | null;
  }

  const venue = venueData;

  // True only for founder impersonation of an unclaimed venue (Case B) —
  // mirrors the isUnclaimedVenueSupportMode check in saveEventAction, so the
  // client-side recurrence picker isn't gated when the server would actually
  // allow support-mode recurring event creation. Always false for claimed-
  // venue impersonation (Case A) and normal operator logins.
  const isUnclaimedVenueSupportMode = isImpersonating && !operator;

  // Events are manageable whenever a venue was resolved above — either a
  // claimed venue owned by the current operator (Case A / normal login), or
  // an unassigned venue under founder impersonation (Case B, operator is
  // null but the venue lookup above still succeeded via impersonatingVenueId).
  // EventsManager/EventForm and the save/delete actions handle a null
  // operator explicitly (see actions.ts) — no separate founder UI needed.
  const canManageEvents = !!venue;

  const { data: eventsData, error: eventsError } =
    canManageEvents
      ? await ctx.supabase
          .from("events")
          .select(
            "id, title, description, event_type, first_date, start_time, end_time, recurrence, " +
            "event_time, event_frequency, is_published, venue_id, image_url, " +
            "created_by_operator_id, updated_by_operator_id, updated_at, " +
            "ticketing_enabled, ticket_url, sold_out, is_seeded_event, " +
            "price_display, age_restriction, reservation_recommendation, parking_notes, accessibility_notes"
          )
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
        <div className="bg-white rounded-xl border border-gray-200 shadow-resting">
          <EmptyState
            title="No venue set up yet"
            description="Set up your venue before adding events."
            cta={{ label: "Go to Venue →", href: "/admin/venue" }}
          />
        </div>
      )}

      {/* Non-fatal event load error */}
      {canManageEvents && eventsError && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
          <strong>Note:</strong> Could not load existing events. You can still
          create a new one.
        </div>
      )}

      {/* Events manager — list + form. Ownership scoping (Case A operator vs.
          Case B founder impersonation of an unassigned venue) is resolved
          server-side inside the save/delete/image actions via
          resolveOperatorContext() — no operator id needs to cross the wire. */}
      {!operatorError && canManageEvents && (
        <EventsManager
          initialEvents={initialEvents}
          venueId={venue!.id}
          operatorPlan={parseOperatorPlan(operator?.plan)}
          isOwner={isOwner}
          isUnclaimedVenueSupportMode={isUnclaimedVenueSupportMode}
        />
      )}
    </div>
  );
}
