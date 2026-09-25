/**
 * Server-only configuration for the operator email-code activation flow
 * (email-code initiative, Phase 1B foundation — migration 100).
 *
 * NOT WIRED ANYWHERE. Nothing in claims, submissions, approval, email,
 * reminders, or any UI imports this module yet; the feature is unreachable.
 *
 * Server-only — never import into a Client Component. Neither function
 * logs or otherwise exposes an environment value.
 */

/** Minimum HMAC secret length (characters). Anything shorter fails closed. */
export const OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH = 32;

/**
 * Feature flag for the email-code activation flow. Mirrors
 * isOperatorActivationReminderProcessingEnabled() (activationReminderConfig.ts),
 * except the value is normalized (trimmed, lowercased) before the exact
 * comparison — so " TRUE " enables, while "1", "yes", "false", empty, or an
 * absent variable all mean DISABLED.
 *
 * Intended future use: gating whether a NEWLY approved lifecycle is created
 * with verification_required = true. It never moves an existing lifecycle
 * out of the legacy setup-link flow.
 */
export function isOperatorEmailCodeVerificationEnabled(): boolean {
  return (process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Reads OPERATOR_VERIFICATION_CODE_HMAC_SECRET at call time (never at
 * module import, so builds and tests don't depend on it). Returns null —
 * fail closed — when the secret is absent, blank, or shorter than
 * OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH. Callers must treat
 * null as "verification unavailable" and refuse to issue or verify codes.
 *
 * The secret must be a dedicated random value (e.g. 32+ random bytes,
 * base64/hex-encoded), distinct per environment, and never reused from
 * another key. Not set in any environment yet.
 */
export function getOperatorVerificationCodeHmacSecret(): string | null {
  const secret = process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET;
  if (!secret || secret.trim().length < OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH) return null;
  return secret;
}
