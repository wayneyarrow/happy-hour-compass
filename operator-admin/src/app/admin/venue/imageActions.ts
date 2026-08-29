"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { parseOperatorPlan, maxImages } from "@/lib/plans";

const BUCKET = "venue-images";

export async function uploadVenueImageAction(
  venueId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  // In impersonation, enforce the session's venue rather than the caller-supplied venueId.
  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  // Ownership check (normal mode only — impersonation already pins
  // targetVenueId to the session's venue above, ignoring the caller-supplied
  // one entirely). A client-submitted venueId is never trusted on its own —
  // this must be one of the venues resolveOperatorContext() actually
  // resolved for this operator, which matters more now that an operator can
  // own more than one venue.
  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file provided." };

  const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Unsupported file type. Please upload a JPEG, PNG, WebP, or GIF image." };
  }

  // Count existing images before uploading — used for both the plan limit check
  // and deriving sort_order so we don't pay two round-trips.
  const { data: existing } = await ctx.supabase
    .from("media")
    .select("id")
    .eq("venue_id", targetVenueId)
    .eq("type", "venue_image");
  const existingCount = existing?.length ?? 0;

  const plan = parseOperatorPlan(ctx.operator?.plan);
  const imageLimit = maxImages(plan);

  if (existingCount >= imageLimit) {
    const { imagesNudge } = await import("@/lib/planNudges");
    const { atLimitMsg, upgradeSuggestion } = imagesNudge(plan);
    const detail = upgradeSuggestion ?? "Remove a photo to upload a new one.";
    return { error: `${atLimitMsg} ${detail}` };
  }

  const bytes = await file.arrayBuffer();
  const path = `venues/${targetVenueId}/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      // 1 year — safe because every upload gets a brand-new
      // crypto.randomUUID() path (upsert: false above), so a URL's content
      // can never change after it's created; "replacing" a photo always
      // means a new URL, never an overwrite. Existing objects uploaded
      // before this change keep their prior 1-hour cache-control until a
      // separate, deliberate migration re-uploads them (out of scope here).
      cacheControl: "31536000",
      upsert: false,
      contentType: "image/jpeg",
    });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { data: urlData } = ctx.supabase.storage.from(BUCKET).getPublicUrl(path);

  const sortOrder = existingCount;

  const { error: insertError } = await ctx.supabase.from("media").insert({
    venue_id: targetVenueId,
    url: urlData.publicUrl,
    sort_order: sortOrder,
    type: "venue_image",
  });

  if (insertError) {
    // Best-effort cleanup of the orphaned storage object.
    await ctx.supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { error: `Failed to save image record: ${insertError.message}` };
  }

  return { error: null };
}

export async function deleteVenueImageAction(
  venueId: string,
  mediaId: string,
  imageUrl: string
): Promise<{ error: string | null; venueUnpublished?: boolean }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  // Never trust a client-submitted venueId on its own — see uploadVenueImageAction.
  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  const { error: deleteError } = await ctx.supabase
    .from("media")
    .delete()
    .eq("id", mediaId)
    .eq("venue_id", targetVenueId);

  if (deleteError) {
    return { error: `Failed to delete image: ${deleteError.message}` };
  }

  // Best-effort: delete the file from storage.
  try {
    const urlObj = new URL(imageUrl);
    const match = urlObj.pathname.match(/\/public\/[^/]+\/(.+)$/);
    if (match?.[1]) {
      await ctx.supabase.storage.from(BUCKET).remove([match[1]]);
    }
  } catch {
    // Non-fatal — the media row is already gone.
  }

  // Auto-unpublish: a published venue must have at least one image (see the
  // hasAnyVenueImage/hasOperatorVenueImage required items in
  // computeVenueReadiness / updatePublishStatusAction). If this delete left
  // the venue with zero images, every variant of that requirement fails
  // regardless of claimed/submitted status — unpublish it automatically
  // rather than leaving a published listing with no image to show.
  let venueUnpublished = false;
  const { count: remainingImages } = await ctx.supabase
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", targetVenueId)
    .eq("type", "venue_image");

  if ((remainingImages ?? 0) === 0) {
    let unpublishQuery = ctx.supabase
      .from("venues")
      .update(
        {
          is_published: false,
          ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
        },
        { count: "exact" }
      )
      .eq("id", targetVenueId)
      .eq("is_published", true);

    if (ctx.operator) {
      unpublishQuery = unpublishQuery.eq("created_by_operator_id", ctx.operator.id);
    }

    const { count: unpublishedCount } = await unpublishQuery;
    venueUnpublished = (unpublishedCount ?? 0) > 0;
  }

  return { error: null, venueUnpublished };
}

export async function reorderVenueImagesAction(
  venueId: string,
  orderedIds: string[]
): Promise<{ error: string | null }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  // Never trust a client-submitted venueId on its own — see uploadVenueImageAction.
  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      ctx.supabase
        .from("media")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("venue_id", targetVenueId)
    )
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { error: `Failed to reorder images: ${failed.error.message}` };
  }

  return { error: null };
}
