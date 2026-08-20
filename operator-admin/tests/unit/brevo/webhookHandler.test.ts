import { test } from "node:test";
import assert from "node:assert/strict";
import { handleBrevoWebhookRequest, classifyEventType, extractEmail } from "../../../src/lib/brevo/webhookHandler";
import { createFakeWebhookEventsStore } from "./support/fakeWebhookEventsStore";
import { withBrevoEnv } from "./support/testEnv";

test("missing Authorization header is rejected with 401 and nothing is persisted", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest(null, JSON.stringify({ event: "unsubscribed", email: "wayne@example.com" }), client);
    assert.equal(outcome.status, 401);
    assert.equal(rows.length, 0);
  } finally {
    restore();
  }
});

test("invalid token is rejected with 401", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest("Bearer wrong-token", "{}", client);
    assert.equal(outcome.status, 401);
    assert.equal(rows.length, 0);
  } finally {
    restore();
  }
});

test("missing BREVO_WEBHOOK_TOKEN configuration returns 500, not a silent pass-through", async () => {
  const restore = withBrevoEnv({});
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest("Bearer anything", "{}", client);
    assert.equal(outcome.status, 500);
    assert.equal(rows.length, 0);
  } finally {
    restore();
  }
});

test("malformed JSON body is handled safely with 400, not a thrown exception", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest("Bearer correct-token", "{not valid json", client);
    assert.equal(outcome.status, 400);
    assert.equal(rows.length, 0);
  } finally {
    restore();
  }
});

test("a JSON array body (not an object) is rejected as malformed", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest("Bearer correct-token", "[1,2,3]", client);
    assert.equal(outcome.status, 400);
    assert.equal(rows.length, 0);
  } finally {
    restore();
  }
});

test("a recognized unsubscribe event is authenticated, recorded, and returns 202", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest(
      "Bearer correct-token",
      JSON.stringify({ event: "unsubscribed", email: "Wayne@Example.com", date: "2026-08-20" }),
      client
    );
    assert.equal(outcome.status, 202);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, "unsubscribe");
    assert.equal(rows[0].email, "wayne@example.com");
  } finally {
    restore();
  }
});

test("an unrelated event type is recorded as unrecognized but does not error, and no consumer behavior is triggered", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest(
      "Bearer correct-token",
      JSON.stringify({ event: "delivered", email: "wayne@example.com" }),
      client
    );
    assert.equal(outcome.status, 202);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, "unrecognized");
  } finally {
    restore();
  }
});

test("a duplicate delivery of the same event is safely idempotent (200, not a second row)", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  const body = JSON.stringify({ event: "unsubscribed", email: "wayne@example.com", date: "2026-08-20" });
  try {
    const first = await handleBrevoWebhookRequest("Bearer correct-token", body, client);
    const second = await handleBrevoWebhookRequest("Bearer correct-token", body, client);

    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { status: "duplicate" });
    assert.equal(rows.length, 1, "duplicate delivery must not create a second row");
  } finally {
    restore();
  }
});

test("no response ever leaks the configured webhook token", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "super-secret-webhook-token" });
  const { client } = createFakeWebhookEventsStore();
  try {
    const unauthorized = await handleBrevoWebhookRequest("Bearer wrong", "{}", client);
    const malformed = await handleBrevoWebhookRequest("Bearer super-secret-webhook-token", "not json", client);
    const accepted = await handleBrevoWebhookRequest(
      "Bearer super-secret-webhook-token",
      JSON.stringify({ event: "unsubscribed", email: "wayne@example.com" }),
      client
    );

    for (const outcome of [unauthorized, malformed, accepted]) {
      assert.ok(!JSON.stringify(outcome.body).includes("super-secret-webhook-token"));
    }
  } finally {
    restore();
  }
});

test("classifyEventType recognizes unsubscribe/unsubscribed across likely field names", () => {
  assert.equal(classifyEventType({ event: "unsubscribed" }), "unsubscribe");
  assert.equal(classifyEventType({ event: "unsubscribe" }), "unsubscribe");
  assert.equal(classifyEventType({ msg_status: "unsubscribed" }), "unsubscribe");
  assert.equal(classifyEventType({ event: "delivered" }), "unrecognized");
  assert.equal(classifyEventType({}), "unrecognized");
});

test("extractEmail reads email or 'to', and ignores non-email-looking values", () => {
  assert.equal(extractEmail({ email: "wayne@example.com" }), "wayne@example.com");
  assert.equal(extractEmail({ to: "wayne@example.com" }), "wayne@example.com");
  assert.equal(extractEmail({ email: "not-an-email" }), null);
  assert.equal(extractEmail({}), null);
});
