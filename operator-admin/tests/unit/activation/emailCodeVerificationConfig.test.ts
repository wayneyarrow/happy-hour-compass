import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOperatorEmailCodeVerificationEnabled,
  getOperatorVerificationCodeHmacSecret,
  OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH,
} from "../../../src/lib/activation/emailCodeVerificationConfig";

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

const FLAG = "OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED";
const SECRET = "OPERATOR_VERIFICATION_CODE_HMAC_SECRET";

// ── Feature flag ─────────────────────────────────────────────────────────────

test("isOperatorEmailCodeVerificationEnabled: missing env var means disabled", () => {
  withEnv(FLAG, undefined, () => assert.equal(isOperatorEmailCodeVerificationEnabled(), false));
});

test("isOperatorEmailCodeVerificationEnabled: empty and whitespace-only mean disabled", () => {
  for (const value of ["", "   "]) {
    withEnv(FLAG, value, () => assert.equal(isOperatorEmailCodeVerificationEnabled(), false, JSON.stringify(value)));
  }
});

test("isOperatorEmailCodeVerificationEnabled: exact 'true' means enabled", () => {
  withEnv(FLAG, "true", () => assert.equal(isOperatorEmailCodeVerificationEnabled(), true));
});

test("isOperatorEmailCodeVerificationEnabled: case and surrounding whitespace are normalized", () => {
  for (const value of ["TRUE", "True", " true ", "\ttrue\n"]) {
    withEnv(FLAG, value, () => assert.equal(isOperatorEmailCodeVerificationEnabled(), true, JSON.stringify(value)));
  }
});

test("isOperatorEmailCodeVerificationEnabled: any other value means disabled", () => {
  for (const value of ["false", "1", "yes", "on", "enabled", "truee", "t rue", "'true'"]) {
    withEnv(FLAG, value, () => assert.equal(isOperatorEmailCodeVerificationEnabled(), false, JSON.stringify(value)));
  }
});

// ── HMAC secret boundary ─────────────────────────────────────────────────────

test("getOperatorVerificationCodeHmacSecret: missing, empty, or short secret fails closed (null)", () => {
  const short = "x".repeat(OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH - 1);
  for (const value of [undefined, "", "   ", short]) {
    withEnv(SECRET, value, () => assert.equal(getOperatorVerificationCodeHmacSecret(), null));
  }
});

test("getOperatorVerificationCodeHmacSecret: a sufficiently long secret is returned as-is", () => {
  const fixture = "test-only-fixture-secret-".padEnd(OPERATOR_VERIFICATION_CODE_HMAC_SECRET_MIN_LENGTH, "z");
  withEnv(SECRET, fixture, () => assert.equal(getOperatorVerificationCodeHmacSecret(), fixture));
});
