import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFakeDeliveryClient,
  makeFakeCsEventRow,
  type FakeVenueRow,
  type FakeMembershipRow,
  type FakeBaselineRow,
} from "./support/fakeDeliveryClient";
import { processCustomerSuccessDeliveries } from "../../../src/lib/customerSuccess/processCustomerSuccessDeliveries";

type SendEmailParams = {
  type: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  criticality: string;
  from?: string;
  replyTo?: string;
  idempotencyKey?: string;
};
type SendEmailResult = { ok: boolean; id?: string; error?: string };

function makeSendEmailSpy(script: SendEmailResult[]) {
  const calls: SendEmailParams[] = [];
  let i = 0;
  const fn = async (params: SendEmailParams): Promise<SendEmailResult> => {
    calls.push(params);
    const result = script[Math.min(i, script.length - 1)];
    i++;
    return result;
  };
  return { fn, calls };
}

const OWNER: FakeMembershipRow = {
  id: "m-owner",
  operator_id: "op-1",
  role: "owner",
  email: "kelly@example.com",
  full_name: "Kelly Owner",
  status: "active",
};

const MARKET = { id: "market-1", slug: "central-okanagan" };

const VENUE: FakeVenueRow = {
  id: "venue-1",
  is_published: true,
  is_verified: true,
  created_by_operator_id: "op-1",
  market_id: MARKET.id,
  name: "Buffalo Rouge Brewing Co.",
};

/**
 * Wraps createFakeDeliveryClient() with MARKET seeded by default (every
 * test venue resolves a real timezone unless a test explicitly overrides
 * `markets` to exercise the unresolvable-timezone path).
 */
function makeClient(seed: Parameters<typeof createFakeDeliveryClient>[0]) {
  return createFakeDeliveryClient({ markets: [MARKET], ...seed });
}

function baselineFor(venueId: string): FakeBaselineRow {
  return { id: `baseline-${venueId}`, venue_id: venueId, event_type: "venue_view_milestone", metric_value_at_baseline: 0 };
}

function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return fn().finally(() => {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  });
}

// ── Sending ──────────────────────────────────────────────────────────────────

test("a due, resolvable event is sent via the approved renderer, Wayne sender/reply-to, and becomes 'sent'", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-100",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
          achieved_at: new Date(now.getTime() - 3600_000).toISOString(),
        }),
      ],
    });

    const spy = makeSendEmailSpy([{ ok: true, id: "resend-msg-1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.enabled, true);
    assert.equal(result.sent, 1);
    assert.equal(result.attempted, 1);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].from, "Wayne <wayne@happyhourcompass.com>");
    assert.equal(spy.calls[0].replyTo, "wayne@happyhourcompass.com");
    assert.equal(spy.calls[0].to, "kelly@example.com");
    assert.match(spy.calls[0].subject, /100 views/);
    assert.match(spy.calls[0].html, /Hi Kelly,/);
    assert.match(spy.calls[0].html, /Buffalo Rouge Brewing Co\./);

    const row = csEvents.find((e) => e.id === "event-100")!;
    assert.equal(row.communication_status, "sent");
    assert.equal(row.recipient_email, "kelly@example.com");
    assert.equal(row.provider_message_id, "resend-msg-1");
    assert.equal(row.attempt_count, 1);
  });
});

test("idempotency key is deterministic from the event id and passed to the sender", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-xyz",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(spy.calls[0].idempotencyKey, "hhc-customer-success:event-xyz");
  });
});

// ── Retry progression to terminal failure ───────────────────────────────────

