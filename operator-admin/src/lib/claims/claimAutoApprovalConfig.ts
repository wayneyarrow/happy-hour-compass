/**
 * Server-only feature flag for claim auto-approval.
 *
 * Fail closed: only the exact value "true" (trimmed, case-insensitive)
 * enables it. Absent/anything else → every claim follows today's founder-
 * review flow, byte-for-byte (submitClaimAction skips evaluation entirely).
 * Auto-approval additionally requires the email-code activation
 * architecture to be available (see claimAutoApprovalSignals.ts); it never
 * auto-approves onto the legacy setup-link onboarding path.
 */
export function isClaimAutoApprovalEnabled(): boolean {
  return (process.env.CLAIM_AUTO_APPROVAL_ENABLED ?? "").trim().toLowerCase() === "true";
}
