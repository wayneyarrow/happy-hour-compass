/**
 * TEMPORARY — staging-only Stripe configuration diagnostic (Comp/Trial
 * Checkout QA preflight). Rendered only by
 * src/app/control-panel/integrations/stripe-check/page.tsx. Both files (and
 * tests/unit/stripe/stripeEnvironmentCheck.test.ts) are removed in a
 * follow-up commit before any production promotion.
 *
 * Reports ONLY enums and booleans: key mode, whether the configured Pro /
 * Premium prices exist in that mode, and whether the expected webhook
 * endpoint exists in the same Stripe environment. It never returns, logs or
 * echoes a credential, price ID, endpoint ID, environment value or raw Stripe
 * error (Stripe errors can include part of the key).
 *
 * Makes Stripe requests ONLY when the key is confirmed test mode, and only
 * read-only GETs through the injected `get` function.
 */

export type StripeMode = "test" | "live" | "unknown";
export type CheckStatus = "pass" | "fail" | "unknown" | "not_checked";

export type PriceCheck = {
  configured: boolean;
  /** pass = exists in test mode, active and recurring. */
  status: CheckStatus;
  detail: "ok" | "not_configured" | "not_found_in_test_mode" | "not_test_mode" | "inactive" | "not_recurring" | "lookup_failed" | "skipped";
};

export type StripeEnvironmentReport = {
  mode: StripeMode;
  webhookSecretConfigured: boolean;
  proPrice: PriceCheck;
  premiumPrice: PriceCheck;
  webhook: {
    expectedUrl: string;
    status: CheckStatus;
    detail: "ok" | "not_found" | "disabled" | "missing_events" | "lookup_failed" | "skipped";
    /** Event names only (public Stripe event types) — never IDs. */
    missingEvents: string[];
  };
  /** True only when every check passed — the gate for Checkout QA. */
  readyForCheckoutQa: boolean;
};

/** Events the webhook handler (src/app/api/webhooks/stripe/route.ts) acts on. */
export const REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
] as const;

/** Read-only GET of a Stripe API path (e.g. "/v1/prices/…"); throws on any failure. */
export type StripeGet = (path: string) => Promise<unknown>;

/**
 * The only error a StripeGet may throw: carries the HTTP status (0 = network
 * / timeout) and NOTHING from Stripe's response body, which can echo part of
 * the key.
 */
export class StripeGetError extends Error {
  constructor(readonly status: number) {
    super(`Stripe request failed (HTTP ${status})`);
    this.name = "StripeGetError";
  }
}

export function classifyStripeKey(secretKey: string | undefined | null): StripeMode {
  if (!secretKey) return "unknown";
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) return "test";
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) return "live";
  return "unknown";
}

const SKIPPED_PRICE = (configured: boolean): PriceCheck => ({ configured, status: "not_checked", detail: configured ? "skipped" : "not_configured" });

async function checkPrice(get: StripeGet, priceId: string | undefined | null): Promise<PriceCheck> {
  if (!priceId) return { configured: false, status: "fail", detail: "not_configured" };
  let price: { livemode?: unknown; active?: unknown; recurring?: unknown };
  try {
    price = (await get(`/v1/prices/${encodeURIComponent(priceId)}`)) as typeof price;
  } catch (err) {
    // A test key can't see a live-mode (or nonexistent) price → 404. Anything
    // else (auth, rate limit, network) is inconclusive, not a failure.
    if (err instanceof StripeGetError && err.status === 404) {
      return { configured: true, status: "fail", detail: "not_found_in_test_mode" };
    }
    return { configured: true, status: "unknown", detail: "lookup_failed" };
  }
  if (!price || typeof price !== "object") return { configured: true, status: "unknown", detail: "lookup_failed" };
  if (price.livemode !== false) return { configured: true, status: "fail", detail: "not_test_mode" };
  if (price.active !== true) return { configured: true, status: "fail", detail: "inactive" };
  if (!price.recurring) return { configured: true, status: "fail", detail: "not_recurring" };
  return { configured: true, status: "pass", detail: "ok" };
}

async function checkWebhook(get: StripeGet, expectedUrl: string): Promise<StripeEnvironmentReport["webhook"]> {
  let list: { data?: Array<{ url?: unknown; status?: unknown; enabled_events?: unknown }> };
  try {
    list = (await get("/v1/webhook_endpoints?limit=100")) as typeof list;
  } catch {
    return { expectedUrl, status: "unknown", detail: "lookup_failed", missingEvents: [] };
  }
  const matches = (list?.data ?? []).filter((e) => e.url === expectedUrl);
  if (matches.length === 0) return { expectedUrl, status: "fail", detail: "not_found", missingEvents: [] };

  const enabled = matches.filter((e) => e.status === "enabled");
  if (enabled.length === 0) return { expectedUrl, status: "fail", detail: "disabled", missingEvents: [] };

  // Best enabled endpoint: wildcard, or the one missing the fewest events.
  let best: string[] | null = null;
  for (const e of enabled) {
    const events = Array.isArray(e.enabled_events) ? (e.enabled_events as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const missing = events.includes("*") ? [] : REQUIRED_WEBHOOK_EVENTS.filter((r) => !events.includes(r));
    if (!best || missing.length < best.length) best = missing;
  }
  const missingEvents = best ?? [...REQUIRED_WEBHOOK_EVENTS];
  return missingEvents.length === 0
    ? { expectedUrl, status: "pass", detail: "ok", missingEvents: [] }
    : { expectedUrl, status: "fail", detail: "missing_events", missingEvents };
}

export async function checkStripeEnvironment(input: {
  secretKey: string | undefined | null;
  proPriceId: string | undefined | null;
  premiumPriceId: string | undefined | null;
  webhookSecret: string | undefined | null;
  expectedWebhookUrl: string;
  get: StripeGet;
}): Promise<StripeEnvironmentReport> {
  const mode = classifyStripeKey(input.secretKey);
  const webhookSecretConfigured = !!input.webhookSecret;

  if (mode !== "test") {
    // Live or unrecognised key: make NO Stripe requests at all.
    return {
      mode,
      webhookSecretConfigured,
      proPrice: SKIPPED_PRICE(!!input.proPriceId),
      premiumPrice: SKIPPED_PRICE(!!input.premiumPriceId),
      webhook: { expectedUrl: input.expectedWebhookUrl, status: "not_checked", detail: "skipped", missingEvents: [] },
      readyForCheckoutQa: false,
    };
  }

  const [proPrice, premiumPrice, webhook] = await Promise.all([
    checkPrice(input.get, input.proPriceId),
    checkPrice(input.get, input.premiumPriceId),
    checkWebhook(input.get, input.expectedWebhookUrl),
  ]);

  return {
    mode,
    webhookSecretConfigured,
    proPrice,
    premiumPrice,
    webhook,
    readyForCheckoutQa:
      webhookSecretConfigured && proPrice.status === "pass" && premiumPrice.status === "pass" && webhook.status === "pass",
  };
}

/**
 * Staging-only gate. True only on the website staging deployment: the site
 * URL must be staging AND Vercel must report a non-production environment.
 * Any missing value fails closed.
 */
export const STAGING_SITE_URL = "https://staging.happyhourcompass.com";
export function isStagingDiagnosticAllowed(siteUrl: string, vercelEnv: string | undefined): boolean {
  return siteUrl === STAGING_SITE_URL && !!vercelEnv && vercelEnv !== "production";
}
