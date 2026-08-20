import { test } from "node:test";
import assert from "node:assert/strict";
import { syncConsumerBrevoEligibility } from "../../../src/lib/brevo/consumerSync";
import type { ConsumerLookupClient } from "../../../src/lib/brevo/consumerEligibility";
import { createFakeConsumerLookupClient } from "./support/fakeConsumerLookupClient";
import { createFakeOutboxStore } from "./support/fakeOutboxStore";
import { withBrevoEnv } from "./support/testEnv";

const CONSUMER_ID = "22222222-2222-2222-2222-222222222222";

function installFetchSpy() {
  const original = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    throw new Error("consumer lifecycle code must never call fetch (i.e. never call Brevo directly)");
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, callCount: () => callCount };
}

test("production + eligible consumer enqueues a subscribed:true outbox row with EXT_ID and FIRSTNAME set", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2", VERCEL_ENV: "production" });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  const fetchSpy = installFetchSpy();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].entity_type, "consumer");
    assert.equal(rows[0].payload.email, "wayne@example.com");
    assert.equal(rows[0].payload.subscribed, true);
    assert.equal((rows[0].payload.attributes as Record<string, string>).EXT_ID, CONSUMER_ID);
    assert.equal((rows[0].payload.attributes as Record<string, string>).FIRSTNAME, "Wayne");
    assert.equal(fetchSpy.callCount(), 0, "must never call Brevo directly");
  } finally {
    fetchSpy.restore();
    restoreEnv();
  }
});

test("consumer without marketing consent is not enqueued as eligible", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: false }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  const fetchSpy = installFetchSpy();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });
    assert.equal(rows.length, 0, "no outbox row should be created for a non-consenting, never-eligible consumer");
    assert.equal(fetchSpy.callCount(), 0);
  } finally {
    fetchSpy.restore();
    restoreEnv();
  }
});

test("unconfirmed consumer (e.g. mid-signup) is not enqueued yet", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: null }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });
    assert.equal(rows.length, 0, "signup-time call (pre-confirmation) must not enqueue yet");
  } finally {
    restoreEnv();
  }
});

test("consent true -> false transition enqueues a subscribed:false desired state (production)", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2", VERCEL_ENV: "production" });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: false }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, {
      lookupClient,
      outboxClient,
      previousMarketingConsent: true, // caller reports the pre-update value was true
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.subscribed, false);
    assert.equal(rows[0].payload.email, "wayne@example.com");
  } finally {
    restoreEnv();
  }
});

test("never-consented consumer does not get a spurious unsubscribe row (no previousMarketingConsent reported)", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: false }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    // No previousMarketingConsent option passed — matches the plain
    // createConsumerProfile() call sites, which never know a "before" value.
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });
    assert.equal(rows.length, 0);
  } finally {
    restoreEnv();
  }
});

test("repeated eligible-state syncs coalesce into a single outbox row (production)", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2", VERCEL_ENV: "production" });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });

    assert.equal(rows.length, 1, "three syncs for the same still-in-flight consumer must not create three rows");
  } finally {
    restoreEnv();
  }
});

test("missing Brevo configuration never throws and never blocks — sync is skipped, not failed", async () => {
  const restoreEnv = withBrevoEnv({}); // no BREVO_API_KEY / BREVO_CONSUMER_LIST_ID at all
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [{ id: CONSUMER_ID, email: "wayne@example.com", display_name: "Wayne", marketing_consent: true }],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    await assert.doesNotReject(() => syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient }));
    assert.equal(rows.length, 0, "no row can be enqueued without a target list id, but the caller must not see a thrown error");
  } finally {
    restoreEnv();
  }
});

// ── Phase 2A safety correction: enqueue-time staging protection ────────────

test("preview + email matching BREVO_TEST_EMAIL -> enqueue allowed", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "wayne@happyhourcompass.com",
    VERCEL_ENV: "preview",
  });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [
      { id: CONSUMER_ID, email: "wayne@happyhourcompass.com", display_name: "Wayne", marketing_consent: true },
    ],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  const fetchSpy = installFetchSpy();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });
    assert.equal(rows.length, 1, "the allowlisted test email must still be enqueueable in preview");
    assert.equal(fetchSpy.callCount(), 0);
  } finally {
    fetchSpy.restore();
    restoreEnv();
  }
});

test("preview + non-test consumer email -> no outbox row is created", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "wayne@happyhourcompass.com",
    VERCEL_ENV: "preview",
  });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [
      { id: CONSUMER_ID, email: "some-real-consumer@example.com", display_name: "Real Person", marketing_consent: true },
    ],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  const fetchSpy = installFetchSpy();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });
    assert.equal(rows.length, 0, "a real, non-test consumer email must never enter the shared outbox from preview");
    assert.equal(fetchSpy.callCount(), 0);
  } finally {
    fetchSpy.restore();
    restoreEnv();
  }
});

test("preview + BREVO_TEST_EMAIL unset -> fails closed, no outbox row for anyone", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    // BREVO_TEST_EMAIL intentionally omitted
    VERCEL_ENV: "preview",
  });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [
      { id: CONSUMER_ID, email: "anyone@example.com", display_name: "Anyone", marketing_consent: true },
    ],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient });
    assert.equal(rows.length, 0, "no allowlist configured in a non-production environment must block everyone, not allow everyone");
  } finally {
    restoreEnv();
  }
});

test("preview block does not throw back into the caller (signup/account update stays unaffected)", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "wayne@happyhourcompass.com",
    VERCEL_ENV: "preview",
  });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [
      { id: CONSUMER_ID, email: "some-real-consumer@example.com", display_name: "Real Person", marketing_consent: true },
    ],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient } = createFakeOutboxStore();
  try {
    await assert.doesNotReject(() => syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient, outboxClient }));
  } finally {
    restoreEnv();
  }
});

test("preview + true->false consent transition for a non-test email is also blocked before enqueue", async () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "3",
    BREVO_TEST_EMAIL: "wayne@happyhourcompass.com",
    VERCEL_ENV: "preview",
  });
  const lookupClient = createFakeConsumerLookupClient({
    profiles: [
      { id: CONSUMER_ID, email: "some-real-consumer@example.com", display_name: "Real Person", marketing_consent: false },
    ],
    authUsers: [{ id: CONSUMER_ID, email_confirmed_at: "2026-01-01T00:00:00Z" }],
  });
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    await syncConsumerBrevoEligibility(CONSUMER_ID, {
      lookupClient,
      outboxClient,
      previousMarketingConsent: true,
    });
    assert.equal(rows.length, 0, "an opt-out desired-state row for a real email must also be blocked in preview");
  } finally {
    restoreEnv();
  }
});

test("a lookup-client error never throws — signup/account code must remain unaffected", async () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  const throwingLookupClient = {
    from() {
      throw new Error("simulated Supabase outage");
    },
    auth: { admin: { async getUserById() { return { data: { user: null }, error: null }; } } },
  } as unknown as ConsumerLookupClient;
  const { client: outboxClient, rows } = createFakeOutboxStore();
  try {
    await assert.doesNotReject(() =>
      syncConsumerBrevoEligibility(CONSUMER_ID, { lookupClient: throwingLookupClient, outboxClient })
    );
    assert.equal(rows.length, 0);
  } finally {
    restoreEnv();
  }
});
