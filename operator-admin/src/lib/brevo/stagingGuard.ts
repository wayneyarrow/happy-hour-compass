import { normalizeEmail } from "./config";
import { maskEmail } from "./maskEmail";

export class BrevoStagingGuardBlockedError extends Error {
  constructor(email: string) {
    super(
      `Blocked by Brevo staging allowlist: ${maskEmail(email)} does not match the configured BREVO_TEST_EMAIL.`
    );
    this.name = "BrevoStagingGuardBlockedError";
  }
}

/**
 * Enforces the staging/Preview safety allowlist (Part 4 of the Brevo
 * integration foundation).
 *
 * When `testEmail` is set (staging/Preview — BREVO_TEST_EMAIL is
 * configured), only that exact normalized address may be synced to Brevo;
 * every other email is refused with BrevoStagingGuardBlockedError. When
 * `testEmail` is null (production — BREVO_TEST_EMAIL is unset), this is a
 * deliberate no-op: production must never depend on BREVO_TEST_EMAIL being
 * present, so "unset" means "no allowlist," never "block everything."
 *
 * This function is called from exactly one place in the codebase —
 * upsertBrevoContact() in client.ts, as its first statement, before any
 * network I/O — so no call path (direct call, outbox processor, future
 * Phase 2 wiring) can reach the Brevo API for a non-allowlisted address
 * without going through this check first.
 */
export function assertAllowedToSyncEmail(email: string, testEmail: string | null): void {
  if (testEmail === null) return;

  if (normalizeEmail(email) !== testEmail) {
    throw new BrevoStagingGuardBlockedError(email);
  }
}
