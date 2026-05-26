"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  sendOperatorSubmissionMoreInfoEmail,
  sendOperatorSubmissionClosedEmail,
  sendOperatorActivationEmail,
} from "@/lib/email";
import { provisionOperatorForVenue } from "@/lib/operatorActivation";

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubmissionReviewState = {
  success?: true;
  successAction?: string;
  error?: string;
};

export type AddNoteState = {
  success?: true;
  error?: string;
  fieldError?: string;
};

export type ApproveVenueState = {
  success?: true;
  successAction?: string;
  error?: string;
};

type ReviewAction = "needs_more_info" | "close";

// Statuses eligible for manual "Approve & Create Venue" — validated server-side.
const APPROVE_ELIGIBLE_STATUSES = new Set([
  "info_submitted",
  "no_match",
  "needs_more_info",
  "rejected_by_user",
]);

const ACTION_LABELS: Record<ReviewAction, string> = {
  needs_more_info: "More info requested — email sent to submitter",
  close:           "Submission closed",
};

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Handles founder review actions on Needs Review operator submissions.
 *
 * needs_more_info:
 *   - Updates: status → needs_more_info, reviewed_by, reviewed_at,
 *     more_info_requested_at. Saves review_notes if provided.
 *   - Sends sendOperatorSubmissionMoreInfoEmail (awaited, required).
 *   - If email fails: returns error. Status update is already committed;
 *     the founder knows to contact the submitter directly.
 *
 * close:
 *   - Updates: status → closed, reviewed_by, reviewed_at, rejected_at.
 *     Saves review_notes if provided.
 *   - Sends sendOperatorSubmissionClosedEmail (awaited, failure non-blocking).
 *   - Closure always succeeds if the DB update succeeds, even if email fails.
 *
 * submissionId is bound via .bind(null, submissionId) — never read from FormData.
 * All DB writes use createAdminClient() (service role) — RLS blocks writes.
 *
 * Does NOT: create/link operators, create/link venues, or send activation emails.
 */
export async function reviewSubmissionAction(
  submissionId: string,
  _prevState: SubmissionReviewState,
  formData: FormData
): Promise<SubmissionReviewState> {
  // ── Validate action ────────────────────────────────────────────────────────
  const rawAction = formData.get("action") as string | null;
  if (!rawAction || !["needs_more_info", "close"].includes(rawAction)) {
    return { error: "Invalid action. Please try again." };
  }
  const action = rawAction as ReviewAction;


  // ── Resolve admin identity ─────────────────────────────────────────────────
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();

  // ── Fetch submission (need email + name for emails) ─────────────────────────
  const { data: submissionRow, error: fetchError } = await supabase
    .from("operator_submissions")
    .select("email, first_name, venue_name, status")
    .eq("id", submissionId)
    .single();

  if (fetchError || !submissionRow) {
    console.error("[reviewSubmissionAction] Fetch failed:", fetchError?.message);
    return { error: "Submission not found. Please refresh and try again." };
  }

  const submitterEmail = submissionRow.email as string;
  const firstName      = (submissionRow.first_name as string | null)?.trim() || "there";
  const venueName      = submissionRow.venue_name as string;
  const now            = new Date().toISOString();

  // ── needs_more_info ────────────────────────────────────────────────────────
  if (action === "needs_more_info") {
    // Generate a secure 64-char hex token (32 random bytes). This IS the
    // credential for the public more-info form — never log the token value.
    const token     = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("operator_submissions")
      .update({
        status:                 "needs_more_info",
        reviewed_by:            user.id,
        reviewed_at:            now,
        more_info_requested_at: now,
        // Token for the structured more-info form (overwrites any prior token)
        more_info_token:        token,
        more_info_expires_at:   expiresAt,
        more_info_completed_at: null, // clear any prior completion
      })
      .eq("id", submissionId);

    if (updateError) {
      console.error("[reviewSubmissionAction] needs_more_info update failed:", updateError.message);
      return { error: "Failed to save review. Please try again." };
    }

    const appUrl     = getAppUrl();
    const moreInfoUrl = `${appUrl}/suggest/owner/more-info/${token}`;

    // Email is required for this action. If it fails, the token is stored but
    // the submitter has no link — return a clear error so the founder knows to
    // retry. On retry, a new token overwrites the current one.
    const emailResult = await sendOperatorSubmissionMoreInfoEmail({
      to:          submitterEmail,
      firstName,
      venueName,
      moreInfoUrl,
    });

    if (!emailResult.ok) {
      console.error(
        "[reviewSubmissionAction] More-info email failed — status updated but submitter not emailed.",
        { submissionId, submitterEmail, error: emailResult.error }
      );
      return {
        error:
          `Status updated to "Needs more info", but the email to ${submitterEmail} could not ` +
          `be sent (${emailResult.error ?? "unknown error"}). Please contact the submitter directly.`,
      };
    }

    console.log("[reviewSubmissionAction] needs_more_info — complete.", {
      submissionId,
      submitterEmail,
    });

    revalidatePath("/control-panel/operator-submissions");
    revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
    return { success: true, successAction: ACTION_LABELS.needs_more_info };
  }

  // ── close ──────────────────────────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from("operator_submissions")
    .update({
      status:      "closed",
      reviewed_by: user.id,
      reviewed_at:  now,
      rejected_at:  now,
    })
    .eq("id", submissionId);

  if (updateError) {
    console.error("[reviewSubmissionAction] close update failed:", updateError.message);
    return { error: "Failed to save review. Please try again." };
  }

  // Closure email: awaited but non-blocking on failure. The submission is
  // correctly closed regardless of whether the courtesy email reaches the
  // submitter. Failure is logged for monitoring.
  const emailResult = await sendOperatorSubmissionClosedEmail({
    to:        submitterEmail,
    firstName,
    venueName,
  });

  if (!emailResult.ok) {
    console.error(
      "[reviewSubmissionAction] Closure email failed — submission closed but submitter not emailed.",
      { submissionId, submitterEmail, error: emailResult.error }
    );
    // Do not return error — closure succeeded. Founder can contact manually.
  }

  console.log("[reviewSubmissionAction] close — complete.", {
    submissionId,
    emailSent: emailResult.ok,
  });

  revalidatePath("/control-panel/operator-submissions");
  revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  return { success: true, successAction: ACTION_LABELS.close };
}

