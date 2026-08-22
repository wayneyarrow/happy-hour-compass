import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInternalErrorMessage,
  HHC_SUPPORT_EMAIL,
} from "../../../src/lib/observability/customerMessage";

test("HHC_SUPPORT_EMAIL is exactly support@happyhourcompass.com", () => {
  assert.equal(HHC_SUPPORT_EMAIL, "support@happyhourcompass.com");
});

test("buildInternalErrorMessage contains the support email exactly", () => {
  const msg = buildInternalErrorMessage("HHC-7X42M");
  assert.ok(msg.includes("support@happyhourcompass.com"));
});

test("buildInternalErrorMessage contains the exact supplied reference id", () => {
  const msg = buildInternalErrorMessage("HHC-7X42M");
  assert.ok(msg.includes("HHC-7X42M"));

  const other = buildInternalErrorMessage("HHC-QK93M");
  assert.ok(other.includes("HHC-QK93M"));
  assert.ok(!other.includes("HHC-7X42M"));
});

test("buildInternalErrorMessage matches the exact requested template", () => {
  const msg = buildInternalErrorMessage("HHC-7X42M");
  assert.equal(
    msg,
    "Something went wrong. Please try again. If the problem continues, contact us at support@happyhourcompass.com and mention error HHC-7X42M."
  );
});

test("buildInternalErrorMessage never exposes technical details", () => {
  const msg = buildInternalErrorMessage("HHC-7X42M");
  const forbidden = [
    "23503",
    "constraint",
    "postgres",
    "supabase",
    "stack trace",
    "undefined",
    "null",
    "Error:",
  ];
  for (const term of forbidden) {
    assert.ok(
      !msg.toLowerCase().includes(term.toLowerCase()),
      `message must not contain technical term "${term}": ${msg}`
    );
  }
});

test("buildInternalErrorMessage does not use hello@happyhourcompass.com (the internal/founder address)", () => {
  const msg = buildInternalErrorMessage("HHC-7X42M");
  assert.ok(!msg.includes("hello@happyhourcompass.com"));
});
