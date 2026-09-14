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

/**
 * Builds the INSERT payload for an already-activated operator's additional
 * (second-or-later) venue — used by createVenueAdminAction()
 * (app/admin/venue/actions.ts). Extracted as a pure function purely so this
 * shape is unit-testable: createVenueAdminAction() itself has no DI seam
 * (resolveOperatorContext() + a real Supabase client, same as every other
 * flow-specific action in this codebase — see
 * tests/unit/operatorActivation/operatorActivationObservability.test.ts's
 * header for the established "no DI seam, not unit-tested directly"
 * convention this mirrors).
 *
 * `is_verified: true` mirrors provisionOperatorForVenue()'s atomic
 * claimed_by/claimed_at/created_by_operator_id/is_verified UPDATE
 * (src/lib/operatorActivation.ts) for an operator's FIRST venue — see that
 * action's own call site comment for the full reasoning. `operatorId` must
 * come from a server-resolved OperatorContext.operator.id (never client
 * input) at the call site; this function has no way to target an existing
 * venue at all — it only ever describes a brand-new row.
 */
export function buildAdditionalVenueInsertPayload(params: {
  operatorId: string;
  name: string;
  slug: string;
}): {
  name: string;
  slug: string;
  created_by_operator_id: string;
  updated_by_operator_id: string;
  is_verified: true;
} {
  return {
    name: params.name,
    slug: params.slug,
    created_by_operator_id: params.operatorId,
    updated_by_operator_id: params.operatorId,
    is_verified: true,
  };
}
