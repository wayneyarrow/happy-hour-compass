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
