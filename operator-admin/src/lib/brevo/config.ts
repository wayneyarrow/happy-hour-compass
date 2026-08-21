/**
 * Brevo integration — environment configuration.
 *
 * Server-only. Never import this from a Client Component — BREVO_API_KEY
 * must never reach the browser bundle. Matches the existing RESEND_API_KEY /
 * STRIPE_SECRET_KEY convention already in this codebase: no NEXT_PUBLIC_
 * prefix, read from process.env only inside server code.
 *
 * Config is read fresh on every call rather than cached at module load —
 * matches the existing getResend() (src/lib/email.ts) / getStripeClient()
 * (src/lib/stripe.ts) lazy-read-and-validate pattern rather than a
 * module-level constant.
 */

export class BrevoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrevoConfigError";
  }
}

export type BrevoConfig = {
  apiKey: string;
  consumerListId: number;
  /**
   * Normalized (trimmed, lowercased) staging allowlist address, or null when
   * no allowlist is configured (production — see stagingGuard.ts, which
   * treats null as "no restriction," never as "block everything").
   */
  testEmail: string | null;
};

/**
 * Reads and validates the outbound Brevo contact-sync configuration.
 * Throws BrevoConfigError — never the raw env var value — when required
 * configuration is missing or malformed, so callers can log/report the
 * failure without risking a secret ending up in a log line.
 */
export function getBrevoConfig(): BrevoConfig {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new BrevoConfigError("BREVO_API_KEY is not set.");
  }

  const rawListId = process.env.BREVO_CONSUMER_LIST_ID;
  if (!rawListId) {
    throw new BrevoConfigError("BREVO_CONSUMER_LIST_ID is not set.");
  }
  const consumerListId = Number(rawListId);
  if (!Number.isInteger(consumerListId) || consumerListId <= 0) {
    throw new BrevoConfigError("BREVO_CONSUMER_LIST_ID must be a positive integer.");
  }

  const rawTestEmail = process.env.BREVO_TEST_EMAIL;
  const testEmail = rawTestEmail ? normalizeEmail(rawTestEmail) : null;

  return { apiKey, consumerListId, testEmail };
}

/** Trims and lowercases an email for safe, consistent comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Reads the dedicated Brevo list ID used ONLY by the one-time historical
 * existing-consumer welcome cohort backfill
 * (src/lib/brevo/welcomeCohortBackfill.ts /
 * scripts/backfillConsumerBrevoWelcomeCohort.ts) — the list Kate targets for
 * the one-time historical welcome campaign, distinct from the ongoing
 * BREVO_CONSUMER_LIST_ID every consumer is synced to. Deliberately kept
 * separate from getBrevoConfig() — matching getBrevoWebhookToken()'s
 * existing precedent above — so that ordinary consumer lifecycle syncs
 * (signup, account updates) never depend on, or fail because of, a variable
 * that is only ever relevant to this one backfill. Like
 * BREVO_CONSUMER_LIST_ID, this is expected to hold a different value per
 * Vercel environment (Production vs. Preview) via normal Vercel env var
 * scoping — no additional environment-switching code is needed here.
 */
export function getExistingConsumerWelcomeListId(): number {
  const raw = process.env.BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID;
  if (!raw) {
    throw new BrevoConfigError("BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID is not set.");
  }
  const listId = Number(raw);
  if (!Number.isInteger(listId) || listId <= 0) {
    throw new BrevoConfigError("BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID must be a positive integer.");
  }
  return listId;
}

/**
 * Reads the inbound webhook authentication token. Kept separate from
 * getBrevoConfig() — the webhook route needs this, the outbound
 * contact-sync path never should touch it.
 */
export function getBrevoWebhookToken(): string {
  const token = process.env.BREVO_WEBHOOK_TOKEN;
  if (!token) {
    throw new BrevoConfigError("BREVO_WEBHOOK_TOKEN is not set.");
  }
  return token;
}
