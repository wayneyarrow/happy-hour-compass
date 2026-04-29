"use server";

import { createAdminClient } from "@/lib/supabase/server";
import {
  sendContactFounderNotificationEmail,
  sendContactSubmitterConfirmationEmail,
} from "@/lib/email";

export type ContactFormState = {
  success?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function submitContactAction(
  _prevState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const name    = (formData.get("name")    as string | null)?.trim() || null;
  const email   = (formData.get("email")   as string | null)?.trim().toLowerCase() ?? "";
  const message = (formData.get("message") as string | null)?.trim() ?? "";

  const fieldErrors: Record<string, string> = {};
  if (!email) {
    fieldErrors.email = "Required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Please enter a valid email address";
  }
  if (!message) fieldErrors.message = "Required";

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  // 1. DB insert
  const supabase = createAdminClient();
  const { data: inserted, error: insertError } = await supabase
    .from("contact_messages")
    .insert({ name, email, message })
    .select("id, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("[submitContactAction] Insert error:", insertError);
    return { error: "Something went wrong. Please try again." };
  }

  console.log("[submitContactAction] contact_message inserted:", { id: inserted.id, email });

  const submittedAt = new Date(inserted.created_at as string).toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });

  // 2. Founder email — must succeed; failure returns error to user
  console.log("[EMAIL] submitContactAction — attempting founder notification", { id: inserted.id });
  const founderResult = await sendContactFounderNotificationEmail({
    messageId:   inserted.id as string,
    name,
    email,
    message,
    submittedAt,
  });

  if (!founderResult.ok) {
    console.error("[EMAIL] submitContactAction — founder email failed:", founderResult.error);
    return { error: "Something went wrong sending your message. Please try again." };
  }

  console.log("[EMAIL] submitContactAction — founder email sent successfully");

  // 3. Submitter confirmation — failure is logged but does not block success
  console.log("[EMAIL] submitContactAction — attempting submitter confirmation", { to: email });
  const confirmResult = await sendContactSubmitterConfirmationEmail({ to: email, name });

  if (!confirmResult.ok) {
    console.error("[EMAIL] submitContactAction — submitter confirmation failed:", confirmResult.error);
  } else {
    console.log("[EMAIL] submitContactAction — submitter confirmation sent successfully");
  }

  return { success: true };
}
