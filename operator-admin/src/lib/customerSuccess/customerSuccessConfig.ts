/**
 * Server-side kill switch for live Customer Success email delivery
 * (Phase 1B, Section 18).
 *
 * Default (env var absent, empty, or anything other than exactly "true"):
 * DISABLED — no Resend call is ever made. This is what prevents a staging/
 * preview deployment, or an accidental/manual cron invocation, from
 * sending a real email before Wayne explicitly turns this on in Production.
 *
 * Server-only — there is no client-side equivalent, and this must never be
 * imported into a Client Component.
 */
export function isCustomerSuccessEmailDeliveryEnabled(): boolean {
  return process.env.CUSTOMER_SUCCESS_EMAILS_ENABLED === "true";
}
