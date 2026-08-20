import { timingSafeEqual } from "node:crypto";
import { getBrevoWebhookToken } from "./config";

export type WebhookAuthResult =
  | { ok: true }
  | { ok: false; reason: "missing_config" | "missing_token" | "invalid_token" };

/**
 * Verifies an inbound Brevo webhook request against BREVO_WEBHOOK_TOKEN.
 *
 * Brevo's "Token" outbound-webhook authentication method sends the
 * configured token as a standard bearer token — `Authorization: Bearer
 * <token>` — per Brevo's webhook auth object shape
 * (`{ "type": "bearer", "token": "<token>" }`, confirmed against Brevo's
 * API/help documentation at implementation time). This function also
 * defensively accepts the raw token with no "Bearer " prefix in the same
 * header, because the actual production webhook has not been created in
 * Brevo yet (per this task's brief) and its exact request framing cannot be
 * fully confirmed until Wayne configures it against this deployed endpoint.
 * Re-verify against a real test delivery before Phase 2, and simplify this
 * to whichever single shape is actually observed.
 */
export function verifyBrevoWebhookRequest(authorizationHeader: string | null): WebhookAuthResult {
  let expectedToken: string;
  try {
    expectedToken = getBrevoWebhookToken();
  } catch {
    return { ok: false, reason: "missing_config" };
  }

  if (!authorizationHeader) {
    return { ok: false, reason: "missing_token" };
  }

  const presented = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : authorizationHeader;

  return safeCompare(presented, expectedToken) ? { ok: true } : { ok: false, reason: "invalid_token" };
}

/** Constant-time comparison — never branch on the secret's own content. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal-length buffers; a length mismatch is
  // already a definitive "not equal" and doesn't leak anything beyond what
  // an attacker could trivially determine by trying different lengths.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
