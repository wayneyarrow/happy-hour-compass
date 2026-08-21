import { test } from "node:test";
import assert from "node:assert/strict";
import { processUnprocessedWebhookEvents } from "../../../src/lib/brevo/webhookEventsProcessor";
import { createFakeWebhookEventsStore, type FakeWebhookEventRow } from "./support/fakeWebhookEventsStore";
import { createFakeConsumerLookupClient } from "./support/fakeConsumerLookupClient";
import { createFakeOutboxStore } from "./support/fakeOutboxStore";
import { withBrevoEnv } from "./support/testEnv";
import type { ConsumerLookupClient } from "../../../src/lib/brevo/consumerEligibility";

const CONSUMER_ID = "55555555-5555-5555-5555-555555555555";

function seedEvent(rows: FakeWebhookEventRow[], overrides: Partial<FakeWebhookEventRow> = {}): FakeWebhookEventRow {
  const nowIso = new Date().toISOString();
  const row: FakeWebhookEventRow = {
    id: overrides.id ?? `seed-event-${rows.length + 1}`,
    provider: "brevo",
    event_type: "unsubscribe",
    dedupe_key: overrides.dedupe_key ?? `dedupe-${rows.length + 1}`,
    email: "wayne@example.com",
    raw_payload: { event: "unsubscribe" },
    received_at: nowIso,
    processed_at: null,
    ...overrides,
  };
  rows.push(row);
  return row;
}

test("a persisted unprocessed unsubscribe event is found and reconciled by the scheduled processor", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  seedEvent(rows);
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    const result = await processUnprocessedWebhookEvents(25, webhookEventsClient, consumerLookupClient, outboxClient);
    assert.equal(result.claimed, 1);
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 0);
    assert.ok(rows[0].processed_at, "successful retry sets processed_at");
  } finally {
    restoreEnv();
  }
});

test("a retry with no matching HHC consumer is a safe no-op and still marks processed_at", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  seedEvent(rows, { email: "wayne@happyhourcompass.com" });
  const consumerLookupClient = createFakeConsumerLookupClient({ profiles: [], authUsers: [] });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    const result = await processUnprocessedWebhookEvents(25, webhookEventsClient, consumerLookupClient, outboxClient);
    assert.equal(result.processed, 1);
    assert.ok(rows[0].processed_at);
  } finally {
    restoreEnv();
  }
});

test("an already-processed event is never reprocessed on a later run", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  seedEvent(rows, { processed_at: new Date().toISOString() });
  const throwingLookupClient = {
    from() {
      throw new Error("must not be called for an already-processed event");
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as ConsumerLookupClient;
  try {
    const result = await processUnprocessedWebhookEvents(25, webhookEventsClient, throwingLookupClient);
    assert.equal(result.claimed, 0, "an already-processed row must never be selected at all");
  } finally {
    restoreEnv();
  }
});

test("a failed retry leaves the event unprocessed for a future attempt", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  seedEvent(rows);
  const throwingLookupClient = {
    from() {
      throw new Error("simulated Supabase outage");
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as ConsumerLookupClient;
  try {
    const result = await processUnprocessedWebhookEvents(25, webhookEventsClient, throwingLookupClient);
    assert.equal(result.failed, 1);
    assert.equal(result.processed, 0);
    assert.equal(rows[0].processed_at, null, "must remain unprocessed for a future scheduled attempt");
  } finally {
    restoreEnv();
  }
});

test("one failing event does not prevent other rows in the same batch from being processed", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  seedEvent(rows, { id: "bad-event", email: "bad@example.com", dedupe_key: "dedupe-bad" });
  seedEvent(rows, { id: "good-event", email: "wayne@example.com", dedupe_key: "dedupe-good" });

  const consumerLookupClient = {
    from(table: string) {
      if (table !== "consumer_profiles") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            ilike(_column: string, pattern: string) {
              return {
                async maybeSingle() {
                  if (pattern === "bad@example.com") throw new Error("simulated failure for this one contact");
                  return {
                    data: { id: CONSUMER_ID, marketing_consent: true },
                    error: null,
                  };
                },
              };
            },
          };
        },
        update() {
          return { async eq() { return { error: null }; } };
        },
      };
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as ConsumerLookupClient;
  const { client: outboxClient } = createFakeOutboxStore();

  try {
    const result = await processUnprocessedWebhookEvents(25, webhookEventsClient, consumerLookupClient, outboxClient);
    assert.equal(result.claimed, 2);
    assert.equal(result.processed, 1, "the good row should still be processed");
    assert.equal(result.failed, 1, "the bad row should be recorded as failed, not silently dropped");

    const badRow = rows.find((r) => r.id === "bad-event")!;
    const goodRow = rows.find((r) => r.id === "good-event")!;
    assert.equal(badRow.processed_at, null);
    assert.ok(goodRow.processed_at);
  } finally {
    restoreEnv();
  }
});

test("only recognized unsubscribe events are ever selected — unrecognized events are never reconciled", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  seedEvent(rows, { event_type: "unrecognized" });
  const throwingLookupClient = {
    from() {
      throw new Error("must not be called for an unrecognized event");
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as ConsumerLookupClient;
  try {
    const result = await processUnprocessedWebhookEvents(25, webhookEventsClient, throwingLookupClient);
    assert.equal(result.claimed, 0, "unrecognized events must never be claimed by this processor");
    assert.equal(rows[0].processed_at, null);
  } finally {
    restoreEnv();
  }
});

test("no code path in this processor can set marketing_consent from false to true", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  seedEvent(rows);
  const profiles = [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: false }];
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles,
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  try {
    await processUnprocessedWebhookEvents(25, webhookEventsClient, consumerLookupClient);
    assert.equal(profiles[0].marketing_consent, false);
  } finally {
    restoreEnv();
  }
});

test("the batch is bounded by the limit parameter", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  for (let i = 0; i < 5; i++) {
    seedEvent(rows, { id: `event-${i}`, dedupe_key: `dedupe-${i}`, email: "wayne@example.com" });
  }
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    const result = await processUnprocessedWebhookEvents(2, webhookEventsClient, consumerLookupClient, outboxClient);
    assert.equal(result.claimed, 2, "must never claim more than the requested bounded limit");
  } finally {
    restoreEnv();
  }
});

test("full pipeline: a failed inline reconciliation, then a later scheduled retry, succeeds and sets processed_at", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client: webhookEventsClient, rows } = createFakeWebhookEventsStore();
  // Simulate the state left behind by a failed inline reconciliation
  // attempt (webhookHandler.ts) — a durably persisted, unprocessed event.
  seedEvent(rows);
  assert.equal(rows[0].processed_at, null);

  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();

  try {
    const result = await processUnprocessedWebhookEvents(25, webhookEventsClient, consumerLookupClient, outboxClient);
    assert.equal(result.processed, 1);
    assert.ok(rows[0].processed_at, "the scheduled retry closes the gap the failed inline attempt left open");
  } finally {
    restoreEnv();
  }
});
