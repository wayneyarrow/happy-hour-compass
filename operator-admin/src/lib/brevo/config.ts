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