test("attempt 1 and 2 fail → retry ~1hr later each time; attempt 3 fails → terminal 'failed'", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    let now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-retry",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });

    const spy = makeSendEmailSpy([
      { ok: false, error: "Provider timeout" },
      { ok: false, error: "Provider timeout" },
      { ok: false, error: "Provider timeout" },
    ]);

    // Attempt 1
    let result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(result.retried, 1);
    let row = csEvents.find((e) => e.id === "event-retry")!;
    assert.equal(row.communication_status, "pending");
    assert.equal(row.attempt_count, 1);
    assert.equal(row.next_attempt_at, new Date(now.getTime() + 3_600_000).toISOString());

    // Attempt 2 — advance clock to the scheduled retry time.
    now = new Date(row.next_attempt_at!);
    result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(result.retried, 1);
    row = csEvents.find((e) => e.id === "event-retry")!;
    assert.equal(row.communication_status, "pending");
    assert.equal(row.attempt_count, 2);

    // Attempt 3 — final failure.
    now = new Date(row.next_attempt_at!);
    result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(result.failedTerminal, 1);
    row = csEvents.find((e) => e.id === "event-retry")!;
    assert.equal(row.communication_status, "failed");
    assert.equal(row.attempt_count, 3);
    assert.equal(row.next_attempt_at, null);

    assert.equal(spy.calls.length, 3);
    // Same idempotency key reused across every retry of the same event.
    assert.equal(spy.calls[0].idempotencyKey, spy.calls[1].idempotencyKey);
    assert.equal(spy.calls[1].idempotencyKey, spy.calls[2].idempotencyKey);
  });
});

// ── Delivery snapshot — stable retry payload (Correction Pass Section 2) ───

test("the first attempt establishes a locked delivery snapshot (recipient_email + metadata_json)", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-snapshot",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    const row = csEvents.find((e) => e.id === "event-snapshot")!;
    assert.equal(row.recipient_email, "kelly@example.com");
    assert.deepEqual(row.metadata_json, {
      deliverySnapshot: { recipientFirstName: "Kelly", venueName: "Buffalo Rouge Brewing Co." },
    });
  });
});

test("locking the delivery snapshot PRESERVES any pre-existing metadata_json keys, never replaces the whole object", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-metadata-preserved",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
          metadata_json: { source: "future-value", foo: "bar" },
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    const row = csEvents.find((e) => e.id === "event-metadata-preserved")!;
    assert.deepEqual(row.metadata_json, {
      source: "future-value",
      foo: "bar",
      deliverySnapshot: { recipientFirstName: "Kelly", venueName: "Buffalo Rouge Brewing Co." },
    });
  });
});

test("account email changes before retry → retry still uses the snapshotted (original) email", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    let now = new Date("2026-01-06T15:00:00Z");
    const { client, memberships, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [{ ...OWNER, email: "kelly@old-address.com" }],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-email-change",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: false, error: "temporary failure" }, { ok: true, id: "r2" }]);

    const first = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(first.retried, 1);
    assert.equal(spy.calls[0].to, "kelly@old-address.com");

    // Account email changes before the retry attempt.
    memberships[0].email = "kelly@new-address.com";

    const row = csEvents.find((e) => e.id === "event-email-change")!;
    now = new Date(row.next_attempt_at!);
    const second = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(second.sent, 1);
    assert.equal(spy.calls[1].to, "kelly@old-address.com", "retry must use the LOCKED snapshot, not the changed email");

    const finalRow = csEvents.find((e) => e.id === "event-email-change")!;
    assert.equal(finalRow.recipient_email, "kelly@old-address.com");
  });
});

test("operator first name changes before retry → same greeting used", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    let now = new Date("2026-01-06T15:00:00Z");
    const { client, memberships, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [{ ...OWNER, full_name: "Kelly Original" }],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-name-change",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: false, error: "temporary failure" }, { ok: true, id: "r2" }]);

    await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.match(spy.calls[0].html, /Hi Kelly,/);

    // Name changes on the account before the retry attempt.
    memberships[0].full_name = "Kelly Changed";

    const row = csEvents.find((e) => e.id === "event-name-change")!;
    now = new Date(row.next_attempt_at!);
    await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.match(spy.calls[1].html, /Hi Kelly,/, "retry must use the snapshotted greeting name, not the changed one");
    assert.doesNotMatch(spy.calls[1].html, /Kelly Changed/);
  });
});

test("venue name changes before retry → same subject/body venue name used", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    let now = new Date("2026-01-06T15:00:00Z");
    const { client, venues, csEvents } = makeClient({
      venues: [{ ...VENUE }],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-venue-name-change",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: false, error: "temporary failure" }, { ok: true, id: "r2" }]);

    await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.match(spy.calls[0].subject, /Buffalo Rouge Brewing Co\./);

    // Venue is renamed before the retry attempt.
    venues[0].name = "Renamed Venue LLC";

    const row = csEvents.find((e) => e.id === "event-venue-name-change")!;
    now = new Date(row.next_attempt_at!);
    await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.match(spy.calls[1].subject, /Buffalo Rouge Brewing Co\./, "retry must use the snapshotted venue name");
    assert.doesNotMatch(spy.calls[1].subject, /Renamed Venue LLC/);
  });
});

