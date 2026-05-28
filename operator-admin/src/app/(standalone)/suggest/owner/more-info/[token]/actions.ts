"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { sendOperatorSubmissionInfoSubmittedNotificationEmail } from "@/lib/email";
import { sendSlackAlert } from "@/lib/slack";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MoreInfoState = {
  success?: true;
  error?: string;
  fieldErrors?: {
    venue_name?: string;
    info_phone?: string;
    info_website?: string;
    info_relationship?: string;
  };
};

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Handles the public more-info form submission.
 *
 * Security: token is bound server-side via .bind(null, token) — it never
 * comes from FormData and cannot be tampered with. The token is re-validated
 * against the DB on every submit (expiry + not-yet-completed check).
 *
 * On success:
 *   - Saves verification details and corrected business fields.
 *   - Updates status → info_submitted.
 *   - Sets more_info_completed_at.
 *   - Clears more_info_token and more_info_expires_at (single-use).
 *
 * Does NOT: create operators, create venues, or send activation emails.
 */
export async function submitMoreInfoAction(
  token: string,
  _prevState: MoreInfoState,
  formData: FormData
): Promise<MoreInfoState> {
  // ── Extract fields ─────────────────────────────────────────────────────────
  const venueName     = (formData.get("venue_name")           as string | null)?.trim() ?? "";
  const streetAddress = (formData.get("street_address")       as string | null)?.trim() ?? "";
  const city          = (formData.get("city")                 as string | null)?.trim() ?? "";
  const province      = (formData.get("province")             as string | null)?.trim() ?? "";
  const position      = (formData.get("position")             as string | null)?.trim() ?? "";
  const infoPhone     = (formData.get("info_phone")           as string | null)?.trim() ?? "";
  const infoWebsite   = (formData.get("info_website")         as string | null)?.trim() ?? "";
  const infoInstagram = (formData.get("info_instagram")       as string | null)?.trim() ?? "";
  const infoFacebook  = (formData.get("info_facebook")        as string | null)?.trim() ?? "";
  const infoTiktok    = (formData.get("info_tiktok")          as string | null)?.trim() ?? "";
  const infoRelation  = (formData.get("info_relationship")    as string | null)?.trim() ?? "";
  const infoNotes     = (formData.get("info_additional_notes")as string | null)?.trim() ?? "";
  const rawContact    = (formData.get("info_preferred_contact") as string | null)?.trim() ?? "";
  const otherText     = (formData.get("info_preferred_contact_other") as string | null)?.trim() ?? "";
  const infoContact   = rawContact === "Other" && otherText ? `Other: ${otherText}` : rawContact;

  // ── Validate ───────────────────────────────────────────────────────────────
  const fieldErrors: MoreInfoState["fieldErrors"] = {};

  if (!venueName)  fieldErrors.venue_name      = "Business name is required.";
  if (!infoPhone)  fieldErrors.info_phone      = "Business phone number is required.";
  if (!infoRelation) fieldErrors.info_relationship = "Please describe your relationship to this business.";

  const hasOnlinePresence = infoWebsite || infoInstagram || infoFacebook || infoTiktok;
  if (!hasOnlinePresence) {
    fieldErrors.info_website = "Please provide a website URL or at least one social media profile.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  // ── Re-validate token server-side ─────────────────────────────────────────
  // This is the authoritative check — prevents replay, reuse after completion,
  // and reuse after expiry. The token value itself is NOT logged.
  const supabase = createAdminClient();

  const { data: submissionRow, error: lookupError } = await supabase
    .from("operator_submissions")
    .select("id, first_name, last_name, email, venue_name")
    .eq("more_info_token", token)
    .gt("more_info_expires_at", new Date().toISOString())
    .is("more_info_completed_at", null)
    .maybeSingle();

  if (lookupError) {
    console.error("[submitMoreInfoAction] Token lookup error:", lookupError.message);
    return { error: "Something went wrong. Please try again." };
  }

  if (!submissionRow) {
    return {
      error:
        "This link has expired or has already been used. " +
        "Please contact us at hello@happyhourcompass.com and we'll send you a new one.",
    };
  }

  // ── Build socials JSONB ───────────────────────────────────────────────────
  const infoSocials: Record<string, string> = {};
  if (infoInstagram) infoSocials.instagram = infoInstagram;
  if (infoFacebook)  infoSocials.facebook  = infoFacebook;
  if (infoTiktok)    infoSocials.tiktok    = infoTiktok;

  // ── Update submission ──────────────────────────────────────────────────────
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("operator_submissions")
    .update({
      // Corrected business fields (submitter may have fixed typos)
      venue_name:     venueName,
      street_address: streetAddress || null,
      city:           city          || null,
      province:       province      || null,
      position:       position      || null,

      // Verification details (founder-review-only)
      info_phone:             infoPhone,
      info_website:           infoWebsite   || null,
      info_socials:           Object.keys(infoSocials).length > 0 ? infoSocials : null,
      info_relationship:      infoRelation,
      info_additional_notes:  infoNotes     || null,
      info_preferred_contact: infoContact   || null,

      // Status + token invalidation
      status:                "info_submitted",
      more_info_completed_at: now,
      more_info_token:        null, // single-use: clear after successful submission
      more_info_expires_at:   null,
    })
    .eq("id", submissionRow.id);

  if (updateError) {
    console.error("[submitMoreInfoAction] Update error:", updateError.message);
    await sendSlackAlert({
      channel:  "ops-alerts",
      severity: "warning",
      title:    "Submission More-Info DB Write Failed",
      message:  "Submitter submitted additional info but the DB update failed. Submission remains in 'needs_more_info'. Submitter can retry (token still valid).",
      metadata: { "Submission ID": submissionRow.id as string, Email: submissionRow.email as string, Business: venueName, Error: updateError.message },
    });
    return { error: "Something went wrong saving your response. Please try again." };
  }

  console.log("[submitMoreInfoAction] Info submitted successfully.", {
    submissionId: submissionRow.id,
  });

  // ── Founder notification (non-blocking) ───────────────────────────────────
  // Submitter success is unaffected by email failure — log and continue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = submissionRow as Record<string, any>;
  const submittedAt = new Date().toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const notifyResult = await sendOperatorSubmissionInfoSubmittedNotificationEmail({
    submissionId:      row.id as string,
    businessName:      venueName, // use the (possibly corrected) name from FormData
    submitterFirstName: (row.first_name as string | null) ?? "",
    submitterLastName:  (row.last_name  as string | null) ?? "",
    submitterEmail:    row.email as string,
    submittedAt,
  });
  if (!notifyResult.ok) {
    console.error("[submitMoreInfoAction] Founder notification email failed.", {
      submissionId: row.id,
      error: notifyResult.error,
    });
    await sendSlackAlert({
      channel:  "ops-alerts",
      severity: "warning",
      title:    "Submission More-Info Submitted — Founder Notification Email Failed",
      message:  "Submitter successfully submitted additional info but the founder notification email could not be sent. Manual review required.",
      metadata: { "Submission ID": row.id as string, Email: row.email as string, Business: venueName, Error: notifyResult.error ?? "unknown" },
    });
  }

  return { success: true };
}
