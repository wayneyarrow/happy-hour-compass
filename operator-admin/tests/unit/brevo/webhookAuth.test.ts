import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyBrevoWebhookRequest } from "../../../src/lib/brevo/webhookAuth";
import { withBrevoEnv } from "./support/testEnv";

test("returns missing_config when BREVO_WEBHOOK_TOKEN is not set", () => {
  const restore = withBrevoEnv({});
  try {
    const result = verifyBrevoWebhookRequest("Bearer anything");
    assert.deepEqual(result, { ok: false, reason: "missing_config" });
  } finally {
    restore();
  }
});

test("returns missing_token when no Authorization header is present", () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  try {
    const result = verifyBrevoWebhookRequest(null);
    assert.deepEqual(result, { ok: false, reason: "missing_token" });
  } finally {
    restore();
  }
});

test("returns invalid_token for a wrong Bearer token", () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  try {
    const result = verifyBrevoWebhookRequest("Bearer wrong-token");
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  } finally {
    restore();
  }
});

test("accepts the correct token in standard 'Bearer <token>' form", () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  try {
    const result = verifyBrevoWebhookRequest("Bearer correct-token");
    assert.deepEqual(result, { ok: true });
  } finally {
    restore();
  }
});

test("defensively also accepts the raw token with no 'Bearer ' prefix", () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  try {
    const result = verifyBrevoWebhookRequest("correct-token");
    assert.deepEqual(result, { ok: true });
  } finally {
    restore();
  }
});

test("a token of different length is rejected without throwing", () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  try {
    const result = verifyBrevoWebhookRequest("Bearer short");
    assert.deepEqual(result, { ok: false, reason: "invalid_token" });
  } finally {
    restore();
  }
});

test("an empty Authorization header is rejected without throwing", () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  try {
    const result = verifyBrevoWebhookRequest("");
    assert.equal(result.ok, false);
  } finally {
    restore();
  }
});
