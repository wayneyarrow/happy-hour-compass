/**
 * Cloudflare Turnstile server-side verification — server-only.
 *
 * NEVER import this from a Client Component. TURNSTILE_SECRET_KEY must
 * never reach the browser bundle.
 *
 * This is the single authoritative check for every unauthenticated public
 * form's server action (contact, suggest venue, add venue, claim venue,
 * more-info follow-ups, consumer signup, password resets). Client-side
 * widget completion is only a UI gate — verifyTurnstileToken() must be
 * called server-side, before any database write, account creation, email,
 * or Slack notification, and its result must block the submission on
 * failure. See CLAUDE.md's Turnstile section for the full architecture.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerification =
  | { success: true }
  | { success: false; reason: "missing-token" | "failed" | "network-error" | "not-configured" };

/**
 * Verifies a Cloudflare Turnstile token via Siteverify.
 *
 * Treats a missing token, a failed/expired/already-used token, and a
 * Siteverify network failure identically: verification did not succeed,
 * so the caller must not proceed with the submission.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null
): Promise<TurnstileVerification> {
  if (!token) {
    return { success: false, reason: "missing-token" };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("[verifyTurnstileToken] TURNSTILE_SECRET_KEY is not configured.");
    return { success: false, reason: "not-configured" };
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      console.error("[verifyTurnstileToken] Siteverify HTTP error:", res.status);
      return { success: false, reason: "network-error" };
    }

    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };

    if (!data.success) {
      console.warn("[verifyTurnstileToken] Verification failed:", data["error-codes"]);
      return { success: false, reason: "failed" };
    }

    return { success: true };
  } catch (err) {
    console.error("[verifyTurnstileToken] Siteverify request threw:", err);
    return { success: false, reason: "network-error" };
  }
}

/** Friendly, non-technical message shown to the user when verification fails. */
export const TURNSTILE_FAILURE_MESSAGE =
  "We couldn't verify you're human. Please complete the challenge below and try again.";

/** Extracts the client IP from request headers for Siteverify's optional remoteip param. */
export function getClientIpFromHeaders(headerList: Headers): string | null {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headerList.get("x-real-ip");
}

/** FormData field name every Turnstile-protected form submits its token under. */
export const TURNSTILE_TOKEN_FIELD = "cf_turnstile_token";
