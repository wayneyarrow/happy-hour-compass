"use server";

import { revalidatePath } from "next/cache";
import { resolveOperatorContext } from "@/lib/impersonation";

// Allowlist of review keys that can be confirmed via the "Mark reviewed" button.
// claimedReview_image is intentionally excluded — that's confirmed by uploading,
// not by clicking a button. All other claimed review tasks are included here.
const VALID_REVIEW_KEYS = new Set([
  "claimedReview_businessDetails",
  "claimedReview_venueType",
  "claimedReview_businessHours",
  "claimedReview_hhTimes",
  "claimedReview_hhSpecials",
  "claimedReview_menuLink",
  "claimedReview_website",
  "claimedReview_phone",
]);

type VenueReviewRow = { id: string; review_confirmations: Record<string, boolean> | null };

export async function markReviewedAction(formData: FormData): Promise<void> {
  const itemKey = formData.get("itemKey") as string | null;
  if (!itemKey || !VALID_REVIEW_KEYS.has(itemKey)) return;

  const ctx = await resolveOperatorContext();

  // Resolve the venue scoped to this operator/session.
  let venue: VenueReviewRow | null = null;

  if (ctx.operator) {
    const { data } = await ctx.supabase
      .from("venues")
      .select("id, review_confirmations")
      .eq("created_by_operator_id", ctx.operator.id)
      .maybeSingle();
    venue = data as VenueReviewRow | null;
  } else if (ctx.isImpersonating && ctx.impersonatingVenueId) {
    // Case B impersonation (orphan venue — no operator row).
    // ctx.supabase is an admin client so no RLS applies; scope by venue id.
    const { data } = await ctx.supabase
      .from("venues")
      .select("id, review_confirmations")
      .eq("id", ctx.impersonatingVenueId)
      .maybeSingle();
    venue = data as VenueReviewRow | null;
  }

  if (!venue) return;

  const current = venue.review_confirmations ?? {};
  const updated = { ...current, [itemKey]: true };

  await ctx.supabase
    .from("venues")
    .update({ review_confirmations: updated })
    .eq("id", venue.id);

  revalidatePath("/admin/home");
}
