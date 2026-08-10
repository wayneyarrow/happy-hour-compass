import { resolveOperatorContext } from "@/lib/impersonation";
import { resolveOperatorVenueOrigin, type OperatorVenueOrigin } from "./gettingStartedOrigin";

/**
 * Resolves the current Operator Admin user's venue-origin for the Getting
 * Started guide. Mirrors the operator/impersonation venue-lookup pattern
 * already used in app/admin/home/page.tsx and app/admin/subscription/page.tsx
 * (query by created_by_operator_id, or by impersonatingVenueId in Case B
 * impersonation) rather than introducing a new lookup path.
 */
export async function getOperatorVenueOrigin(): Promise<{
  origin: OperatorVenueOrigin;
  venueName: string | null;
}> {
  const ctx = await resolveOperatorContext();
  const { operator, isImpersonating, impersonatingVenueId } = ctx;

  let venue: { source: string | null; name: string | null } | null = null;

  if (operator) {
    const { data } = await ctx.supabase
      .from("venues")
      .select("source, name")
      .eq("created_by_operator_id", operator.id)
      .maybeSingle();
    venue = data as { source: string | null; name: string | null } | null;
  } else if (isImpersonating && impersonatingVenueId) {
    const { data } = await ctx.supabase
      .from("venues")
      .select("source, name")
      .eq("id", impersonatingVenueId)
      .maybeSingle();
    venue = data as { source: string | null; name: string | null } | null;
  }

  return {
    origin: resolveOperatorVenueOrigin(venue?.source),
    venueName: venue?.name ?? null,
  };
}
