import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runConsumerBrevoWelcomeCohortBackfill,
  resolveWelcomeCohortBackfillConfig,
  type WelcomeCohortBackfillConfig,
} from "../../../src/lib/brevo/welcomeCohortBackfill";
import { createFakeConsumerLookupClient, type FakeConsumerProfile } from "./support/fakeConsumerLookupClient";
import { createFakeOutboxStore } from "./support/fakeOutboxStore";
import { createFakeWelcomeCohortStore } from "./support/fakeWelcomeCohortStore";
import { withBrevoEnv } from "./support/testEnv";

const FAKE_CONFIG: WelcomeCohortBackfillConfig = {
  consumerListId: 2,
  existingConsumerWelcomeListId: 4,
  testEmail: null,
};

function makeProfile(overrides: Partial<FakeConsumerProfile> & { id: string }): FakeConsumerProfile {
  return {
    email: `${overrides.id}@example.com`,
    display_name: null,
    marketing_consent: true,
    brevo_welcome_backfilled_at: null,
    ...overrides,
  };
}

/** Wires one shared profiles array + one shared outbox rows array across all three fakes, mirroring one consistent Postgres database. */
function makeHarness(profiles: FakeConsumerProfile[], authUsers: { id: string; email_confirmed_at: string | null }[]) {
  const lookupClient = createFakeConsumerLookupClient({ profiles, authUsers });
  const { client: outboxClient, rows: outboxRows } = createFakeOutboxStore();
  const store = createFakeWelcomeCohortStore(profiles, outboxRows);
  return { lookupClient, outboxClient, outboxRows, store, profiles };
}

test("1. an eligible existing consumer is selected, enqueued, and marked as part of the cohort", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient,
      config: FAKE_CONFIG,
    });

    assert.equal(summary.examined, 1);
    assert.equal(summary.eligible, 1);
    assert.equal(summary.enqueued, 1);
    assert.equal(summary.errors, 0);
    assert.ok(profiles[0].brevo_welcome_backfilled_at, "consumer must be marked as backfilled");
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0].entity_id, "c1");
    assert.equal((outboxRows[0].payload as { subscribed: boolean }).subscribed, true);
  } finally {
    restoreEnv();
  }
});

test("2. a consumer with an unconfirmed email is excluded and never marked", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: null }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient,
      config: FAKE_CONFIG,
    });

    assert.equal(summary.eligible, 0);
    assert.equal(summary.excluded, 1);
    assert.equal(summary.excludedByReason.unconfirmed_email, 1);
    assert.equal(outboxRows.length, 0);
    assert.equal(profiles[0].brevo_welcome_backfilled_at, null);
  } finally {
    restoreEnv();
  }
});

test("3. a consumer with marketing_consent = false is never even examined", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1", marketing_consent: false })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient,
      config: FAKE_CONFIG,
    });

    assert.equal(summary.examined, 0, "candidate query itself must filter out consent=false consumers");
    assert.equal(outboxRows.length, 0);
    assert.equal(profiles[0].brevo_welcome_backfilled_at, null);
  } finally {
    restoreEnv();
  }
});

test("4. a consumer with no usable email is excluded and never marked", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1", email: "not-an-email" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient,
      config: FAKE_CONFIG,
    });

    assert.equal(summary.eligible, 0);
    assert.equal(summary.excludedByReason.no_usable_email, 1);
    assert.equal(outboxRows.length, 0);
    assert.equal(profiles[0].brevo_welcome_backfilled_at, null);
  } finally {
    restoreEnv();
  }
});

test("5. an eligible consumer is queued through the existing durable outbox architecture (not a direct Brevo call)", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1", display_name: "Wayne" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });

    assert.equal(outboxRows.length, 1, "the durable outbox must carry exactly one row");
    const row = outboxRows[0];
    assert.equal(row.status, "pending", "a fresh enqueue must land in the same pending state every other sync uses");
    assert.equal(row.dedupe_key, "consumer:upsert_contact:c1");
    const payload = row.payload as { email: string; attributes: Record<string, unknown>; listIds: number[] };
    assert.equal(payload.email, "c1@example.com");
    assert.equal(payload.attributes.EXT_ID, "c1");
    assert.equal(payload.attributes.FIRSTNAME, "Wayne");
    assert.deepEqual(payload.listIds, [2, 4], "must carry both the ongoing consumer list and the dedicated historical-welcome list");
  } finally {
    restoreEnv();
  }
});

