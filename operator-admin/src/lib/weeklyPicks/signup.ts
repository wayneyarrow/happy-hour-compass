import { requestWeeklyPicksDoubleOptIn, type RequestWeeklyPicksDoubleOptInParams } from "@/lib/brevo/client";
import { BrevoConfigError, NewsletterUnavailableError } from "@/lib/brevo/config";
import { BrevoApiError } from "@/lib/brevo/errors";
import { BrevoStagingGuardBlockedError } from "@/lib/brevo/stagingGuard";
import { maskEmail } from "@/lib/brevo/maskEmail";
import { getSiteUrl } from "@/lib/siteUrl";
import { sendSlackAcquisitionNotification, type SlackResult } from "@/lib/slack";
import { resolveAnalyticsEnvironment } from "@/lib/analyticsEnvironment";
import { verifyTurnstileToken, TURNSTILE_FAILURE_MESSAGE, type TurnstileVerification } from "@/lib/turnstile";
import { reportOperationalError } from "@/lib/observability/reportOperationalError";
import type { OperationalErrorContext } from "@/lib/observability/reportOperationalError";
import type { OperationalSeverity } from "@/lib/observability/types";
import {
  WEEKLY_PICKS_EMAIL_REQUIRED_MESSAGE,
  WEEKLY_PICKS_EMAIL_INVALID_MESSAGE,
  WEEKLY_PICKS_GENERIC_ERROR_MESSAGE,
  WEEKLY_PICKS_STAGING_BLOCKED_MESSAGE,
  isValidWeeklyPicksEmail,
  isWeeklyPicksPlacement,
  normalizeWeeklyPicksEmail,
  type WeeklyPicksSignupState,
} from "./weeklyPicks";
import { getNewsletterMarket, type NewsletterMarket } from "./newsletterMarkets";
import { getAvailableNewsletterMarket } from "./newsletterAvailability";

/**
 * Weekly Picks newsletter signup — the logic behind the
 * subscribeToWeeklyPicks server action ((website)/weekly-picks/actions.ts),
 * kept here with injectable dependencies so it can be tested without
 * Turnstile, Brevo or Sentry.
 *
 * Order: field validation (no network) → market check → Turnstile → one
 * Brevo double opt-in request.
 *
 * Market: the form names its newsletter market; the server accepts it only
 * when that market's signup is switched on here (getAvailableNewsletterMarket)
 * and resolves its Brevo list/template server-side. A missing, unknown or
 * switched-off market is refused before Turnstile or Brevo — it never falls
 * back to another market's audience. Brevo sends the confirmation email and owns the
 * subscriber, list membership, unsubscribes and blocklist; HHC stores
 * nothing and never resubscribes anyone.
 *
 * "accepted" means only that Brevo returned 2xx for the request. It is not
 * a confirmed or new subscriber, and the accepted copy never promises an
 * email (Brevo may not send one, e.g. to a blocklisted contact).
 *
 * Only an accepted request posts to #consumer-signup ("Newsletter signup
 * requested") — never a validation, Turnstile, staging-allowlist or Brevo
 * failure. The alert is a request, not a confirmed subscriber, and repeated
 * accepted requests repeat it (accepted limitation: no dedupe state). A
 * Slack failure never affects the signup result.
 */

const FLOW = "weekly-picks-signup";

export type { WeeklyPicksSignupState };

export type WeeklyPicksSignupInput = {
  email: unknown;
  placement: unknown;
  market: unknown;
  turnstileToken: unknown;
  remoteIp: string | null;
};

export type WeeklyPicksSignupDeps = {
  verifyTurnstile: (token: string | null, remoteIp: string | null) => Promise<TurnstileVerification>;
  requestDoubleOptIn: (params: RequestWeeklyPicksDoubleOptInParams) => Promise<void>;
  reportError: (params: {
    error: unknown;
    stage: string;
    severity: OperationalSeverity;
    context: OperationalErrorContext;
  }) => void;
  siteUrl: () => string;
  notifySlack: (text: string) => Promise<SlackResult>;
  environment: () => string;
  /** The market's newsletter when its signup is switched on in this deployment, else null. */
  availableMarket: (marketId: string) => NewsletterMarket | null;
};

export const defaultWeeklyPicksSignupDeps: WeeklyPicksSignupDeps = {
  verifyTurnstile: (token, remoteIp) => verifyTurnstileToken(token, remoteIp),
  requestDoubleOptIn: requestWeeklyPicksDoubleOptIn,
  reportError: ({ error, stage, severity, context }) => {
    reportOperationalError({ error, flow: FLOW, stage, severity, context });
  },
  siteUrl: getSiteUrl,
  notifySlack: (text) => sendSlackAcquisitionNotification({ channel: "consumer-signup", text }),
  environment: () => resolveAnalyticsEnvironment(),
  availableMarket: getAvailableNewsletterMarket,
};

