import { resolveOperatorContext } from "@/lib/impersonation";
import { resolveOperatorVenueOrigin, type OperatorVenueOrigin } from "./gettingStartedOrigin";

/**
 * Resolves the current Operator Admin user's venue-origin for the Getting
 * Started guide. Uses the shared active-venue resolution
 * (resolveOperatorContext()'s activeVenueId) rather than an independent
 * created_by_operator_id lookup — an operator may own more than one venue,
 * so "the" venue is whichever one is currently active, not just any venue
 * that happens to match.
 */
export async function getOperatorVenueOrigin(): Promise<{
  origin: OperatorVenueOrigin;
  venueName: string | null;
}> {
  const ctx = await resolveOperatorContext();
  const { operator } = ctx;

  let venue: { source: string | null; name: string | null } | null = null;

  if (ctx.activeVenueId) {
    let query = ctx.supabase.from("venues").select("source, name").eq("id", ctx.activeVenueId);
    if (operator) {
      query = query.eq("created_by_operator_id", operator.id);
    }
    const { data } = await query.maybeSingle();
    venue = data as { source: string | null; name: string | null } | null;
  }

  return {
    origin: resolveOperatorVenueOrigin(venue?.source),
    venueName: venue?.name ?? null,
  };
}
