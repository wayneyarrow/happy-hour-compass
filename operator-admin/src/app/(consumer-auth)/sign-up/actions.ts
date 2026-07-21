"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/siteUrl";
import { sendConsumerSignupConfirmationEmail } from "@/lib/email";
import { sendSlackAcquisitionNotification } from "@/lib/slack";

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
  | { ok: false; error: string };

/**
 * Creates a new consumer auth user, creates their consumer_profiles row, and
 * sends a branded confirmation-link email — server-side, using the Supabase
 * admin API rather than the public client SDK's supabase.auth.signUp().
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
 * The confirmation link still resolves through the existing /auth/callback
 * route with ?next=/welcome — unchanged, already documented there as the
 * consumer signup confirmation entry point.
 */
export async function createConsumerAccount({
  email,
  password,
  displayName,
  marketingConsent,
}: {
  email: string;
  password: string;
  displayName: string | null;
  marketingConsent: boolean;
}): Promise<CreateConsumerAccountResult> {
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
      redirectTo: `${getSiteUrl()}/auth/callback?next=/welcome`,
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
    // /auth/callback will attempt profile creation again when the user confirms.
    // Don't block the success screen; the user still needs to confirm their email.
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
