/**
 * Pure, framework-free Turnstile reset logic for the operator-submission
 * flow — shared between OwnerSubmissionFlow.tsx (consumer app) and the
 * website's AddVenueModalContent.tsx, the two client entry points that both
 * call saveOperatorSubmissionAction (actions.ts).
 *
 * Why this exists: a Cloudflare Turnstile token is single-use server-side
 * (verifyTurnstileToken() / Siteverify — see src/lib/turnstile.ts). If a
 * submission attempt fails for any reason AFTER Turnstile already verified
 * successfully — a database error, an application error, anything other
 * than Turnstile itself failing — the already-consumed token must not be
 * left in place. Leaving it in place lets a retry silently resubmit the
 * same token, which Cloudflare then correctly (but confusingly) rejects as
 * "timeout-or-duplicate" — masking the real, original failure behind a
 * second, unrelated one. This is exactly what happened during the Casa de
 * Frida investigation: the first attempt failed on an unrelated database
 * error (see linkVenueToSubmission.ts's header comment for that bug), the
 * widget/token were never reset, and the retry failed Turnstile instead.
 *
 * Kept independent of React (works against a plain ref-shaped object and
 * two setter callbacks) so it's directly unit-testable without a
 * component-testing setup, which this codebase doesn't have — see
 * tests/unit/suggest-owner/turnstileRetry.test.ts.
 */

export type TurnstileResettableRef = { current: { reset: () => void } | null };

/**
 * Resets the Turnstile widget/token after a submission attempt fails for a
 * reason OTHER than Turnstile itself (i.e. any `result.error` or thrown
 * exception from saveOperatorSubmissionAction that leaves the form on the
 * same step for a retry). Also records the error message via
 * `setGeneralError`, matching the existing Turnstile-specific failure
 * handling's shape (see handleTurnstileFailure in each call site) — the two
 * differ only in whether the message is the shared Turnstile copy or
 * whatever the server actually returned.
 */
export function resetTurnstileAfterSubmissionError(
  message: string,
  setGeneralError: (message: string) => void,
  setTurnstileToken: (token: string | null) => void,
  turnstileRef: TurnstileResettableRef
): void {
  setGeneralError(message);
  setTurnstileToken(null);
  turnstileRef.current?.reset();
}
