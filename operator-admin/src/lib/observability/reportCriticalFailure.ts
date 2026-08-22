/**
 * Reports a CATEGORY-C, customer-blocking operational failure: captures it
 * once via reportOperationalError() (Sentry + one HHC-XXXXX reference), and,
 * production-only, escalates the SAME correlated occurrence to #ops-critical
 * via the existing sendSlackAlert() infrastructure — no second Slack
 * implementation, no second HHC id, no second Sentry capture.
 *
 * This is exactly the extension point reportOperationalError.ts's own header
 * comment described and deliberately left unwired: this file is the first
 * caller of it, used here for the Add Your Venue / Claim Your Venue
 * acquisition flows. Reserve it for genuinely customer-blocking failures
 * (severity is always "critical" — hardcoded, not a caller option, so it
 * can't be misused for a lower-severity/non-blocking case). A best-effort
 * or non-blocking failure should call reportOperationalError() directly
 * instead, without this wrapper.
 *
 * Correct call sequence at a business-flow site (see actions.ts in both
 * instrumented flows for real usage):
 *   1. failure occurs, caught in a try/catch or an `if (error)` branch
 *   2. call reportCriticalAcquisitionFailure() exactly once
 *   3. return { error: report.customerMessage } to the customer
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

export type CriticalAcquisitionFailureParams = {
  /** The caught error/failure. Any shape — see reportOperationalError's normalizeError. */
  error: unknown;
  /** Stable slug identifying the user journey, e.g. "operator-submission". */
  flow: string;
  /** Stable slug identifying the step within that flow, e.g. "venue-insert". */
  stage: string;
  /** Human-readable Slack alert title, e.g. "Operator Venue Submission Failed". */
  title: string;
  /** One short, safe technical classification, e.g. "database write failed". Never a raw error dump. */
  technicalSummary: string;
  /**
   * Safe, non-sensitive business context attached to the Sentry event (same
   * guardrails as reportOperationalError's own `context` — see there for
   * what must never be passed).
   */
  context?: OperationalErrorContext;
  /**
   * Additional safe display fields for the Slack alert only, e.g.
   * `{ Venue: "Casa de Frida" }`. Run through the same
   * sanitizeOperationalContext() guardrail as `context` — never pass
   * emails, phone numbers, addresses, tokens, secrets, or raw form data.
   */
  slackFields?: OperationalErrorContext;
};

/** Test-only injection points — production callers should never pass this. */
export type CriticalAcquisitionFailureDeps = {
  sentryClient?: SentryCaptureClient;
  sendSlack?: typeof sendSlackAlert;
};

export type CriticalAcquisitionFailureResult = ReportOperationalErrorResult & {
  /** True only when the production #ops-critical alert was actually sent. */
  slackSent: boolean;
};

/**
 * Reports a customer-blocking acquisition-flow failure to Sentry (always)
 * and to #ops-critical (production only). Returns the same reference/event
 * data reportOperationalError() returns, plus whether Slack was sent.
 */
export async function reportCriticalAcquisitionFailure(
  params: CriticalAcquisitionFailureParams,
  deps: CriticalAcquisitionFailureDeps = {}
): Promise<CriticalAcquisitionFailureResult> {
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
  // existing caller (see the observability foundation report for why a
  // central guard inside slack.ts was deliberately not attempted in this
  // task).
  let slackSent = false;
  if (report.environment === "production") {
    const safeSlackFields = sanitizeOperationalContext(params.slackFields);
    await sendSlack({
      channel: "ops-critical",
      severity: "critical",
      title: params.title,
      message: `A customer-blocking failure occurred in the ${params.flow} journey (stage: ${params.stage}).`,
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