// ── Approve & Create Venue ────────────────────────────────────────────────────

/**
 * Manually approves an operator submission by creating an unpublished venue,
 * provisioning an operator account, and sending an activation email.
 *
 * Eligible statuses: info_submitted, no_match, needs_more_info, rejected_by_user.
 * Re-validates eligibility server-side (status + no existing venue_id/operator_id).
 *
 * Steps:
 *  1. Fetch submission + server-side eligibility checks.
 *  2. Create unpublished venue row (from submission + google_match_json).
 *  3. Call provisionOperatorForVenue() — creates auth user, operator row,
 *     links venue, sends activation email. Handles its own internal rollback.
 *  4. On provisioning failure: delete the venue created in step 2.
 *  5. Update submission: status → approved, venue_id, operator_id, reviewed_by/at.
 *  6. Append internal note to operator_submission_notes.
 *
 * The submission row is only updated after provisioning succeeds — no partial
 * state is visible if provisioning fails. The only artifact on failure is the
 * deleted venue (cleaned up in step 4).
 *
 * submissionId is bound via .bind(null, submissionId).
 */
export async function approveAndCreateVenueAction(
  submissionId: string,
  _prevState: ApproveVenueState,
  _formData: FormData
): Promise<ApproveVenueState> {
  // ── Authenticate ───────────────────────────────────────────────────────────
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();

  // ── Fetch submission ───────────────────────────────────────────────────────
  // No generated Supabase types in this project — cast to Record for property access.
  const { data: subRaw, error: fetchError } = await supabase
    .from("operator_submissions")
    .select("id, email, first_name, last_name, venue_name, street_address, city, province, website, status, venue_id, operator_id, place_id, google_match_json")
    .eq("id", submissionId)
    .single();

  if (fetchError || !subRaw) {
    console.error("[approveAndCreateVenueAction] Fetch failed:", fetchError?.message);
    return { error: "Submission not found. Please refresh and try again." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = subRaw as any as Record<string, unknown>;

  // ── Server-side eligibility ────────────────────────────────────────────────
  if (!APPROVE_ELIGIBLE_STATUSES.has(sub.status as string)) {
    return {
      error: `Cannot approve a submission with status "${sub.status}". ` +
             `Eligible statuses: ${[...APPROVE_ELIGIBLE_STATUSES].join(", ")}.`,
    };
  }
  if (sub.venue_id) {
    return {
      error:
        "This submission is already linked to a venue. " +
        "Refresh to see the current state.",
    };
  }
  if (sub.operator_id) {
    return {
      error:
        "An operator account has already been provisioned for this submission.",
    };
  }

  // ── Derive venue fields from submission + google_match_json ───────────────
  const gm = sub.google_match_json as Record<string, unknown> | null;

  const venueName = (gm?.name as string | null) ?? (sub.venue_name as string);
  const placeId   = (sub.place_id as string | null) ?? (gm?.placeId as string | null);

  const slugBase = placeId
    ? `submission-${placeId.toLowerCase().replace(/[^a-z0-9]/g, "-")}`
    : `submission-${submissionId.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

  // Phone: same formatting as saveOperatorSubmissionAction
  const rawPhone = gm?.phone as string | null | undefined;
  let phone: string | null = null;
  if (rawPhone?.trim()) {
    const digits = (rawPhone.match(/\d/g) ?? []).join("");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    phone = ten.length === 10
      ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
      : rawPhone;
  }

  // ── Create unpublished venue ───────────────────────────────────────────────
  const { data: newVenue, error: venueError } = await supabase
    .from("venues")
    .insert({
      name:                 venueName,
      slug:                 slugBase,
      address_line1:        (gm?.streetAddress as string | null) ?? (sub.street_address as string | null) ?? null,
      city:                 (gm?.city          as string | null) ?? (sub.city           as string | null) ?? null,
      region:               (gm?.provinceShort as string | null) ?? (gm?.province as string | null) ?? (sub.province as string | null) ?? null,
      postal_code:          (gm?.postalCode    as string | null) ?? null,
      country:              (gm?.country       as string | null) ?? null,
      lat:                  (gm?.lat           as number | null) ?? null,
      lng:                  (gm?.lng           as number | null) ?? null,
      phone,
      website_url:          (gm?.website       as string | null) ?? (sub.website as string | null) ?? null,
      place_id:             placeId,
      is_published:         false,
      source:               "operator_submission",
      source_submission_id: submissionId,
    })
    .select("id")
    .single();

  if (venueError || !newVenue) {
    console.error("[approveAndCreateVenueAction] Venue creation failed:", venueError?.message);
    if (venueError?.code === "23505") {
      return {
        error:
          "A venue with the same identifier already exists. " +
          "This submission may have already been processed. Please refresh.",
      };
    }
    return { error: "Failed to create venue. Please try again." };
  }

  const venueId = newVenue.id as string;

  // ── Provision operator ─────────────────────────────────────────────────────
  // provisionOperatorForVenue handles its own internal rollback (auth user,
  // operator row, venue link fields). On failure we still need to delete the
  // venue row we created above.
  const firstName = ((sub.first_name as string | null) ?? "").trim();
  const lastName  = ((sub.last_name  as string | null) ?? "").trim();
  const email     = sub.email as string;

  const provisionResult = await provisionOperatorForVenue({
    email,
    firstName,
    lastName,
    venueId,
    logTag: "[approveAndCreateVenueAction]",
    sendEmail: (setupLink) =>
      sendOperatorActivationEmail({
        to:        email,
        firstName: firstName || "there",
        setupLink,
      }),
  });

  if (!provisionResult.ok) {
    console.error(
      "[approveAndCreateVenueAction] Provisioning failed — deleting venue.",
      { venueId, error: provisionResult.error }
    );
    await supabase.from("venues").delete().eq("id", venueId);
    return { error: provisionResult.error };
  }

  // ── Update submission ──────────────────────────────────────────────────────
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("operator_submissions")
    .update({
      status:      "approved",
      venue_id:    venueId,
      operator_id: provisionResult.authUserId,
      reviewed_by: user.id,
      reviewed_at: now,
    })
    .eq("id", submissionId);

  if (updateError) {
    // Provisioning succeeded and the activation email was sent — the operator
    // account is live. Log a critical alert for manual fix but do not fail.
    console.error(
      "[approveAndCreateVenueAction] CRITICAL: provisioning succeeded but submission " +
      "update failed. Manual fix required: " +
      `operator_submissions.status='approved', venue_id='${venueId}', ` +
      `operator_id='${provisionResult.authUserId}' for id='${submissionId}'.`,
      { dbError: updateError.message }
    );
  }

  // ── Append internal note ───────────────────────────────────────────────────
  await supabase.from("operator_submission_notes").insert({
    submission_id:    submissionId,
    note:
      `Founder manually approved. Venue created (id: ${venueId}), operator account ` +
      `provisioned for ${email}. Status → approved.`,
    created_by:       user.id,
    created_by_email: user.email ?? null,
  });

  console.log("[approveAndCreateVenueAction] Complete.", {
    submissionId,
    venueId,
    authUserId: provisionResult.authUserId,
  });

  revalidatePath("/control-panel/operator-submissions");
  revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  return {
    success:       true,
    successAction: "Venue created and operator account activated — activation email sent",
  };
}

// ── Resend operator setup email ───────────────────────────────────────────────

export type ResendSetupEmailState = {
  success?: true;
  successAction?: string;
  error?: string;
};

/**
 * Resends the "set up your account" email to an operator whose submission was
 * approved and whose account was provisioned.
 *
 * Safe to call multiple times — generates a fresh Supabase recovery link each
 * time. Does NOT create a new auth user, a new operator row, or alter venue
 * ownership. Appends an internal note on success.
 *
 * Eligibility: submission.status === "approved" and operator_id is set.
 *
 * submissionId is bound via .bind(null, submissionId).
 */
export async function resendSubmissionSetupEmailAction(
  submissionId: string,
  _prevState: ResendSetupEmailState,
  _formData: FormData
): Promise<ResendSetupEmailState> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: "Session expired. Please sign in again." };

  const supabase = createAdminClient();

  // ── Fetch submission ──────────────────────────────────────────────────────
  const { data: subRaw, error: fetchError } = await supabase
    .from("operator_submissions")
    .select("email, first_name, operator_id, status")
    .eq("id", submissionId)
    .single();

  if (fetchError || !subRaw) {
    console.error("[resendSubmissionSetupEmailAction] Fetch failed:", fetchError?.message);
    return { error: "Submission not found. Please refresh and try again." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = subRaw as any as Record<string, unknown>;

  // ── Eligibility ───────────────────────────────────────────────────────────
  if ((sub.status as string) !== "approved") {
    return { error: "Resend is only available for approved submissions." };
  }

  const email      = sub.email as string;
  const firstName  = ((sub.first_name as string | null) ?? "").trim() || "there";
  const operatorId = sub.operator_id as string | null;

  if (!email) return { error: "Submission has no email address." };
  if (!operatorId) {
    return {
      error:
        "No operator account is linked to this submission. " +
        "The submission may not have been fully provisioned.",
    };
  }

  // ── Generate fresh recovery link ──────────────────────────────────────────
  const appUrl     = getAppUrl();
  const redirectTo = `${appUrl}/operator/create-password`;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type:    "recovery",
    email,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error("[resendSubmissionSetupEmailAction] generateLink failed:", linkError?.message);
    return { error: "Failed to generate a new setup link. Please try again." };
  }

  // ── Send email (awaited — fail fast on error) ─────────────────────────────
  const emailResult = await sendOperatorActivationEmail({
    to:        email,
    firstName,
    setupLink: linkData.properties.action_link,
  });

  if (!emailResult.ok) {
    console.error(
      "[resendSubmissionSetupEmailAction] Email send failed:",
      { submissionId, email, error: emailResult.error }
    );
    return {
      error: `Email could not be sent to ${email} (${emailResult.error ?? "unknown error"}). Please try again.`,
    };
  }

  // ── Append internal note ──────────────────────────────────────────────────
  await supabase.from("operator_submission_notes").insert({
    submission_id:    submissionId,
    note:             `Setup email resent to ${email} by founder.`,
    created_by:       user.id,
    created_by_email: user.email ?? null,
  });

  console.log("[resendSubmissionSetupEmailAction] Complete.", { submissionId, email });

  revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  return { success: true, successAction: `Setup email resent to ${email}` };
}

// ── Append internal note ──────────────────────────────────────────────────────

/**
 * Appends a new internal note to operator_submission_notes.
 * Does NOT overwrite previous notes — each call inserts a new row.
 * Notes are internal only; never sent to submitters.
 *
 * submissionId is bound via .bind(null, submissionId).
 */
export async function addSubmissionNoteAction(
  submissionId: string,
  _prevState: AddNoteState,
  formData: FormData
): Promise<AddNoteState> {
  const note = (formData.get("note") as string | null)?.trim() ?? "";

  if (!note) {
    return { fieldError: "Note cannot be empty." };
  }

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("operator_submission_notes")
    .insert({
      submission_id:    submissionId,
      note,
      created_by:       user.id,
      created_by_email: user.email ?? null,
    });

  if (error) {
    console.error("[addSubmissionNoteAction] Insert failed:", error.message);
    return { error: "Failed to save note. Please try again." };
  }

  revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  return { success: true };
}
