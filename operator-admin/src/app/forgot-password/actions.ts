"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { sendPasswordResetEmail } from "@/lib/email";
import { sendSlackAlert } from "@/lib/slack";

export type ForgotPasswordState = {
  success?: true;
  error?: string;
  fieldError?: string;
};

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Sends a password reset email to an operator if an account exists for the
 * given email address.
 *
 * Security invariants:
 *   - Always returns { success: true } regardless of whether an account was
 *     found or whether delivery succeeded — prevents account enumeration.
 *   - Only generates recovery links for emails that exist in the operators
 *     table — not for any arbitrary Supabase auth user.
 *   - Email is normalised to lowercase before any lookup.
 *   - Slack alerts fire only for known-operator failures (generateLink or
 *     email delivery). Unknown emails never alert.
 */
export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const rawEmail = (formData.get("email") as string | null)?.trim() ?? "";
  const email = rawEmail.toLowerCase();

  // ── Basic validation ───────────────────────────────────────────────────────
  if (!email) {
    return { fieldError: "Email address is required." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { fieldError: "Please enter a valid email address." };
  }

  const supabase = createAdminClient();

  // ── Check for an operator account ──────────────────────────────────────────
  // Uses maybeSingle() — no row found is not an error, just a no-op.
  const { data: operatorRow } = await supabase
    .from("operators")
    .select("id, first_name")
    .eq("email", email)
    .maybeSingle();

  if (!operatorRow?.id) {
    // No operator found — return success silently.
    // No Slack alert, no indication to the user.
    return { success: true };
  }

  const firstName = ((operatorRow.first_name as string | null) ?? "").trim() || undefined;

  // ── Generate a Supabase recovery link ─────────────────────────────────────
  const appUrl = getAppUrl();
  const redirectTo = `${appUrl}/operator/create-password`;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type:    "recovery",
    email,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error("[forgotPasswordAction] generateLink failed:", linkError?.message);
    await sendSlackAlert({
      channel:  "ops-alerts",
      severity: "warning",
      title:    "Forgot Password — Recovery Link Generation Failed",
      message:  "An operator requested a password reset but the Supabase recovery link could not be generated.",
      metadata: {
        Flow:        "forgotPasswordAction",
        Email:       email,
        Error:       linkError?.message ?? "unknown",
        Environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      },
    });
    // Still return success — do not reveal account existence or internal errors.
    return { success: true };
  }

  // ── Send branded reset email via Resend ────────────────────────────────────
  await sendPasswordResetEmail({
    to:        email,
    firstName,
    resetLink: linkData.properties.action_link,
  });

  // Slack escalation on failure is handled by sendTransactionalEmail
  // (password_reset → critical → #ops-critical). Always return success to
  // prevent account enumeration — never reveal delivery outcome to the caller.
  return { success: true };
}
