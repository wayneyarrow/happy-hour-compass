import { getBrevoConfig } from "./config";
import { assertAllowedToSyncEmail } from "./stagingGuard";
import { BrevoApiError, classifyHttpStatus } from "./errors";
import { maskEmail } from "./maskEmail";

/**
 * Brevo API client — server-only. This is the ONLY module in the codebase
 * that performs a network call to Brevo's contacts API; every caller
 * (the outbox processor today, any future direct caller) goes through
 * upsertBrevoContact() so the staging-allowlist guard and error
 * classification are applied exactly once, in exactly one place.
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

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
