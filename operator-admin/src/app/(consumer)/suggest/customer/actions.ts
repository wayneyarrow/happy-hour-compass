"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { sendSuggestionNotificationEmail, sendSuggestionConfirmationEmail } from "@/lib/email";
import {
  verifyTurnstileToken,
  getClientIpFromHeaders,
  TURNSTILE_FAILURE_MESSAGE,
  TURNSTILE_TOKEN_FIELD,
} from "@/lib/turnstile";

export type SuggestionFormState = {
  success?: boolean;
  /** General (non-field) error shown above the form. */
  error?: string;
  /** Per-field validation errors. */
  fieldErrors?: Record<string, string>;
  turnstileFailed?: boolean;
};

/**
 * Submits a consumer venue suggestion to venue_suggestions.
 *
 * Writes the row first; email notification is awaited with try/catch.
 * Email failure is logged server-side but does not block the success state.
 * This matches the same pattern used by submitClaimAction.
 */
export async function submitSuggestionAction(
  _prevState: SuggestionFormState,
  formData: FormData
): Promise<SuggestionFormState> {
  // ── Extract + sanitize fields ─────────────────────────────────────────────
  const name              = (formData.get("name")                   as string | null)?.trim() ?? "";
  const city              = (formData.get("city")                   as string | null)?.trim() ?? "";
  const notes             = (formData.get("notes")                  as string | null)?.trim() || null;
  const customerName      = (formData.get("customer_name")          as string | null)?.trim() || null;
  const customerEmail     = (formData.get("customer_email")         as string | null)?.trim().toLowerCase() || null;
  const marketingOptIn    = formData.get("email_marketing_opt_in") === "true";
  const marketingOptedInAt = (marketingOptIn && customerEmail) ? new Date().toISOString() : null;

  // ── Server-side validation ────────────────────────────────────────────────
  const fieldErrors: Record<string, string> = {};

  if (!name) fieldErrors.name = "Required";
  if (!city) fieldErrors.city = "Required";

  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    fieldErrors.customer_email = "Please enter a valid email address";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  // ── Turnstile verification — must pass before any side effect below ──────
  const heads = await headers();
  const turnstileToken = formData.get(TURNSTILE_TOKEN_FIELD) as string | null;
  const verification = await verifyTurnstileToken(turnstileToken, getClientIpFromHeaders(heads));
  if (!verification.success) {
    console.warn("[submitSuggestionAction] Turnstile verification failed:", verification.reason);
    return { error: TURNSTILE_FAILURE_MESSAGE, turnstileFailed: true };
  }

  // ── Insert suggestion record ──────────────────────────────────────────────
  const supabase = createAdminClient();

  const { data: inserted, error: insertError } = await supabase
    .from("venue_suggestions")
    .insert({
      name,
      city,
      notes,
      customer_name:               customerName,
      customer_email:              customerEmail,
      email_marketing_opt_in:      marketingOptIn,
      email_marketing_opted_in_at: marketingOptedInAt,
    })
    .select("id, submitted_at")
    .single();

  if (insertError) {
    console.error("[submitSuggestionAction] Insert error:", insertError);
    return { error: "Something went wrong. Please try again." };
  }

  // ── Notify founder — fire-and-forget; email failure must not block consumer ─
  // Pattern mirrors submitClaimAction: call the email helper directly and let
  // its internal try/catch handle any Resend errors or missing env vars.
  const submittedAt = new Date(inserted.submitted_at as string).toLocaleString(
    "en-CA",
    { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" }
  );

  console.log("[EMAIL] submitSuggestionAction — sending founder notification", {
    suggestionId: inserted.id,
    venueName: name,
    city,
    flow: "suggestion-notification",
  });

  try {
    const emailResult = await sendSuggestionNotificationEmail({
      suggestionId:  inserted.id as string,
      venueName:     name,
      city,
      notes:         notes ?? undefined,
      customerName,
      customerEmail,
      marketingOptIn,
      submittedAt,
    });
    if (!emailResult.ok) {
      console.error("[submitSuggestionAction] Notification email failed:", emailResult.error);
    }
  } catch (emailErr) {
    console.error("[submitSuggestionAction] Notification email threw unexpected exception:", emailErr);
  }

  // ── Confirmation email to submitter (if email provided) ───────────────────
  if (customerEmail) {
    console.log("[EMAIL] submitSuggestionAction — sending submitter confirmation", {
      suggestionId: inserted.id,
      venueName: name,
      marketingOptIn,
      flow: "suggestion-confirmation",
    });
    try {
      const confirmResult = await sendSuggestionConfirmationEmail({
        to:            customerEmail,
        venueName:     name,
        customerName,
        marketingOptIn,
      });
      if (!confirmResult.ok) {
        console.error("[submitSuggestionAction] Confirmation email failed:", confirmResult.error);
      }
    } catch (confirmErr) {
      console.error("[submitSuggestionAction] Confirmation email threw unexpected exception:", confirmErr);
    }
  }

  return { success: true };
}
