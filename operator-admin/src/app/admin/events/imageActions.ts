"use server";

/**
 * Event image upload/remove — server actions.
 *
 * Previously implemented as direct client-side Supabase calls (browser
 * session, the caller's own JWT). That bypassed the impersonation
 * architecture entirely: during founder impersonation the browser session
 * belongs to the founder's own Supabase Auth account, not the impersonated
 * operator, so the "events: update own" RLS policy
 * (created_by_operator_id IN (SELECT id FROM operators WHERE email =
 * auth.jwt()->>'email'), see migrations/001_initial_schema.sql) never
 * matched — the DB write silently affected zero rows. The same policy also
 * can never match a seeded event at all (created_by_operator_id IS NULL),
 * which is every retained launch event and every event this support-mode
 * workflow creates.
 *
 * Routing through resolveOperatorContext() + ctx.supabase fixes this the
 * same way saveEventAction/deleteEventAction and the venue image actions
 * (admin/venue/imageActions.ts) already do: ctx.supabase is the admin
 * (service-role) client during impersonation, which bypasses RLS.
 *
 * Authorization/scoping is based on the event belonging to the currently
 * managed venue, not on who created it — created_by_operator_id is NULL for
 * every platform-seeded event, so it was never a reliable ownership signal
 * (see saveEventAction/deleteEventAction for the matching fix and full
 * explanation).
 */

import { revalidatePath } from "next/cache";
import { resolveOperatorContext } from "@/lib/impersonation";

const BUCKET = "venue-images"; // same bucket used for venue photos; events live under events/{eventId}/...

export async function uploadEventImageAction(
  eventId: string,
  venueId: string,
  formData: FormData
): Promise<{ error: string | null; imageUrl?: string }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  // In impersonation, enforce the session's venue rather than the
  // caller-supplied venueId — matches saveEventAction's targetVenueId.
  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file provided." };

  const bytes = await file.arrayBuffer();
  const path = `events/${eventId}/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { cacheControl: "3600", upsert: false, contentType: "image/jpeg" });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { data: urlData } = ctx.supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  const { error: updateError, count } = await ctx.supabase
    .from("events")
    .update({ image_url: publicUrl }, { count: "exact" })
    .eq("id", eventId)
    .eq("venue_id", targetVenueId);

  if (updateError) {
    // Best-effort cleanup of the orphaned storage object.
    await ctx.supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { error: `Failed to save image: ${updateError.message}` };
  }

  if (!count) {
    await ctx.supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { error: "This event could not be found for your venue." };
  }

  revalidatePath("/admin/events");
  return { error: null, imageUrl: publicUrl };
}

export async function removeEventImageAction(
  eventId: string,
  venueId: string,
  imageUrl: string
): Promise<{ error: string | null }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  const { error: updateError, count } = await ctx.supabase
    .from("events")
    .update({ image_url: null }, { count: "exact" })
    .eq("id", eventId)
    .eq("venue_id", targetVenueId);

  if (updateError) {
    return { error: `Failed to remove image: ${updateError.message}` };
  }

  if (!count) {
    return { error: "This event could not be found for your venue." };
  }

  // Best-effort: also delete the file from storage — non-fatal, the DB row
  // is already cleared either way.
  try {
    const urlObj = new URL(imageUrl);
    const match = urlObj.pathname.match(/\/public\/[^/]+\/(.+)$/);
    if (match?.[1]) {
      await ctx.supabase.storage.from(BUCKET).remove([match[1]]);
    }
  } catch {
    // Non-fatal.
  }

  revalidatePath("/admin/events");
  return { error: null };
}
