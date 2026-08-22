/**
 * Reusable reporter for HANDLED operational errors — the gap the
 * observability audit identified: Sentry correctly captures *unhandled*
 * exceptions (via onRequestError / global-error.tsx), but every internal
 * failure that's already caught in a try/catch or returned as a normal
 * `{ error }` result (the FK-constraint venue-creation failure that started
 * this project, and the same shape repeated across claim/suggest/contact)
 * was previously invisible to Sentry — console.error only.
 *
 * Call this from the catch/error branch of a handled internal failure
 * instead of a bare console.error. It:
 *   1. Generates one HHC-XXXXX reference id for this occurrence.
 *   2. Explicitly captures the error in Sentry with stable tags.
 *   3. Still logs to console (existing `vercel logs` grep-based workflows
 *      keep working unchanged).
 *   4. Returns everything a caller needs to build its response — most
 *      usefully `customerMessage`, ready to hand straight to a Server
 *      Action's `return { error: report.customerMessage }`.
 *
 * This task deliberately does NOT wire flows to call this yet (see the
 * task's scope guardrails) and does NOT call sendSlackAlert() from inside
 * here. A future task can do, for `severity === "critical"`:
 *
 *   const report = reportOperationalError({ error, flow, stage, severity: "critical" });
 *   await sendSlackAlert({
 *     channel: "ops-critical",
 *     severity: "critical",
 *     title: `${report.flow} — ${report.stage} failed`,
 *     message: `Reference ${report.hhcErrorId}. See Sentry event ${report.sentryEventId ?? "(capture failed)"}.`,
 *     metadata: { Flow: report.flow, Stage: report.stage, Environment: report.environment },
 *   });
 *
 * without regenerating an id or re-capturing to Sentry — every field that
 * call needs is already on the returned report. Keeping that call at the
 * flow's own call site (rather than inside this helper) avoids a second
 * Slack implementation and keeps this foundation's job to exactly one
 * thing: produce one correlated, privacy-safe Sentry event per failure.
 */

import * as Sentry from "@sentry/nextjs";
import { generateHhcErrorReference } from "./errorReference";
import { buildInternalErrorMessage } from "./customerMessage";
import { resolveSentryEnvironment } from "./sentryRuntime";
import type { OperationalSeverity } from "./types";

// ── Minimal Sentry client surface ───────────────────────────────────────────
//
// Narrowed to exactly the one call this module makes, mirroring the
// existing narrow-client-surface + dependency-injection pattern used for
// Supabase in src/lib/google/reconcileVenueGoogleIdentity.ts — lets tests
// inject a fake instead of mocking the @sentry/nextjs module.
//
// This is a hand-rolled subset of Sentry's own (much wider, union-typed)
// captureContext shape — only the plain "scope context object" fields this
// module actually uses. The real Sentry.captureException's second parameter
// also accepts a Scope instance or a scope-mutating callback, which this
// codebase never uses, so leaving those out keeps the type concrete and
// easy to assert against in tests. A concrete object matching this shape is
// structurally assignable to Sentry's wider real parameter type, so
// getDefaultSentryCaptureClient below still type-checks against the
// installed SDK.
export type SentryCaptureContext = {
  level?: "warning" | "error" | "fatal";
  tags?: Record<string, string>;
  contexts?: Record<string, Record<string, unknown>>;
  /**
   * Intentionally never set by reportOperationalError — see the "Deliberately
   * no `fingerprint`" comment below and Part 10 of the observability
   * foundation report. Declared here only so a test can assert it stays
   * absent.
   */
  fingerprint?: string[];
};

export type SentryCaptureClient = {
  captureException(exception: unknown, captureContext?: SentryCaptureContext): string;
};

export function getDefaultSentryCaptureClient(): SentryCaptureClient {
  return {
    captureException: (exception, captureContext) =>
      Sentry.captureException(exception, captureContext),
  };
}

// ── Context privacy guardrail ───────────────────────────────────────────────
//
// Context is caller-supplied and deliberately narrow (primitives only, by
// type) — this function is a second, runtime layer of defense, not the
// primary one. It drops (does not merely mask) any key whose *name* looks
// like it holds contact info, a secret, or a credential, and drops any
// value that isn't actually a primitive despite the type signature (a
// looser JS caller, or a value that changed shape after the types were
// written). Every drop is logged so misuse is visible during development
// rather than silently vanishing.
//
// The `^((first|last|full)[_-]?)?name$` branch (anchored to match the
// WHOLE key, unlike every other branch here, which matches anywhere in the
// key) drops personal-name fields — firstName/first_name/firstname,
// lastName/last_name/lastname, fullName/full_name/fullname, and a bare
// "name" — without catching safe entity-name identifiers like `venueName`
// or `businessName`, which don't start with first/last/full and aren't the
// bare word "name". Discovered as a gap during Consumer Signup observability
// work (the first flow whose context is genuinely name-adjacent); hardened
// here as shared infrastructure rather than patched per-flow.
//
// `ssn` was changed from a bare substring match to `(?<![a-z])ssn(?![a-z])`
// (i.e. not glued directly onto another letter) as a side effect of adding
// the name-field branch above: `businessName` contains the literal
// substring "ssN" (busine-SS-N-ame), which the old bare `ssn` match caught
// as a false positive — exactly the safe entity-name field this change is
// required to keep allowing. The lookaround still matches "ssn" on its own,
// with an underscore/hyphen delimiter (`consumer_ssn`), or any other
// non-letter boundary; it only stops matching an "ssn" glued directly onto
// another word with no delimiter or case-boundary hint at all (e.g. a
// hypothetical "consumerSsn") — not a real field anywhere in this codebase,
// and a reasonable trade-off for a term this app never actually collects.
const SENSITIVE_CONTEXT_KEY_PATTERN =
  /email|phone|address|token|password|passwd|secret|api[-_]?key|cookie|signature|(?<![a-z])ssn(?![a-z])|card|auth(?!or)|^((first|last|full)[_-]?)?name$/i;

