/**
 * Signed tokens for the operator email-code activation flow (email-code
 * initiative, Phase 2B). Pure — no I/O, no environment reads; the HMAC
 * secret is always passed in (see getOperatorVerificationCodeHmacSecret()).
 *
 * Server-only (uses node:crypto) — never import into a Client Component.
 *
 * TWO TOKENS, each domain-separated from the code digest
 * (emailCodeVerificationPolicy.ts) and from each other:
 *
 *   Link token — `<lifecycleId>.<mac>`, carried in /operator/verify?t=...
 *     It is what an approval/reminder/resend email links to, and what the
 *     in-flow Add Your Venue path redirects to. Lifecycle ids are not
 *     secret (they appear in Control Panel URLs and Slack metadata), so the
 *     MAC is what stops anyone who merely knows an id from triggering code
 *     sends or guessing codes for that lifecycle. It never expires on its
 *     own: the lifecycle's own deadline/expiry/release decides whether the
 *     page will do anything, and possession of the link grants nothing
 *     beyond "send a code to the operator's own inbox" and "enter a code".
 *
 *   Verified-browser proof — `<lifecycleId>.<expiresMs>.<mac>`, set as an
 *     httpOnly cookie only at the moment a code is successfully consumed.
 *     Lets the SAME browser retry session setup (e.g. a transient Supabase
 *     link failure right after verification) without turning the link
 *     token into a bearer credential after verification. Short-lived.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH } from "./emailCodeVerificationConfig";

const LINK_CONTEXT = "hhc-operator-verify-link:v1";
const PROOF_CONTEXT = "hhc-operator-verified-browser:v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** How long a verified-browser proof lets the same browser resume session setup. */
export const VERIFIED_BROWSER_PROOF_LIFETIME_MS = 30 * 60 * 1000;

/** Cookie name for the verified-browser proof. */
export const VERIFIED_BROWSER_PROOF_COOKIE = "hhc_operator_verified";

function usableSecret(secret: string | null | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH;
}

function mac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}

function macEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ── Link token ───────────────────────────────────────────────────────────────

/** Returns null when the secret is unusable or the id isn't a UUID — callers must treat that as "unavailable". */
export function signVerificationLinkToken(lifecycleId: string, secret: string | null | undefined): string | null {
  if (!usableSecret(secret) || !UUID_PATTERN.test(lifecycleId)) return null;
  const id = lifecycleId.toLowerCase();
  return `${id}.${mac(secret, `${LINK_CONTEXT}:${id}`)}`;
}

/** The lifecycle id a genuine link token names, or null for anything malformed, forged, or unverifiable. */
export function readVerificationLinkToken(token: unknown, secret: string | null | undefined): string | null {
  if (!usableSecret(secret) || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [id, tokenMac] = parts;
  if (!UUID_PATTERN.test(id) || id !== id.toLowerCase() || !MAC_PATTERN.test(tokenMac)) return null;
  return macEquals(tokenMac, mac(secret, `${LINK_CONTEXT}:${id}`)) ? id : null;
}

// ── Verified-browser proof ───────────────────────────────────────────────────

export function signVerifiedBrowserProof(
  lifecycleId: string,
  secret: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!usableSecret(secret) || !UUID_PATTERN.test(lifecycleId)) return null;
  const id = lifecycleId.toLowerCase();
  const expiresMs = now.getTime() + VERIFIED_BROWSER_PROOF_LIFETIME_MS;
  return `${id}.${expiresMs}.${mac(secret, `${PROOF_CONTEXT}:${id}:${expiresMs}`)}`;
}

/** True only for an unexpired proof, signed with this secret, for exactly this lifecycle. */
export function isVerifiedBrowserProofValid(
  proof: unknown,
  lifecycleId: string,
  secret: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!usableSecret(secret) || typeof proof !== "string") return false;
  const parts = proof.split(".");
  if (parts.length !== 3) return false;
  const [id, expiresRaw, proofMac] = parts;
  if (id !== lifecycleId.toLowerCase() || !/^[0-9]{1,15}$/.test(expiresRaw) || !MAC_PATTERN.test(proofMac)) return false;
  if (now.getTime() >= Number(expiresRaw)) return false;
  return macEquals(proofMac, mac(secret, `${PROOF_CONTEXT}:${id}:${expiresRaw}`));
}
