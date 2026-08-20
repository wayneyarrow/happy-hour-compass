import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyHttpStatus,
  classifyThrown,
  isRetryable,
  BrevoApiError,
} from "../../../src/lib/brevo/errors";
import { BrevoConfigError } from "../../../src/lib/brevo/config";
import { BrevoStagingGuardBlockedError } from "../../../src/lib/brevo/stagingGuard";

test("classifyHttpStatus: 401 and 403 -> auth", () => {
  assert.equal(classifyHttpStatus(401), "auth");
  assert.equal(classifyHttpStatus(403), "auth");
});

test("classifyHttpStatus: 429 and 5xx -> transient", () => {
  assert.equal(classifyHttpStatus(429), "transient");
  assert.equal(classifyHttpStatus(500), "transient");
  assert.equal(classifyHttpStatus(503), "transient");
});

test("classifyHttpStatus: other 4xx -> invalid_request", () => {
  assert.equal(classifyHttpStatus(400), "invalid_request");
  assert.equal(classifyHttpStatus(404), "invalid_request");
  assert.equal(classifyHttpStatus(422), "invalid_request");
});

test("isRetryable: transient and unknown are retryable", () => {
  assert.equal(isRetryable("transient"), true);
  assert.equal(isRetryable("unknown"), true);
});

test("isRetryable: auth, invalid_request, config, blocked are not retryable", () => {
  assert.equal(isRetryable("auth"), false);
  assert.equal(isRetryable("invalid_request"), false);
  assert.equal(isRetryable("config"), false);
  assert.equal(isRetryable("blocked"), false);
});

test("classifyThrown dispatches BrevoApiError to its own errorClass", () => {
  const err = new BrevoApiError("boom", "transient", 500, "internal_error");
  const result = classifyThrown(err);
  assert.equal(result.errorClass, "transient");
  assert.equal(result.message, "boom");
});

test("classifyThrown dispatches BrevoStagingGuardBlockedError to 'blocked'", () => {
  const err = new BrevoStagingGuardBlockedError("someone@example.com");
  const result = classifyThrown(err);
  assert.equal(result.errorClass, "blocked");
});

test("classifyThrown dispatches BrevoConfigError to 'config'", () => {
  const err = new BrevoConfigError("BREVO_API_KEY is not set.");
  const result = classifyThrown(err);
  assert.equal(result.errorClass, "config");
});

test("classifyThrown treats a generic Error as 'unknown'", () => {
  const result = classifyThrown(new Error("something else broke"));
  assert.equal(result.errorClass, "unknown");
  assert.equal(result.message, "something else broke");
});

test("classifyThrown handles a non-Error thrown value safely", () => {
  const result = classifyThrown("a raw string throw");
  assert.equal(result.errorClass, "unknown");
  assert.equal(result.message, "a raw string throw");
});
