import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isVerifiedBrowserProofValid,
  readVerificationLinkToken,
  signVerificationLinkToken,
  signVerifiedBrowserProof,
  VERIFIED_BROWSER_PROOF_LIFETIME_MS,
} from "../../../src/lib/activation/emailCodeVerificationTokens";
import { maskEmail } from "../../../src/lib/activation/emailCodeVerificationPolicy";

const SECRET = "test-hmac-secret-that-is-at-least-32-characters-long";
const OTHER = "another-hmac-secret-that-is-also-32-characters-long";
const ID = "11111111-1111-4111-8111-111111111111";
const T0 = new Date("2026-09-25T18:00:00.000Z");

test("link token: round-trips to the lifecycle id and never contains the secret", () => {
  const token = signVerificationLinkToken(ID, SECRET)!;
  assert.equal(readVerificationLinkToken(token, SECRET), ID);
  assert.ok(!token.includes(SECRET));
  assert.match(token, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/, "URL-safe");
});

test("link token: forged, tampered, cross-lifecycle, or other-secret tokens are rejected", () => {
  const token = signVerificationLinkToken(ID, SECRET)!;
  const [id, mac] = token.split(".");
  const otherId = "22222222-2222-4222-8222-222222222222";
  for (const bad of [
    "",
    id,
    `${otherId}.${mac}`,
    `${id}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`,
    `${token}.extra`,
    signVerificationLinkToken(ID, OTHER)!,
  ]) {
    assert.equal(readVerificationLinkToken(bad, SECRET), null, bad);
  }
  assert.equal(readVerificationLinkToken(12345, SECRET), null);

  // Ids are canonicalized to lowercase when signed; an upper-cased copy is not the signed token.
  const lettered = "abcdef12-1111-4111-8111-111111111111";
  const [lid, lmac] = signVerificationLinkToken(lettered, SECRET)!.split(".");
  assert.equal(readVerificationLinkToken(`${lid}.${lmac}`, SECRET), lettered);
  assert.equal(readVerificationLinkToken(`${lid.toUpperCase()}.${lmac}`, SECRET), null);
});

test("link token: fails closed with a missing or weak secret", () => {
  assert.equal(signVerificationLinkToken(ID, null), null);
  assert.equal(signVerificationLinkToken(ID, "short"), null);
  assert.equal(signVerificationLinkToken("not-a-uuid", SECRET), null);
  assert.equal(readVerificationLinkToken(signVerificationLinkToken(ID, SECRET), null), null);
});

test("link token and verified-browser proof are domain-separated (neither validates as the other)", () => {
  const token = signVerificationLinkToken(ID, SECRET)!;
  const proof = signVerifiedBrowserProof(ID, SECRET, T0)!;
  assert.equal(readVerificationLinkToken(proof, SECRET), null);
  assert.equal(isVerifiedBrowserProofValid(token, ID, SECRET, T0), false);
});

test("verified-browser proof: valid only for its lifecycle, its secret, and until it expires", () => {
  const proof = signVerifiedBrowserProof(ID, SECRET, T0)!;
  assert.equal(isVerifiedBrowserProofValid(proof, ID, SECRET, T0), true);
  assert.equal(isVerifiedBrowserProofValid(proof, "22222222-2222-4222-8222-222222222222", SECRET, T0), false);
  assert.equal(isVerifiedBrowserProofValid(proof, ID, OTHER, T0), false);
  const justBefore = new Date(T0.getTime() + VERIFIED_BROWSER_PROOF_LIFETIME_MS - 1);
  const atExpiry = new Date(T0.getTime() + VERIFIED_BROWSER_PROOF_LIFETIME_MS);
  assert.equal(isVerifiedBrowserProofValid(proof, ID, SECRET, justBefore), true);
  assert.equal(isVerifiedBrowserProofValid(proof, ID, SECRET, atExpiry), false);
  const [id, , mac] = proof.split(".");
  const extended = `${id}.${T0.getTime() + 10 * VERIFIED_BROWSER_PROOF_LIFETIME_MS}.${mac}`;
  assert.equal(isVerifiedBrowserProofValid(extended, ID, SECRET, atExpiry), false, "expiry can't be edited");
  assert.equal(isVerifiedBrowserProofValid(null, ID, SECRET, T0), false);
});

test("maskEmail: shows first character and full domain only", () => {
  assert.equal(maskEmail("owner@venue.example"), "o****@venue.example");
  assert.equal(maskEmail("a@b.co"), "a***@b.co");
  assert.equal(maskEmail("averyveryverylongname@x.io"), "a********@x.io");
  assert.equal(maskEmail("no-at-sign"), "your email address");
  assert.equal(maskEmail("@nolocal.com"), "your email address");
});