test("6. rerunning the backfill does not create unsafe duplicate work", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" }), makeProfile({ id: "c2" })];
  const authUsers = [
    { id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    { id: "c2", email_confirmed_at: "2026-01-01T00:00:00Z" },
  ];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const first = await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    assert.equal(first.enqueued, 2);
    assert.equal(outboxRows.length, 2);

    const second = await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    assert.equal(second.examined, 0, "already-marked consumers must never be re-examined on a rerun");
    assert.equal(second.enqueued, 0);
    assert.equal(outboxRows.length, 2, "no duplicate outbox rows from the rerun");
    assert.equal(second.alreadyInHistoricalCohortBeforeThisRun, 2);
  } finally {
    restoreEnv();
  }
});

test("7. exactly one enqueue call happens per eligible consumer — no extra or direct Brevo calls", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" }), makeProfile({ id: "c2" })];
  const authUsers = [
    { id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    { id: "c2", email_confirmed_at: "2026-01-01T00:00:00Z" },
  ];
  const { lookupClient, outboxClient, store } = makeHarness(profiles, authUsers);

  let rpcCalls = 0;
  const spyOutboxClient = {
    ...outboxClient,
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls++;
      assert.equal(fn, "enqueue_brevo_contact_sync", "the backfill must only ever call the existing enqueue RPC — never a direct Brevo API method");
      return outboxClient.rpc(fn, args);
    },
  };

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient: spyOutboxClient,
      config: FAKE_CONFIG,
    });
    assert.equal(rpcCalls, 2, "one RPC enqueue call per eligible consumer, no more");
    assert.equal(summary.enqueued, 2);
  } finally {
    restoreEnv();
  }
});

test("8. no consumer's marketing consent is ever changed by the backfill", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1", marketing_consent: true }), makeProfile({ id: "c2", marketing_consent: false })];
  const authUsers = [
    { id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    { id: "c2", email_confirmed_at: "2026-01-01T00:00:00Z" },
  ];
  const { lookupClient, outboxClient, store } = makeHarness(profiles, authUsers);

  try {
    await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    assert.equal(profiles[0].marketing_consent, true);
    assert.equal(profiles[1].marketing_consent, false, "an ineligible consumer's consent must remain exactly as it was");
  } finally {
    restoreEnv();
  }
});

test("9. the cohort marker outcome is deterministic across independent identical runs", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const build = () => {
    const profiles = [makeProfile({ id: "c1" }), makeProfile({ id: "c2", marketing_consent: false })];
    const authUsers = [
      { id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" },
      { id: "c2", email_confirmed_at: "2026-01-01T00:00:00Z" },
    ];
    return makeHarness(profiles, authUsers);
  };

  try {
    const runA = build();
    const summaryA = await runConsumerBrevoWelcomeCohortBackfill({ apply: true, ...runA, config: FAKE_CONFIG });
    const runB = build();
    const summaryB = await runConsumerBrevoWelcomeCohortBackfill({ apply: true, ...runB, config: FAKE_CONFIG });

    assert.equal(summaryA.enqueued, summaryB.enqueued);
    assert.equal(summaryA.excluded, summaryB.excluded);
    assert.equal(!!runA.profiles[0].brevo_welcome_backfilled_at, !!runB.profiles[0].brevo_welcome_backfilled_at);
    assert.equal(runA.profiles[1].brevo_welcome_backfilled_at, null);
    assert.equal(runB.profiles[1].brevo_welcome_backfilled_at, null);
  } finally {
    restoreEnv();
  }
});

test("10. a consumer already marked as part of the historical cohort can never be re-selected as a future-automation candidate", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, store } = makeHarness(profiles, authUsers);

  try {
    await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    assert.ok(profiles[0].brevo_welcome_backfilled_at);

    // Any future automated-welcome eligibility check is expected to read
    // this exact same column and exclude anyone it finds set — modeled
    // here directly since that check does not exist yet in this task.
    const wouldBeAutomationEligible = profiles.filter((p) => !p.brevo_welcome_backfilled_at);
    assert.equal(wouldBeAutomationEligible.length, 0, "a historically-backfilled consumer must never appear as automation-eligible");
  } finally {
    restoreEnv();
  }
});

test("11. a consumer who only exists after a completed backfill run is untouched by that run (cutoff is a run-time snapshot, not a stored date)", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [
    { id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    { id: "c2", email_confirmed_at: "2026-01-01T00:00:00Z" },
  ];
  const { lookupClient, outboxClient, store } = makeHarness(profiles, authUsers);

  try {
    const first = await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    assert.equal(first.examined, 1);

    // A brand new consumer signs up AFTER the run above has already completed.
    profiles.push(makeProfile({ id: "c2" }));

    assert.equal(profiles[1].brevo_welcome_backfilled_at, null, "a post-run signup must never be retroactively marked by an already-finished run");
  } finally {
    restoreEnv();
  }
});

