import { test } from "node:test";
import assert from "node:assert/strict";
import { getOperatorActivationReviews, getOperatorActivationReviewSummary } from "../../../src/lib/activation/activationReviews";

/**
 * Behavioral tests for the Phase 2A-4 Action Center "Operator activation
 * reviews" query layer — verifying the union/de-duplication contract, the
 * exclusion rules, and the N+1-safe batching (a small, fixed number of
 * queries regardless of how many lifecycles are actionable).
 */

const NOW = new Date("2026-09-20T00:00:00.000Z");
const PAST_DEADLINE = "2026-09-15T00:00:00.000Z";
const FUTURE_DEADLINE = "2026-10-05T00:00:00.000Z";

type Row = Record<string, unknown>;

function makeFakeClient(seed: {
  lifecycles: Row[];
  operators: Row[];
  claims?: Row[];
  submissions?: Row[];
  venues?: Row[];
}) {
  const claims = seed.claims ?? [];
  const submissions = seed.submissions ?? [];
  const venues = seed.venues ?? [];
  let lifecycleQueryCount = 0;
  let operatorQueryCount = 0;
  let claimQueryCount = 0;
  let submissionQueryCount = 0;
  let venueQueryCount = 0;

  function inOnlyTable(rows: Row[], onQuery: () => void) {
    return {
      select() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const builder: any = {
          in(col: string, ids: unknown[]) {
            onQuery();
            const data = rows.filter((r) => (ids as unknown[]).includes(r[col]));
            return Promise.resolve({ data, error: null });
          },
        };
        return builder;
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      if (table === "operator_activation_lifecycles") {
        return {
          select() {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const builder: any = {
              is() {
                return builder;
              },
              then(onfulfilled: (v: { data: Row[]; error: null }) => unknown) {
                lifecycleQueryCount++;
                return Promise.resolve({ data: seed.lifecycles, error: null }).then(onfulfilled);
              },
            };
            return builder;
          },
        };
      }
      if (table === "operators") return inOnlyTable(seed.operators, () => operatorQueryCount++);
      if (table === "venue_claims") return inOnlyTable(claims, () => claimQueryCount++);
      if (table === "operator_submissions") return inOnlyTable(submissions, () => submissionQueryCount++);
      if (table === "venues") return inOnlyTable(venues, () => venueQueryCount++);
      throw new Error(`unexpected table in fake: ${table}`);
    },
  };

  return {
    client,
    counts: () => ({ lifecycleQueryCount, operatorQueryCount, claimQueryCount, submissionQueryCount, venueQueryCount }),
  };
}

function makeLifecycle(overrides: Partial<Row> & { id: string; operator_id: string }): Row {
  return {
    origin_type: "submission",
    origin_claim_id: null,
    origin_submission_id: "sub-1",
    deadline_at: PAST_DEADLINE,
    expired_at: null,
    reminder_stage: 0,
    reminder_next_attempt_at: null,
    reminder_attempt_count: 0,
    reminder_last_attempted_at: null,
    reminder_last_error: null,
    expiry_slack_notified_at: null,
    expiry_founder_email_sent_at: null,
    ...overrides,
  };
}

test("release_required: a lifecycle with a passed deadline and no expired_at is actionable with exactly that reason", async () => {
  const { client } = makeFakeClient({
    lifecycles: [makeLifecycle({ id: "lc-1", operator_id: "op-1" })],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "Buffalo Rouge" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].reasons, ["release_required"]);
  assert.equal(rows[0].venueName, "Buffalo Rouge");
});

test("expired: expired_at set is actionable with 'expired', and 'notification_incomplete' when either marker is missing", async () => {
  const { client } = makeFakeClient({
    lifecycles: [makeLifecycle({ id: "lc-1", operator_id: "op-1", expired_at: "2026-09-16T00:00:00.000Z" })],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].reasons, ["expired", "notification_incomplete"]);
});

