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

export type WeeklyPicksBrevoConfig = {
  apiKey: string;
  listId: number;
  doiTemplateId: number;
  /** Same semantics as BrevoConfig.testEmail — see stagingGuard.ts. */
  testEmail: string | null;
};

// ─── Per-market newsletter audiences ─────────────────────────────────────────

/**
 * Each market's newsletter is its own Brevo audience (list + double opt-in
 * template), read from that market's own environment variables. Must list
 * exactly the markets in NEWSLETTER_MARKETS (src/lib/weeklyPicks/
 * newsletterMarkets.ts — pinned by test).
 *
 *   - enabledEnv: the market's signup is switched on only when this is
 *     exactly "true" (fail closed). null = always on — Central Okanagan, the
 *     original newsletter, whose signup has been public since 2026-10.
 *   - listIdEnv / templateIdEnv: that market's Brevo IDs. Central Okanagan
 *     keeps its original BREVO_WEEKLY_PICKS_* variables.
 *
 * Central Okanagan's list is the existing HHC Consumers list (the same list
 * as Production's BREVO_CONSUMER_LIST_ID): confirmed signups join it
 * alongside consenting account holders. Sharing it is safe with the
 * consumer sync (consumerSync.ts): that only removes a contact on an
 * observed true -> false change of an account's marketing_consent — a real
 * withdrawal; newsletter-only contacts have no profile and are never
 * touched. Every other market has its own list, which must differ from all
 * of these (checked in getNewsletterBrevoConfig).
 *
 * Kept separate from getBrevoConfig() — matching
 * getExistingConsumerWelcomeListId()'s precedent above — so the account
 * sync never depends on a double opt-in template variable.
 */
type NewsletterBrevoEnv = { enabledEnv: string | null; listIdEnv: string; templateIdEnv: string };

export const NEWSLETTER_BREVO_ENV: Readonly<Record<string, NewsletterBrevoEnv>> = {
  "central-okanagan": {
    enabledEnv: null,
    listIdEnv: "BREVO_WEEKLY_PICKS_LIST_ID",
    templateIdEnv: "BREVO_WEEKLY_PICKS_DOI_TEMPLATE_ID",
  },
  "greater-san-diego": {
    enabledEnv: "NEWSLETTER_SIGNUP_ENABLED_GREATER_SAN_DIEGO",
    listIdEnv: "BREVO_NEWSLETTER_LIST_ID_GREATER_SAN_DIEGO",
    templateIdEnv: "BREVO_NEWSLETTER_DOI_TEMPLATE_ID_GREATER_SAN_DIEGO",
  },
};

/** Thrown when a signup names a market whose newsletter is unknown or switched off here. */
export class NewsletterUnavailableError extends Error {
  constructor(marketId: string) {
    super(`Newsletter signup is not available for market "${marketId}".`);
    this.name = "NewsletterUnavailableError";
  }
}

/** True when `marketId` has a newsletter and its signup is switched on in this deployment. */
export function isNewsletterSignupEnabledForMarket(marketId: string): boolean {
  const env = Object.prototype.hasOwnProperty.call(NEWSLETTER_BREVO_ENV, marketId)
    ? NEWSLETTER_BREVO_ENV[marketId]
    : undefined;
  if (!env) return false;
  return env.enabledEnv === null || process.env[env.enabledEnv] === "true";
}

/**
 * The Brevo double opt-in configuration for one market's newsletter. Never
 * falls back to another market: an unknown or switched-off market throws
 * NewsletterUnavailableError; a missing/malformed variable throws
 * BrevoConfigError; and a market configured with another market's list ID
 * throws BrevoConfigError rather than sending signups to that audience.
 */
export function getNewsletterBrevoConfig(marketId: string): WeeklyPicksBrevoConfig {
  if (!isNewsletterSignupEnabledForMarket(marketId)) throw new NewsletterUnavailableError(marketId);
  const env = NEWSLETTER_BREVO_ENV[marketId];

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new BrevoConfigError("BREVO_API_KEY is not set.");
  }
  const listId = parsePositiveInt(process.env[env.listIdEnv], env.listIdEnv);
  const doiTemplateId = parsePositiveInt(process.env[env.templateIdEnv], env.templateIdEnv);

  for (const [otherId, other] of Object.entries(NEWSLETTER_BREVO_ENV)) {
    if (otherId === marketId) continue;
    if (Number(process.env[other.listIdEnv]) === listId) {
      throw new BrevoConfigError(`${env.listIdEnv} is the same list as ${other.listIdEnv} (${otherId}).`);
    }
  }
  // The account-consent list (consumerSync.ts) is the original Central
  // Okanagan audience in Production; a newer market must never share it.
  if (env.enabledEnv !== null && Number(process.env.BREVO_CONSUMER_LIST_ID) === listId) {
    throw new BrevoConfigError(`${env.listIdEnv} is the same list as BREVO_CONSUMER_LIST_ID.`);
  }

  const rawTestEmail = process.env.BREVO_TEST_EMAIL;
  const testEmail = rawTestEmail ? normalizeEmail(rawTestEmail) : null;

  return { apiKey, listId, doiTemplateId, testEmail };
}

function parsePositiveInt(raw: string | undefined, name: string): number {
  if (!raw) {
    throw new BrevoConfigError(`${name} is not set.`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new BrevoConfigError(`${name} must be a positive integer.`);
  }
  return value;
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
