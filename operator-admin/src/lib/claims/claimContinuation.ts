/**
 * Client-safe: the only destinations a claim form may navigate to after an
 * auto-approved claim. The server builds these, but the client re-checks
 * the exact shape so a tampered/unexpected value can never redirect off
 * the HHC onboarding flow (no open redirect).
 */
const VERIFY_PATH = /^\/operator\/verify\?t=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;

export function safeClaimContinuation(state: { verificationPath?: unknown; nextPath?: unknown }): string | null {
  if (typeof state.verificationPath === "string" && VERIFY_PATH.test(state.verificationPath)) return state.verificationPath;
  if (state.nextPath === "/login") return "/login";
  return null;
}

/**
 * Client-safe: copy for an APPROVED claim whose setup continues by email
 * (the rare path where the browser can't go straight to /operator/verify).
 * Returns null for anything else — a genuinely pending claim keeps the
 * existing "we'll review it" confirmation.
 */
export function approvedClaimEmailNotice(state: { approvedSetup?: unknown }): { title: string; body: string } | null {
  if (state.approvedSetup === "emailed") {
    return {
      title: "Your claim has been approved.",
      body: "We’ve emailed you instructions to finish setting up your account.",
    };
  }
  if (state.approvedSetup === "pending_email") {
    return {
      title: "Your claim has been approved.",
      body: "We’ll email you instructions to finish setting up your account. If they don’t arrive soon, contact hello@happyhourcompass.com.",
    };
  }
  return null;
}
