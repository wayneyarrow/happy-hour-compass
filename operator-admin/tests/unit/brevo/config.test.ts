import { test } from "node:test";
import assert from "node:assert/strict";
import { getBrevoConfig, getBrevoWebhookToken, normalizeEmail, BrevoConfigError } from "../../../src/lib/brevo/config";
import { withBrevoEnv } from "./support/testEnv";

test("getBrevoConfig throws BrevoConfigError when BREVO_API_KEY is missing", () => {
  const restore = withBrevoEnv({ BREVO_CONSUMER_LIST_ID: "3" });
  try {
    assert.throws(() => getBrevoConfig(), BrevoConfigError);
  } finally {
    restore();
  }
});

test("getBrevoConfig throws BrevoConfigError when BREVO_CONSUMER_LIST_ID is missing", () => {
  const restore = withBrevoEnv({ BREVO_API_KEY: "fake-key-123" });
  try {
    assert.throws(() => getBrevoConfig(), BrevoConfigError);
  } finally {
    restore();
  }
});

test("getBrevoConfig throws BrevoConfigError when BREVO_CONSUMER_LIST_ID is not a positive integer", () => {
  const restore = withBrevoEnv({ BREVO_API_KEY: "fake-key-123", BREVO_CONSUMER_LIST_ID: "not-a-number" });
  try {
    assert.throws(() => getBrevoConfig(), BrevoConfigError);
  } finally {
    restore();
  }
});

test("getBrevoConfig error message never contains the actual key value", () => {
  const restore = withBrevoEnv({});
  try {
    try {
      getBrevoConfig();
      assert.fail("expected getBrevoConfig to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(!message.includes("fake-key-123"));
    }
  } finally {
    restore();
  }
});

test("getBrevoConfig returns a valid config with normalized testEmail when BREVO_TEST_EMAIL is set", () => {
  const restore = withBrevoEnv({
    BREVO_API_KEY: "fake-key-123",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "  Wayne.Yarrow@Example.com  ",
  });
  try {
    const config = getBrevoConfig();
    assert.equal(config.apiKey, "fake-key-123");
    assert.equal(config.consumerListId, 3);
    assert.equal(config.testEmail, "wayne.yarrow@example.com");
  } finally {
    restore();
  }
});

test("getBrevoConfig returns testEmail: null when BREVO_TEST_EMAIL is unset (production shape)", () => {
  const restore = withBrevoEnv({ BREVO_API_KEY: "fake-key-123", BREVO_CONSUMER_LIST_ID: "2" });
  try {
    const config = getBrevoConfig();
    assert.equal(config.consumerListId, 2);
    assert.equal(config.testEmail, null);
  } finally {
    restore();
  }
});

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Wayne.Yarrow@GMAIL.com  "), "wayne.yarrow@gmail.com");
});

test("getBrevoWebhookToken throws BrevoConfigError when unset", () => {
  const restore = withBrevoEnv({});
  try {
    assert.throws(() => getBrevoWebhookToken(), BrevoConfigError);
  } finally {
    restore();
  }
});

test("getBrevoWebhookToken returns the configured token", () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "fake-webhook-token" });
  try {
    assert.equal(getBrevoWebhookToken(), "fake-webhook-token");
  } finally {
    restore();
  }
});
