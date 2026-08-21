import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileConsumerUnsubscribe } from "../../../src/lib/brevo/consumerConsentReconciliation";
import { createFakeConsumerLookupClient } from "./support/fakeConsumerLookupClient";
import { createFakeOutboxStore } from "./support/fakeOutboxStore";
import { withBrevoEnv } from "./support/testEnv";

const CONSUMER_ID = "44444444-4444-4444-4444-444444444444";

test("consenting consumer -> marketing_consent moves true to false", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    const result = await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient, outboxClient });
    assert.deepEqual(result, { ok: true, outcome: "updated" });
  } finally {
    restoreEnv();
  }
});

test("marketing_consent_at is nulled out on unsubscribe, matching the existing consent-change convention", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const profiles = [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }];
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles,
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient, outboxClient });
    const updated = profiles[0] as unknown as Record<string, unknown>;
    assert.equal(updated.marketing_consent, false);
    assert.equal(updated.marketing_consent_at, null);
  } finally {
    restoreEnv();
  }
});

test("matching normalized email is case-insensitive (consumer_profiles.email is not guaranteed lowercased)", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "Wayne@Example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    const result = await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient, outboxClient });
    assert.deepEqual(result, { ok: true, outcome: "updated" });
  } finally {
    restoreEnv();
  }
});

test("already-false consumer is treated as a safe idempotent no-op — no write, no outbound enqueue", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: false }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    const result = await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient, outboxClient });
    assert.deepEqual(result, { ok: true, outcome: "already_false" });
    assert.equal(rows.length, 0, "no outbound work should be enqueued for a consumer who was already opted out");
  } finally {
    restoreEnv();
  }
});

test("no matching HHC consumer (e.g. Wayne's founder/admin identity) is a safe no-op — never creates a consumer", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const consumerLookupClient = createFakeConsumerLookupClient({ profiles: [], authUsers: [] });
  const { client: outboxClient, rows: outboxRows } = createFakeOutboxStore();
  try {
    const result = await reconcileConsumerUnsubscribe("wayne@happyhourcompass.com", { consumerLookupClient, outboxClient });
    assert.deepEqual(result, { ok: true, outcome: "no_matching_consumer" });
    assert.equal(outboxRows.length, 0);
  } finally {
    restoreEnv();
  }
});

test("a Supabase update failure surfaces as { ok: false } — remains observable, not silently dropped", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const consumerLookupClient = {
    from(table: string) {
      if (table !== "consumer_profiles") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            ilike() {
              return {
                async maybeSingle() {
                  return { data: { id: CONSUMER_ID, marketing_consent: true }, error: null };
                },
              };
            },
          };
        },
        update() {
          return {
            async eq() {
              return { error: { message: "simulated write failure" } };
            },
          };
        },
      };
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as Parameters<typeof reconcileConsumerUnsubscribe>[1] extends { consumerLookupClient?: infer T } ? T : never;

  try {
    const result = await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /simulated write failure/);
  } finally {
    restoreEnv();
  }
});

test("a thrown client error surfaces as { ok: false } rather than an uncaught exception", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const throwingClient = {
    from() {
      throw new Error("simulated Supabase outage");
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as Parameters<typeof reconcileConsumerUnsubscribe>[1] extends { consumerLookupClient?: infer T } ? T : never;

  try {
    await assert.doesNotReject(() => reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient: throwingClient }));
    const result = await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient: throwingClient });
    assert.equal(result.ok, false);
  } finally {
    restoreEnv();
  }
});

test("never mutates auth.users — getUserById is never called by this reconciliation path", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  let authCalled = false;
  const consumerLookupClient = {
    from(table: string) {
      if (table !== "consumer_profiles") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            ilike() {
              return {
                async maybeSingle() {
                  return { data: { id: CONSUMER_ID, marketing_consent: true }, error: null };
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
    auth: {
      admin: {
        async getUserById() {
          authCalled = true;
          return { data: { user: null }, error: null };
        },
      },
    },
  } as unknown as Parameters<typeof reconcileConsumerUnsubscribe>[1] extends { consumerLookupClient?: infer T } ? T : never;
  const { client: outboxClient } = createFakeOutboxStore();

  try {
    await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient, outboxClient });
    assert.equal(authCalled, false, "unsubscribe reconciliation must never touch auth.users");
  } finally {
    restoreEnv();
  }
});

test("never mutates any profile field other than marketing_consent / marketing_consent_at", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const profiles = [
    { id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true },
  ];
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles,
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient, outboxClient });
    assert.equal(profiles[0].display_name, "Wayne", "display_name must be untouched");
    assert.equal(profiles[0].email, "wayne@example.com", "email must be untouched");
  } finally {
    restoreEnv();
  }
});

test("a real transition enqueues an outbound subscribed:false desired state (reinforcing the same final state, not a loop)", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2", VERCEL_ENV: "production" });
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient, outboxClient });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.subscribed, false);
    assert.equal(rows[0].payload.email, "wayne@example.com");
  } finally {
    restoreEnv();
  }
});

test("there is no code path in this module that can set marketing_consent from false to true", async () => {
  // Structural guarantee, not just behavioral: the only { marketing_consent: ... }
  // write literal in this module is `false`. Re-processing an already-false
  // consumer never issues a write at all (see the "safe idempotent no-op" test).
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const profiles = [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: false }];
  const consumerLookupClient = createFakeConsumerLookupClient({
    profiles,
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    await reconcileConsumerUnsubscribe("wayne@example.com", { consumerLookupClient, outboxClient });
    assert.equal(profiles[0].marketing_consent, false, "must remain false — never flipped back to true");
  } finally {
    restoreEnv();
  }
});
