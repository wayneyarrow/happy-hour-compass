import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertAllowedToSyncEmail,
  BrevoStagingGuardBlockedError,
  isProductionEnvironment,
  isEnqueueAllowedInThisEnvironment,
} from "../../../src/lib/brevo/stagingGuard";
import { withBrevoEnv } from "./support/testEnv";

test("does not throw when testEmail is null (production — no allowlist)", () => {
  assert.doesNotThrow(() => assertAllowedToSyncEmail("anyone@example.com", null));
});

test("does not throw when the email matches the configured test email", () => {
  assert.doesNotThrow(() => assertAllowedToSyncEmail("wayne@example.com", "wayne@example.com"));
});

test("throws BrevoStagingGuardBlockedError when the email does not match", () => {
  assert.throws(
    () => assertAllowedToSyncEmail("someone-else@example.com", "wayne@example.com"),
    BrevoStagingGuardBlockedError
  );
});

test("comparison is case-insensitive and whitespace-normalized on the checked email", () => {
  assert.doesNotThrow(() => assertAllowedToSyncEmail("  Wayne@EXAMPLE.com  ", "wayne@example.com"));
});

test("a near-miss email is still blocked (not a substring/prefix match)", () => {
  assert.throws(
    () => assertAllowedToSyncEmail("wayne+other@example.com", "wayne@example.com"),
    BrevoStagingGuardBlockedError
  );
});

test("the blocked error message does not include the full raw email unmasked", () => {
  try {
    assertAllowedToSyncEmail("someone-else@example.com", "wayne@example.com");
    assert.fail("expected assertAllowedToSyncEmail to throw");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(!message.includes("someone-else@example.com"));
  }
});

// ── isProductionEnvironment / isEnqueueAllowedInThisEnvironment ────────────
// (Phase 2A safety correction — the enqueue-time, shared-outbox guard)

test("isProductionEnvironment is true only for VERCEL_ENV=production", () => {
  const restore = withBrevoEnv({ VERCEL_ENV: "production" });
  try {
    assert.equal(isProductionEnvironment(), true);
  } finally {
    restore();
  }
});

test("isProductionEnvironment is false for preview, development, and unset", () => {
  for (const value of ["preview", "development", undefined]) {
    const restore = withBrevoEnv({ VERCEL_ENV: value });
    try {
      assert.equal(isProductionEnvironment(), false, `expected false for VERCEL_ENV=${value}`);
    } finally {
      restore();
    }
  }
});

test("isEnqueueAllowedInThisEnvironment: production always allows, regardless of testEmail", () => {
  const restore = withBrevoEnv({ VERCEL_ENV: "production" });
  try {
    assert.equal(isEnqueueAllowedInThisEnvironment("anyone@example.com", null), true);
    assert.equal(isEnqueueAllowedInThisEnvironment("anyone@example.com", "wayne@example.com"), true);
  } finally {
    restore();
  }
});

test("isEnqueueAllowedInThisEnvironment: preview + matching test email allows", () => {
  const restore = withBrevoEnv({ VERCEL_ENV: "preview" });
  try {
    assert.equal(isEnqueueAllowedInThisEnvironment("wayne@example.com", "wayne@example.com"), true);
  } finally {
    restore();
  }
});

test("isEnqueueAllowedInThisEnvironment: preview + non-matching email blocks", () => {
  const restore = withBrevoEnv({ VERCEL_ENV: "preview" });
  try {
    assert.equal(isEnqueueAllowedInThisEnvironment("someone-else@example.com", "wayne@example.com"), false);
  } finally {
    restore();
  }
});

test("isEnqueueAllowedInThisEnvironment: preview + unset testEmail fails CLOSED (blocks), unlike assertAllowedToSyncEmail's null handling", () => {
  const restore = withBrevoEnv({ VERCEL_ENV: "preview" });
  try {
    assert.equal(isEnqueueAllowedInThisEnvironment("anyone@example.com", null), false);
  } finally {
    restore();
  }
});

test("isEnqueueAllowedInThisEnvironment: undefined VERCEL_ENV (e.g. local dev) is treated as non-production", () => {
  const restore = withBrevoEnv({ VERCEL_ENV: undefined });
  try {
    assert.equal(isEnqueueAllowedInThisEnvironment("anyone@example.com", null), false);
    assert.equal(isEnqueueAllowedInThisEnvironment("wayne@example.com", "wayne@example.com"), true);
  } finally {
    restore();
  }
});
