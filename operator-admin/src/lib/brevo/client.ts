import { getBrevoConfig, normalizeEmail } from "./config";
import { assertAllowedToSyncEmail } from "./stagingGuard";
import { BrevoApiError, classifyHttpStatus } from "./errors";
import { maskEmail } from "./maskEmail";

/**
 * Brevo API client — server-only. This is the ONLY module in the codebase
 * that performs a network call to Brevo's contacts API; every caller (the
 * outbox processor, any future direct caller) goes through
 * upsertBrevoContact() or removeBrevoContactFromList() so the
 * staging-allowlist guard and error classification are applied exactly
 * once, in exactly one place, regardless of which operation is used.
 */

const BREVO_API_BASE = "https://api.brevo.com/v3";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Only Brevo attributes that already exist in the account (FIRSTNAME,
 * LASTNAME, EXT_ID) per the approved contact model — this task deliberately
 * does not introduce new custom Brevo attributes.
 */
export type BrevoContactAttributes = Partial<{
  FIRSTNAME: string;
  LASTNAME: string;
  EXT_ID: string;
}>;

export type UpsertBrevoContactParams = {
  /** Brevo's native identifier for the contact — email may change over time; this is always the current value. */
  email: string;
  attributes?: BrevoContactAttributes;
  listId: number;
};

/**
 * Upserts a Brevo contact by email: POST /v3/contacts with
 * `updateEnabled: true`, Brevo's documented idempotent create-or-update
 * primitive — safe to call repeatedly for the same contact, and safe if the
 * contact's email attribute values change between calls (a later call with
 * updated attributes simply updates the existing contact).
 *
 * Throws BrevoApiError (classified) on any non-2xx response or network
 * failure, or BrevoStagingGuardBlockedError / BrevoConfigError from the
 * guard/config steps below — callers use classifyThrown() (errors.ts) to
 * turn any of these into a retry/permanent-failure decision.
 */
export async function upsertBrevoContact(params: UpsertBrevoContactParams): Promise<void> {
  const config = getBrevoConfig();

  // Staging safety choke point. Must run before any network call — see
  // stagingGuard.ts for why this is the single enforcement point.
  assertAllowedToSyncEmail(params.email, config.testEmail);

  const body = {
    email: params.email,
    attributes: params.attributes ?? {},
    listIds: [params.listId],
    updateEnabled: true,
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(`${BREVO_API_BASE}/contacts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": config.apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network error, timeout, or abort — always transient.
    const msg = err instanceof Error ? err.message : String(err);
    throw new BrevoApiError(`Brevo contact upsert network failure: ${msg}`, "transient");
  }

  if (response.ok) return;

  const errorClass = classifyHttpStatus(response.status);
  let brevoCode: string | null = null;
  let brevoMessage = response.statusText;
  try {
    const errBody = (await response.json()) as { code?: string; message?: string };
    brevoCode = errBody.code ?? null;
    brevoMessage = errBody.message ?? brevoMessage;
  } catch {
    // Body wasn't JSON (or was empty) — fall back to statusText above.
  }

  throw new BrevoApiError(
    `Brevo contact upsert failed for ${maskEmail(params.email)}: HTTP ${response.status} ${brevoMessage}`,
    errorClass,
    response.status,
    brevoCode
  );
}

export type RemoveBrevoContactFromListParams = {
  email: string;
  listId: number;
};

/**
 * Removes a contact from one specific Brevo list — the narrow, purpose-built
 * primitive for "no longer eligible for this list" (POST
 * /v3/contacts/lists/{listId}/contacts/remove, body { emails: [...] } —
 * confirmed against Brevo's official API docs at implementation time).
 * Deliberately NOT the broader `emailBlacklisted` contact field (which
 * suppresses all Brevo email to the address, not just list membership) and
 * NOT a contact-delete call — neither is what "marketing_consent went
 * false for the HHC consumer list" means.
 *
 * Per Brevo's documented response schema (confirmed against the official
 * API reference at implementation time), this endpoint responds HTTP 201
 * for the request as a whole, with the body shaped
 * `{ contacts: { success: [...], failure: [...] } }` — plain arrays of the
 * same identifiers passed in the request (email strings here). Brevo's
 * docs do NOT document any further detail on a failure entry (no reason,
 * code, or message field) — there is no documented way to distinguish
 * "already wasn't a member," "unknown contact," and a genuine removal
 * failure from that array alone. Given that documented gap, this function
 * takes the conservative reading: the request succeeding (HTTP 2xx) is
 * necessary but not sufficient — the requested email must NOT appear in
 * `contacts.failure`, or it's surfaced as a (retryable) BrevoApiError
 * rather than silently treated as the desired end state. This is
 * deliberately cautious rather than assumed-safe; the actual real-world
 * behavior (does an already-absent contact appear in `failure`?) is
 * unverified against a live response and is flagged for controlled
 * staging QA — see the Phase 2B follow-up report.
 *
 * Never deletes the Brevo contact and never touches any other list.
 */
export async function removeBrevoContactFromList(params: RemoveBrevoContactFromListParams): Promise<void> {
  const config = getBrevoConfig();

  // Staging safety choke point — identical rule and enforcement point as
  // upsertBrevoContact above.
  assertAllowedToSyncEmail(params.email, config.testEmail);

  let response: Response;
  try {
    response = await fetchWithTimeout(`${BREVO_API_BASE}/contacts/lists/${params.listId}/contacts/remove`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": config.apiKey,
      },
      body: JSON.stringify({ emails: [params.email] }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BrevoApiError(`Brevo list-removal network failure: ${msg}`, "transient");
  }

  // Read the body once, regardless of status — used for the error message
  // on a non-2xx response, and to check the per-contact failure array on a
  // 2xx response. Response bodies can only be consumed once.
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // No parseable body (e.g. empty response) — handled per-branch below.
  }

  if (!response.ok) {
    const errorClass = classifyHttpStatus(response.status);
    const errBody = (body ?? {}) as { code?: string; message?: string };
    throw new BrevoApiError(
      `Brevo list removal failed for ${maskEmail(params.email)}: HTTP ${response.status} ${errBody.message ?? response.statusText}`,
      errorClass,
      response.status,
      errBody.code ?? null
    );
  }

  // HTTP 2xx — but per the doc comment above, Brevo may still report the
  // requested email in the body's `contacts.failure` array, and its
  // documented schema gives no way to tell that apart from a harmless
  // already-absent contact. Treat any appearance there as a retryable
  // failure rather than assume it's safe.
  const failureList = (body as { contacts?: { failure?: unknown[] } } | null)?.contacts?.failure ?? [];
  const normalizedTarget = normalizeEmail(params.email);
  const reportedAsFailure = failureList.some(
    (entry) => typeof entry === "string" && normalizeEmail(entry) === normalizedTarget
  );

  if (reportedAsFailure) {
    throw new BrevoApiError(
      `Brevo list removal reported a per-contact failure for ${maskEmail(params.email)} on list ${params.listId} ` +
        `(HTTP ${response.status} succeeded, but the requested email appears in the response body's failure list — ` +
        `Brevo's documented schema does not distinguish an already-absent contact from a genuine failure here, so ` +
        `this is treated conservatively as retryable rather than assumed harmless)`,
      "unknown",
      response.status,
      null
    );
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
