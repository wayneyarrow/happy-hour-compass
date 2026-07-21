"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPasswordResetEmail } from "@/lib/email";
import { sendSlackAlert } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { getActiveMemberMembershipByEmail } from "@/lib/memberships";
import {
  verifyTurnstileToken,
  getClientIpFromHeaders,
  TURNSTILE_FAILURE_MESSAGE,
  TURNSTILE_TOKEN_FIELD,
} from "@/lib/turnstile";

export type ForgotPasswordState = {
  success?: true;
  error?: string;
  fieldError?: string;
  turnstileFailed?: boolean;
};

/**
 * Sends a password reset email to an operator if an account exists for the
 * given email address.
 *
 * Security invariants:
 *   - Always returns { success: true } regardless of whether an account was
 *     found or whether delivery succeeded — prevents account enumeration.
 *   - Only generates recovery links for emails that resolve to a known
 *     account — either an owner (a row in `operators`) or an active,
 *     invited team member (a `role='member'` row in `operator_memberships`)
 *     — not for any arbitrary Supabase auth user. Both are real, independent
 *     Supabase Auth users; only owners get their own `operators` row, so a
 *     team member's email is never found there and must be checked
 *     separately (see getActiveMemberMembershipByEmail below).
 *   - Email is normalised to lowercase before any lookup.
 *   - Slack alerts fire only for known-account failures (generateLink or
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

  // ── Turnstile verification — must pass before any side effect below ──────
  const heads = await headers();
  const turnstileToken = formData.get(TURNSTILE_TOKEN_FIELD) as string | null;
  const verification = await verifyTurnstileToken(turnstileToken, getClientIpFromHeaders(heads));
  if (!verification.success) {
    console.warn("[forgotPasswordAction] Turnstile verification failed:", verification.reason);
    return { error: TURNSTILE_FAILURE_MESSAGE, turnstileFailed: true };
  }

  const supabase = createAdminClient();

  // ── Check for an operator account (owner) ────────────────────────────────
  // Uses maybeSingle() — no row found is not an error, just a no-op.
  const { data: operatorRow } = await supabase
    .from("operators")
    .select("id, first_name")
    .eq("email", email)
    .maybeSingle();

  let firstName: string | undefined;

  if (operatorRow?.id) {
    firstName = ((operatorRow.first_name as string | null) ?? "").trim() || undefined;
  } else {
    // ── Fall back to an active team-member account ─────────────────────────
    // Invited team members (operator_memberships.role='member') are real,
    // independent Supabase Auth users created by acceptInviteAction, but they
    // never get their own `operators` row — only the account owner does. Without
    // this fallback, every non-owner team member's reset request matched
    // nothing above and the function returned success without ever generating
    // a recovery link or sending an email — this was the root cause of
    // "reports success but no email received" for team-member accounts.
    const membership = await getActiveMemberMembershipByEmail(email);
    if (!membership) {
      // No operator and no active team member found — return success silently.
      // No Slack alert, no indication to the user.
      return { success: true };
    }
    firstName = undefined;
  }

  // ── Generate a Supabase recovery link ─────────────────────────────────────
  const appUrl = getSiteUrl();
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
