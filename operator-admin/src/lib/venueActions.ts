import type { OperatorContext } from "@/lib/impersonation";

/**
 * Builds a scoped Supabase UPDATE query for the venues table.
 *
 * Ownership scoping:
 *   Normal / Case A impersonation: filter by both venue id AND operator id.
 *   Case B impersonation (orphan):  filter by venue id only (no operator assigned).
 *
 * In impersonation mode ctx.supabase is the admin client (bypasses RLS).
 * The explicit filter ensures we never touch any venue other than the target.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVenueUpdate(
  ctx: OperatorContext,
  venueId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updates: Record<string, any>
) {
  const q = ctx.supabase
    .from("venues")
    .update(updates, { count: "exact" })
    .eq("id", venueId);
  return ctx.operator ? q.eq("created_by_operator_id", ctx.operator.id) : q;
}