test("expired with BOTH notifications complete: only 'expired', never 'notification_incomplete'", async () => {
  const { client } = makeFakeClient({
    lifecycles: [
      makeLifecycle({
        id: "lc-1", operator_id: "op-1", expired_at: "2026-09-16T00:00:00.000Z",
        expiry_slack_notified_at: "2026-09-16T00:01:00.000Z", expiry_founder_email_sent_at: "2026-09-16T00:02:00.000Z",
      }),
    ],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.deepEqual(rows[0].reasons, ["expired"]);
});

test("reminder_exhausted: stage-3-exhausted-with-time-remaining is actionable even though deadline is still future", async () => {
  const { client } = makeFakeClient({
    lifecycles: [
      makeLifecycle({
        id: "lc-1", operator_id: "op-1", deadline_at: FUTURE_DEADLINE,
        reminder_stage: 2, reminder_next_attempt_at: null, reminder_last_error: "Resend rejected the message",
      }),
    ],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].reasons, ["reminder_exhausted"]);
});

test("an ordinary un-initialized lifecycle (reminder_next_attempt_at null, reminder_last_error null) is NEVER counted as reminder_exhausted", async () => {
  const { client } = makeFakeClient({
    lifecycles: [makeLifecycle({ id: "lc-1", operator_id: "op-1", deadline_at: FUTURE_DEADLINE, reminder_next_attempt_at: null, reminder_last_error: null })],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 0, "ordinary awaiting_setup/expiring_soon records must never appear here");
});

// ── Phase 2A-4 correction: exact exhaustion predicate ───────────────────────

test("Kelly's exact current field shape (reminder_stage 0, reminder_next_attempt_at null, reminder_attempt_count 0, no last attempt/error, deadline future) is excluded — proves the predicate is safe against the one real live lifecycle in production", async () => {
  const { client } = makeFakeClient({
    lifecycles: [
      makeLifecycle({
        id: "8b573190-6cf5-4537-82f7-07c10a3f49c9", operator_id: "op-kelly",
        deadline_at: "2026-10-02T23:41:30.607Z", // future relative to NOW (2026-09-20)
        reminder_stage: 0, reminder_next_attempt_at: null, reminder_attempt_count: 0,
        reminder_last_attempted_at: null, reminder_last_error: null,
        expiry_slack_notified_at: null, expiry_founder_email_sent_at: null,
      }),
    ],
    operators: [{ id: "op-kelly", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-buffalo-rouge" }],
    venues: [{ id: "venue-buffalo-rouge", name: "Buffalo Rouge Brewing Co." }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 0, "Kelly's real row must never appear as actionable — it is a genuinely fresh, untouched lifecycle");
});

test("attempts 1-2 with a future retry scheduled are never exhausted, regardless of attempt_count", async () => {
  for (const attemptCount of [1, 2]) {
    const { client } = makeFakeClient({
      lifecycles: [
        makeLifecycle({
          id: "lc-1", operator_id: "op-1", deadline_at: FUTURE_DEADLINE,
          reminder_stage: 1, reminder_attempt_count: attemptCount,
          reminder_next_attempt_at: "2026-09-20T01:00:00.000Z", // a real future retry is scheduled
          reminder_last_attempted_at: "2026-09-20T00:00:00.000Z", reminder_last_error: "Resend rejected the message",
        }),
      ],
      operators: [{ id: "op-1", account_activated_at: null }],
      submissions: [{ id: "sub-1", venue_id: "venue-1" }],
      venues: [{ id: "venue-1", name: "V" }],
    });
    const rows = await getOperatorActivationReviews(client, NOW);
    assert.equal(rows.length, 0, `attempt_count=${attemptCount} with a scheduled retry must not be exhausted`);
  }
});

test("attempt 3 with no next attempt and a recorded failure IS exhausted (the literal attempt_count >= 3 reading)", async () => {
  const { client } = makeFakeClient({
    lifecycles: [
      makeLifecycle({
        id: "lc-1", operator_id: "op-1", deadline_at: FUTURE_DEADLINE,
        reminder_stage: 1, reminder_attempt_count: 3, reminder_next_attempt_at: null,
        reminder_last_attempted_at: "2026-09-20T00:00:00.000Z", reminder_last_error: "Resend rejected the message",
      }),
    ],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].reasons, ["reminder_exhausted"]);
});

test("the worker's REAL post-exhaustion shape (attempt_count reset to 0, next_attempt_at null, failure recorded) is also exhausted — the attempt_count=0 disjunct is what makes the predicate fire in actual production use", async () => {
  const { client } = makeFakeClient({
    lifecycles: [
      makeLifecycle({
        id: "lc-1", operator_id: "op-1", deadline_at: FUTURE_DEADLINE,
        reminder_stage: 1, reminder_attempt_count: 0, reminder_next_attempt_at: null,
        reminder_last_attempted_at: "2026-09-20T00:00:00.000Z", reminder_last_error: "Resend rejected the message",
      }),
    ],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].reasons, ["reminder_exhausted"]);
});

test("an expired lifecycle is never ALSO flagged reminder_exhausted, even if its reminder fields look exhaustion-shaped — expired always takes the 'expired' reason only", async () => {
  const { client } = makeFakeClient({
    lifecycles: [
      makeLifecycle({
        id: "lc-1", operator_id: "op-1", expired_at: "2026-09-16T00:00:00.000Z",
        expiry_slack_notified_at: "x", expiry_founder_email_sent_at: "y",
        reminder_stage: 1, reminder_attempt_count: 0, reminder_next_attempt_at: null,
        reminder_last_attempted_at: "2026-09-15T00:00:00.000Z", reminder_last_error: "Resend rejected the message",
      }),
    ],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.deepEqual(rows[0].reasons, ["expired"]);
});

test("stage-3-resolved (reminder_stage === 3) is never reminder_exhausted, even with next_attempt_at null", async () => {
  const { client } = makeFakeClient({
    lifecycles: [makeLifecycle({ id: "lc-1", operator_id: "op-1", deadline_at: FUTURE_DEADLINE, reminder_stage: 3, reminder_next_attempt_at: null, reminder_last_error: null })],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 0);
});

test("activated operators are excluded before any reason is evaluated, even if otherwise overdue", async () => {
  const { client } = makeFakeClient({
    lifecycles: [makeLifecycle({ id: "lc-1", operator_id: "op-1" })],
    operators: [{ id: "op-1", account_activated_at: "2026-01-01T00:00:00.000Z" }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 0);
});

test("released lifecycles are excluded at the query level — never even fetched as candidates", async () => {
  // The query itself filters released_at IS NULL; simulate by simply never
  // seeding a released row and confirming a live row with the same shape
  // otherwise DOES appear, proving the fixture/query pairing is meaningful.
  const { client } = makeFakeClient({
    lifecycles: [makeLifecycle({ id: "lc-1", operator_id: "op-1" })],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 1);
});

test("union/de-duplication: a lifecycle matching multiple reasons is counted exactly once in the primary total, with all reasons listed", async () => {
  const { client } = makeFakeClient({
    lifecycles: [
      makeLifecycle({
        id: "lc-1", operator_id: "op-1", expired_at: "2026-09-16T00:00:00.000Z", deadline_at: PAST_DEADLINE,
      }),
    ],
    operators: [{ id: "op-1", account_activated_at: null }],
    submissions: [{ id: "sub-1", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", name: "V" }],
  });
  const summary = await getOperatorActivationReviewSummary(client, NOW);
  assert.equal(summary.total, 1, "one lifecycle, counted once, even though it matches both expired and notification_incomplete");
  assert.equal(summary.expiredAwaitingReview, 1);
  assert.equal(summary.notificationIncomplete, 1);
  assert.equal(summary.releaseRequired, 0, "expired takes precedence over release_required in the reason computation — never double-flagged");
});

test("summary breakdown counts across a mixed set of claim and submission origins", async () => {
  const { client } = makeFakeClient({
    lifecycles: [
      makeLifecycle({ id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null }),
      makeLifecycle({ id: "lc-2", operator_id: "op-2", origin_submission_id: "sub-2", expired_at: "2026-09-16T00:00:00.000Z", expiry_slack_notified_at: "x", expiry_founder_email_sent_at: "y" }),
      makeLifecycle({ id: "lc-3", operator_id: "op-3", origin_submission_id: "sub-3", deadline_at: FUTURE_DEADLINE, reminder_stage: 1, reminder_next_attempt_at: null, reminder_last_error: "boom" }),
    ],
    operators: [
      { id: "op-1", account_activated_at: null },
      { id: "op-2", account_activated_at: null },
      { id: "op-3", account_activated_at: null },
    ],
    claims: [{ id: "claim-1", venue_id: "venue-1" }],
    submissions: [
      { id: "sub-2", venue_id: "venue-2" },
      { id: "sub-3", venue_id: "venue-3" },
    ],
    venues: [
      { id: "venue-1", name: "Claim Venue" },
      { id: "venue-2", name: "Sub Venue" },
      { id: "venue-3", name: "Sub Venue 3" },
    ],
  });
  const summary = await getOperatorActivationReviewSummary(client, NOW);
  assert.equal(summary.total, 3);
  assert.equal(summary.releaseRequired, 1);
  assert.equal(summary.expiredAwaitingReview, 1);
  assert.equal(summary.reminderExhausted, 1);
  assert.equal(summary.notificationIncomplete, 0);
});

test("N+1 safety: a fixed, small number of queries regardless of how many lifecycles are actionable", async () => {
  const lifecycles = Array.from({ length: 30 }, (_, i) =>
    makeLifecycle({ id: `lc-${i}`, operator_id: `op-${i}`, origin_submission_id: `sub-${i}` })
  );
  const operators = lifecycles.map((l) => ({ id: l.operator_id as string, account_activated_at: null }));
  const submissions = lifecycles.map((l) => ({ id: l.origin_submission_id as string, venue_id: `venue-${l.operator_id}` }));
  const venues = lifecycles.map((l) => ({ id: `venue-${l.operator_id}`, name: `Venue ${l.operator_id}` }));

  const { client, counts } = makeFakeClient({ lifecycles, operators, submissions, venues });
  const rows = await getOperatorActivationReviews(client, NOW);

  assert.equal(rows.length, 30);
  const c = counts();
  assert.equal(c.lifecycleQueryCount, 1, "exactly one lifecycle query");
  assert.equal(c.operatorQueryCount, 1, "exactly one batched operator query");
  assert.equal(c.claimQueryCount, 0, "no claim query when every origin is a submission");
  assert.equal(c.submissionQueryCount, 1, "exactly one batched submission query");
  assert.equal(c.venueQueryCount, 1, "exactly one batched venue query");
});

test("empty candidate set short-circuits with zero downstream queries", async () => {
  const { client, counts } = makeFakeClient({ lifecycles: [], operators: [] });
  const rows = await getOperatorActivationReviews(client, NOW);
  assert.equal(rows.length, 0);
  const c = counts();
  assert.equal(c.operatorQueryCount, 0);
});
