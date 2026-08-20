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

/**
 * True only for a confirmed Vercel Production deployment. Reuses the exact
 * convention already established in src/lib/siteUrl.ts (getSiteUrl() /
 * shouldNoIndex() both branch on VERCEL_ENV the same way) rather than
 * introducing a second environment-detection mechanism. Unset (local dev,
 * a script run outside Vercel) is deliberately NOT production — see
 * isEnqueueAllowedInThisEnvironment below.
 */
export function isProductionEnvironment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Enqueue-time staging protection (Phase 2A correction) — a SECOND,
 * EARLIER checkpoint than assertAllowedToSyncEmail above, not a
 * replacement for it.
 *
 * HHC uses one shared Supabase project for local/staging/production
 * (see CLAUDE.md's Repository Layout section) — a row written to
 * brevo_sync_outbox from staging is the same row a production outbox
 * processor could later claim, running with production's own
 * BREVO_API_KEY/BREVO_CONSUMER_LIST_ID and production's own (absent)
 * BREVO_TEST_EMAIL. assertAllowedToSyncEmail's guard only re-evaluates
 * config in whichever environment actually calls upsertBrevoContact() at
 * process time — it cannot know a row originated from staging. Staging
 * must therefore never be allowed to WRITE an arbitrary real consumer's
 * row into the shared outbox in the first place.
 *
 * Deliberately different semantics from assertAllowedToSyncEmail's
 * null-testEmail handling: that function treats an unset BREVO_TEST_EMAIL
 * as "no restriction" — correct for its context, since production is
 * expected to never set it. This function instead fails CLOSED outside
 * production: if we are not confirmed to be Production and
 * BREVO_TEST_EMAIL is unset, enqueueing is blocked entirely rather than
 * treated as unrestricted.
 */
export function isEnqueueAllowedInThisEnvironment(email: string, testEmail: string | null): boolean {
  if (isProductionEnvironment()) return true;
  if (testEmail === null) return false;
  return normalizeEmail(email) === testEmail;
}
