"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/siteUrl";
import { sendConsumerSignupConfirmationEmail, sendConsumerSignupFounderNotificationEmail } from "@/lib/email";
import { sendSlackAcquisitionNotification } from "@/lib/slack";
import { syncConsumerBrevoEligibility } from "@/lib/brevo/consumerSync";
import { buildConsumerDisplayName } from "@/lib/consumerName";
import {
  verifyTurnstileToken,
  getClientIpFromHeaders,
  TURNSTILE_FAILURE_MESSAGE,
} from "@/lib/turnstile";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";
import { reportOperationalError } from "@/lib/observability/reportOperationalError";

// ── Observability ────────────────────────────────────────────────────────────
//
// createConsumerProfile() is the single ownership point for its own
// consumer_profiles-write failure — it's called from THIS file's signup
// action, from /auth/confirm/page.tsx's retry, and (via its own parallel
// inline insert, not a call to this function) from /auth/callback's
// resilience fallback. See this function's `isRetryAttempt` doc comment for
// why severity differs between the first (signup-time) attempt and a retry.
// Only the generateLink failure below (stage "auth-user-create") and the
// confirmation-email failure (stage "confirmation-email-send", Sentry-only —
// its Slack alert already lives inside the shared email subsystem, same
// reasoning as operator-activation's activation-email stage) are
// instrumented at THIS layer. Turnstile failure, the "account already
// exists" duplicate case, the standard-criticality founder-notification
// email, the proactive #consumer-signup Slack notification, and
// syncConsumerBrevoEligibility() (explicitly out of scope — see the task
// report) are all deliberately left as-is.
const CONSUMER_SIGNUP_FLOW = "consumer-signup";

export async function createConsumerProfile({
  userId,
  email,
  firstName,
  lastName,
  termsAcceptedAt,
  privacyAcceptedAt,
  marketingConsent,
  marketingConsentAt,
  isRetryAttempt = false,
}: {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  termsAcceptedAt: string;
  privacyAcceptedAt: string;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
  /**
   * True when this call is the LAST-RESORT retry (from /auth/confirm or
   * /auth/callback, after the signup-time attempt already failed) rather
   * than the first attempt made during signup itself. The first attempt
   * still has this retry safety net ahead of it and can self-heal silently
   * (Sentry-only, operational). A retry failing means there is no further
   * automatic healing — the auth user exists and can sign in, but the
   * profile row never gets created — so it's reported critical with a
   * production Slack page instead.
   */
  isRetryAttempt?: boolean;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("consumer_profiles").upsert(
    {
      id: userId,
      email,
      first_name: firstName,
      last_name: lastName,
      display_name: buildConsumerDisplayName(firstName, lastName),
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
    if (isRetryAttempt) {
      await reportCriticalFailure({
        error: new Error(error.message),
        flow: CONSUMER_SIGNUP_FLOW,
        stage: "profile-create",
        title: "Consumer Profile Creation Failed",
        technicalSummary: "database write failed (consumer_profiles upsert, retry)",
        context: { isRetryAttempt: true, userId },
        slackFields: { "User ID": userId },
      });
    } else {
      reportOperationalError({
        error: new Error(error.message),
        flow: CONSUMER_SIGNUP_FLOW,
        stage: "profile-create",
        severity: "operational",
        context: { isRetryAttempt: false, userId },
      });
    }
    return error.message;
  }

  // Brevo Phase 2A: re-evaluate this consumer's marketing-sync eligibility
  // on every profile write. This one call site covers signup (pre-
  // confirmation, will correctly no-op since the account isn't confirmed
  // yet), the /auth/confirm retry (post-confirmation — this is where a
  // newly-eligible consumer actually gets enqueued), and the /auth/callback
  // fallback, since all three already funnel through createConsumerProfile.
  // Never blocks or fails this function — see consumerSync.ts.
  await syncConsumerBrevoEligibility(userId);

  return null;
}

export type CreateConsumerAccountResult =
  | { ok: true; isNewSignup: boolean }
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
  firstName,
  lastName,
  marketingConsent,
  turnstileToken,
}: {
  email: string;
  password: string;
  firstName: string | null;
  lastName: string | null;
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
  const displayName = buildConsumerDisplayName(firstName, lastName);

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: {
      data: {
        // Structured fields are the canonical source going forward.
        // display_name is also stored for backward compatibility with any
        // code (including the pre-existing auth/confirm and auth/callback
        // resilience-retry paths) that may still read it from metadata.
        first_name: firstName,
        last_name: lastName,
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
    if (isDuplicate) {
      // Expected outcome, not a failure — a real consumer hit an ordinary
      // "already registered" case. No Sentry/HHC reporting.
      return {
        ok: false,
        error: "An account with this email already exists. Please sign in instead, or use a different email.",
      };
    }
    const report = await reportCriticalFailure({
      error: new Error(linkError?.message ?? "generateLink returned no action_link/user"),
      flow: CONSUMER_SIGNUP_FLOW,
      stage: "auth-user-create",
      title: "Consumer Signup Failed",
      technicalSummary: "Supabase generateLink (signup) failed",
    });
    return { ok: false, error: report.customerMessage };
  }

  // ── Analytics: distinguish a brand-new signup from a resend ──────────────
  // generateLink({ type: "signup" }) for an email that already exists but is
  // still unconfirmed does not error (see this function's doc comment above)
  // — it behaves like a confirmation resend, running this entire function
  // again. That's existing, intentional behavior this task does not change.
  // For analytics purposes only, linkData.user.created_at (already returned
  // by the generateLink call above — no extra Supabase call) lets us tell
  // the two cases apart safely: a brand-new auth user's created_at is ~now,
  // while a resend's created_at is the original signup time. The caller uses
  // this to avoid double-counting a resend as a new consumer_signup_completed
  // GA4 event.
  const isNewSignup =
    Math.abs(new Date(linkData.user.created_at).getTime() - new Date(now).getTime()) < 10_000;

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
    firstName,
    lastName,
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
    // Now uses the real structured first name instead of the full
    // combined display name — a small, in-scope correctness fix enabled
    // by this task's new structured fields (the greeting previously read
    // "Hi Mindy Green," for a two-token name; this param has always been
    // named/typed as a first name only).
    firstName,
    confirmLink: linkData.properties.action_link,
  });

  if (!emailResult.ok) {
    // sendTransactionalEmail already escalates critical failures to
    // #ops-critical (criticality "critical" — src/lib/email.ts) — that
    // alert lives inside the shared email subsystem behind
    // sendConsumerSignupConfirmationEmail, so it can't be enriched from
    // here without touching that shared code (same reasoning as operator
    // activation's "activation-email" stage). Sentry-only reporting still
    // gives this occurrence its own searchable HHC reference. The account
    // itself was created successfully, so this doesn't block the user's
    // success screen — matching how a failure here was already invisible
    // to the app under the previous Supabase-sent-email flow (Supabase's
    // own email delivery wasn't observable at all before).
    const report = reportOperationalError({
      error: new Error(emailResult.error ?? "confirmation email send failed"),
      flow: CONSUMER_SIGNUP_FLOW,
      stage: "confirmation-email-send",
      severity: "critical",
      context: { userId: linkData.user.id },
    });
    console.error(
      "[createConsumerAccount] Confirmation email failed:",
      emailResult.error,
      { hhcErrorId: report.hhcErrorId }
    );
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

  return { ok: true, isNewSignup };
}
