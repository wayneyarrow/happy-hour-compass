/**
 * Delivery retry policy for Customer Success milestone emails (Phase 1B,
 * Section 8). Pure decision logic — no Supabase, no I/O.
 */

/** Maximum delivery attempts before a communication becomes terminal 'failed'. */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** ~1 hour between retries (attempt 1 ~3pm, attempt 2 ~4pm, attempt 3 ~5pm). */
export const RETRY_DELAY_MS = 60 * 60 * 1000;

/**
 * A 'processing' row older than this is treated as stranded by a crashed
 * worker and recovered back to 'pending' — see migration
 * 095_customer_success_delivery.sql's header for the full reasoning
 * (cron maxDuration is 60s and each attempt is a single email send, so a
 * still-'processing' row well past that reliably means the process died,
 * not that it's still legitimately working).
 */
export const STALE_PROCESSING_MINUTES = 15;

export type AfterFailedAttemptDecision =
  | { action: "retry"; nextAttemptAt: Date }
  | { action: "terminal_failed" };

/**
 * What to do after a delivery attempt fails, given the attempt count
 * AFTER this attempt (i.e. already incremented) and the current time.
 * At MAX_DELIVERY_ATTEMPTS or beyond, no further retry — terminal.
 */
export function decideAfterFailedAttempt(attemptCountAfterThisAttempt: number, now: Date): AfterFailedAttemptDecision {
  if (attemptCountAfterThisAttempt >= MAX_DELIVERY_ATTEMPTS) {
    return { action: "terminal_failed" };
  }
  return { action: "retry", nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS) };
}

/** True once a 'processing' claim started this long ago is stale (see STALE_PROCESSING_MINUTES). */
export function isProcessingStale(processingStartedAt: Date, now: Date): boolean {
  return now.getTime() - processingStartedAt.getTime() > STALE_PROCESSING_MINUTES * 60_000;
}

/**
 * The deterministic Resend idempotency key for a Customer Success event —
 * the SAME value across every retry of the same event, so a
 * provider-accepted-but-unrecorded send (crash between acceptance and DB
 * write) is never duplicated on retry (Section 13).
 */
export function customerSuccessIdempotencyKey(eventId: string): string {
  return `hhc-customer-success:${eventId}`;
}