test("stale-processing recovery also reuses the locked snapshot, not fresh recipient resolution", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const staleStart = new Date(now.getTime() - 20 * 60_000);
    const { client, memberships, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [{ ...OWNER, email: "kelly@snapshotted.com" }],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-stale-snapshot",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "processing", // crashed mid-attempt, snapshot already locked
          processing_started_at: staleStart.toISOString(),
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
          attempt_count: 1,
          recipient_email: "kelly@snapshotted.com",
          metadata_json: {
            deliverySnapshot: { recipientFirstName: "Kelly", venueName: "Buffalo Rouge Brewing Co." },
          },
        }),
      ],
    });
    // Account changed after the crash but before recovery — must be ignored.
    memberships[0].email = "kelly@should-not-be-used.com";

    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.staleRecovered, 1);
    assert.equal(result.sent, 1);
    assert.equal(spy.calls[0].to, "kelly@snapshotted.com");
    assert.equal(spy.calls[0].idempotencyKey, "hhc-customer-success:event-stale-snapshot");

    const row = csEvents.find((e) => e.id === "event-stale-snapshot")!;
    assert.equal(row.recipient_email, "kelly@snapshotted.com");
  });
});

test("a failed terminal milestone does not block a later, higher milestone from becoming active", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 250]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-100-failed",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "failed",
          attempt_count: 3,
          next_attempt_at: null,
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    // Detection (which runs first inside the processor) should be able to
    // record 250 as newly pending even though 100 is terminally failed.
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(result.detection!.milestonesNewlyAchieved, 1);
    const row250 = csEvents.find((e) => e.milestone_value === 250)!;
    assert.ok(row250);
    assert.equal(row250.communication_status === "pending" || row250.communication_status === "sent", true);
  });
});

// ── Recipient resolution / blocking ─────────────────────────────────────────

test("no active recipient: blocked, no send attempted, not counted as a delivery attempt", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [], // no active operator users at all
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-blocked",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.recipientBlocked, 1);
    assert.equal(result.attempted, 0);
    assert.equal(spy.calls.length, 0);

    const row = csEvents.find((e) => e.id === "event-blocked")!;
    assert.equal(row.communication_status, "pending"); // still recoverable
    assert.equal(row.attempt_count, 0); // not consumed
    assert.equal(row.recipient_blocked_reason, "no_active_recipient");
    assert.ok(row.recipient_blocked_notified_at);
  });
});

test("ambiguous recipient (multiple active, no owner): blocked, never guessed", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [
        { id: "m1", operator_id: "op-1", role: "member", email: "a@example.com", full_name: "Alex A", status: "active" },
        { id: "m2", operator_id: "op-1", role: "member", email: "b@example.com", full_name: "Bailey B", status: "active" },
      ],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-ambiguous",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.recipientBlocked, 1);
    assert.equal(spy.calls.length, 0);
    const row = csEvents.find((e) => e.id === "event-ambiguous")!;
    assert.equal(row.recipient_blocked_reason, "ambiguous_recipient");
  });
});

test("recipient-blocked notification fires once for the same reason, not every run", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-repeat-block",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([]);
    await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    const firstNotifiedAt = csEvents.find((e) => e.id === "event-repeat-block")!.recipient_blocked_notified_at;

    // Second run, same unresolved reason — notified_at must not change.
    await processCustomerSuccessDeliveries(client as never, new Date(now.getTime() + 3_600_000), spy.fn);
    const secondNotifiedAt = csEvents.find((e) => e.id === "event-repeat-block")!.recipient_blocked_notified_at;

    assert.equal(firstNotifiedAt, secondNotifiedAt);
  });
});

