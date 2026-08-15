"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import {
  sendOperatorSubmissionMoreInfoEmail,
  sendOperatorSubmissionClosedEmail,
  sendOperatorActivationEmail,
} from "@/lib/email";
import { provisionOperatorForVenue } from "@/lib/operatorActivation";
import { sendSlackAlert } from "@/lib/slack";
import { logAuditEvent } from "@/lib/auditLog";
import { getSiteUrl } from "@/lib/siteUrl";
import { resolveVenueGeography } from "@/lib/geo/venueGeographyResolver";
import { geocodeStreetAddress } from "@/lib/geo/geocodeAddress";

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

  if (!user || !await isControlPanelAdmin(user.email)) {
    return { error: "Unauthorized." };
  }

  const supabase = createAdminClient();

  // ── Fetch submission (need email + name for emails) ─────────────────────────
  const { data: submissionRow, error: fetchError } = await supabase
    .from("operator_submissions")
    .select("email, first_name, venue_name, status, more_info_requested_at")
    .eq("id", submissionId)
    .single();

  if (fetchError || !submissionRow) {
    console.error("[reviewSubmissionAction] Fetch failed:", fetchError?.message);
    return { error: "Submission not found. Please refresh and try again." };
  }

  const submitterEmail  = submissionRow.email as string;
  const firstName       = (submissionRow.first_name as string | null)?.trim() || "there";
  const venueName       = submissionRow.venue_name as string;
  const currentStatus   = submissionRow.status as string;
  const lastRequestedAt = submissionRow.more_info_requested_at as string | null;
  const now             = new Date().toISOString();

  // ── needs_more_info ────────────────────────────────────────────────────────
  if (action === "needs_more_info") {
    // Guard against an accidental double-submit or network-level retry of the
    // same click re-running the whole side-effect chain (new token, new
    // email, new note) a second time. A genuine, deliberate re-request (e.g.
    // resending after the submitter hasn't replied) is still allowed — the
    // CPanel UI does not disable this button based on current status — so
    // this only short-circuits requests arriving within seconds of the last
    // one, well inside any realistic double-click/retry window and well
    // short of any legitimate distinct re-request.
    const RETRY_WINDOW_MS = 10_000;
    if (lastRequestedAt && Date.now() - new Date(lastRequestedAt).getTime() < RETRY_WINDOW_MS) {
      console.warn(
        "[reviewSubmissionAction] needs_more_info — duplicate request suppressed (retry window).",
        { submissionId }
      );
      return { success: true, successAction: ACTION_LABELS.needs_more_info };
    }

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

    const appUrl     = getSiteUrl();
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
      // Slack escalation already fired by sendTransactionalEmail
      // (operator_submission_more_info → important → #ops-alerts).
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

    // Append internal note — mirrors reviewClaimAction's needs_more_info note.
    await supabase.from("operator_submission_notes").insert({
      submission_id:    submissionId,
      note:             `More info requested — structured verification form emailed to ${submitterEmail}. Token expires in 72 h.`,
      created_by:       user.id,
      created_by_email: user.email ?? null,
    });

    await logAuditEvent({
      actorEmail: user.email ?? "unknown",
      action:     "submission_more_info_requested",
      entityType: "operator_submission",
      entityId:   submissionId,
      entityName: venueName,
    });

    console.log("[reviewSubmissionAction] needs_more_info — complete.", {
      submissionId,
      submitterEmail,
    });

    revalidatePath("/control-panel/operator-submissions");
    revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
    return { success: true, successAction: ACTION_LABELS.needs_more_info };
  }

  // ── close ──────────────────────────────────────────────────────────────────
  // Guard against retrying/resubmitting an already-closed submission. The
  // CPanel UI itself disables both action buttons once closed (see
  // SubmissionReviewPanel's isClosed check) — this enforces the same
  // assumption server-side so a stale page, replayed request, or double
  // submit cannot resend the closure email or duplicate the lifecycle note.
  // Mirrors reviewClaimAction's existing "already approved" guard for the
  // same class of terminal-state re-submission.
  if (currentStatus === "closed") {
    return { error: "This submission has already been closed." };
  }

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
    // Slack escalation already fired by sendTransactionalEmail
    // (operator_submission_closed → important → #ops-alerts).
    // Do not return error — closure succeeded. Founder can contact manually.
    console.error(
      "[reviewSubmissionAction] Closure email failed — submission closed but submitter not emailed.",
      { submissionId, submitterEmail, error: emailResult.error }
    );
  }

  // Append internal note — mirrors the note already written by the sibling
  // needs_more_info/approve actions in this file.
  await supabase.from("operator_submission_notes").insert({
    submission_id:    submissionId,
    note:             emailResult.ok
      ? `Submission closed by founder. Closure email sent to ${submitterEmail}.`
      : `Submission closed by founder. Closure email to ${submitterEmail} failed to send.`,
    created_by:       user.id,
    created_by_email: user.email ?? null,
  });

  await logAuditEvent({
    actorEmail: user.email ?? "unknown",
    action:     "submission_closed",
    entityType: "operator_submission",
    entityId:   submissionId,
    entityName: venueName,
  });

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

  if (!user || !await isControlPanelAdmin(user.email)) {
    return { error: "Unauthorized." };
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

  // Prefer the stored Google match's structured city/province; fall back to
  // the submitter-provided (mandatory form fields) city/province.
  const resolvedCity     = (gm?.city          as string | null) ?? (sub.city           as string | null) ?? null;
  const resolvedProvince = (gm?.provinceShort as string | null) ?? (gm?.province as string | null) ?? (sub.province as string | null) ?? null;

  // ── Resolve canonical geography (market_id/city_id) ─────────────────────────
  // Never guessed: returns null when the city text doesn't confidently match
  // a seeded city. The venue is still created (unpublished, as today) with
  // market_id/city_id left NULL in that case — the publish-readiness gate
  // then blocks it clearly until a founder resolves geography.
  const geography = await resolveVenueGeography(supabase, {
    city:     resolvedCity,
    province: resolvedProvince,
  });
  if (!geography) {
    console.warn(
      "[approveAndCreateVenueAction] Could not resolve market/city for venue — " +
        "leaving market_id/city_id NULL. Venue will remain unpublishable until resolved.",
      { submissionId, venueName, city: resolvedCity }
    );
  }

  // ── Resolve coordinates (lat/lng) ──────────────────────────────────────────
  // Prefer the Google Places business-name match's coordinates when present
  // (existing behavior, unchanged). When the match failed (no_match —
  // google_match_json is null, a real and non-rare outcome, e.g. a
  // restaurant operating inside a hotel and indexed under the hotel's name)
  // or otherwise didn't include a location, fall back to geocoding the
  // submitter's street address directly via geocodeStreetAddress() — the
  // same Google Places API (New) Text Search integration, extended to
  // accept a plain address instead of a business name. Never fabricated:
  // if the fallback also fails, lat/lng are left NULL and the venue is
  // still created unpublished — the publish-readiness gate
  // (src/lib/venueReadiness.ts) blocks it from ever going live with
  // unresolved geography, the same safety net already used for a failed
  // market/city resolution above.
  const matchLat = gm?.lat as number | null | undefined;
  const matchLng = gm?.lng as number | null | undefined;

  let lat: number | null = typeof matchLat === "number" ? matchLat : null;
  let lng: number | null = typeof matchLng === "number" ? matchLng : null;

  if (lat === null || lng === null) {
    const submittedStreetAddress = (sub.street_address as string | null) ?? "";
    if (submittedStreetAddress && resolvedCity && resolvedProvince) {
      const geocodeResult = await geocodeStreetAddress({
        streetAddress: submittedStreetAddress,
        city:          resolvedCity,
        province:      resolvedProvince,
      });
      if (geocodeResult.ok) {
        lat = geocodeResult.lat;
        lng = geocodeResult.lng;
        console.log(
          "[approveAndCreateVenueAction] Address geocoding fallback succeeded (no Google business match).",
          { submissionId, venueName, lat, lng, formattedAddress: geocodeResult.formattedAddress }
        );
      } else {
        console.warn(
          "[approveAndCreateVenueAction] Address geocoding fallback failed — leaving lat/lng NULL. " +
            "Venue will remain unpublishable until a founder resolves location.",
          { submissionId, venueName, reason: geocodeResult.reason }
        );
      }
    } else {
      console.warn(
        "[approveAndCreateVenueAction] No Google match and insufficient address fields to geocode — " +
          "leaving lat/lng NULL. Venue will remain unpublishable until a founder resolves location.",
        { submissionId, venueName }
      );
    }
  }

  // ── Create unpublished venue ───────────────────────────────────────────────
  const { data: newVenue, error: venueError } = await supabase
    .from("venues")
    .insert({
      name:                 venueName,
      slug:                 slugBase,
      address_line1:        (gm?.streetAddress as string | null) ?? (sub.street_address as string | null) ?? null,
      city:                 resolvedCity,
      region:               resolvedProvince,
      postal_code:          (gm?.postalCode    as string | null) ?? null,
      country:              (gm?.country       as string | null) ?? null,
      lat,
      lng,
      phone,
      website_url:          (gm?.website       as string | null) ?? (sub.website as string | null) ?? null,
      place_id:             placeId,
      market_id:            geography?.marketId ?? null,
      city_id:              geography?.cityId ?? null,
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
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "CRITICAL: Submission Not Marked Approved — Operator Is Live",
      message:  "Provisioning succeeded and activation email sent, but operator_submissions row could not be updated to 'approved'. Manual DB fix required.",
      metadata: {
        "Submission ID": submissionId,
        Email:           email,
        "Venue ID":      venueId,
        "Auth User":     provisionResult.authUserId,
        "DB Error":      updateError.message,
      },
    });
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

  await logAuditEvent({
    actorEmail: user.email ?? "unknown",
    action:     "submission_approved",
    entityType: "operator_submission",
    entityId:   submissionId,
    entityName: venueName,
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

// ── Existing Venue Match Resolution (pending_review / double_claim) ──────────
//
// Resolves an Add Your Venue submission that matched an existing venue
// instead of requiring a new one. Handles both routing outcomes:
//
//   pending_review — confirmed Google match against an existing venue that
//                    was UNCLAIMED at submission time.
//   double_claim   — confirmed Google match against an existing venue that
//                    was already claimed/owned at submission time.
//
// Both statuses land here with venue_id already set (no venue is ever
// created by this action — see saveOperatorSubmissionAction Case B/C).
// Eligibility to approve is driven by the venue's CURRENT claim state,
// re-checked fresh at submit time — not by which of the two stored statuses
// the submission happens to carry. A submission stored as "double_claim" can
// still be approved if the conflicting claim has since been resolved and the
// venue is unclaimed again; a "pending_review" submission is blocked if the
// venue was claimed by someone else in the meantime. The stored status is
// preserved as-is (reflects the routing decision at submission time) and is
// never rewritten except to its terminal outcome (approved / closed).

export type ResolveExistingVenueMatchState = {
  success?: true;
  successAction?: string;
  error?: string;
};

// The only two routing statuses this action resolves. Intentionally
// disjoint from APPROVE_ELIGIBLE_STATUSES (new-venue creation) — a
// pending_review/double_claim submission always already has venue_id set,
// so it must never become eligible for "Approve & Create Venue" (which
// would attempt to create a duplicate venue; that action already guards on
// venue_id being NULL, but this action is the correct, intentional path).
const EXISTING_VENUE_MATCH_STATUSES = new Set(["pending_review", "double_claim"]);

/**
 * Approves an operator submission that matched an existing venue, linking
 * the submitter to that venue via the same provisioning path used by new
 * Add Your Venue venues and venue claims. Never creates a venue.
 *
 * Steps:
 *  1. Re-fetch the submission fresh; verify status is still pending_review
 *     or double_claim, and no operator has been provisioned for it yet.
 *  2. Re-fetch the linked venue fresh; verify it is CURRENTLY unclaimed
 *     (claimed_by AND created_by_operator_id both NULL) — this is the live
 *     state check, independent of the submission's stored status.
 *  3. Check for a conflicting active/approved venue_claims row on the same
 *     venue (the separate Claim Your Venue flow) — block if found.
 *  4. Check for another unresolved operator_submissions row targeting the
 *     same venue — block if found, to avoid two founder decisions racing.
 *  5. Call provisionOperatorForVenue() — creates/reuses the auth user,
 *     inserts the operator row, links the venue, sends the activation email.
 *     Handles its own internal rollback on failure.
 *  6. Update submission: status → approved, operator_id, reviewed_by/at.
 *  7. Append an internal note and audit log entry.
 *
 * All checks in steps 1-4 re-read the database immediately before acting —
 * a stale client render (e.g. the founder had the page open while the venue
 * was claimed by someone else) cannot bypass them.
 *
 * submissionId is bound via .bind(null, submissionId).
 */
export async function resolveExistingVenueMatchAction(
  submissionId: string,
  _prevState: ResolveExistingVenueMatchState,
  _formData: FormData
): Promise<ResolveExistingVenueMatchState> {
  // ── Authenticate ───────────────────────────────────────────────────────────
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user || !await isControlPanelAdmin(user.email)) {
    return { error: "Unauthorized." };
  }

  const supabase = createAdminClient();

  // ── Fetch submission fresh ─────────────────────────────────────────────────
  const { data: subRaw, error: fetchError } = await supabase
    .from("operator_submissions")
    .select("id, email, first_name, last_name, status, venue_id, operator_id")
    .eq("id", submissionId)
    .single();

  if (fetchError || !subRaw) {
    console.error("[resolveExistingVenueMatchAction] Fetch failed:", fetchError?.message);
    return { error: "Submission not found. Please refresh and try again." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = subRaw as any as Record<string, unknown>;

  // ── Server-side eligibility (re-checked, never trusts the client) ─────────
  if (!EXISTING_VENUE_MATCH_STATUSES.has(sub.status as string)) {
    return {
      error:
        `Cannot resolve a submission with status "${sub.status}". This action is only ` +
        `available for submissions matched to an existing venue awaiting review ` +
        `(pending_review or double_claim). Refresh to see the current state.`,
    };
  }
  if (sub.operator_id) {
    return {
      error: "An operator account has already been provisioned for this submission.",
    };
  }

  const venueId = sub.venue_id as string | null;
  if (!venueId) {
    return {
      error: "This submission has no linked venue — cannot resolve as an existing-venue match.",
    };
  }

  // ── Re-fetch the matched venue fresh — live claim state ────────────────────
  const { data: venueRow, error: venueFetchError } = await supabase
    .from("venues")
    .select("id, name, claimed_by, created_by_operator_id")
    .eq("id", venueId)
    .maybeSingle();

  if (venueFetchError || !venueRow) {
    console.error("[resolveExistingVenueMatchAction] Venue fetch failed:", venueFetchError?.message);
    return { error: "The matched venue could not be found. It may have been removed." };
  }

  if (venueRow.claimed_by != null || venueRow.created_by_operator_id != null) {
    return {
      error:
        "This venue is already claimed by another operator. Approving would reassign an " +
        "active listing, so this action is blocked. Reject / close this submission instead " +
        "— resolving ownership disputes requires a separate, deliberate manual step.",
    };
  }

  // ── Conflicting claim check (Claim Your Venue flow) ────────────────────────
  const { data: conflictingClaim } = await supabase
    .from("venue_claims")
    .select("id, status")
    .eq("venue_id", venueId)
    .in("status", ["pending", "needs_more_info", "approved"])
    .maybeSingle();

  if (conflictingClaim) {
    return {
      error:
        `This venue has an active claim (status: "${conflictingClaim.status}") through the ` +
        `Claim Your Venue flow. Resolve that claim first before approving this submission.`,
    };
  }

  // ── Conflicting submission check (another unresolved submission, same venue) ─
  const { data: conflictingSubmission } = await supabase
    .from("operator_submissions")
    .select("id, status")
    .eq("venue_id", venueId)
    .neq("id", submissionId)
    .in("status", ["pending_review", "double_claim", "needs_more_info", "info_submitted"])
    .maybeSingle();

  if (conflictingSubmission) {
    return {
      error:
        `Another submission (id: ${conflictingSubmission.id}, status: ` +
        `"${conflictingSubmission.status}") is also unresolved for this venue. Resolve that ` +
        `one first to avoid conflicting decisions.`,
    };
  }

  // ── Provision operator (reuses the same shared path as the other two ──────
  // Add Your Venue approve actions and the venue-claim approve flow) ────────
  const firstName = ((sub.first_name as string | null) ?? "").trim();
  const lastName  = ((sub.last_name  as string | null) ?? "").trim();
  const email     = sub.email as string;
  const venueName = venueRow.name as string;

  if (!email) {
    return { error: "Submission has no email address — cannot provision operator." };
  }

  const provisionResult = await provisionOperatorForVenue({
    email,
    firstName,
    lastName,
    venueId,
    logTag: "[resolveExistingVenueMatchAction]",
    sendEmail: (setupLink) =>
      sendOperatorActivationEmail({
        to:        email,
        firstName: firstName || "there",
        setupLink,
      }),
  });

  if (!provisionResult.ok) {
    return { error: provisionResult.error };
  }

  // ── Update submission ──────────────────────────────────────────────────────
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("operator_submissions")
    .update({
      status:      "approved",
      operator_id: provisionResult.authUserId,
      reviewed_by: user.id,
      reviewed_at: now,
    })
    .eq("id", submissionId);

  if (updateError) {
    // Provisioning succeeded and the activation email was sent — the operator
    // account is live and linked to the venue. Log a critical alert for
    // manual fix but do not fail (mirrors approveAndCreateVenueAction).
    console.error(
      "[resolveExistingVenueMatchAction] CRITICAL: provisioning succeeded but submission " +
      "update failed. Manual fix required: " +
      `operator_submissions.status='approved', operator_id='${provisionResult.authUserId}' ` +
      `for id='${submissionId}'.`,
      { dbError: updateError.message }
    );
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "CRITICAL: Submission Not Marked Approved — Operator Is Live",
      message:  "Provisioning succeeded and activation email sent, but operator_submissions row could not be updated to 'approved'. Manual DB fix required.",
      metadata: {
        "Submission ID": submissionId,
        Email:           email,
        "Venue ID":      venueId,
        "Auth User":     provisionResult.authUserId,
        "DB Error":      updateError.message,
      },
    });
  }

  // ── Append internal note ───────────────────────────────────────────────────
  await supabase.from("operator_submission_notes").insert({
    submission_id:    submissionId,
    note:
      `Founder approved — linked to existing venue "${venueName}" (id: ${venueId}). ` +
      `No new venue was created. Operator account provisioned for ${email}. Status → approved.`,
    created_by:       user.id,
    created_by_email: user.email ?? null,
  });

  await logAuditEvent({
    actorEmail: user.email ?? "unknown",
    action:     "submission_existing_venue_approved",
    entityType: "operator_submission",
    entityId:   submissionId,
    entityName: venueName,
  });

  console.log("[resolveExistingVenueMatchAction] Complete.", {
    submissionId,
    venueId,
    authUserId: provisionResult.authUserId,
  });

  revalidatePath("/control-panel/operator-submissions");
  revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  return {
    success:       true,
    successAction: "Approved — linked to existing venue, activation email sent",
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
  if (!user || !await isControlPanelAdmin(user.email)) return { error: "Unauthorized." };

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
  const appUrl     = getSiteUrl();
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

  if (!user || !await isControlPanelAdmin(user.email)) {
    return { error: "Unauthorized." };
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

  // Fetch venue name for audit log (best-effort)
  const { data: subForLog } = await supabase
    .from("operator_submissions")
    .select("venue_name")
    .eq("id", submissionId)
    .maybeSingle();

  await logAuditEvent({
    actorEmail: user.email ?? "unknown",
    action:     "submission_note_added",
    entityType: "operator_submission",
    entityId:   submissionId,
    entityName: (subForLog as { venue_name?: string } | null)?.venue_name ?? null,
  });

  revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  return { success: true };
}
