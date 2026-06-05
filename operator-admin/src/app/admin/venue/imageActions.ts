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

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file provided." };

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
      cacheControl: "3600",
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
): Promise<{ error: string | null }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

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

  return { error: null };
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
