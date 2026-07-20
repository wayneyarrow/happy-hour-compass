import { resolveOperatorContext } from "@/lib/impersonation";

/**
 * Preview authorization helpers — one per previewable entity (venue, event).
 *
 * Both authorize the current Operator Admin session to view a specific
 * record's public page even when it's unpublished, and both are built on
 * the same rule: resolveOperatorContext() already resolves any active
 * operator session — owner or team member alike — into `ctx.operator`, so
 * "the operator associated with the record" and "an authorized team member
 * for that operator" are the same check (no separate role check is added
 * here, consistent with canPreviewVenue's existing behaviour). Founder
 * impersonation (Case B, orphan venues) is authorized separately via
 * ctx.impersonatingVenueId.
 *
 * Reused by both /api/preview/[entity] redirect routes and the canonical
 * website pages' own preview-mode gates, so a signed-out visitor or an
 * operator previewing someone else's record can never see unpublished data.
 */

/**
 * Authorizes the current session to preview a specific venue's public page.
 *
 * Mirrors the exact ownership check already used by the Operator Admin
 * venue/home pages (created_by_operator_id for a normal or Case-A
 * impersonation session, impersonatingVenueId for a Case-B orphan-venue
 * founder session) rather than introducing a new authorization model.
 */
export async function canPreviewVenue(venueId: string): Promise<boolean> {
  const ctx = await resolveOperatorContext();

  if (ctx.operator) {
    const { data } = await ctx.supabase
      .from("venues")
      .select("id")
      .eq("id", venueId)
      .eq("created_by_operator_id", ctx.operator.id)
      .maybeSingle();
    return !!data;
  }

  if (ctx.isImpersonating && ctx.impersonatingVenueId) {
    return ctx.impersonatingVenueId === venueId;
  }

  return false;
}

/**
 * Authorizes the current session to preview a specific event's public page.
 *
 * Events are owned directly (events.created_by_operator_id, stamped by
 * saveEventAction at creation — see admin/events/actions.ts) rather than
 * only through their venue, so this checks the event row itself, exactly
 * mirroring canPreviewVenue's structure against the events table instead
 * of venues. Case B impersonation is authorized via the event's venue_id
 * matching the impersonated venue, since a Case B session has no operator
 * row of its own to compare created_by_operator_id against.
 */
export async function canPreviewEvent(eventId: string): Promise<boolean> {
  const ctx = await resolveOperatorContext();

  if (ctx.operator) {
    const { data } = await ctx.supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("created_by_operator_id", ctx.operator.id)
      .maybeSingle();
    return !!data;
  }

  if (ctx.isImpersonating && ctx.impersonatingVenueId) {
    const { data } = await ctx.supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("venue_id", ctx.impersonatingVenueId)
      .maybeSingle();
    return !!data;
  }

  return false;
}
