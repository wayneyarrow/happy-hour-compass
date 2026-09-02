import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTokenHashRecoveryLink } from "../../../src/lib/supabase/recoveryLink";

/**
 * Pins the shape of the recovery link both forgotPasswordAction (operator)
 * and requestConsumerPasswordReset (consumer) now send — the hardening from
 * the Casa de Frida operator-login investigation (see recoveryLink.ts's
 * header comment). The generateLink()/email-send flow itself isn't
 * unit-tested (real Supabase admin client + Resend calls, no DI seam, same
 * convention as every other flow-specific contract test in this repo) — this
 * is the one pure piece: given a hashed_token, does the link we actually
 * send avoid the raw action_link shape entirely.
 */

const REDIRECT_TO_OPERATOR = "https://happyhourcompass.com/operator/create-password";
const REDIRECT_TO_CONSUMER = "https://happyhourcompass.com/account/reset-password";
const HASHED_TOKEN = "036370d111f0eda0056959aad978c4118822fb2383467124c6a503bc";

test("builds a token_hash query-param link, not a raw action_link/verify URL", () => {
  const link = buildTokenHashRecoveryLink(REDIRECT_TO_OPERATOR, HASHED_TOKEN);
  assert.ok(!link.includes("/auth/v1/verify"), "must not be the raw action_link shape");
  assert.ok(!link.includes("token="), "must not carry the raw one-time `token` param action_link uses");
});

test("embeds the exact redirectTo origin+path unchanged (no silent host/path substitution)", () => {
  const link = buildTokenHashRecoveryLink(REDIRECT_TO_OPERATOR, HASHED_TOKEN);
  assert.ok(link.startsWith(REDIRECT_TO_OPERATOR + "?"), "redirectTo must be the link's base, verbatim");
});

test("carries token_hash and type=recovery as query params", () => {
  const link = buildTokenHashRecoveryLink(REDIRECT_TO_OPERATOR, HASHED_TOKEN);
  const url = new URL(link);
  assert.equal(url.searchParams.get("token_hash"), HASHED_TOKEN);
  assert.equal(url.searchParams.get("type"), "recovery");
});

test("operator and consumer recovery links share the same shape, differing only in redirectTo", () => {
  const operatorLink = buildTokenHashRecoveryLink(REDIRECT_TO_OPERATOR, HASHED_TOKEN);
  const consumerLink = buildTokenHashRecoveryLink(REDIRECT_TO_CONSUMER, HASHED_TOKEN);

  const operatorUrl = new URL(operatorLink);
  const consumerUrl = new URL(consumerLink);

  assert.equal(operatorUrl.pathname, "/operator/create-password");
  assert.equal(consumerUrl.pathname, "/account/reset-password");
  assert.equal(operatorUrl.searchParams.get("token_hash"), consumerUrl.searchParams.get("token_hash"));
  assert.equal(operatorUrl.searchParams.get("type"), consumerUrl.searchParams.get("type"));
});

test("does not leak the hashed token anywhere but the token_hash param (no fragment, no duplicate)", () => {
  const link = buildTokenHashRecoveryLink(REDIRECT_TO_OPERATOR, HASHED_TOKEN);
  const occurrences = link.split(HASHED_TOKEN).length - 1;
  assert.equal(occurrences, 1);
  assert.ok(!link.includes("#"), "must be a query param, not a hash fragment");
});
