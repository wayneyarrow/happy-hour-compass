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
 * (service-role) client during impersonation, which bypasses RLS, with the
 * explicit venue/operator filter below providing the actual scoping.
 */

import { revalidatePath } from "next/cache";
import { resolveOperatorContext } from "@/lib/impersonation";

const BUCKET = "venue-images"; // same bucket used for venue photos; events live under events/{eventId}/...

export async function uploadEventImageAction(
  eventId: string,
  formData: FormData
): Promise<{ error: string | null; imageUrl?: string }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

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

  // Case A (operator) scopes by created_by_operator_id; Case B (founder
  // impersonating an unassigned venue) scopes strictly by the impersonated
  // venue — same pattern as saveEventAction/deleteEventAction.
  let updateQuery = ctx.supabase.from("events").update({ image_url: publicUrl }).eq("id", eventId);
  updateQuery = ctx.operator
    ? updateQuery.eq("created_by_operator_id", ctx.operator.id)
    : updateQuery.eq("venue_id", ctx.impersonatingVenueId ?? "");

  const { error: updateError } = await updateQuery;

  if (updateError) {
    // Best-effort cleanup of the orphaned storage object.
    await ctx.supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { error: `Failed to save image: ${updateError.message}` };
  }

  revalidatePath("/admin/events");
  return { error: null, imageUrl: publicUrl };
}

export async function removeEventImageAction(
  eventId: string,
  imageUrl: string
): Promise<{ error: string | null }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  let updateQuery = ctx.supabase.from("events").update({ image_url: null }).eq("id", eventId);
  updateQuery = ctx.operator
    ? updateQuery.eq("created_by_operator_id", ctx.operator.id)
    : updateQuery.eq("venue_id", ctx.impersonatingVenueId ?? "");

  const { error: updateError } = await updateQuery;

  if (updateError) {
    return { error: `Failed to remove image: ${updateError.message}` };
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
