"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/siteUrl";
import { sendConsumerSignupConfirmationEmail, sendConsumerSignupFounderNotificationEmail } from "@/lib/email";
import { sendSlackAcquisitionNotification } from "@/lib/slack";
import {
  verifyTurnstileToken,
  getClientIpFromHeaders,
  TURNSTILE_FAILURE_MESSAGE,
} from "@/lib/turnstile";

export async function createConsumerProfile({
  userId,
  email,
  displayName,
  termsAcceptedAt,
  privacyAcceptedAt,
  marketingConsent,
  marketingConsentAt,
}: {
  userId: string;
  email: string;
  displayName: string | null;
  termsAcceptedAt: string;
  privacyAcceptedAt: string;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("consumer_profiles").upsert(
    {
      id: userId,
      email,
      display_name: displayName,
      terms_accepted_at: termsAcceptedAt,
      privacy_accepted_at: privacyAcceptedAt,
      marketing_consent: marketingConsent,
      marketing_consent_at: marketingConsentAt,
      last_login_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("[createConsumerProfile]", error.message, "userId:", userId);
    return error.message;
  }

  return null;
}

export type CreateConsumerAccountResult =
  | { ok: true }
  | { ok: false; error: string; turnstileFailed?: boolean };

/**
 * Creates a new consumer auth user, creates their consumer_profiles row,
 * sends a branded confirmation-link email, and notifies the founder — all
 * server-side, using the Supabase admin API rather than the public client
 * SDK's supabase.auth.signUp().
 *
 * This mirrors provisionOperatorForVenue's auth.admin.generateLink pattern
 * (src/lib/operatorActivation.ts): generateLink({ type: "signup" }) both
 * creates the (unconfirmed) auth user and returns a confirmation action
 * link, without Supabase auto-sending its own email. The link's redirectTo
 * is built from getSiteUrl() so it resolves to whatever environment this is
 * actually running in (staging vs. production) rather than the client
 * SDK's emailRedirectTo, whose confirmation email is sent by Supabase's own
 * infrastructure and — per the same environment-URL problem getSiteUrl()
 * was introduced to fix for every other email in this codebase (see the
 * header comment in src/lib/email.ts) — is governed by the Supabase
 * project's single dashboard-configured Site URL rather than the current
 * deployment's actual origin.
 *
 * The confirmation link resolves through /auth/confirm?next=/welcome — a
 * dedicated hash-fragment session handler (src/app/auth/confirm/page.tsx),
 * not /auth/callback. generateLink() is called server-side with no browser
 * PKCE code_verifier available, so Supabase can only redirect back with
 * tokens in the URL hash fragment (#access_token=...&type=signup) rather
 * than a ?code=... query param — the same implicit-flow shape already
 * documented for the admin-generated operator recovery link in
 * /operator/create-password. /auth/callback only understands the ?code=
 * query-param (PKCE) shape, so it cannot be used here.
 */
export async function createConsumerAccount({
  email,
  password,
  displayName,
  marketingConsent,
  turnstileToken,
}: {
  email: string;
  password: string;
  displayName: string | null;
  marketingConsent: boolean;
  turnstileToken: string | null;
}): Promise<CreateConsumerAccountResult> {
  // ── Turnstile verification — must pass before any side effect below ──────
  const heads = await headers();
  const verification = await verifyTurnstileToken(turnstileToken, getClientIpFromHeaders(heads));
  if (!verification.success) {
    console.warn("[createConsumerAccount] Turnstile verification failed:", verification.reason);
    return { ok: false, error: TURNSTILE_FAILURE_MESSAGE, turnstileFailed: true };
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        consumer_terms_accepted_at: now,
        consumer_privacy_accepted_at: now,
        consumer_marketing_consent: marketingConsent,
        consumer_marketing_consent_at: marketingConsent ? now : null,
      },
      redirectTo: `${getSiteUrl()}/auth/confirm?next=/welcome`,
    },
  });

  if (linkError || !linkData?.properties?.action_link || !linkData.user) {
    // Matches the duplicate-detection convention already used in
    // provisionOperatorForVenue (src/lib/operatorActivation.ts) for the
    // equivalent admin.createUser "already exists" case.
    const isDuplicate = linkError?.message?.toLowerCase().includes("already");
    console.error("[createConsumerAccount] generateLink failed:", linkError?.message);
    return {
      ok: false,
      error: isDuplicate
        ? "An account with this email already exists. Please sign in instead, or use a different email."
        : "Something went wrong. Please try again.",
    };
  }

  // ── Notify founder — fire-and-forget; email failure must not block account
  // creation or the consumer's success screen. Matches submitSuggestionAction's
  // pattern (src/app/(consumer)/suggest/customer/actions.ts): the account is
  // already confirmed created (the early return above already ruled out
  // failed/duplicate signups), so this can't fire for those cases.
  const signupAt = new Date(now).toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });
  try {
    const founderResult = await sendConsumerSignupFounderNotificationEmail({
      displayName,
      email,
      signupAt,
    });
    if (!founderResult.ok) {
      console.error("[createConsumerAccount] Founder notification email failed:", founderResult.error);
    }
  } catch (founderErr) {
    console.error("[createConsumerAccount] Founder notification email threw unexpected exception:", founderErr);
  }

  const profileError = await createConsumerProfile({
    userId: linkData.user.id,
    email,
    displayName,
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    marketingConsent,
    marketingConsentAt: marketingConsent ? now : null,
  });

  if (profileError) {
    console.error("[createConsumerAccount] createConsumerProfile failed:", profileError);
    // Auth user was created. Profile creation failed — likely a transient error.
    // /auth/confirm (src/app/auth/confirm/page.tsx) re-calls createConsumerProfile
    // once the user confirms and a session is established, so this is retried
    // rather than lost. Don't block the success screen; the user still needs to
    // confirm their email.
  }

  const emailResult = await sendConsumerSignupConfirmationEmail({
    to: email,
    firstName: displayName,
    confirmLink: linkData.properties.action_link,
  });

  if (!emailResult.ok) {
    // sendTransactionalEmail already escalates critical failures to
    // #ops-critical. The account itself was created successfully, so this
    // doesn't block the user's success screen — matching how a failure here
    // was already invisible to the app under the previous Supabase-sent-email
    // flow (Supabase's own email delivery wasn't observable at all before).
    console.error("[createConsumerAccount] Confirmation email failed:", emailResult.error);
  }

  const slackResult = await sendSlackAcquisitionNotification({
    channel: "consumer-signup",
    text: displayName
      ? `${displayName} (${email}) just created an account.`
      : `${email} just created an account.`,
  });
  if (slackResult !== "delivered" && slackResult !== "no-webhook") {
    console.error("[createConsumerAccount] Slack notification not delivered.", { result: slackResult });
  }

  return { ok: true };
}
