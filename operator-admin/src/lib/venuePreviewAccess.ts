import { resolveOperatorContext } from "@/lib/impersonation";

/**
 * Authorizes the current Operator Admin session to preview a specific
 * venue's public page — including when the venue is unpublished.
 *
 * Mirrors the exact ownership check already used by the Operator Admin
 * venue/home pages (created_by_operator_id for a normal or Case-A
 * impersonation session, impersonatingVenueId for a Case-B orphan-venue
 * founder session) rather than introducing a new authorization model.
 *
 * Reused by both the /api/preview/venue redirect route and the canonical
 * website venue page's own preview-mode gate, so a signed-out visitor or an
 * operator previewing someone else's venue can never see unpublished data.
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
