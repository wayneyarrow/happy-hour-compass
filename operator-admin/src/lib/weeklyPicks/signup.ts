import { requestWeeklyPicksDoubleOptIn, type RequestWeeklyPicksDoubleOptInParams } from "@/lib/brevo/client";
import { BrevoConfigError } from "@/lib/brevo/config";
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
  WEEKLY_PICKS_CONSENT_REQUIRED_MESSAGE,
  WEEKLY_PICKS_GENERIC_ERROR_MESSAGE,
  WEEKLY_PICKS_STAGING_BLOCKED_MESSAGE,
  isValidWeeklyPicksEmail,
  isWeeklyPicksPlacement,
  normalizeWeeklyPicksEmail,
  weeklyPicksUsesButtonConsent,
  type WeeklyPicksSignupState,
} from "./weeklyPicks";

/**
 * Weekly Picks newsletter signup — the logic behind the
 * subscribeToWeeklyPicks server action ((website)/weekly-picks/actions.ts),
 * kept here with injectable dependencies so it can be tested without
 * Turnstile, Brevo or Sentry.
 *
 * Order: field validation (no network) → Turnstile → one Brevo double
 * opt-in request. Brevo sends the confirmation email and owns the
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
  consent: unknown;
  placement: unknown;
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
};

export async function processWeeklyPicksSignup(
  input: WeeklyPicksSignupInput,
  deps: WeeklyPicksSignupDeps = defaultWeeklyPicksSignupDeps
): Promise<WeeklyPicksSignupState> {
  // ── 1. Field validation — cheap, before any network call ─────────────────
  const rawEmail = typeof input.email === "string" ? input.email : "";
  const email = normalizeWeeklyPicksEmail(rawEmail);
  const fieldErrors: { email?: string; consent?: string } = {};

  if (!email) fieldErrors.email = WEEKLY_PICKS_EMAIL_REQUIRED_MESSAGE;
  else if (!isValidWeeklyPicksEmail(email)) fieldErrors.email = WEEKLY_PICKS_EMAIL_INVALID_MESSAGE;

  // The checkbox is the explicit permission — it must have been ticked —
  // except on button-consent placements, where submitting is the consent
  // action. An unknown placement is treated as a checkbox placement.
  if (!weeklyPicksUsesButtonConsent(input.placement) && input.consent !== "yes") {
    fieldErrors.consent = WEEKLY_PICKS_CONSENT_REQUIRED_MESSAGE;
  }

  if (fieldErrors.email || fieldErrors.consent) {
    return { status: "error", fieldErrors };
  }

  // Only a tampered form can send an unknown placement.
  if (!isWeeklyPicksPlacement(input.placement)) {
    return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
  }
  const placement = input.placement;

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
      redirectionUrl: `${deps.siteUrl()}/weekly-picks/confirmed`,
    });
  } catch (err) {
    return handleBrevoFailure(err, email, placement, deps);
  }

  console.log("[weeklyPicks/signup] double opt-in requested", { placement, email: maskEmail(email) });

  await notifySignupRequested(email, placement, deps);
  return { status: "accepted" };
}

export function buildSignupRequestedSlackText(email: string, placement: string, environment: string): string {
  return [
    "*Newsletter signup requested*",
    `Email: ${email}`,
    `Placement: ${placement}`,
    `Environment: ${environment}`,
    "Confirmation is handled by Brevo; this alert does not mean a new subscriber was confirmed.",
  ].join("\n");
}

/** Fire-and-forget in effect: logs a non-delivery, never throws. */
async function notifySignupRequested(email: string, placement: string, deps: WeeklyPicksSignupDeps): Promise<void> {
  try {
    const text = buildSignupRequestedSlackText(email, placement, deps.environment());
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
  deps: WeeklyPicksSignupDeps
): WeeklyPicksSignupState {
  // Staging/local only — Production never throws this.
  if (err instanceof BrevoStagingGuardBlockedError) {
    console.warn("[weeklyPicks/signup] blocked by staging allowlist", { email: maskEmail(email) });
    return { status: "error", message: WEEKLY_PICKS_STAGING_BLOCKED_MESSAGE };
  }

  if (err instanceof BrevoConfigError) {
    deps.reportError({ error: err, stage: "config", severity: "critical", context: { placement } });
    return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
  }

  if (err instanceof BrevoApiError) {
    const context = {
      placement,
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

  deps.reportError({ error: err, stage: "brevo-double-opt-in", severity: "critical", context: { placement } });
  return { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
}
