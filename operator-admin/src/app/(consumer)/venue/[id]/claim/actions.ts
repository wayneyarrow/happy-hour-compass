"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import {
  sendClaimNotificationEmail,
  sendClaimSubmissionConfirmationEmail,
} from "@/lib/email";
import {
  verifyTurnstileToken,
  getClientIpFromHeaders,
  TURNSTILE_FAILURE_MESSAGE,
  TURNSTILE_TOKEN_FIELD,
} from "@/lib/turnstile";
import { reportCriticalAcquisitionFailure } from "@/lib/observability/reportCriticalFailure";
import { isClaimAutoApprovalEnabled } from "@/lib/claims/claimAutoApprovalConfig";
import {
  runClaimAutoApproval,
  resolveAutoApprovedClaimContinuation,
  type ApprovedClaimSetup,
} from "@/lib/claims/claimAutoApprovalFlow";

// Flow slug shared by every reportCriticalAcquisitionFailure() call in this
// file. Only the unexpected primary-insert failure is instrumented — field
// validation, Turnstile failure, venue-not-found, already-claimed, and the
// 23505 "already under review" duplicate-claim outcome are all
// expected/business-rule paths and are deliberately left as-is.
const VENUE_CLAIM_FLOW = "venue-claim";

export type ClaimFormState = {
  success?: boolean;
  /** General (non-field) error shown above the form. */
  error?: string;
  /** Per-field validation errors. */
  fieldErrors?: Record<string, string>;
  turnstileFailed?: boolean;
  /**
   * Claim auto-approval (flag on): the claim was auto-approved for a new
   * operator — the browser goes straight to this HHC code screen (a code was
   * just emailed). Always a server-built relative "/operator/verify?t=…".
   */
  verificationPath?: string;
  /** Claim auto-approval: an existing activated operator — continue to sign in. */
  nextPath?: "/login";
  /**
   * Claim auto-approval, rare path: the claim IS approved but setup
   * continues by email instead of in-flow. The form must show "approved",
   * never "we'll review it". See ApprovedClaimSetup.
   */
  approvedSetup?: ApprovedClaimSetup;
};

const VALID_POSITIONS = ["Owner", "Manager", "Bartender", "Server", "Other"];

/**
 * Submits a venue claim intake record into venue_claims.
 *
 * venueRouteParam is the route [id] segment — either a slug or a UUID.
 * The actual DB UUID is resolved server-side (never trusted from the client).
 * IP address is captured from request headers (x-forwarded-for / x-real-ip).
 *
 * Bound via .bind(null, venueRouteParam) in ClaimForm.tsx so it matches the
 * (prevState, formData) => State signature expected by useActionState.
 */
