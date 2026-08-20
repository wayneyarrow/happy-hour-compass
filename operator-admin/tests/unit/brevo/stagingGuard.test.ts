import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAllowedToSyncEmail, BrevoStagingGuardBlockedError } from "../../../src/lib/brevo/stagingGuard";

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
