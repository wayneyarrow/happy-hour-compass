import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBackoffMs, processBrevoOutboxBatch, reclaimStaleProcessingRows } from "../../../src/lib/brevo/outbox";
import { createFakeOutboxStore, type FakeOutboxRow } from "./support/fakeOutboxStore";
import { withBrevoEnv } from "./support/testEnv";

function installFakeFetch(handler: () => Response | Promise<Response>) {
  const original = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    return handler();
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, callCount: () => callCount };
}

function seedRow(rows: FakeOutboxRow[], overrides: Partial<FakeOutboxRow> = {}): FakeOutboxRow {
  const nowIso = new Date().toISOString();
  const row: FakeOutboxRow = {
    id: overrides.id ?? `seed-${rows.length + 1}`,
    provider: "brevo",
    entity_type: "consumer",
    entity_id: "11111111-1111-1111-1111-111111111111",
    operation: "upsert_contact",
    dedupe_key: `consumer:upsert_contact:${overrides.entity_id ?? "11111111-1111-1111-1111-111111111111"}`,
    payload: { email: "wayne@example.com", attributes: {}, listId: 2, subscribed: true },
    status: "pending",
    attempt_count: 0,
    max_attempts: 5,
    last_attempted_at: null,
    next_attempt_at: nowIso,
    last_error: null,
    last_error_class: null,
    completed_at: null,
    created_at: nowIso,
    ...overrides,
  };
  rows.push(row);
  return row;
}

test("processBrevoOutboxBatch with an empty store claims nothing", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client } = createFakeOutboxStore();
  try {
    const result = await processBrevoOutboxBatch(10, client);
    assert.deepEqual(result, { claimed: 0, completed: 0, retried: 0, failed: 0, blocked: 0 });
  } finally {
    restoreEnv();
  }
});

test("successful processing completes the job", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeOutboxStore();
  seedRow(rows);
  const fake = installFakeFetch(() => new Response(null, { status: 204 }));
  try {
    const result = await processBrevoOutboxBatch(10, client);
    assert.equal(result.claimed, 1);
    assert.equal(result.completed, 1);
    assert.equal(rows[0].status, "completed");
    assert.ok(rows[0].completed_at);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("a transient failure schedules a retry with attempt_count and next_attempt_at recorded", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeOutboxStore();
  seedRow(rows);
  const fake = installFakeFetch(() => new Response("server error", { status: 500 }));
  try {
    const result = await processBrevoOutboxBatch(10, client);
    assert.equal(result.retried, 1);
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].attempt_count, 1);
    assert.equal(rows[0].last_error_class, "transient");
    assert.ok(new Date(rows[0].next_attempt_at).getTime() > Date.now());
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("a permanent (non-transient) failure is marked failed immediately, without burning the retry budget", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeOutboxStore();
  seedRow(rows, { max_attempts: 5 });
  const fake = installFakeFetch(
    () => new Response(JSON.stringify({ code: "invalid_parameter", message: "bad email" }), { status: 400 })
  );
  try {
    const result = await processBrevoOutboxBatch(10, client);
    assert.equal(result.failed, 1);
    assert.equal(rows[0].status, "failed");
    assert.equal(rows[0].attempt_count, 1);
    assert.equal(rows[0].last_error_class, "invalid_request");
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("a transient failure that exhausts max_attempts is marked failed, not retried forever", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeOutboxStore();
  seedRow(rows, { max_attempts: 1 });
  const fake = installFakeFetch(() => new Response("server error", { status: 503 }));
  try {
    const result = await processBrevoOutboxBatch(10, client);
    assert.equal(result.failed, 1);
    assert.equal(result.retried, 0);
    assert.equal(rows[0].status, "failed");
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("a non-allowlisted email in staging is blocked before any Brevo API call, and is never retried", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "wayne@example.com",
  });
  const { client, rows } = createFakeOutboxStore();
  seedRow(rows, { payload: { email: "someone-else@example.com", attributes: {}, listId: 3, subscribed: true } });
  const fake = installFakeFetch(() => new Response(null, { status: 204 }));
  try {
    const result = await processBrevoOutboxBatch(10, client);
    assert.equal(result.blocked, 1);
    assert.equal(rows[0].status, "blocked");
    assert.equal(fake.callCount(), 0);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("a completed row is never reclaimed by a later batch (reprocessing is idempotent)", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const { client, rows } = createFakeOutboxStore();
  seedRow(rows, { status: "completed", completed_at: new Date().toISOString() });
  const fake = installFakeFetch(() => new Response(null, { status: 204 }));
  try {
    const result = await processBrevoOutboxBatch(10, client);
    assert.equal(result.claimed, 0);
    assert.equal(fake.callCount(), 0);
    assert.equal(rows[0].status, "completed");
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("reclaimStaleProcessingRows resets a row stuck in 'processing' back to 'pending'", async () => {
  const { client, rows } = createFakeOutboxStore();
  const staleTimestamp = new Date(Date.now() - 60 * 60_000).toISOString(); // 1 hour ago
  seedRow(rows, { status: "processing", last_attempted_at: staleTimestamp });

  const reclaimed = await reclaimStaleProcessingRows(client);
  assert.equal(reclaimed, 1);
  assert.equal(rows[0].status, "pending");
});

test("reclaimStaleProcessingRows does not touch a recently-claimed 'processing' row", async () => {
  const { client, rows } = createFakeOutboxStore();
  seedRow(rows, { status: "processing", last_attempted_at: new Date().toISOString() });

  const reclaimed = await reclaimStaleProcessingRows(client);
  assert.equal(reclaimed, 0);
  assert.equal(rows[0].status, "processing");
});

test("computeBackoffMs is bounded and increases with attempt number, capped at 60 minutes", () => {
  assert.equal(computeBackoffMs(1), 60_000);
  assert.equal(computeBackoffMs(2), 5 * 60_000);
  assert.equal(computeBackoffMs(3), 15 * 60_000);
  assert.equal(computeBackoffMs(4), 30 * 60_000);
  assert.equal(computeBackoffMs(5), 60 * 60_000);
  assert.equal(computeBackoffMs(50), 60 * 60_000); // never grows unbounded
});
