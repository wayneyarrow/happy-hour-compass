/**
 * Reports a CATEGORY-C/D, customer-or-revenue-blocking operational failure:
 * captures it once via reportOperationalError() (Sentry + one HHC-XXXXX
 * reference), and, production-only, escalates the SAME correlated
 * occurrence to #ops-critical via the existing sendSlackAlert()
 * infrastructure — no second Slack implementation, no second HHC id, no
 * second Sentry capture.
 *
 * Originally built for the Add Your Venue / Claim Your Venue acquisition
 * flows (as `reportCriticalAcquisitionFailure`, still exported below as a
 * stable alias — see "Backward compatibility"). Generalized here, with no
 * behavior change to those two call sites, so Stripe payment/subscription
 * failures (and future flows) can reuse the exact same mechanism under a
 * name that isn't acquisition-specific.
 *
 * Reserve this for genuinely blocking failures (severity is always
 * "critical" — hardcoded, not a caller option, so it can't be misused for a
 * lower-severity/non-blocking case). A best-effort or non-blocking failure
 * should call reportOperationalError() directly instead, without this
 * wrapper.
 *
 * Correct call sequence at a call site:
 *   1. failure occurs, caught in a try/catch or an `if (error)` branch
 *   2. call reportCriticalFailure() exactly once
 *   3. return { error: report.customerMessage } to the customer, where the
 *      caller is a customer-facing action genuinely blocked by it — a
 *      webhook handler instead returns whatever HTTP status preserves
 *      Stripe's retry semantics, and never exposes report.customerMessage
 *      or the HHC id to Stripe
 * Never call generateHhcErrorReference() or reportOperationalError() a
 * second time for the same occurrence, and never construct a competing
 * sendSlackAlert() call for it elsewhere.
 */

import { sendSlackAlert } from "@/lib/slack";
import {
  reportOperationalError,
  sanitizeOperationalContext,
  getDefaultSentryCaptureClient,
  type SentryCaptureClient,
  type OperationalErrorContext,
  type ReportOperationalErrorResult,
} from "./reportOperationalError";

export type CriticalFailureParams = {
  /** The caught error/failure. Any shape — see reportOperationalError's normalizeError. */
  error: unknown;
  /** Stable slug identifying the user journey, e.g. "operator-submission", "stripe-subscription". */
  flow: string;
  /** Stable slug identifying the step within that flow, e.g. "venue-insert", "checkout-completed-sync". */
  stage: string;
  /** Human-readable Slack alert title, e.g. "Stripe Subscription Sync Failed". */
  title: string;
  /** One short, safe technical classification, e.g. "database sync failed". Never a raw error dump. */
  technicalSummary: string;
  /**
   * Safe, non-sensitive context attached to the Sentry event (same
   * guardrails as reportOperationalError's own `context` — see there for
   * what must never be passed).
   */
  context?: OperationalErrorContext;
  /**
   * Additional safe display fields for the Slack alert only, e.g.
   * `{ Venue: "Casa de Frida" }` or `{ "Stripe Event": "evt_..." }`. Run
   * through the same sanitizeOperationalContext() guardrail as `context` —
   * never pass emails, phone numbers, addresses, tokens, secrets, card/
   * payment-method details, or raw request/webhook payloads.
   */
  slackFields?: OperationalErrorContext;
};

/** Test-only injection points — production callers should never pass this. */
export type CriticalFailureDeps = {
  sentryClient?: SentryCaptureClient;
  sendSlack?: typeof sendSlackAlert;
};

export type CriticalFailureResult = ReportOperationalErrorResult & {
  /** True only when the production #ops-critical alert was actually sent. */
  slackSent: boolean;
};

/**
 * Reports a customer-or-revenue-blocking failure to Sentry (always) and to
 * #ops-critical (production only). Returns the same reference/event data
 * reportOperationalError() returns, plus whether Slack was sent.
 */
export async function reportCriticalFailure(
  params: CriticalFailureParams,
  deps: CriticalFailureDeps = {}
): Promise<CriticalFailureResult> {
  const sentryClient = deps.sentryClient ?? getDefaultSentryCaptureClient();
  const sendSlack = deps.sendSlack ?? sendSlackAlert;

  const report = reportOperationalError(
    {
      error: params.error,
      flow: params.flow,
      stage: params.stage,
      severity: "critical",
      context: params.context,
    },
    sentryClient
  );

  // Production-only guard: routine Preview/staging exercise of these flows
  // must never page the real #ops-critical channel. Sentry still gets the
  // correctly environment-tagged event either way (via reportOperationalError
  // above) — only the Slack escalation is gated here. Narrowly scoped to
  // this one call path, not a change to sendSlackAlert() itself or any
  // existing caller.
  let slackSent = false;
  if (report.environment === "production") {
    const safeSlackFields = sanitizeOperationalContext(params.slackFields);
    await sendSlack({
      channel: "ops-critical",
      severity: "critical",
      title: params.title,
      message: `A customer/revenue-impacting failure occurred in the ${params.flow} flow (stage: ${params.stage}).`,
      metadata: {
        "HHC Error": report.hhcErrorId,
        Flow: report.flow,
        Stage: report.stage,
        ...safeSlackFields,
        Environment: report.environment,
        "Sentry Event": report.sentryEventId ?? "unavailable",
        Failure: params.technicalSummary,
      },
    });
    slackSent = true;
  }

  return { ...report, slackSent };
}

// ── Backward compatibility ──────────────────────────────────────────────────
//
// reportCriticalAcquisitionFailure was this module's original, acquisition-
// specific name — still used, unmodified, by the Add Your Venue
// (suggest/owner/actions.ts) and Claim Your Venue (venue/[id]/claim/actions.ts)
// call sites. Kept as a stable, identically-behaved alias rather than
// renaming those call sites, which is out of scope for whatever task
// generalized this file. New call sites (Stripe and beyond) should use
// reportCriticalFailure directly.
export type CriticalAcquisitionFailureParams = CriticalFailureParams;
export type CriticalAcquisitionFailureDeps = CriticalFailureDeps;
export type CriticalAcquisitionFailureResult = CriticalFailureResult;
export const reportCriticalAcquisitionFailure = reportCriticalFailure;