test("recipient blocked can recover automatically once account data is fixed, without recreating the milestone", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, memberships, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-recovers",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const first = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(first.recipientBlocked, 1);
    // No delivery snapshot was locked — blocking happens strictly before
    // any claim/snapshot write (Correction Pass Section 2, "recipient-
    // blocked case").
    const blockedRow = csEvents.find((e) => e.id === "event-recovers")!;
    assert.equal(blockedRow.recipient_email, null);
    assert.equal(blockedRow.metadata_json, null);

    // Account data fixed — an active owner now exists for the same operator.
    memberships.push({ ...OWNER });

    const second = await processCustomerSuccessDeliveries(client as never, new Date(now.getTime() + 60_000), spy.fn);
    assert.equal(second.sent, 1);
    const row = csEvents.find((e) => e.id === "event-recovers")!;
    assert.equal(row.communication_status, "sent");
    assert.equal(row.recipient_blocked_reason, null);
    assert.equal(row.recipient_email, "kelly@example.com");
  });
});

// ── Duplicate protection ────────────────────────────────────────────────────

test("an event already claimed into 'processing' by another worker is not re-sent by a concurrent run", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-inflight",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "processing", // another worker's active claim
          processing_started_at: new Date(now.getTime() - 60_000).toISOString(), // not stale
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(spy.calls.length, 0, "a still-processing event must never be picked up by fetchDueEvents");
    assert.equal(result.staleRecovered, 0);
  });
});

test("re-running a completed pass does not resend an already-'sent' event", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-already-sent",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "sent",
          sent_at: now.toISOString(),
          recipient_email: "kelly@example.com",
          sent_notification_sent_at: now.toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(spy.calls.length, 0);
    assert.equal(result.sent, 0);
  });
});

// ── Stale-processing recovery ───────────────────────────────────────────────

test("a stale 'processing' claim (crashed worker) is recovered and resent with the SAME idempotency key", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const staleStart = new Date(now.getTime() - 20 * 60_000); // 20 min ago, > 15 min threshold
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-stale",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "processing",
          processing_started_at: staleStart.toISOString(),
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
          attempt_count: 1,
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.staleRecovered, 1);
    assert.equal(result.sent, 1);
    assert.equal(spy.calls[0].idempotencyKey, "hhc-customer-success:event-stale");

    const row = csEvents.find((e) => e.id === "event-stale")!;
    assert.equal(row.communication_status, "sent");
  });
});

// ── Kill switch (Correction Pass Section 1) ─────────────────────────────────
//
// Disabled must mean the WHOLE run is a no-op: no detection, no
// baseline/event creation, no next_attempt_at writes, no claiming, no
// stale-processing recovery, no Resend, no Slack, no state mutation of any
// kind — not merely "Resend is skipped but everything else still runs".

test("kill switch off: a pre-existing pending event is left completely untouched — no claim, no state change, no Resend", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", undefined, async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-disabled",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const before = { ...csEvents[0] };
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.enabled, false);
    assert.equal(result.detection, null);
    assert.equal(spy.calls.length, 0);
    // The row is byte-for-byte identical to before the run — no claim, no
    // snapshot lock, no attempt_count bump, nothing.
    assert.deepEqual(csEvents[0], before);
  });
});

test("an explicit 'false' value also keeps the kill switch off (only the literal string 'true' enables it)", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "false", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-false-flag",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);
    assert.equal(result.enabled, false);
    assert.equal(spy.calls.length, 0);
    assert.equal(csEvents[0].communication_status, "pending");
  });
});

test("Scenario 1 — initial deployment, disabled: a venue crossing milestones produces ZERO baselines/events while off", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", undefined, async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    // Fresh venue, never baselined, already well past several milestones —
    // exactly the "code/migrations deployed before delivery is enabled"
    // scenario: nothing about this venue has been seen by Customer Success yet.
    const { client, csEvents, csBaselines } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [],
      viewCounts: new Map([[VENUE.id, 300]]),
      csEvents: [],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.enabled, false);
    assert.equal(result.detection, null);
    // No detection ran at all — no baseline row, no event row, nothing.
    assert.equal(csBaselines.length, 0);
    assert.equal(csEvents.length, 0);
    assert.equal(spy.calls.length, 0);
  });
});

