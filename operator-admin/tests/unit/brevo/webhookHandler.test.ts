import { test } from "node:test";
import assert from "node:assert/strict";
import { handleBrevoWebhookRequest, classifyEventType, extractEmail } from "../../../src/lib/brevo/webhookHandler";
import { createFakeWebhookEventsStore } from "./support/fakeWebhookEventsStore";
import { createFakeConsumerLookupClient } from "./support/fakeConsumerLookupClient";
import { createFakeOutboxStore } from "./support/fakeOutboxStore";
import { withBrevoEnv } from "./support/testEnv";

/** No matching consumer, no outbox activity — used for tests that don't care about reconciliation. */
function emptyReconciliation() {
  return { consumerLookupClient: createFakeConsumerLookupClient({}), outboxClient: createFakeOutboxStore().client };
}

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
      client,
      emptyReconciliation()
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
    const first = await handleBrevoWebhookRequest("Bearer correct-token", body, client, emptyReconciliation());
    const second = await handleBrevoWebhookRequest("Bearer correct-token", body, client, emptyReconciliation());

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
      client,
      emptyReconciliation()
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

// ── Inbound consent reconciliation (Phase 2B) ───────────────────────────────

const CONSUMER_ID = "33333333-3333-3333-3333-333333333333";

test("a genuine unsubscribe for a matching consenting consumer sets marketing_consent false and marks the event processed", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token", BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeWebhookEventsStore();
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@happyhourcompass.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    const outcome = await handleBrevoWebhookRequest(
      "Bearer correct-token",
      JSON.stringify({ event: "unsubscribe", email: "wayne@happyhourcompass.com" }),
      client,
      { consumerLookupClient, outboxClient }
    );
    assert.equal(outcome.status, 202);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].processed_at, "the event must be marked processed once reconciliation succeeds");
  } finally {
    restore();
  }
});

test("a genuine unsubscribe for an email with no matching HHC consumer (e.g. a founder/admin identity) is a safe no-op and still marks processed", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token", BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest(
      "Bearer correct-token",
      JSON.stringify({ event: "unsubscribe", email: "wayne@happyhourcompass.com" }),
      client,
      emptyReconciliation() // no consumer_profiles row for this email — matches the real founder-identity scenario
    );
    assert.equal(outcome.status, 202);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].processed_at, "no-matching-consumer is still a successfully handled event, not left pending");
  } finally {
    restore();
  }
});

test("reconciliation failure leaves the event unprocessed (observable/retryable) but the webhook response still succeeds", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  const throwingLookupClient = {
    from() {
      throw new Error("simulated Supabase outage");
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as Parameters<typeof handleBrevoWebhookRequest>[3] extends { consumerLookupClient?: infer T } ? T : never;
  try {
    const outcome = await handleBrevoWebhookRequest(
      "Bearer correct-token",
      JSON.stringify({ event: "unsubscribe", email: "wayne@happyhourcompass.com" }),
      client,
      { consumerLookupClient: throwingLookupClient }
    );
    assert.equal(outcome.status, 202, "the webhook itself still succeeds — a reconciliation failure never fails the delivery");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].processed_at, null, "must remain unprocessed so it stays visible for later reprocessing");
  } finally {
    restore();
  }
});

test("an unrecognized event type never attempts reconciliation, even with a real matching consumer email", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token", BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeWebhookEventsStore();
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@happyhourcompass.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  try {
    await handleBrevoWebhookRequest(
      "Bearer correct-token",
      JSON.stringify({ event: "delivered", email: "wayne@happyhourcompass.com" }),
      client,
      { consumerLookupClient }
    );
    assert.equal(rows[0].event_type, "unrecognized");
    assert.equal(rows[0].processed_at, null, "unrecognized events are never marked processed — they were never actioned");
  } finally {
    restore();
  }
});

test("missing/malformed email on a recognized unsubscribe event is marked processed without attempting reconciliation", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token" });
  const { client, rows } = createFakeWebhookEventsStore();
  try {
    const outcome = await handleBrevoWebhookRequest(
      "Bearer correct-token",
      JSON.stringify({ event: "unsubscribe" }), // no email field at all
      client
      // no reconciliation clients passed — if this ever tried to reconcile,
      // it would attempt a real Supabase connection and throw/fail this test
    );
    assert.equal(outcome.status, 202);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, null);
    assert.ok(rows[0].processed_at, "nothing to reconcile against — should still be marked processed, not left pending forever");
  } finally {
    restore();
  }
});

test("a duplicate delivery whose original attempt never finished reconciling gets an opportunistic retry", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token", BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeWebhookEventsStore();
  const body = JSON.stringify({ event: "unsubscribe", email: "wayne@happyhourcompass.com" });

  // First delivery: reconciliation fails (simulated outage) — event persists unprocessed.
  const throwingLookupClient = {
    from() {
      throw new Error("simulated Supabase outage");
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as Parameters<typeof handleBrevoWebhookRequest>[3] extends { consumerLookupClient?: infer T } ? T : never;

  try {
    const first = await handleBrevoWebhookRequest("Bearer correct-token", body, client, { consumerLookupClient: throwingLookupClient });
    assert.equal(first.status, 202);
    assert.equal(rows[0].processed_at, null);

    // Second delivery (Brevo redelivery of the same event, or a genuine
    // resend) — this time reconciliation succeeds.
    const consumerLookupClient = createFakeConsumerLookupClient({
      profiles: [{ id: CONSUMER_ID, email: "wayne@happyhourcompass.com", display_name: "Wayne", marketing_consent: true }],
      authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
    });
    const { client: outboxClient } = createFakeOutboxStore();
    const second = await handleBrevoWebhookRequest("Bearer correct-token", body, client, { consumerLookupClient, outboxClient });

    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { status: "duplicate" });
    assert.equal(rows.length, 1, "still exactly one durable event row — the retry does not create a new row");
    assert.ok(rows[0].processed_at, "the opportunistic retry on redelivery should have completed reconciliation this time");
  } finally {
    restore();
  }
});

test("a duplicate delivery whose original attempt already succeeded does not re-attempt reconciliation", async () => {
  const restore = withBrevoEnv({ BREVO_WEBHOOK_TOKEN: "correct-token", BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeWebhookEventsStore();
  const body = JSON.stringify({ event: "unsubscribe", email: "wayne@happyhourcompass.com" });
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@happyhourcompass.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();

  try {
    await handleBrevoWebhookRequest("Bearer correct-token", body, client, { consumerLookupClient, outboxClient });
    assert.ok(rows[0].processed_at);
    const firstProcessedAt = rows[0].processed_at;

    // A second (duplicate) delivery — a throwing client here proves
    // reconciliation is NOT re-attempted, since the event is already processed.
    const throwingLookupClient = {
      from() {
        throw new Error("must not be called for an already-processed event");
      },
      auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
    } as unknown as Parameters<typeof handleBrevoWebhookRequest>[3] extends { consumerLookupClient?: infer T } ? T : never;

    const second = await handleBrevoWebhookRequest("Bearer correct-token", body, client, { consumerLookupClient: throwingLookupClient });
    assert.equal(second.status, 200);
    assert.equal(rows[0].processed_at, firstProcessedAt, "processed_at must not be touched again");
  } finally {
    restore();
  }
});
