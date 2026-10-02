/**
 * Coordination between the founder's post-expiry final follow-up actions
 * (finalSetupFollowUpImpl.ts) and the reminder worker
 * (processActivationReminders.ts). Both generate a Supabase recovery link,
 * and a new recovery link replaces the operator's previous one, so they must
 * never run against the same lifecycle at the same time.
 *
 * Each side takes its own claim first, then checks the other side's claim
 * and backs off if it is active:
 *   - final follow-up claims operator_activation_lifecycles.setup_link_claimed_at
 *     (migration 103) and refuses if a reminder lease is active;
 *   - the worker claims reminder_lease_started_at and abandons the send if a
 *     setup-link claim is active.
 * Whichever checks second sees the other's claim, so at most one proceeds.
 *
 * Dependency-free so Release (activationReleaseImpl.ts) and the worker can
 * import it without the follow-up action's email/auth dependencies.
 */

/**
 * How long a final follow-up action's setup_link_claimed_at claim is
 * honoured. It must outlive any request that could still be using the link
 * it generated, so a competing request can never generate a replacement
 * while an earlier email is still in flight:
 *   - the action bounds its own waiting (GENERATE_LINK_TIMEOUT_MS +
 *     FINAL_SEND_TIMEOUT_MS, under a minute), and on a timeout it KEEPS
 *     its claim rather than releasing it;
 *   - a provider call we stopped waiting for can still complete in the
 *     background — Node's fetch (undici) gives up after its default
 *     5-minute headers timeout, and Vercel's function time limit bounds it
 *     too.
 * Six minutes covers both. The normal (completed) path releases the claim
 * immediately, so this only delays a retry after a crash or timeout.
 */
export const SETUP_LINK_LOCK_MS = 6 * 60 * 1000;

/** How long a final follow-up action waits for Supabase generateLink before giving up (keeping its claim). */
export const GENERATE_LINK_TIMEOUT_MS = 20 * 1000;

/** How long a final follow-up action waits for the email provider before treating delivery as unknown (keeping its claim). */
export const FINAL_SEND_TIMEOUT_MS = 25 * 1000;

/** Reminder leases older than this are treated as abandoned (the worker recovers them). */
export const REMINDER_LEASE_STALE_MINUTES = 15;

/** True when a setup-link claim taken at `claimedAt` is still in force at `now`. A claim newer than `now` counts as active. */
export function isSetupLinkClaimActive(claimedAt: string | null | undefined, now: Date): boolean {
  if (!claimedAt) return false;
  return now.getTime() - new Date(claimedAt).getTime() < SETUP_LINK_LOCK_MS;
}

/** True when a reminder lease started at `leaseStartedAt` is still in force at `now`. */
export function isReminderLeaseActive(leaseStartedAt: string | null | undefined, now: Date): boolean {
  if (!leaseStartedAt) return false;
  return now.getTime() - new Date(leaseStartedAt).getTime() < REMINDER_LEASE_STALE_MINUTES * 60_000;
}
