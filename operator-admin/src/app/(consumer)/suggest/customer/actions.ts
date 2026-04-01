"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { sendSuggestionNotificationEmail } from "@/lib/email";

export type SuggestionFormState = {
  success?: boolean;
  /** General (non-field) error shown above the form. */
  error?: string;
  /** Per-field validation errors. */
  fieldErrors?: Record<string, string>;
};

/**
 * Submits a consumer venue suggestion to venue_suggestions.
 *
 * Writes the row first; email notification is fire-and-forget.
 * Email failure is logged server-side but does not block the success state.
 * This matches the same pattern used by submitClaimAction.
 */
export async function submitSuggestionAction(
  _prevState: SuggestionFormState,
  formData: FormData
): Promise<SuggestionFormState> {
  // ── Extract + sanitize fields ─────────────────────────────────────────────
  const name          = (formData.get("name")           as string | null)?.trim() ?? "";
  const city          = (formData.get("city")           as string | null)?.trim() ?? "";
  const notes         = (formData.get("notes")          as string | null)?.trim() || null;
  const customerName  = (formData.get("customer_name")  as string | null)?.trim() || null;
  const customerEmail = (formData.get("customer_email") as string | null)?.trim().toLowerCase() || null;

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

  // ── Insert suggestion record ──────────────────────────────────────────────
  const supabase = createAdminClient();

  const { data: inserted, error: insertError } = await supabase
    .from("venue_suggestions")
    .insert({
      name,
      city,
      notes,
      customer_name:  customerName,
      customer_email: customerEmail,
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

  sendSuggestionNotificationEmail({
    suggestionId: inserted.id as string,
    venueName:    name,
    city,
    notes:        notes ?? undefined,
    submittedAt,
  }).then(({ ok, error: emailErr }) => {
    if (!ok) {
      console.error("[submitSuggestionAction] Notification email failed:", emailErr);
    }
  });

  return { success: true };
}
