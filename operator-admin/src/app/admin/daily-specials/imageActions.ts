"use server";

/**
 * Daily Special image upload/remove — server actions.
 *
 * Direct mirror of src/app/admin/events/imageActions.ts: same bucket
 * ("venue-images" — no new Storage bucket introduced), same
 * resolveOperatorContext()-routed auth (ctx.supabase is the RLS-respecting
 * session client in normal mode, or the admin/service-role client during
 * impersonation — bypassing RLS is required for a founder managing an
 * unassigned/seeded venue, whose rows have no operator-matching JWT to
 * satisfy the RLS ownership policy), same venue-ownership scoping (never
 * on who created the row — created_by_operator_id is NULL for every
 * seeded special), same fresh-UUID-per-upload path (a "replace" is always
 * a new object, never an overwrite), same 1-year cache-control, same
 * best-effort cleanup on failure/removal.
 *
 * Path convention: daily-specials/{specialId}/{uuid}.jpg — the
 * daily-specials/ prefix is the only difference from events/{eventId}/...
 *
 * REPLACEMENT CLEANUP (added after initial Phase 2 review): a replace
 * previously left the object it was replacing orphaned in Storage forever
 * — uploadDailySpecialImageAction never looked at the row's existing
 * image_url at all. It now reads the CURRENT image_url fresh from the
 * database (never a client-supplied "previous URL") before uploading, and
 * — only after the new object is uploaded AND the DB row is confirmed
 * updated to point at it — best-effort deletes the previous object. This
 * ordering is deliberate: the previous image is never touched before the
 * replacement has fully succeeded, so a failed upload or a failed DB write
 * always leaves the special still pointing at a real, valid image.
 */

import { revalidatePath } from "next/cache";
import { resolveOperatorContext } from "@/lib/impersonation";
import { parseOwnedStoragePath } from "./storagePath";

const BUCKET = "venue-images"; // same bucket as venue photos and event images

export async function uploadDailySpecialImageAction(
  specialId: string,
  venueId: string,
  formData: FormData
): Promise<{ error: string | null; imageUrl?: string }> {
  // ── 1. Authorize venue/special ──────────────────────────────────────────
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file provided." };

  // ── 2. Read current image_url — fresh from the DB, never from the client,
  //      scoped by the same id + venue_id every other operation here uses.
  //      This is what makes replacement cleanup possible below. A read
  //      failure here is non-fatal to the upload itself — it just means no
  //      previous-image cleanup will be attempted (nothing to clean up if
  //      we couldn't confirm what it was).
  const { data: existingRow } = await ctx.supabase
    .from("daily_specials")
    .select("image_url")
    .eq("id", specialId)
    .eq("venue_id", targetVenueId)
    .maybeSingle();
  const previousImageUrl = (existingRow?.image_url as string | null) ?? null;

  // ── 3. Process/upload the new image ─────────────────────────────────────
  const bytes = await file.arrayBuffer();
  const path = `daily-specials/${specialId}/${crypto.randomUUID()}.jpg`;

  // 1 year — safe because every upload gets a brand-new crypto.randomUUID()
  // path (upsert: false), so a URL's content never changes after creation;
  // "replacing" a photo always means a new URL, never an overwrite.
  const { error: uploadError } = await ctx.supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { cacheControl: "31536000", upsert: false, contentType: "image/jpeg" });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { data: urlData } = ctx.supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  // ── 4. Update daily_specials.image_url to the new URL ───────────────────
  const { error: updateError, count } = await ctx.supabase
    .from("daily_specials")
    .update({ image_url: publicUrl }, { count: "exact" })
    .eq("id", specialId)
    .eq("venue_id", targetVenueId);

  // ── 5. DB update failed — clean up ONLY the newly uploaded object. The
  //      previous image (if any) is left completely untouched: the row
  //      still points at it, so deleting it here would break a valid,
  //      still-referenced image over a failed replacement attempt.
  if (updateError) {
    await ctx.supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { error: `Failed to save image: ${updateError.message}` };
  }

  if (!count) {
    await ctx.supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { error: "This Daily Special could not be found for your venue." };
  }

  // ── 6. DB update succeeded — the row now points at the new image. Only
  //      NOW is it safe to best-effort remove the PREVIOUS object (if any
  //      existed, and it actually belongs to our own bucket). Failure to
  //      delete it must never fail this otherwise-successful replacement —
  //      an orphaned-but-harmless old object is an acceptable outcome; a
  //      broken image reference is not.
  if (previousImageUrl) {
    const previousPath = parseOwnedStoragePath(previousImageUrl, BUCKET);
    if (previousPath) {
      await ctx.supabase.storage.from(BUCKET).remove([previousPath]).catch(() => {});
    }
  }

  // ── 7. Return success ────────────────────────────────────────────────────
  revalidatePath("/admin/daily-specials");
  return { error: null, imageUrl: publicUrl };
}

export async function removeDailySpecialImageAction(
  specialId: string,
  venueId: string,
  imageUrl: string
): Promise<{ error: string | null }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  const targetVenueId = ctx.isImpersonating ? (ctx.sessionVenueId ?? venueId) : venueId;

  if (!ctx.isImpersonating && !ctx.venues.some((v) => v.id === targetVenueId)) {
    return { error: "Venue not found or you don't have permission to manage it." };
  }

  const { error: updateError, count } = await ctx.supabase
    .from("daily_specials")
    .update({ image_url: null }, { count: "exact" })
    .eq("id", specialId)
    .eq("venue_id", targetVenueId);

  if (updateError) {
    return { error: `Failed to remove image: ${updateError.message}` };
  }

  if (!count) {
    return { error: "This Daily Special could not be found for your venue." };
  }

  // Best-effort: also delete the file from storage — non-fatal, the DB row
  // is already cleared either way. Shares parseOwnedStoragePath() with the
  // upload path's replacement cleanup above, rather than parsing the URL
  // independently here.
  const removePath = parseOwnedStoragePath(imageUrl, BUCKET);
  if (removePath) {
    await ctx.supabase.storage.from(BUCKET).remove([removePath]).catch(() => {});
  }

  revalidatePath("/admin/daily-specials");
  return { error: null };
}
