import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDedupeKey, enqueueBrevoContactSync } from "../../../src/lib/brevo/contactSync";
import { createFakeOutboxStore } from "./support/fakeOutboxStore";

test("buildDedupeKey is deterministic per (entityType, operation, entityId)", () => {
  const key = buildDedupeKey("consumer", "aaaa-1111", "upsert_contact");
  assert.equal(key, "consumer:upsert_contact:aaaa-1111");
});

test("enqueue succeeds and creates a new pending row", async () => {
  const { client, rows } = createFakeOutboxStore();
  const result = await enqueueBrevoContactSync(
    {
      entityType: "consumer",
      entityId: "11111111-1111-1111-1111-111111111111",
      email: "wayne@example.com",
      listId: 2,
      subscribed: true,
    },
    client
  );

  assert.equal(result.ok, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].entity_type, "consumer");
});

test("a duplicate enqueue for the same in-flight entity coalesces into the existing row instead of creating a second one", async () => {
  const { client, rows } = createFakeOutboxStore();
  const entityId = "22222222-2222-2222-2222-222222222222";

  const first = await enqueueBrevoContactSync(
    { entityType: "consumer", entityId, email: "wayne@example.com", listId: 2, subscribed: true },
    client
  );
  const second = await enqueueBrevoContactSync(
    { entityType: "consumer", entityId, email: "wayne+updated@example.com", listId: 2, subscribed: false },
    client
  );

  assert.equal(rows.length, 1, "expected exactly one in-flight row, not a duplicate");
  assert.equal(first.ok && second.ok && first.outboxId, second.ok && second.outboxId);
  // The coalesced row reflects the latest desired state (desired-state, not one-time-command).
  assert.equal(rows[0].payload.email, "wayne+updated@example.com");
  assert.equal(rows[0].payload.subscribed, false);
});

test("re-enqueuing after the prior job already completed creates a fresh row (reprocessing after completion is safe)", async () => {
  const { client, rows } = createFakeOutboxStore();
  const entityId = "33333333-3333-3333-3333-333333333333";

  await enqueueBrevoContactSync(
    { entityType: "consumer", entityId, email: "wayne@example.com", listId: 2, subscribed: true },
    client
  );
  rows[0].status = "completed";
  rows[0].completed_at = new Date().toISOString();

  await enqueueBrevoContactSync(
    { entityType: "consumer", entityId, email: "wayne@example.com", listId: 2, subscribed: true },
    client
  );

  assert.equal(rows.length, 2, "a new sync after the prior one completed should not be blocked by it");
  assert.equal(rows[0].status, "completed");
  assert.equal(rows[1].status, "pending");
});

test("enqueue for a different entity never coalesces with an unrelated in-flight job", async () => {
  const { client, rows } = createFakeOutboxStore();

  await enqueueBrevoContactSync(
    { entityType: "consumer", entityId: "aaaaaaaa-0000-0000-0000-000000000001", email: "a@example.com", listId: 2, subscribed: true },
    client
  );
  await enqueueBrevoContactSync(
    { entityType: "consumer", entityId: "aaaaaaaa-0000-0000-0000-000000000002", email: "b@example.com", listId: 2, subscribed: true },
    client
  );

  assert.equal(rows.length, 2);
});