export async function submitClaimAction(
  venueRouteParam: string,
  _prevState: ClaimFormState,
  formData: FormData
): Promise<ClaimFormState> {
  // Latency measurement only (logged on the auto-approval path; no PII).
  const actionStartedAt = Date.now();

  // ── Extract + sanitize fields ─────────────────────────────────────────────
  const firstName = (formData.get("first_name") as string | null)?.trim() ?? "";
  const lastName  = (formData.get("last_name")  as string | null)?.trim() ?? "";
  const position  = (formData.get("position")   as string | null)?.trim() ?? "";
  const phone     = (formData.get("phone")       as string | null)?.trim() ?? "";
  const email     = (formData.get("email")       as string | null)?.trim().toLowerCase() ?? "";

  // ── Server-side validation ────────────────────────────────────────────────
  const fieldErrors: Record<string, string> = {};

  if (!firstName) fieldErrors.first_name = "Required";
  if (!lastName)  fieldErrors.last_name  = "Required";
  if (!position || !VALID_POSITIONS.includes(position)) {
    fieldErrors.position = "Please select your role";
  }
  if (!phone) {
    fieldErrors.phone = "Required";
  }
  if (!email) {
    fieldErrors.email = "Required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Please enter a valid email address";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  // ── Capture IP server-side — never trust client ───────────────────────────
  const heads = await headers();
  const forwarded = heads.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0].trim()
    : (heads.get("x-real-ip") ?? null);

  // ── Turnstile verification — must pass before any side effect below ──────
  const turnstileToken = formData.get(TURNSTILE_TOKEN_FIELD) as string | null;
  const turnstileStartedAt = Date.now();
  const verification = await verifyTurnstileToken(turnstileToken, getClientIpFromHeaders(heads));
  const turnstileMs = Date.now() - turnstileStartedAt;
  if (!verification.success) {
    console.warn("[submitClaimAction] Turnstile verification failed:", verification.reason);
    return { error: TURNSTILE_FAILURE_MESSAGE, turnstileFailed: true };
  }

  // ── Resolve venue UUID from route param (slug or UUID) ───────────────────
  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function queryVenueFull(field: "slug" | "id"): Promise<Record<string, any> | null> {
    const { data } = await supabase
      .from("venues")
      .select("id, name, city, claimed_at, claimed_by, created_by_operator_id, phone, website_url, country, lat, lng")
      .eq(field, venueRouteParam)
      .eq("is_published", true)
      .maybeSingle();
    return data ?? null;
  }

  const venueRow = (await queryVenueFull("slug")) ?? (await queryVenueFull("id"));

  if (!venueRow) {
    return { error: "Venue not found." };
  }

  if (venueRow.claimed_at) {
    // Claim auto-approval: the same claimant re-submitting (retry/double
    // click) for a venue their own auto-approved claim already owns gets
    // the same HHC next step back, with nothing new issued.
    if (isClaimAutoApprovalEnabled()) {
      const continuation = await resolveAutoApprovedClaimContinuation({
        venueId: venueRow.id as string,
        claimedBy: (venueRow.claimed_by as string | null) ?? null,
        email,
      });
      if (continuation) return { success: true, ...continuation };
    }
    // Venue is already claimed — do not reveal claim details to public
    return { error: "This venue is not available to claim." };
  }

  // ── Insert claim record ───────────────────────────────────────────────────
  const { data: insertedClaim, error: insertError } = await supabase
    .from("venue_claims")
    .insert({
      venue_id:   venueRow.id as string,
      first_name: firstName,
      last_name:  lastName,
      position,
      phone,
      email,
      ip_address: ip,
      status:     "pending",
    })
    .select("id")
    .single();

  if (insertError) {
    // 23505 = unique_violation — partial unique index on (venue_id) WHERE status = 'pending'
    if (insertError.code === "23505") {
      return {
        error: "A claim request for this venue is already under review.",
      };
    }
    const report = await reportCriticalAcquisitionFailure({
      error: insertError,
      flow: VENUE_CLAIM_FLOW,
      stage: "claim-insert",
      title: "Venue Claim Failed",
      technicalSummary: "database write failed (venue_claims insert)",
      context: { venueId: venueRow.id },
      slackFields: { Venue: venueRow.name as string, "Venue ID": venueRow.id },
    });
    return { error: report.customerMessage };
  }

  // ── Send emails — awaited; failure is non-blocking but must be logged ────────
  // Fire-and-forget (.then()) is NOT safe in Vercel serverless — the runtime
  // exits after the return value is serialised, cutting off any pending Promise.
  const submittedAt = new Date().toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });

  // ── Claim auto-approval (flag on only) ────────────────────────────────────
  // The claim row above was inserted as `pending`, so the one-pending-claim-
  // per-venue index has already serialized competing claims. The flow owns
  // every notification from here (founder email/Slack with the decision,
  // claimant confirmation when held). Flag off: today's flow, unchanged.
  if (isClaimAutoApprovalEnabled()) {
    const flowStartedAt = Date.now();
    const result = await runClaimAutoApproval({
      claim: { id: insertedClaim.id as string, email, phone, position, ipAddress: ip },
      venue: {
        id: venueRow.id as string,
        name: venueRow.name as string,
        country: (venueRow.country as string | null) ?? null,
        lat: (venueRow.lat as number | null) ?? null,
        lng: (venueRow.lng as number | null) ?? null,
        phone: (venueRow.phone as string | null) ?? null,
        websiteUrl: (venueRow.website_url as string | null) ?? null,
        claimedAt: (venueRow.claimed_at as string | null) ?? null,
        claimedBy: (venueRow.claimed_by as string | null) ?? null,
        createdByOperatorId: (venueRow.created_by_operator_id as string | null) ?? null,
      },
      requestHeaders: heads,
      claimant: { firstName, lastName, email, phone, position },
      venueCity: (venueRow.city as string | null) ?? null,
      submittedAt,
    });
    console.log("[submitClaimAction] timing", {
      claimId: insertedClaim.id,
      turnstileMs,
      beforeFlowMs: flowStartedAt - actionStartedAt,
      flowMs: Date.now() - flowStartedAt,
      totalMs: Date.now() - actionStartedAt,
    });
    if (result.outcome === "auto_approved") {
      return {
        success: true,
        verificationPath: result.verificationPath,
        nextPath: result.nextPath,
        approvedSetup: result.approvedSetup,
      };
    }
    return { success: true };
  }

  // Founder notification
  console.log("[EMAIL] submitClaimAction — sending founder notification", {
    claimId: insertedClaim.id,
    venueName: venueRow.name,
    flow: "claim-notification",
  });
  try {
    const founderResult = await sendClaimNotificationEmail({
      claimId:       insertedClaim.id as string,
      venueName:     venueRow.name as string,
      city:          venueRow.city as string | null,
      firstName,
      lastName,
      claimantEmail: email,
      phone,
      submittedAt,
    });
    if (!founderResult.ok) {
      console.error("[EMAIL] submitClaimAction — founder notification not-ok:", founderResult.error);
    } else {
      console.log("[EMAIL] submitClaimAction — founder notification sent successfully");
    }
  } catch (err) {
    console.error("[EMAIL] submitClaimAction — founder notification threw:", err);
  }

  // Claimant confirmation
  console.log("[EMAIL] submitClaimAction — sending claimant confirmation", {
    claimantEmail: email,
    venueName: venueRow.name,
    flow: "claim-submission-confirmation",
  });
  try {
    const confirmResult = await sendClaimSubmissionConfirmationEmail({
      to:        email,
      firstName,
      venueName: venueRow.name as string,
    });
    if (!confirmResult.ok) {
      console.error("[EMAIL] submitClaimAction — claimant confirmation not-ok:", confirmResult.error);
    } else {
      console.log("[EMAIL] submitClaimAction — claimant confirmation sent successfully");
    }
  } catch (err) {
    console.error("[EMAIL] submitClaimAction — claimant confirmation threw:", err);
  }

  return { success: true };
}
