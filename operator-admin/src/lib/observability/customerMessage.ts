/**
 * Shared customer-facing copy for UNEXPECTED INTERNAL failures only.
 *
 * Do NOT use this for validation/user-correctable errors (missing field,
 * invalid email, Turnstile challenge, Google no-match, etc.) — those already
 * have specific, actionable copy at their call sites and should keep it.
 * This helper exists for the "something on our end broke" case: a handled
 * database/API/provisioning error that a customer has no way to fix
 * themselves, where the honest, generic message plus a way to reach a human
 * is the whole story.
 *
 * This task intentionally does NOT replace the app's 16+ existing
 * hand-typed "Something went wrong" strings — that's a follow-up wiring
 * task. This is the shared building block for it.
 */

/**
 * The one support address every customer-facing internal-failure message
 * should point to. Distinct from hello@happyhourcompass.com, which is the
 * internal/founder-facing address used for Resend `from` and founder
 * notifications (see src/lib/email.ts) — support@ is the address already
 * used consistently on /legal/privacy, /legal/terms, and the admin Help
 * page, and is the one meant for a customer to actually write to.
 */
export const HHC_SUPPORT_EMAIL = "support@happyhourcompass.com";

/**
 * Builds the standard customer-facing message for an unexpected internal
 * failure, embedding the HHC error reference generated for that failure
 * (see errorReference.ts / reportOperationalError.ts).
 *
 * Contains no technical detail — no error message, code, table/column name,
 * or stack information — by construction: it never receives the underlying
 * error, only the opaque reference id.
 */
export function buildInternalErrorMessage(hhcErrorId: string): string {
  return `Something went wrong. Please try again. If the problem continues, contact us at ${HHC_SUPPORT_EMAIL} and mention error ${hhcErrorId}.`;
}