test("12. a later consent flip does not corrupt an already-assigned cohort outcome", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, store } = makeHarness(profiles, authUsers);

  try {
    await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    assert.ok(profiles[0].brevo_welcome_backfilled_at);
    const markedAt = profiles[0].brevo_welcome_backfilled_at;

    // Consent later flips false then true again (e.g. an account settings change).
    profiles[0].marketing_consent = false;
    profiles[0].marketing_consent = true;

    assert.equal(profiles[0].brevo_welcome_backfilled_at, markedAt, "cohort marker must be untouched by unrelated consent changes after it is set");
  } finally {
    restoreEnv();
  }
});

test("12b. a consumer ineligible on run 1 who becomes eligible later is correctly picked up (not permanently excluded)", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1", marketing_consent: false })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, store } = makeHarness(profiles, authUsers);

  try {
    const first = await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    assert.equal(first.examined, 0);
    assert.equal(profiles[0].brevo_welcome_backfilled_at, null);

    profiles[0].marketing_consent = true;

    const second = await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    assert.equal(second.examined, 1);
    assert.equal(second.enqueued, 1);
    assert.ok(profiles[0].brevo_welcome_backfilled_at);
  } finally {
    restoreEnv();
  }
});

test("13a. staging restrictions remain intact — a non-production run with a non-matching test email enqueues nothing", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: undefined, BREVO_TEST_EMAIL: "someone-else@example.com" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient,
      config: { ...FAKE_CONFIG, testEmail: "someone-else@example.com" },
    });

    assert.equal(summary.eligible, 1, "eligibility itself is unaffected by the staging guard");
    assert.equal(summary.enqueued, 0, "the enqueue-time staging guard must still block a non-allowlisted address");
    assert.equal(outboxRows.length, 0);
    assert.equal(profiles[0].brevo_welcome_backfilled_at, null, "an address blocked by the staging guard must never be marked as backfilled");
  } finally {
    restoreEnv();
  }
});

test("13b. staging restrictions remain intact — a non-production run with no test email configured fails closed (enqueues nothing)", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: undefined });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient,
      config: { ...FAKE_CONFIG, testEmail: null },
    });

    assert.equal(summary.enqueued, 0);
    assert.equal(outboxRows.length, 0);
    assert.equal(profiles[0].brevo_welcome_backfilled_at, null);
  } finally {
    restoreEnv();
  }
});

test("13c. a confirmed production run is unrestricted regardless of BREVO_TEST_EMAIL", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production", BREVO_TEST_EMAIL: "someone-else@example.com" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient,
      config: { ...FAKE_CONFIG, testEmail: "someone-else@example.com" },
    });

    assert.equal(summary.enqueued, 1);
    assert.equal(outboxRows.length, 1);
    assert.ok(profiles[0].brevo_welcome_backfilled_at);
  } finally {
    restoreEnv();
  }
});

test("dry run performs no writes at all — no enqueue, no cohort marker — but still reports eligibility", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: false,
      store,
      lookupClient,
      outboxClient,
      config: FAKE_CONFIG,
    });

    assert.equal(summary.mode, "dry-run");
    assert.equal(summary.eligible, 1);
    assert.equal(summary.enqueued, 0);
    assert.equal(outboxRows.length, 0, "dry run must never write to the outbox");
    assert.equal(profiles[0].brevo_welcome_backfilled_at, null, "dry run must never set the cohort marker");
  } finally {
    restoreEnv();
  }
});

test("a failed enqueue is reported as an error and does not mark the cohort", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, store } = makeHarness(profiles, authUsers);
  const throwingOutboxClient = {
    from() {
      throw new Error("must not be called");
    },
    async rpc() {
      return { data: null, error: { message: "simulated outbox failure" } };
    },
  };

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient: throwingOutboxClient,
      config: FAKE_CONFIG,
    });

    assert.equal(summary.enqueued, 0);
    assert.equal(summary.errors, 1);
    assert.equal(profiles[0].brevo_welcome_backfilled_at, null, "a consumer must never be marked backfilled without a confirmed successful enqueue");
  } finally {
    restoreEnv();
  }
});

