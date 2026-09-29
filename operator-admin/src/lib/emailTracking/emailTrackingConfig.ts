/**
 * Email send registry & open tracking — server-side configuration.
 *
 * EMAIL_OPEN_TRACKING_ENABLED (fail closed): only the literal "true" turns
 * on registration of sends in public.email_messages and the Resend tags
 * that carry the registry id. Absent/anything else ⇒ sendTransactionalEmail()
 * behaves exactly as before this feature existed (no registry writes, no
 * tags). Set it only after migration 102 is applied in the shared database.
 *
 * This flag does NOT turn on Resend's open-tracking pixel — that is a
 * Resend domain setting (open_tracking on happyhourcompass.com), changed in
 * the Resend dashboard, never from code. Click tracking must stay OFF: it
 * rewrites links, which would break single-use setup/verification links.
 *
 * RESEND_WEBHOOK_SECRET: the signing secret (whsec_…) of the Resend webhook
 * endpoint pointing at /api/webhooks/resend in THIS environment. Without
 * it the route rejects every delivery (fail closed).
 */

export function isEmailOpenTrackingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EMAIL_OPEN_TRACKING_ENABLED === "true";
}

/**
 * EMAIL_TRACKED_SENDER_DOMAIN (optional, e.g. "updates.happyhourcompass.com"):
 * a SEPARATE Resend sending domain that has open tracking enabled. When set
 * (and EMAIL_OPEN_TRACKING_ENABLED is on), ONLY the types in
 * TRACKED_SENDER_EMAIL_TYPES (phase 1: automated Customer Success milestone
 * emails) are sent from it; every other email — operator setup/reminders,
 * verification codes, password resets, consumer, founder — stays on the
 * untracked root domain, so turning tracking on for the subdomain never adds
 * a pixel to those. Unset ⇒ every email keeps its normal sender.
 *
 * Do not change or unset this value within 24h of a tracked send that may
 * still be retried: a retry must be able to rebuild the original request
 * (see trackedSend.ts). Turning the FLAG off is always safe.
 *
 * Must be a bare hostname that is a subdomain of happyhourcompass.com;
 * anything else is ignored (fail closed to the normal sender).
 */
export function getTrackedSenderDomain(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.EMAIL_TRACKED_SENDER_DOMAIN?.trim().toLowerCase();
  if (!value) return null;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.happyhourcompass\.com$/.test(value) ? value : null;
}

export function getResendWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.RESEND_WEBHOOK_SECRET?.trim();
  return secret ? secret : null;
}