export type OperationalErrorContext = Record<
  string,
  string | number | boolean | null | undefined
>;

export function sanitizeOperationalContext(
  context: OperationalErrorContext | undefined
): Record<string, string | number | boolean | null> | undefined {
  if (!context) return undefined;

  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_CONTEXT_KEY_PATTERN.test(key)) {
      console.warn(
        `[reportOperationalError] Dropped context key "${key}" — matches the sensitive-field pattern and must not reach Sentry.`
      );
      continue;
    }
    if (value !== null && value !== undefined && typeof value === "object") {
      console.warn(
        `[reportOperationalError] Dropped context key "${key}" — non-primitive values are not allowed.`
      );
      continue;
    }
    if (value === undefined) continue; // omit rather than send an explicit undefined
    clean[key] = value;
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}

// ── Error normalization ─────────────────────────────────────────────────────
//
// Many of the errors this reporter exists for aren't real Error instances —
// e.g. a Supabase/Postgrest error is a plain
// { code, details, hint, message } object. Sentry.captureException accepts
// `unknown` and will do its best with a plain object, but grouping and
// stack-trace quality are meaningfully better with a real Error, so
// non-Error inputs are wrapped (preserving their message text — which for a
// DB error is exactly the useful technical detail, e.g. "insert or update on
// table venues violates foreign key constraint...") rather than passed
// through as-is.
function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return new Error(message);
    }
  }

  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

function severityToSentryLevel(severity: OperationalSeverity): "warning" | "error" {
  // "critical" intentionally maps to Sentry's "error" level, not "fatal" —
  // "fatal" is reserved for the app actually crashing (the unhandled-
  // exception path via onRequestError / global-error.tsx). A critical
  // *handled* error is still a controlled, caught failure; `severity` (a
  // separate tag, see below) is what distinguishes it for HHC's own triage.
  return severity === "warning" ? "warning" : "error";
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ReportOperationalErrorParams = {
  /** The caught error/failure. Any shape — see normalizeError above. */
  error: unknown;
  /** Stable slug identifying the user journey, e.g. "operator-submission". */
  flow: string;
  /** Stable slug identifying the step within that flow, e.g. "venue-insert". */
  stage: string;
  severity: OperationalSeverity;
  /**
   * Small, explicit, non-sensitive business context (e.g. matchStatus,
   * routedStatus). Never pass emails, phone numbers, addresses, tokens,
   * secrets, cookies, or arbitrary request/user objects — see
   * sanitizeOperationalContext, which enforces this at runtime as well.
   */
  context?: OperationalErrorContext;
};

export type ReportOperationalErrorResult = {
  /** e.g. "HHC-7X42M" — safe to show to the customer and to search Sentry by. */
  hhcErrorId: string;
  flow: string;
  stage: string;
  severity: OperationalSeverity;
  /** Resolved via VERCEL_ENV — see sentryRuntime.ts. */
  environment: string;
  /** Sentry's event id if capture succeeded, or null if Sentry itself failed. */
  sentryEventId: string | null;
  /** Ready-to-return customer copy: buildInternalErrorMessage(hhcErrorId). */
  customerMessage: string;
};

/**
 * Reports one handled operational error: generates a reference id, captures
 * it in Sentry with stable tags, logs it to console, and returns everything
 * a caller needs to respond to the user and (later) escalate to Slack.
 *
 * Never throws — a failure inside Sentry capture itself is caught and
 * logged, never allowed to interrupt the caller's own error handling.
 */
export function reportOperationalError(
  params: ReportOperationalErrorParams,
  sentryClient: SentryCaptureClient = getDefaultSentryCaptureClient()
): ReportOperationalErrorResult {
  const { error, flow, stage, severity, context } = params;

  const hhcErrorId = generateHhcErrorReference();
  const environment = resolveSentryEnvironment(process.env.VERCEL_ENV);
  const normalizedError = normalizeError(error);

  console.error(
    `[${flow}] ${stage} failed — ${hhcErrorId} (severity=${severity}, environment=${environment}):`,
    error
  );

  const cleanContext = sanitizeOperationalContext(context);

  let sentryEventId: string | null = null;
  try {
    sentryEventId = sentryClient.captureException(normalizedError, {
      // Deliberately no `fingerprint` here — the random hhc_error_id must
      // stay a searchable TAG, never part of Sentry's grouping key or the
      // exception message, or every occurrence of the same underlying bug
      // would fragment into its own issue instead of accumulating under
      // one. Sentry's default fingerprint (exception type + stack/message)
      // is left untouched on purpose.
      level: severityToSentryLevel(severity),
      tags: {
        hhc_error_id: hhcErrorId,
        flow,
        stage,
        severity,
        environment,
      },
      ...(cleanContext ? { contexts: { hhc_context: cleanContext } } : {}),
    });
  } catch (captureErr) {
    // Sentry reporting failing must never become a second failure the
    // caller has to handle — this mirrors sendSlackAlert's "never throws"
    // contract in src/lib/slack.ts.
    console.error(
      `[reportOperationalError] Sentry capture itself failed for ${hhcErrorId}:`,
      captureErr
    );
  }

  return {
    hhcErrorId,
    flow,
    stage,
    severity,
    environment,
    sentryEventId,
    customerMessage: buildInternalErrorMessage(hhcErrorId),
  };
}