test("Scenario 2 — a previously-baselined venue disabled temporarily: re-enabling detects the newly crossed milestone normally (not as an immediate overdue send)", async () => {
  const { client, csEvents, csBaselines, viewCounts } = makeClient({
    venues: [VENUE],
    memberships: [OWNER],
    csBaselines: [baselineFor(VENUE.id)], // already running normally before the disable
    viewCounts: new Map([[VENUE.id, 100]]),
    csEvents: [],
  });
  const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);

  // Enabled run establishes the venue at 100 views as pending.
  const enabledBefore = await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", () =>
    processCustomerSuccessDeliveries(client as never, new Date("2026-01-05T15:00:00Z"), spy.fn)
  );
  assert.equal(enabledBefore.detection!.milestonesNewlyAchieved, 1);
  assert.equal(csBaselines.length, 1, "baseline established once, before the disable period");

  // Disabled period: venue crosses 250, but the switch is off — no
  // detection/state mutation happens, even though views have moved on.
  const duringDisabled = await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", undefined, async () => {
    viewCounts.set(VENUE.id, 250);
    return processCustomerSuccessDeliveries(client as never, new Date("2026-01-05T20:00:00Z"), spy.fn);
  });
  assert.equal(duringDisabled.enabled, false);
  assert.equal(duringDisabled.detection, null);
  assert.equal(
    csEvents.filter((e) => e.milestone_value === 250).length,
    0,
    "the 250 milestone must not be detected/recorded while disabled"
  );

  // Re-enabled: detection now runs for the first time since the venue hit
  // 250, and — because it's already baselined — 250 becomes the normal
  // newly-pending milestone (not treated as historical/superseded, and not
  // sent immediately as an "overdue" message).
  const reEnabledAt = new Date("2026-01-06T09:00:00Z");
  const reEnabled = await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", () =>
    processCustomerSuccessDeliveries(client as never, reEnabledAt, spy.fn)
  );
  assert.equal(reEnabled.detection!.milestonesNewlyAchieved, 1);
  assert.equal(csBaselines.length, 1, "still exactly one baseline — never re-baselined");

  const row250 = csEvents.find((e) => e.milestone_value === 250)!;
  assert.ok(row250, "250 becomes a normal pending milestone, not skipped");
  // Its schedule follows the normal next-business-day-3pm flow computed
  // from THIS detection's achieved_at (re-enable time), not an immediate
  // "overdue, send right now" instant.
  assert.equal(row250.communication_status, "pending");
  assert.equal(reEnabled.newlyScheduled, 1, "the newly-detected 250 milestone is scheduled on the SAME re-enable run");
  assert.ok(row250.next_attempt_at !== null, "next_attempt_at must be computed, not left null");
  assert.ok(
    new Date(row250.next_attempt_at!).getTime() > reEnabledAt.getTime(),
    "the scheduled send time must be in the future relative to re-enable time, not an immediate overdue fire"
  );
});

// ── Unresolvable venue timezone (Correction Pass Section 4) ────────────────