export async function processWeeklyPicksSignup(
  input: WeeklyPicksSignupInput,
  deps: WeeklyPicksSignupDeps = defaultWeeklyPicksSignupDeps
): Promise<WeeklyPicksSignupState> {
  // ── 1. Field validation — cheap, before any network call ─────────────────
  const rawEmail = typeof input.email === "string" ? input.email : "";
  const email = normalizeWeeklyPicksEmail(rawEmail);
  // Submitting the form is the consent action (see WEEKLY_PICKS_CONSENT_TEXT);
  // Brevo's double opt-in confirmation is still required below.
  if (!email) return { status: "error", fieldErrors: { email: WEEKLY_PICKS_EMAIL_REQUIRED_MESSAGE } };
  if (!isValidWeeklyPicksEmail(email)) {
    return { status: "error", fieldErrors: { email: WEEKLY_PICKS_EMAIL_INVALID_MESSAGE } };
  }

  // Only a tampered form can send an unknown placement.
  if (!isWeeklyPicksPlacement(input.placement)) {
    return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
  }
  const placement = input.placement;

  // Only a tampered form, or a market switched off since the page loaded,
  // names a market that isn't available here.
  const known = getNewsletterMarket(input.market);
  const market = known ? deps.availableMarket(known.marketId) : null;
  if (!market) {
    console.warn("[weeklyPicks/signup] market not available", { market: typeof input.market === "string" ? input.market : null });
    return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
  }

  // ── 2. Turnstile — before any Brevo request ──────────────────────────────
  const token = typeof input.turnstileToken === "string" && input.turnstileToken ? input.turnstileToken : null;
  const verification = await deps.verifyTurnstile(token, input.remoteIp);
  if (!verification.success) {
    console.warn("[weeklyPicks/signup] Turnstile verification failed:", verification.reason);
    return { status: "error", message: TURNSTILE_FAILURE_MESSAGE, turnstileFailed: true };
  }

  // ── 3. Brevo double opt-in ───────────────────────────────────────────────
  try {
    await deps.requestDoubleOptIn({
      email,
      redirectionUrl: `${deps.siteUrl()}${market.confirmedPath}`,
      marketId: market.marketId,
    });
  } catch (err) {
    return handleBrevoFailure(err, email, placement, market.marketId, deps);
  }

  console.log("[weeklyPicks/signup] double opt-in requested", { placement, market: market.marketId, email: maskEmail(email) });

  await notifySignupRequested(email, placement, market.marketId, deps);
  return { status: "accepted" };
}

export function buildSignupRequestedSlackText(
  email: string,
  placement: string,
  environment: string,
  marketId: string
): string {
  return [
    "*Newsletter signup requested*",
    `Email: ${email}`,
    `Market: ${marketId}`,
    `Placement: ${placement}`,
    `Environment: ${environment}`,
    "Confirmation is handled by Brevo; this alert does not mean a new subscriber was confirmed.",
  ].join("\n");
}

/** Fire-and-forget in effect: logs a non-delivery, never throws. */
async function notifySignupRequested(
  email: string,
  placement: string,
  marketId: string,
  deps: WeeklyPicksSignupDeps
): Promise<void> {
  try {
    const text = buildSignupRequestedSlackText(email, placement, deps.environment(), marketId);
    const slackResult = await deps.notifySlack(text);
    if (slackResult !== "delivered" && slackResult !== "no-webhook") {
      console.error("[weeklyPicks/signup] Slack notification not delivered.", { result: slackResult });
    }
  } catch (err) {
    console.error("[weeklyPicks/signup] Slack notification threw unexpected exception:", err);
  }
}

function handleBrevoFailure(
  err: unknown,
  email: string,
  placement: string,
  market: string,
  deps: WeeklyPicksSignupDeps
): WeeklyPicksSignupState {
  // Staging/local only — Production never throws this.
  if (err instanceof BrevoStagingGuardBlockedError) {
    console.warn("[weeklyPicks/signup] blocked by staging allowlist", { email: maskEmail(email) });
    return { status: "error", message: WEEKLY_PICKS_STAGING_BLOCKED_MESSAGE };
  }

  // Switched off between the market check above and the request.
  if (err instanceof NewsletterUnavailableError) {
    console.warn("[weeklyPicks/signup] market not available at request time", { market });
    return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
  }

  if (err instanceof BrevoConfigError) {
    deps.reportError({ error: err, stage: "config", severity: "critical", context: { placement, market } });
    return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
  }

  if (err instanceof BrevoApiError) {
    const context = {
      placement,
      market,
      errorClass: err.errorClass,
      httpStatus: err.status,
      brevoCode: err.brevoCode,
    };
    if (err.errorClass === "transient") {
      // Network/timeout/429/5xx — the visitor can simply retry.
      console.warn("[weeklyPicks/signup] transient Brevo failure", { ...context, email: maskEmail(email) });
    } else {
      // auth / invalid_request / unknown: almost always a configuration
      // problem (key, list, template, missing attribute) or an undocumented
      // Brevo response — never reinterpreted as success.
      deps.reportError({ error: err, stage: "brevo-double-opt-in", severity: "critical", context });
    }
    return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
  }

  deps.reportError({ error: err, stage: "brevo-double-opt-in", severity: "critical", context: { placement, market } });
  return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
}
