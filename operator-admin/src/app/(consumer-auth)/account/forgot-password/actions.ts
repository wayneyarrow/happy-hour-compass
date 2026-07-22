"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/siteUrl";
import {
  verifyTurnstileToken,
  getClientIpFromHeaders,
  TURNSTILE_FAILURE_MESSAGE,
} from "@/lib/turnstile";

export type RequestConsumerPasswordResetResult =
  | { ok: true }
  | { ok: false; error: string; turnstileFailed?: boolean };

/**
 * Requests a Supabase password-reset email for a consumer account.
 *
 * Always resolves { ok: true } once Turnstile verification passes,
 * regardless of whether the email matches an account — prevents account
 * enumeration, matching the same convention already used by the operator
 * forgot-password flow (forgotPasswordAction, src/app/forgot-password/actions.ts).
 *
 * This used to be a direct supabase.auth.resetPasswordForEmail() call from
 * the browser (ConsumerForgotPasswordPage). Moved server-side so the
 * Turnstile token can be verified — and the reset email blocked on failure —
 * before Supabase is asked to send anything; a client-only call has no point
 * to gate server-side.
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
  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${getSiteUrl()}/account/reset-password`,
  });

  return { ok: true };
}
