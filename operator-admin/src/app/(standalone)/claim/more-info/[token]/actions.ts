"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { sendClaimInfoSubmittedNotificationEmail } from "@/lib/email";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClaimMoreInfoState = {
  success?: true;
  error?: string;
  fieldErrors?: {
    info_phone?: string;
    info_website?: string;
    info_relationship?: string;
  };
};

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Handles the public claim more-info form submission.
 *
 * Security: token is bound server-side via .bind(null, token) — it never
 * comes from FormData and cannot be tampered with. The token is re-validated
 * against the DB on every submit (expiry + not-yet-completed check).
 *
 * On success:
 *   - Saves verification details to the venue_claims row.
 *   - Updates status → info_submitted.
 *   - Sets more_info_completed_at.
 *   - Clears more_info_token and more_info_expires_at (single-use).
 *   - Appends an internal note to venue_claim_notes.
 *   - Sends founder notification email.
 */
export async function submitClaimMoreInfoAction(
  token: string,
  _prevState: ClaimMoreInfoState,
  formData: FormData
): Promise<ClaimMoreInfoState> {
  // ── Extract fields ─────────────────────────────────────────────────────────
  const infoPhone     = (formData.get("info_phone")            as string | null)?.trim() ?? "";
  const infoWebsite   = (formData.get("info_website")          as string | null)?.trim() ?? "";
  const infoInstagram = (formData.get("info_instagram")        as string | null)?.trim() ?? "";
  const infoFacebook  = (formData.get("info_facebook")         as string | null)?.trim() ?? "";
  const infoTiktok    = (formData.get("info_tiktok")           as string | null)?.trim() ?? "";
  const infoRelation  = (formData.get("info_relationship")     as string | null)?.trim() ?? "";
  const infoNotes     = (formData.get("info_additional_notes") as string | null)?.trim() ?? "";
  const rawContact    = (formData.get("info_preferred_contact") as string | null)?.trim() ?? "";
  const otherText     = (formData.get("info_preferred_contact_other") as string | null)?.trim() ?? "";
  const infoContact   = rawContact === "Other" && otherText ? `Other: ${otherText}` : rawContact;

  // ── Validate ───────────────────────────────────────────────────────────────
  const fieldErrors: ClaimMoreInfoState["fieldErrors"] = {};

  if (!infoPhone) fieldErrors.info_phone = "Business phone number is required.";
  if (!infoRelation) fieldErrors.info_relationship = "Please describe your relationship to this business.";

  const hasOnlinePresence = infoWebsite || infoInstagram || infoFacebook || infoTiktok;
  if (!hasOnlinePresence) {
    fieldErrors.info_website = "Please provide a website URL or at least one social media profile.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  // ── Re-validate token server-side ─────────────────────────────────────────
  const supabase = createAdminClient();

  const { data: rawClaim, error: lookupError } = await supabase
    .from("venue_claims")
    .select("id, first_name, last_name, email, venue_id, venues ( name )")
    .eq("more_info_token", token)
    .gt("more_info_expires_at", new Date().toISOString())
    .is("more_info_completed_at", null)
    .maybeSingle();

  if (lookupError) {
    console.error("[submitClaimMoreInfoAction] Token lookup error:", lookupError.message);
    return { error: "Something went wrong. Please try again." };
  }

  if (!rawClaim) {
    return {
      error:
        "This link has expired or has already been used. " +
        "Please contact us at hello@happyhourcompass.com and we'll send you a new one.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claim = rawClaim as any as Record<string, unknown>;
  const claimId       = claim.id as string;
  const firstName     = (claim.first_name as string | null) ?? "";
  const lastName      = (claim.last_name  as string | null) ?? "";
  const claimantEmail = (claim.email      as string | null) ?? "";
  const venueRaw      = claim.venues;
  const venueName     = (Array.isArray(venueRaw) ? (venueRaw[0] as Record<string, unknown>)?.name : (venueRaw as Record<string, unknown>)?.name) as string | null ?? "Unknown venue";

  // ── Build socials JSONB ───────────────────────────────────────────────────
  const infoSocials: Record<string, string> = {};
  if (infoInstagram) infoSocials.instagram = infoInstagram;
  if (infoFacebook)  infoSocials.facebook  = infoFacebook;
  if (infoTiktok)    infoSocials.tiktok    = infoTiktok;

  // ── Update claim row ───────────────────────────────────────────────────────
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("venue_claims")
    .update({
      info_phone:             infoPhone,
      info_website:           infoWebsite   || null,
      info_socials:           Object.keys(infoSocials).length > 0 ? infoSocials : null,
      info_relationship:      infoRelation,
      info_additional_notes:  infoNotes     || null,
      info_preferred_contact: infoContact   || null,
      status:                 "info_submitted",
      more_info_completed_at: now,
      more_info_token:        null,
      more_info_expires_at:   null,
    })
    .eq("id", claimId);

  if (updateError) {
    console.error("[submitClaimMoreInfoAction] Update error:", updateError.message);
    return { error: "Something went wrong saving your response. Please try again." };
  }

  console.log("[submitClaimMoreInfoAction] Info submitted successfully.", { claimId });

  // ── Append internal note ──────────────────────────────────────────────────
  await supabase
    .from("venue_claim_notes")
    .insert({
      claim_id:         claimId,
      note:             "Claimant submitted additional verification info via secure link.",
      created_by:       null,
      created_by_email: null,
    });

  // ── Founder notification ──────────────────────────────────────────────────
  const submittedAt = new Date().toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const notifyResult = await sendClaimInfoSubmittedNotificationEmail({
    claimId,
    venueName:          venueName as string,
    claimantFirstName:  firstName,
    claimantLastName:   lastName,
    claimantEmail,
    submittedAt,
  });

  if (!notifyResult.ok) {
    console.error("[submitClaimMoreInfoAction] Founder notification email failed.", {
      claimId,
      error: notifyResult.error,
    });
  }

  return { success: true };
}
