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
