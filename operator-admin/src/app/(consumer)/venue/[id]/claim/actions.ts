"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { sendClaimNotificationEmail } from "@/lib/email";

export type ClaimFormState = {
  success?: boolean;
  /** General (non-field) error shown above the form. */
  error?: string;
  /** Per-field validation errors. */
  fieldErrors?: Record<string, string>;
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

  // ── Resolve venue UUID from route param (slug or UUID) ───────────────────
  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function queryVenueFull(field: "slug" | "id"): Promise<Record<string, any> | null> {
    const { data } = await supabase
      .from("venues")
      .select("id, name, claimed_at")
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
    console.error("[submitClaimAction] Insert error:", insertError);
    return { error: "Something went wrong. Please try again." };
  }

  // ── Notify founder — fire-and-forget; email failure must not block the claim ─
  const submittedAt = new Date().toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });

  sendClaimNotificationEmail({
    claimId:       insertedClaim.id as string,
    venueName:     venueRow.name as string,
    firstName,
    lastName,
    claimantEmail: email,
    phone,
    submittedAt,
  }).then(({ ok, error: emailErr }) => {
    if (!ok) {
      console.error("[submitClaimAction] Founder notification failed:", emailErr);
    }
  });

  return { success: true };
}
