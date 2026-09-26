"use server";

import { cookies, headers } from "next/headers";
import { getClientIpFromHeaders } from "@/lib/turnstile";
import { getOperatorVerificationCodeHmacSecret } from "@/lib/activation/emailCodeVerificationConfig";
import {
  continueAfterVerification,
  requestVerificationCode,
  startSessionAfterVerification,
  submitVerificationCode,
} from "@/lib/activation/emailCodeVerificationService";
import {
  signVerifiedBrowserProof,
  VERIFIED_BROWSER_PROOF_COOKIE,
  VERIFIED_BROWSER_PROOF_LIFETIME_MS,
} from "@/lib/activation/emailCodeVerificationTokens";
import type { EmailCodeActionResult } from "@/lib/activation/emailCodeVerificationTypes";

/**
 * /operator/verify server actions — thin, fixed-signature wrappers. The
 * only client inputs are the signed link token (already in the page URL)
 * and the typed code; there is no `deps` parameter on any exported action
 * (same rule as every other "use server" file in this codebase — see
 * resendClaimSetupEmailImpl.ts's header). All logic lives in
 * src/lib/activation/emailCodeVerificationService.ts.
 */

/** "Send code" and "Resend code". Safe to double-click: the database function serializes and rate-limits issuance. */
export async function requestVerificationCodeAction(token: string): Promise<EmailCodeActionResult> {
  const requestIp = getClientIpFromHeaders(await headers());
  return requestVerificationCode(token, { requestIp });
}

/**
 * Verifies a code and, on success, starts the operator's session so the
 * browser can continue to /operator/create-password. Also marks this
 * browser as the one that verified (short-lived httpOnly proof), so a
 * refresh or a retry after a failed session start can continue without
 * the link token becoming a bearer credential.
 */
export async function verifyCodeAction(token: string, code: string): Promise<EmailCodeActionResult> {
  const result = await submitVerificationCode(token, code);
  if (result.status === "rate_limited") {
    return { status: "rate_limited", resendAvailableAt: result.resendAvailableAt };
  }
  if (result.status !== "verified") {
    return { status: result.status };
  }

  if (result.consumedNow) {
    const proof = signVerifiedBrowserProof(result.lifecycleId, getOperatorVerificationCodeHmacSecret());
    if (proof) {
      (await cookies()).set(VERIFIED_BROWSER_PROOF_COOKIE, proof, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/operator",
        maxAge: Math.floor(VERIFIED_BROWSER_PROOF_LIFETIME_MS / 1000),
      });
    }
    const session = await startSessionAfterVerification(result.lifecycleId);
    // Verification itself succeeded either way; without a session the page
    // offers "Continue", which retries through the proof cookie.
    return session.next ? session : { status: "verified" };
  }

  // Already verified by an earlier (or concurrent) request — never start a
  // second session from here; the browser continues via the proof cookie.
  return continueAfterVerificationAction(token);
}

/** "Continue" once verified — only works in the browser holding the verified-browser proof. */
export async function continueAfterVerificationAction(token: string): Promise<EmailCodeActionResult> {
  const proof = (await cookies()).get(VERIFIED_BROWSER_PROOF_COOKIE)?.value ?? null;
  return continueAfterVerification(token, proof);
}