test("a venue with no resolvable market/timezone is blocked and Slack-visible, never silently defaulted to Pacific", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const venueNoMarket = { ...VENUE, market_id: null };
    const { client, csEvents } = createFakeDeliveryClient({
      // No `markets` seeded and the venue's own market_id is null —
      // resolveVenueTimeZone() must report unresolvable, not fall back.
      venues: [venueNoMarket],
      memberships: [OWNER],
      csBaselines: [baselineFor(venueNoMarket.id)],
      viewCounts: new Map([[venueNoMarket.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-no-timezone",
          venue_id: venueNoMarket.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: null, // never scheduled yet — exactly what triggers the timezone lookup
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.timezoneBlocked, 1);
    assert.equal(result.newlyScheduled, 0);
    assert.equal(spy.calls.length, 0, "must never call Resend for an unresolvable-timezone event");

    const row = csEvents.find((e) => e.id === "event-no-timezone")!;
    assert.equal(row.next_attempt_at, null, "never guessed a send time — stays unscheduled, not defaulted to Pacific 3pm");
    assert.equal(row.recipient_blocked_reason, "no_resolvable_timezone");
    assert.equal(row.communication_status, "pending", "recoverable — not failed, not superseded");
  });
});

test("an unresolvable-timezone block also only notifies Slack once, and recovers once the market is configured", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const venueNoMarket = { ...VENUE, market_id: null };
    const { client, venues, markets, csEvents } = createFakeDeliveryClient({
      venues: [venueNoMarket],
      markets: [], // deliberately empty — nothing to resolve against yet
      memberships: [OWNER],
      csBaselines: [baselineFor(venueNoMarket.id)],
      viewCounts: new Map([[venueNoMarket.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-tz-recovers",
          venue_id: venueNoMarket.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: null,
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);

    const first = await processCustomerSuccessDeliveries(client as never, new Date("2026-01-06T15:00:00Z"), spy.fn);
    assert.equal(first.timezoneBlocked, 1);
    const firstNotifiedAt = csEvents.find((e) => e.id === "event-tz-recovers")!.recipient_blocked_notified_at;
    assert.ok(firstNotifiedAt);

    const second = await processCustomerSuccessDeliveries(client as never, new Date("2026-01-06T16:00:00Z"), spy.fn);
    assert.equal(second.timezoneBlocked, 1);
    const secondNotifiedAt = csEvents.find((e) => e.id === "event-tz-recovers")!.recipient_blocked_notified_at;
    assert.equal(firstNotifiedAt, secondNotifiedAt, "not re-notified for the same unresolved reason");

    // Market gets configured for the venue (both the FK and the markets row).
    venues[0].market_id = MARKET.id;
    markets.push({ ...MARKET });

    const third = await processCustomerSuccessDeliveries(client as never, new Date("2026-01-06T17:00:00Z"), spy.fn);
    assert.equal(third.timezoneBlocked, 0);
    assert.equal(third.newlyScheduled, 1);
    const row = csEvents.find((e) => e.id === "event-tz-recovers")!;
    assert.equal(row.recipient_blocked_reason, null);
    assert.ok(row.next_attempt_at, "now resolvable — gets a real scheduled send time");
  });
});

// ── Sender / Reply-To (Correction Pass Section 5) ───────────────────────────

test("every sent email uses exactly the approved Wayne sender and reply-to — never any other value", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 100]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-sender-check",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          next_attempt_at: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].from, "Wayne <wayne@happyhourcompass.com>");
    assert.equal(spy.calls[0].replyTo, "wayne@happyhourcompass.com");
  });
});

// ── Milestone supersession interaction (detection runs before delivery) ────

test("a newly-crossed higher milestone supersedes a lower still-pending one BEFORE delivery ever attempts it", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 300]]), // now past 250, only 100 was previously recorded
      csEvents: [
        makeFakeCsEventRow({
          id: "event-100-will-be-superseded",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "pending",
          // Not yet due — proves supersession happens on detection, independent of due timing.
          next_attempt_at: new Date(now.getTime() + 3_600_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    const result = await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    assert.equal(result.detection!.pendingMilestonesSuperseded, 1);
    assert.equal(result.detection!.milestonesNewlyAchieved, 1);

    const oldRow = csEvents.find((e) => e.id === "event-100-will-be-superseded")!;
    assert.equal(oldRow.communication_status, "superseded");

    const newRow = csEvents.find((e) => e.milestone_value === 250)!;
    assert.equal(newRow.communication_status, "pending");

    // The superseded row must never be sent, this run or any future one.
    assert.equal(spy.calls.some((c) => c.subject.includes("100")), false);
  });
});

test("an already-'sent' milestone is never superseded/touched when a higher one is later crossed", async () => {
  await withEnv("CUSTOMER_SUCCESS_EMAILS_ENABLED", "true", async () => {
    const now = new Date("2026-01-06T15:00:00Z");
    const { client, csEvents } = makeClient({
      venues: [VENUE],
      memberships: [OWNER],
      csBaselines: [baselineFor(VENUE.id)],
      viewCounts: new Map([[VENUE.id, 300]]),
      csEvents: [
        makeFakeCsEventRow({
          id: "event-100-sent",
          venue_id: VENUE.id,
          operator_id: "op-1",
          milestone_value: 100,
          communication_status: "sent",
          sent_at: new Date(now.getTime() - 86_400_000).toISOString(),
          sent_notification_sent_at: new Date(now.getTime() - 86_400_000).toISOString(),
        }),
      ],
    });
    const spy = makeSendEmailSpy([{ ok: true, id: "r1" }]);
    await processCustomerSuccessDeliveries(client as never, now, spy.fn);

    const oldRow = csEvents.find((e) => e.id === "event-100-sent")!;
    assert.equal(oldRow.communication_status, "sent"); // untouched
  });
});
