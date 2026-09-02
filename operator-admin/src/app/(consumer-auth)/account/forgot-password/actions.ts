"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/siteUrl";
import { generateLinkWithRetry } from "@/lib/supabase/generateLinkWithRetry";
import { buildTokenHashRecoveryLink } from "@/lib/supabase/recoveryLink";
import { sendPasswordResetEmail } from "@/lib/email";
import { sendSlackAlert } from "@/lib/slack";
import {
  verifyTurnstileToken,
  getClientIpFromHeaders,
  TURNSTILE_FAILURE_MESSAGE,
} from "@/lib/turnstile";

export type RequestConsumerPasswordResetResult =
  | { ok: true }
  | { ok: false; error: string; turnstileFailed?: boolean };

/**
 * Requests a password-reset email for a consumer account.
 *
 * Always resolves { ok: true } once Turnstile verification passes,
 * regardless of whether the email matches an account — prevents account
 * enumeration, matching the same convention already used by the operator
 * forgot-password flow (forgotPasswordAction, src/app/forgot-password/actions.ts).
 *
 * This used to call supabase.auth.resetPasswordForEmail(), letting Supabase
 * render and send the whole email itself. That produced Supabase's default,
 * unbranded "Reset Password" template — sent through Supabase's own mail
 * infrastructure rather than the app's verified Resend domain — which Gmail
 * flagged with a "This message might be dangerous" warning in staging
 * end-to-end testing (2026-07-24). It also had no observable success/failure
 * signal to hang a Slack alert off of.
 *
 * Now mirrors forgotPasswordAction's own pattern instead: generate the
 * recovery link via admin.generateLink() and send our own branded email via
 * sendPasswordResetEmail() (Resend, hello@happyhourcompass.com — the same
 * authenticated sender every other transactional email in this codebase
 * already uses without triggering a Gmail warning).
 *
 * IMPORTANT — the link sent is NOT linkData.properties.action_link (the raw
 * .../auth/v1/verify?... URL). It's rebuilt via buildTokenHashRecoveryLink()
 * (src/lib/supabase/recoveryLink.ts) as
 * `${redirectTo}?token_hash=${hashed_token}&type=recovery`, matching exactly
 * the shape the Reset Password *email template* was previously changed to
 * produce (see CLAUDE.md's Authentication & Email section and commit
 * 1e7067a, "Prevent password reset links from being consumed on page load").
 * hashed_token is the same value Supabase's own {{ .TokenHash }} template
 * variable would resolve to for this exact operation. forgotPasswordAction
 * (the operator flow, src/app/forgot-password/actions.ts) now builds its
 * link through the same helper — see that file's header comment. This preserves
 * /account/reset-password's existing token_hash + explicit-Continue-click
 * flow untouched: that page defers auth.verifyOtp() to a manual button click
 * specifically so an email security scanner prefetching the link cannot
 * consume the single-use recovery token before the user opens it. Sending
 * the raw action_link here instead would silently reintroduce that bug.
 *
 * redirectTo is already built from getSiteUrl(), so it resolves to the
 * correct per-environment origin (confirmed: staging Preview has
 * NEXT_PUBLIC_SITE_URL=https://staging.happyhourcompass.com). That alone is
 * NOT sufficient — Supabase's /auth/v1/verify endpoint only honours a
 * redirect_to it recognises. Every one of these redirectTo paths must also
 * be added to the Supabase dashboard under Auth → URL Configuration →
 * Redirect URLs, for every environment that uses it:
 *   http://localhost:3000/account/reset-password
 *   https://staging.happyhourcompass.com/account/reset-password
 *   https://happyhourcompass.com/account/reset-password
 * If a redirect_to isn't listed there, Supabase does not error — it
 * silently falls back to the project's single, environment-invariant Site
 * URL, stripping the path and appending the recovery tokens to the bare
 * domain instead (see RecoveryRedirect.tsx and sign-up/actions.ts for the
 * two other times this exact failure mode has hit this codebase). This is
 * dashboard-only configuration, invisible to git history or any repo file.
 */
export async function requestConsumerPasswordReset({
  email,
  turnstileToken,
}: {
  email: string;
  turnstileToken: string | null;
}): Promise<RequestConsumerPasswordResetResult> {
  const heads = await headers();
  const verification = await verifyTurnstileToken(turnstileToken, getClientIpFromHeaders(heads));
  if (!verification.success) {
    console.warn("[requestConsumerPasswordReset] Turnstile verification failed:", verification.reason);
    return { ok: false, error: TURNSTILE_FAILURE_MESSAGE, turnstileFailed: true };
  }

  const supabase = createAdminClient();
  const normalizedEmail = email.trim().toLowerCase();
  const redirectTo = `${getSiteUrl()}/account/reset-password`;

  // Retries the known transient Supabase JWT/kid failure (see
  // generateLinkWithRetry's header comment) — the same intermittent
  // generateLink failure already confirmed to hit operator provisioning
  // and the operator forgot-password flow.
  const { data: linkData, error: linkError } = await generateLinkWithRetry(supabase, {
    type:    "recovery",
    email:   normalizedEmail,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    // "user_not_found" just means no consumer account exists for this email —
    // expected for unknown addresses, never alerted on or revealed to the
    // caller (account-enumeration guard, same as forgotPasswordAction's
    // silent no-op for an unmatched email). Any other error is a genuine
    // failure worth ops visibility.
    if (linkError?.code !== "user_not_found") {
      console.error("[requestConsumerPasswordReset] generateLink failed:", linkError?.message);
      await sendSlackAlert({
        channel:  "ops-alerts",
        severity: "warning",
        title:    "Consumer Forgot Password — Recovery Link Generation Failed",
        message:  "A consumer requested a password reset but the Supabase recovery link could not be generated.",
        metadata: {
          Flow:        "requestConsumerPasswordReset",
          Error:       linkError?.message ?? "unknown",
          Environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
        },
      });
    }
    return { ok: true };
  }

  const resetLink = buildTokenHashRecoveryLink(redirectTo, linkData.properties.hashed_token);

  // Slack escalation on delivery failure is handled by sendTransactionalEmail
  // (password_reset → critical → #ops-critical), same as the operator flow.
  await sendPasswordResetEmail({
    to: normalizedEmail,
    resetLink,
  });

  return { ok: true };
}