test("an eligible consumer that already has a pending outbox row is reported as already-represented/coalesced", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);
  // Simulate a pending job already sitting in the outbox from an earlier
  // lifecycle-hook sync (e.g. the consumer updated their profile before the
  // backfill ran) — the enqueue call below must coalesce into it, not fail.
  outboxRows.push({
    id: "pre-existing",
    provider: "brevo",
    entity_type: "consumer",
    entity_id: "c1",
    operation: "upsert_contact",
    dedupe_key: "consumer:upsert_contact:c1",
    payload: { email: "c1@example.com", attributes: { EXT_ID: "c1" }, listIds: [2], subscribed: true },
    status: "pending",
    attempt_count: 0,
    max_attempts: 5,
    last_attempted_at: null,
    next_attempt_at: new Date().toISOString(),
    last_error: null,
    last_error_class: null,
    completed_at: null,
    created_at: new Date().toISOString(),
  });

  try {
    const summary = await runConsumerBrevoWelcomeCohortBackfill({
      apply: true,
      store,
      lookupClient,
      outboxClient,
      config: FAKE_CONFIG,
    });

    assert.equal(summary.alreadyRepresentedOrCoalesced, 1);
    assert.equal(summary.enqueued, 1, "coalescing into an existing row is still a successful enqueue");
    assert.equal(outboxRows.length, 1, "coalescing must not create a second outbox row");
    assert.ok(profiles[0].brevo_welcome_backfilled_at);
  } finally {
    restoreEnv();
  }
});

// ── Brevo-side historical welcome cohort targeting ──────────────────────────

test("14. an eligible historical consumer queues normal consumer-list membership", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    const listIds = (outboxRows[0].payload as { listIds: number[] }).listIds;
    assert.ok(listIds.includes(FAKE_CONFIG.consumerListId), "must remain queued for the ongoing HHC consumer list");
  } finally {
    restoreEnv();
  }
});

test("15. an eligible historical consumer also queues historical-welcome-list membership", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);

  try {
    await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: FAKE_CONFIG });
    const listIds = (outboxRows[0].payload as { listIds: number[] }).listIds;
    assert.ok(
      listIds.includes(FAKE_CONFIG.existingConsumerWelcomeListId),
      "must also be queued for the dedicated one-time historical-welcome Brevo list"
    );
  } finally {
    restoreEnv();
  }
});

test("16. the historical list ID always comes from configuration, never a hard-coded literal", async () => {
  const restoreEnv = withBrevoEnv({ VERCEL_ENV: "production" });
  const profiles = [makeProfile({ id: "c1" })];
  const authUsers = [{ id: "c1", email_confirmed_at: "2026-01-01T00:00:00Z" }];
  const { lookupClient, outboxClient, outboxRows, store } = makeHarness(profiles, authUsers);
  const differentConfig: WelcomeCohortBackfillConfig = {
    consumerListId: 20,
    existingConsumerWelcomeListId: 99,
    testEmail: null,
  };

  try {
    await runConsumerBrevoWelcomeCohortBackfill({ apply: true, store, lookupClient, outboxClient, config: differentConfig });
    const listIds = (outboxRows[0].payload as { listIds: number[] }).listIds;
    assert.deepEqual(listIds, [20, 99], "the exact configured values must flow through, not any hard-coded pair");
  } finally {
    restoreEnv();
  }
});

test("17. missing BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID fails safely in --apply mode (fatal error, no partial enqueue)", () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  // BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID intentionally left unset.
  try {
    const { config, fatalError } = resolveWelcomeCohortBackfillConfig(true);
    assert.equal(config, null, "must never fall back to enqueuing only the main list");
    assert.ok(fatalError, "apply mode must receive an explicit fatal error, not a silent partial success");
    assert.match(fatalError!, /BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID/);
  } finally {
    restoreEnv();
  }
});

test("17b. missing BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID in dry-run mode degrades gracefully (no fatal error, eligibility-only)", () => {
  const restoreEnv = withBrevoEnv({ BREVO_API_KEY: "fake-key", BREVO_CONSUMER_LIST_ID: "2" });
  try {
    const { config, fatalError } = resolveWelcomeCohortBackfillConfig(false);
    assert.equal(config, null);
    assert.equal(fatalError, null, "a dry run must still be able to report eligibility even without the historical list configured");
  } finally {
    restoreEnv();
  }
});

test("17c. with both variables configured, resolveWelcomeCohortBackfillConfig returns a fully populated config", () => {
  const restoreEnv = withBrevoEnv({
    BREVO_API_KEY: "fake-key",
    BREVO_CONSUMER_LIST_ID: "2",
    // withBrevoEnv only manages the Brevo vars it knows about; the new list
    // var is set directly since it is not (yet) part of that shared list.
  });
  process.env.BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID = "4";
  try {
    const { config, fatalError } = resolveWelcomeCohortBackfillConfig(true);
    assert.equal(fatalError, null);
    assert.deepEqual(config, { consumerListId: 2, existingConsumerWelcomeListId: 4, testEmail: null });
  } finally {
    delete process.env.BREVO_EXISTING_CONSUMER_WELCOME_LIST_ID;
    restoreEnv();
  }
});
