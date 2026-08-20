import { BrevoConfigError } from "./config";
import { BrevoStagingGuardBlockedError } from "./stagingGuard";

/**
 * Brevo failure classification — the single place retry/permanent-failure
 * decisions are made, shared by the API client (which throws) and the
 * outbox processor (which decides retry vs. fail from the class).
 *
 * Per the integration requirements: rate limits, network failures, and 5xx
 * responses are retryable ("transient"); invalid configuration/auth and
 * structurally invalid requests are observable non-transient failures that
 * must never be retried forever.
 */
export type BrevoErrorClass =
  | "transient" // network error, timeout, 429, 5xx — retry with backoff
  | "auth" // 401/403 — invalid API key or insufficient permission
  | "invalid_request" // 400/404/422 — payload Brevo rejects; retrying won't help
  | "config" // missing/malformed local configuration (BrevoConfigError)
  | "blocked" // staging-allowlist refusal — never reached the Brevo API
  | "unknown"; // unclassified — treated as transient with the standard budget

export class BrevoApiError extends Error {
  readonly errorClass: BrevoErrorClass;
  readonly status: number | null;
  /** Brevo's own error code (e.g. "invalid_parameter", "duplicate_parameter"), when present. */
  readonly brevoCode: string | null;

  constructor(
    message: string,
    errorClass: BrevoErrorClass,
    status: number | null = null,
    brevoCode: string | null = null
  ) {
    super(message);
    this.name = "BrevoApiError";
    this.errorClass = errorClass;
    this.status = status;
    this.brevoCode = brevoCode;
  }
}

/** True for error classes the outbox processor should retry (with backoff). */
export function isRetryable(errorClass: BrevoErrorClass): boolean {
  return errorClass === "transient" || errorClass === "unknown";
}

/**
 * Classifies a raw Brevo API HTTP response status into a BrevoErrorClass.
 * Does not need the response body — status code alone is sufficient and
 * this keeps the mapping testable without constructing a Response.
 */
export function classifyHttpStatus(status: number): BrevoErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "transient";
  if (status >= 500) return "transient";
  if (status >= 400) return "invalid_request";
  return "unknown";
}

/**
 * Normalizes any thrown value from the Brevo call path into an
 * {errorClass, message} pair for the outbox processor. Centralizing this
 * here (rather than duplicating instanceof checks at each call site) keeps
 * "which failures are retryable" defined in exactly one place.
 */
export function classifyThrown(err: unknown): { errorClass: BrevoErrorClass; message: string } {
  if (err instanceof BrevoApiError) {
    return { errorClass: err.errorClass, message: err.message };
  }
  if (err instanceof BrevoStagingGuardBlockedError) {
    return { errorClass: "blocked", message: err.message };
  }
  if (err instanceof BrevoConfigError) {
    return { errorClass: "config", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { errorClass: "unknown", message };
}
