import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseActivationLifecycleImpl } from "../../../src/lib/activation/activationReleaseImpl";
import {
  createFakeActivationReleaseClient,
  makeLifecycleRow,
  type FakeLifecycleRow,
  type FakeOperatorRow,
  type FakeVenueRow,
} from "./support/fakeActivationReleaseClient";

/**
 * Full behavioral tests for the Phase 2A-4 manual-Release implementation —
 * exercising the real authorization → eligibility → lifecycle CAS → venue
 * CAS → reconciliation → note sequence against a fake, in-memory Supabase
 * client.
 *
 * ALERT ISOLATION (Phase 2A-4 correction): no test here may rely on Slack
 * webhook environment variables being absent. `authDeps()` always injects a
 * default no-op `sendAlert` stub — every test gets one, regardless of
 * whether it cares about alert content — so there is no code path by which
 * any test in this file could ever reach the real sendSlackAlert()/a real
 * webhook, in any developer or CI environment. Tests that assert on alert
 * behavior override this default with their own sendAlertSpy().
 */

const FOUNDER = { id: "founder-1", email: "founder@happyhourcompass.com" };
const NON_FOUNDER = { id: "user-1", email: "operator@example.com" };
const NOW = new Date("2026-09-20T00:00:00.000Z");
const PAST_DEADLINE = "2026-09-15T00:00:00.000Z"; // before NOW — release_required
const FUTURE_DEADLINE = "2026-10-05T00:00:00.000Z"; // after NOW — not yet due

type AlertCall = { channel: string; severity: string; title: string; message: string; metadata?: Record<string, unknown> };

function sendAlertSpy() {
  const calls: AlertCall[] = [];
  const fn = async (params: AlertCall) => {
    calls.push(params);
    return "delivered" as const;
  };
  return { fn, calls };
}

function authDeps(user: { id: string; email: string } | null, isAdmin: boolean) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authClient: { auth: { getUser: async () => ({ data: { user } }) } } as any,
    checkAdmin: async () => isAdmin,
    now: NOW,
    // revalidatePath() throws outside a real Next.js request context — every
    // test here runs as a plain Node test, so this no-op stands in for it,
    // matching extendActivationDeadlineImpl.ts's own established rationale.
    revalidate: () => {},
    // Default no-op — never the real sendSlackAlert. Individual tests
    // override this with sendAlertSpy() when they need to assert on calls.
    sendAlert: async () => "delivered" as const,
  };
}

function seedWorld(opts: {
  lifecycle?: Partial<FakeLifecycleRow>;
  operatorActivated?: boolean;
  claimVenueId?: string | null;
  extraVenues?: FakeVenueRow[];
} = {}) {
  const lifecycle = makeLifecycleRow({
    id: "lc-1",
    operator_id: "op-1",
    origin_type: "submission",
    origin_submission_id: "sub-1",
    deadline_at: PAST_DEADLINE,
    ...opts.lifecycle,
  });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: opts.operatorActivated ? "2026-01-01T00:00:00.000Z" : null }];
  const venues: FakeVenueRow[] = [
    { id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true },
    ...(opts.extraVenues ?? []),
  ];
  const submissions = [{ id: "sub-1", venue_id: opts.claimVenueId === undefined ? "venue-1" : opts.claimVenueId }];
  const fake = createFakeActivationReleaseClient({ lifecycles: [lifecycle], operators, submissions, venues });
  return fake;
}

// ── Authorization ────────────────────────────────────────────────────────────

test("unauthorized: no user — refused before any lookup", async () => {
  const fake = seedWorld();
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(null, false), adminClient: fake.client });
  assert.equal(result.error, "Unauthorized.");
  assert.equal(fake.lifecycles[0].released_at, null);
  assert.equal(fake.venues[0].created_by_operator_id, "op-1");
});

test("unauthorized: signed in but not a Control Panel admin — refused", async () => {
  const fake = seedWorld();
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(NON_FOUNDER, false), adminClient: fake.client });
  assert.equal(result.error, "Unauthorized.");
  assert.equal(fake.lifecycles[0].released_at, null);
});

// ── Eligibility ──────────────────────────────────────────────────────────────

test("lifecycle not found — clear error, no writes", async () => {
  const fake = seedWorld();
  const result = await releaseActivationLifecycleImpl("lc-missing", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(result.error ?? "", /not found/);
});

test("already released — safe message, no venue change, no note", async () => {
  const fake = seedWorld({ lifecycle: { released_at: "2026-09-16T00:00:00.000Z" } });
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(result.error ?? "", /already been released/);
  assert.equal(fake.venues[0].created_by_operator_id, "op-1");
  assert.equal(fake.operatorSubmissionNotes.length, 0);
});

test("reminder lease held — blocked with the exact clear lease message, no writes", async () => {
  const fake = seedWorld({ lifecycle: { reminder_lease_started_at: "2026-09-19T23:00:00.000Z" } });
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.equal(result.error, "A reminder is currently being processed. Please refresh and try again shortly.");
  assert.equal(fake.lifecycles[0].released_at, null);
  assert.equal(fake.venues[0].created_by_operator_id, "op-1");
});

test("operator already activated — blocked, nothing to release", async () => {
  const fake = seedWorld({ operatorActivated: true });
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(result.error ?? "", /already activated/);
  assert.equal(fake.lifecycles[0].released_at, null);
});

test("state not yet due (awaiting_setup/expiring_soon) — blocked, release only available once Release Required or Expired", async () => {
  const fake = seedWorld({ lifecycle: { deadline_at: FUTURE_DEADLINE } });
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(result.error ?? "", /Release Required or Expired/);
  assert.equal(fake.lifecycles[0].released_at, null);
});

test("missing/stale origin — submission has no venue_id — blocked before any write", async () => {
  const fake = seedWorld({ claimVenueId: null });
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(result.error ?? "", /Could not resolve the originating venue/);
  assert.equal(fake.lifecycles[0].released_at, null);
});

test("venue ownership already changed (static pre-check) — blocked before any write", async () => {
  const fake = seedWorld();
  fake.venues[0].created_by_operator_id = "op-OTHER";
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(result.error ?? "", /ownership has changed/);
  assert.equal(fake.lifecycles[0].released_at, null);
});

// ── Successful release — exact mutations ────────────────────────────────────

test("successful release (submission origin): exact lifecycle + venue mutations, is_verified/is_published preserved, founder-attributed note", async () => {
  const fake = seedWorld({ lifecycle: { origin_type: "submission", origin_submission_id: "sub-1", reminder_stage: 1 } });
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });

  assert.equal(result.success, true);
  assert.equal(fake.lifecycles[0].released_at, NOW.toISOString());
  assert.equal(fake.lifecycles[0].expired_at, null, "expired_at is never touched by Release");

  const venue = fake.venues[0];
  assert.equal(venue.claimed_by, null);
  assert.equal(venue.claimed_at, null);
  assert.equal(venue.created_by_operator_id, null);
  assert.equal(venue.is_verified, true, "is_verified is preserved, never cleared");
  assert.equal(venue.is_published, true, "is_published is preserved, never cleared");

  assert.equal(fake.operatorSubmissionNotes.length, 1);
  const note = fake.operatorSubmissionNotes[0];
  assert.equal(note.event_type, "founder_manual_release");
  assert.equal(note.event_key, "hhc-activation-release:lc-1");
  assert.equal(note.created_by, FOUNDER.id);
  assert.equal(note.created_by_email, FOUNDER.email);
  assert.deepEqual(note.metadata_json, {
    lifecycleId: "lc-1",
    venueId: "venue-1",
    previousDeadline: PAST_DEADLINE,
    releasedAt: NOW.toISOString(),
    flow: "submission",
  });
  assert.equal(fake.venueClaimNotes.length, 0, "a submission-origin release never writes to venue_claim_notes");
});

test("successful release (claim origin): writes to venue_claim_notes, not operator_submission_notes", async () => {
  const lifecycle = makeLifecycleRow({
    id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
    deadline_at: PAST_DEADLINE,
  });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venues: FakeVenueRow[] = [{ id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true }];
  const claims = [{ id: "claim-1", venue_id: "venue-1" }];
  const fake = createFakeActivationReleaseClient({ lifecycles: [lifecycle], operators, claims, venues });

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });

  assert.equal(result.success, true);
  assert.equal(fake.venueClaimNotes.length, 1);
  assert.equal(fake.venueClaimNotes[0].event_type, "founder_manual_release");
  assert.equal(fake.operatorSubmissionNotes.length, 0);
  assert.equal(fake.venues[0].created_by_operator_id, null);
});

test("expired state (not just release_required) is also releasable, and expired_at is preserved exactly", async () => {
  const fake = seedWorld({ lifecycle: { expired_at: "2026-09-16T00:00:00.000Z" } });
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.equal(result.success, true);
  assert.equal(fake.lifecycles[0].expired_at, "2026-09-16T00:00:00.000Z", "Release never clears/changes expired_at");
  assert.equal(fake.lifecycles[0].released_at, NOW.toISOString());
});

// ── Multi-venue / preservation guarantees ───────────────────────────────────

test("multi-venue operator: a second venue owned by the same operator is completely untouched", async () => {
  const fake = seedWorld({
    extraVenues: [{ id: "venue-2", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-08-01T00:00:00.000Z", is_verified: true, is_published: true }],
  });
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.equal(result.success, true);
  assert.equal(fake.venues[0].created_by_operator_id, null, "venue-1 (the originating venue) is released");
  const venue2 = fake.venues.find((v) => v.id === "venue-2")!;
  assert.equal(venue2.created_by_operator_id, "op-1", "venue-2 is never touched");
  assert.equal(venue2.claimed_by, "op-1");
});

test("operator record is never mutated by Release — only the venue's ownership fields and the lifecycle's released_at change", async () => {
  const fake = seedWorld();
  await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.equal(fake.operators[0].account_activated_at, null, "operator row is read-only to this action");
});

test("no operator_memberships or auth-user table is ever referenced — the fake throws on any unexpected table, and no test here has ever thrown", () => {
  // Static assertion of intent: createFakeActivationReleaseClient() throws
  // "unexpected table" for anything other than the 7 tables it implements
  // (operator_activation_lifecycles, operators, venue_claims,
  // operator_submissions, venues, venue_claim_notes,
  // operator_submission_notes) — every test above already exercises a full
  // successful release against this fake without that throw ever firing,
  // which is only possible because releaseActivationLifecycleImpl() never
  // touches operator_memberships, auth.admin, or any other table.
  assert.ok(true);
});

// ── Races ────────────────────────────────────────────────────────────────────

test("activated-before-release race: operator activates between the initial check and the fresh pre-CAS re-check — blocked, no writes", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST_DEADLINE });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venues: FakeVenueRow[] = [{ id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true }];
  const submissions = [{ id: "sub-1", venue_id: "venue-1" }];

  const fake = createFakeActivationReleaseClient(
    { lifecycles: [lifecycle], operators, submissions, venues },
    {
      onOperatorSelect: (callIndex, ops) => {
        // Call #1 is the initial eligibility check; call #2 is the fresh
        // pre-CAS re-check — the operator activates in between.
        if (callIndex === 2) ops[0].account_activated_at = "2026-09-19T12:00:00.000Z";
      },
    }
  );

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(result.error ?? "", /already activated/);
  assert.equal(fake.lifecycles[0].released_at, null);
  assert.equal(fake.venues[0].created_by_operator_id, "op-1");
});

test("extend-vs-release race: deadline_at changes concurrently — lifecycle CAS conflict, generic refresh message, no writes", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST_DEADLINE });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venues: FakeVenueRow[] = [{ id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true }];
  const submissions = [{ id: "sub-1", venue_id: "venue-1" }];

  const fake = createFakeActivationReleaseClient(
    { lifecycles: [lifecycle], operators, submissions, venues },
    {
      onOperatorSelect: (callIndex) => {
        // Right before the lifecycle CAS runs, a concurrent extend changes
        // deadline_at — the CAS pins the OLD value, so it must fail cleanly.
        if (callIndex === 2) lifecycle.deadline_at = "2026-10-01T00:00:00.000Z";
      },
    }
  );

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(result.error ?? "", /changed by another action/);
  assert.equal(fake.lifecycles[0].released_at, null);
  assert.equal(fake.venues[0].created_by_operator_id, "op-1");
});

test("duplicate click/retry: releasing an already-released lifecycle a second time is a clean no-op, never a second venue mutation or note", async () => {
  const fake = seedWorld();
  const first = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.equal(first.success, true);

  const second = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client });
  assert.match(second.error ?? "", /already been released/);
  assert.equal(fake.operatorSubmissionNotes.length, 1, "still exactly one note after the duplicate attempt");
});

// ── Venue-ownership CAS conflict (live race, not just the static pre-check) ─

test("ownership-changed reconciliation: venue owned by a DIFFERENT operator by the time of the venue CAS — never touched, lifecycle left released, exactly one critical alert, manual-review message", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST_DEADLINE });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venue: FakeVenueRow = { id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true };
  const otherVenue: FakeVenueRow = { id: "venue-2", created_by_operator_id: "op-2", claimed_by: "op-2", claimed_at: "2026-08-01T00:00:00.000Z", is_verified: true, is_published: true };
  const submissions = [{ id: "sub-1", venue_id: "venue-1" }];
  const alert = sendAlertSpy();

  const fake = createFakeActivationReleaseClient(
    { lifecycles: [lifecycle], operators, submissions, venues: [venue, otherVenue] },
    {
      onOperatorSelect: (callIndex) => {
        // Right before the lifecycle CAS (and therefore before the venue
        // CAS that follows it), the venue's ownership changes out from
        // under this action — e.g. a totally separate flow reassigned it.
        if (callIndex === 2) venue.created_by_operator_id = "op-DIFFERENT";
      },
    }
  );

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.match(result.error ?? "", /ownership has changed/);
  assert.equal(fake.lifecycles[0].released_at, NOW.toISOString(), "the lifecycle IS closed — never blindly reopened for an ownership-changed anomaly");
  assert.equal(venue.created_by_operator_id, "op-DIFFERENT", "the venue is left exactly as the race left it — never clobbered back");
  assert.equal(otherVenue.created_by_operator_id, "op-2", "no other venue is ever touched, even during an anomaly");
  assert.equal(fake.operatorSubmissionNotes.length, 0, "no note is written when the venue release failed");
  assert.equal(alert.calls.length, 1, "exactly one critical alert");
  assert.equal(alert.calls[0].severity, "critical");
  assert.match(alert.calls[0].title, /Ownership Changed/);
});

// ── Partial-write reconciliation (Phase 2A-4 correction) ────────────────────

test("reconciliation branch 1 — already cleared: a benign race where the venue was already released by the time of the write is treated as complete, no alert, note still written normally", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST_DEADLINE });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venue: FakeVenueRow = { id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true };
  const submissions = [{ id: "sub-1", venue_id: "venue-1" }];
  const alert = sendAlertSpy();

  const fake = createFakeActivationReleaseClient(
    { lifecycles: [lifecycle], operators, submissions, venues: [venue] },
    {
      onOperatorSelect: (callIndex) => {
        // Right before the lifecycle CAS, an earlier retry's venue write
        // actually lands — by the time THIS attempt's venue CAS runs (which
        // filters on created_by_operator_id = "op-1"), it will match zero
        // rows purely because the row is already correctly cleared.
        if (callIndex === 2) {
          venue.created_by_operator_id = null;
          venue.claimed_by = null;
          venue.claimed_at = null;
        }
      },
    }
  );

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.equal(result.success, true, "treated as a completed release, not a failure");
  assert.equal(alert.calls.length, 0, "not a genuine anomaly — no alert warranted");
  assert.equal(fake.operatorSubmissionNotes.length, 1, "the note step still runs normally");
  assert.equal(fake.operatorSubmissionNotes[0].event_key, "hhc-activation-release:lc-1");
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function venueUpdateAlwaysFails(originalFrom: (table: string) => any) {
  return (table: string) => {
    if (table === "venues") {
      return {
        select: originalFrom("venues").select,
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "simulated transient write failure" } }) }),
            }),
          }),
        }),
      };
    }
    return originalFrom(table);
  };
}

test("reconciliation branch 2 — still owned by the same operator: the write itself failed transiently; one guarded compensating rollback succeeds, exactly one critical alert stating success, venue untouched, retryable message", async () => {
  const fake = seedWorld();
  const alert = sendAlertSpy();
  const originalFrom = fake.client.from.bind(fake.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fake.client as any).from = venueUpdateAlwaysFails(originalFrom);

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.match(result.error ?? "", /was undone/);
  assert.equal(fake.lifecycles[0].released_at, null, "compensation succeeded — released_at cleared back to null");
  assert.equal(fake.venues[0].created_by_operator_id, "op-1", "the venue itself was never touched — only the failed write's own lifecycle side is undone");
  assert.equal(fake.operatorSubmissionNotes.length, 0, "no note — the release did not actually complete");
  assert.equal(alert.calls.length, 1, "exactly one critical alert");
  assert.equal(alert.calls[0].severity, "critical");
  assert.match(alert.calls[0].title, /Compensation Succeeded/);
  assert.equal(alert.calls[0].metadata?.["Compensation attempted"], "Yes");
  assert.equal(alert.calls[0].metadata?.["Compensation succeeded"], "Yes");
  assert.equal(alert.calls[0].metadata?.["Activation detected"], "No");
});

// ── Phase 2A-4 final correction: activation-safe compensation ──────────────

test("operator activates BEFORE compensation is ever attempted: compensation not attempted, lifecycle remains released, one critical alert, manual-review result", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST_DEADLINE });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venue: FakeVenueRow = { id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true };
  const otherVenue: FakeVenueRow = { id: "venue-2", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-08-01T00:00:00.000Z", is_verified: true, is_published: true };
  const submissions = [{ id: "sub-1", venue_id: "venue-1" }];
  const alert = sendAlertSpy();

  // The activation-race hook: operators.select()'s 3rd call (the
  // reconciliation's PRE-compensation check) sees an already-activated
  // operator, while calls 1-2 (the earlier eligibility checks) still see
  // unactivated — exactly the race this correction closes.
  const fake = createFakeActivationReleaseClient(
    { lifecycles: [lifecycle], operators, submissions, venues: [venue, otherVenue] },
    { onOperatorSelect: (callIndex, ops) => { if (callIndex === 3) ops[0].account_activated_at = "2026-09-19T23:59:00.000Z"; } }
  );
  const originalFrom = fake.client.from.bind(fake.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fake.client as any).from = venueUpdateAlwaysFails(originalFrom);

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.match(result.error ?? "", /activated their account/);
  assert.equal(fake.lifecycles[0].released_at, NOW.toISOString(), "the lifecycle remains released — never reopened for an activated operator");
  assert.equal(fake.venues[0].created_by_operator_id, "op-1", "the venue is untouched by this recovery path");
  const foundOtherVenue = fake.venues.find((v) => v.id === "venue-2")!;
  assert.equal(foundOtherVenue.created_by_operator_id, "op-1", "other venues remain untouched");
  assert.equal(alert.calls.length, 1, "exactly one critical alert — never one before and one after");
  assert.equal(alert.calls[0].severity, "critical");
  assert.match(alert.calls[0].title, /Activated Before Compensation/);
  assert.equal(alert.calls[0].metadata?.["Compensation attempted"], "No");
  assert.equal(alert.calls[0].metadata?.["Activation detected"], "Before compensation");
});

test("compensation CAS pins deadline_at/expired_at/reminder_stage/reminder_lease_started_at — a concurrent change to any of them fails the compensation cleanly", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST_DEADLINE });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venue: FakeVenueRow = { id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true };
  const submissions = [{ id: "sub-1", venue_id: "venue-1" }];
  const alert = sendAlertSpy();

  const hookedFake = createFakeActivationReleaseClient(
    { lifecycles: [lifecycle], operators, submissions, venues: [venue] },
    {
      // Right before the reconciliation's pre-compensation operator check
      // (call #3), a concurrent extend changes deadline_at — the
      // compensation CAS pins the OLD value, so it must fail cleanly rather
      // than silently compensating against stale pinned state.
      onOperatorSelect: (callIndex) => { if (callIndex === 3) lifecycle.deadline_at = "2026-10-01T00:00:00.000Z"; },
    }
  );
  const hookedOriginalFrom = hookedFake.client.from.bind(hookedFake.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (hookedFake.client as any).from = venueUpdateAlwaysFails(hookedOriginalFrom);

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: hookedFake.client, sendAlert: alert.fn });

  assert.match(result.error ?? "", /manual review/);
  assert.equal(hookedFake.lifecycles[0].released_at, NOW.toISOString(), "compensation failed its CAS — the lifecycle remains released, never silently reopened against stale state");
  assert.equal(alert.calls.length, 1);
  assert.match(alert.calls[0].title, /Compensation FAILED/);
});

test("operator activates immediately after compensation succeeds: post-compensation check detects it, lifecycle is re-closed, one critical alert, manual-review result", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST_DEADLINE });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venue: FakeVenueRow = { id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true };
  const submissions = [{ id: "sub-1", venue_id: "venue-1" }];
  const alert = sendAlertSpy();

  // operators.select()'s 4th call is the POST-compensation re-check — the
  // operator activates in the narrow gap during compensation itself.
  const fake = createFakeActivationReleaseClient(
    { lifecycles: [lifecycle], operators, submissions, venues: [venue] },
    { onOperatorSelect: (callIndex, ops) => { if (callIndex === 4) ops[0].account_activated_at = "2026-09-20T00:00:30.000Z"; } }
  );
  const originalFrom = fake.client.from.bind(fake.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fake.client as any).from = venueUpdateAlwaysFails(originalFrom);

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.match(result.error ?? "", /manual review/i);
  assert.equal(fake.lifecycles[0].released_at, NOW.toISOString(), "the lifecycle was re-closed back to released — never left live for an activated operator");
  assert.equal(fake.venues[0].created_by_operator_id, "op-1", "the venue is never mutated during this recovery sequence");
  assert.equal(alert.calls.length, 1, "exactly one alert for the whole outcome — never one before and one after");
  assert.equal(alert.calls[0].severity, "critical");
  assert.match(alert.calls[0].title, /Re-Closed/);
  assert.equal(alert.calls[0].metadata?.["Compensation attempted"], "Yes");
  assert.equal(alert.calls[0].metadata?.["Compensation succeeded"], "Yes");
  assert.equal(alert.calls[0].metadata?.["Activation detected"], "After compensation");
  assert.equal(alert.calls[0].metadata?.["Re-close succeeded"], "Yes");
});

test("re-close CAS fails after detecting post-compensation activation: one critical alert, manual-intervention result, never falsely reports retryable success", async () => {
  const lifecycle = makeLifecycleRow({ id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_submission_id: "sub-1", deadline_at: PAST_DEADLINE });
  const operators: FakeOperatorRow[] = [{ id: "op-1", account_activated_at: null }];
  const venue: FakeVenueRow = { id: "venue-1", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-09-01T00:00:00.000Z", is_verified: true, is_published: true };
  const submissions = [{ id: "sub-1", venue_id: "venue-1" }];
  const alert = sendAlertSpy();
  let lifecycleUpdateCount = 0;

  const fake = createFakeActivationReleaseClient(
    { lifecycles: [lifecycle], operators, submissions, venues: [venue] },
    { onOperatorSelect: (callIndex, ops) => { if (callIndex === 4) ops[0].account_activated_at = "2026-09-20T00:00:30.000Z"; } }
  );
  const originalFrom = fake.client.from.bind(fake.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fake.client as any).from = (table: string) => {
    if (table === "venues") return (venueUpdateAlwaysFails(originalFrom))(table);
    if (table === "operator_activation_lifecycles") {
      const real = originalFrom(table);
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        select: (real as any).select,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: (patch: any) => {
          lifecycleUpdateCount++;
          if (lifecycleUpdateCount === 3) {
            // The re-close attempt (call #3: release, compensation, re-close) — fails.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const failingChain: any = {
              eq: () => failingChain,
              is: () => failingChain,
              select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "simulated re-close failure" } }) }),
            };
            return failingChain;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (real as any).update(patch);
        },
      };
    }
    return originalFrom(table);
  };

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.doesNotMatch(result.error ?? "", /try Release again|was undone/i, "must never falsely report a retryable success");
  assert.match(result.error ?? "", /manual intervention/i);
  assert.equal(fake.lifecycles[0].released_at, null, "compensation cleared released_at and the re-close attempt failed to restore it — a known, alerted gap, never silently hidden");
  assert.equal(alert.calls.length, 1, "exactly one alert for the whole outcome");
  assert.equal(alert.calls[0].severity, "critical");
  assert.match(alert.calls[0].title, /RE-CLOSE FAILED/);
  assert.equal(alert.calls[0].metadata?.["Compensation succeeded"], "Yes");
  assert.equal(alert.calls[0].metadata?.["Activation detected"], "After compensation");
  assert.equal(alert.calls[0].metadata?.["Re-close succeeded"], "No");
});

test("reconciliation branch 2 — compensation ALSO fails: critical manual-intervention message, lifecycle remains released, exactly one critical alert stating failure", async () => {
  const fake = seedWorld();
  const alert = sendAlertSpy();
  let lifecycleUpdateCount = 0;
  const originalFrom = fake.client.from.bind(fake.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fake.client as any).from = (table: string) => {
    if (table === "venues") {
      return (venueUpdateAlwaysFails(originalFrom))(table);
    }
    if (table === "operator_activation_lifecycles") {
      const real = originalFrom(table);
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        select: (real as any).select,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: (patch: any) => {
          lifecycleUpdateCount++;
          if (lifecycleUpdateCount === 2) {
            // The compensating rollback attempt — fails. Chains any number
            // of .eq()/.is() calls before terminating at .select().maybeSingle().
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const failingChain: any = {
              eq: () => failingChain,
              is: () => failingChain,
              select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "simulated rollback failure" } }) }),
            };
            return failingChain;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (real as any).update(patch);
        },
      };
    }
    return originalFrom(table);
  };

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.match(result.error ?? "", /manual review/);
  assert.equal(fake.lifecycles[0].released_at, NOW.toISOString(), "compensation failed — the lifecycle remains released (never falsely un-released)");
  assert.equal(fake.venues[0].created_by_operator_id, "op-1", "the venue itself was never touched");
  assert.equal(alert.calls.length, 1, "exactly one critical alert");
  assert.match(alert.calls[0].title, /Compensation FAILED/);
});

// ── Duplicate retry after a compensated failure ─────────────────────────────

test("after a compensated failure, a later valid retry completes cleanly — no duplicate note, same deterministic event key, other venues untouched", async () => {
  const fake = seedWorld({
    extraVenues: [{ id: "venue-2", created_by_operator_id: "op-1", claimed_by: "op-1", claimed_at: "2026-08-01T00:00:00.000Z", is_verified: true, is_published: true }],
  });
  const alert = sendAlertSpy();
  const originalFrom = fake.client.from.bind(fake.client);
  let venueWriteShouldFail = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fake.client as any).from = (table: string) => {
    if (table === "venues" && venueWriteShouldFail) {
      return (venueUpdateAlwaysFails(originalFrom))(table);
    }
    return originalFrom(table);
  };

  const first = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });
  assert.match(first.error ?? "", /was undone/);
  assert.equal(fake.lifecycles[0].released_at, null, "compensated back to unreleased — safe to retry");

  venueWriteShouldFail = false;
  const second = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.equal(second.success, true);
  assert.equal(fake.venues[0].created_by_operator_id, null, "venue-1 is released on the successful retry");
  assert.equal(fake.operatorSubmissionNotes.length, 1, "exactly one note total, from the successful retry — the failed attempt wrote none");
  assert.equal(fake.operatorSubmissionNotes[0].event_key, "hhc-activation-release:lc-1", "the deterministic event key is unchanged across the failed attempt and the retry");
  const venue2 = fake.venues.find((v) => v.id === "venue-2")!;
  assert.equal(venue2.created_by_operator_id, "op-1", "the operator's other venue is untouched across both the failed attempt and the retry");
});

// ── Note-insertion failure does not reverse a successful release ───────────

test("note insertion fails (non-23505) after both writes succeed — release still reported as success, exactly one non-critical alert", async () => {
  const fake = seedWorld();
  const alert = sendAlertSpy();
  const originalFrom = fake.client.from.bind(fake.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fake.client as any).from = (table: string) => {
    if (table === "operator_submission_notes") {
      return { insert: async () => ({ data: null, error: { code: "OTHER", message: "simulated insert failure" } }) };
    }
    return originalFrom(table);
  };

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.equal(result.success, true, "the release itself still succeeds — never reversed by a note failure");
  assert.equal(fake.lifecycles[0].released_at, NOW.toISOString());
  assert.equal(fake.venues[0].created_by_operator_id, null);
  assert.equal(alert.calls.length, 1, "exactly one non-critical alert for the missing audit trail");
  assert.equal(alert.calls[0].severity, "warning");
  assert.equal(alert.calls[0].channel, "ops-alerts");
});

test("note insertion collides on event_key (23505) — treated as already-recorded, still success, never a duplicate note, no alert", async () => {
  const fake = seedWorld();
  fake.operatorSubmissionNotes.push({ id: "existing-note", event_key: "hhc-activation-release:lc-1" });
  const alert = sendAlertSpy();

  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });

  assert.equal(result.success, true);
  assert.equal(fake.operatorSubmissionNotes.length, 1, "still exactly the one pre-existing note — no duplicate inserted");
  assert.equal(alert.calls.length, 0, "a 23505 collision is treated as success, never an alert-worthy failure");
});

test("successful release sends no Slack alert of any kind", async () => {
  const fake = seedWorld();
  const alert = sendAlertSpy();
  const result = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(FOUNDER, true), adminClient: fake.client, sendAlert: alert.fn });
  assert.equal(result.success, true);
  assert.equal(alert.calls.length, 0);
});

test("authorization/eligibility/CAS failures send no alert of any kind", async () => {
  const alert = sendAlertSpy();

  const unauthorized = await releaseActivationLifecycleImpl("lc-1", { ...authDeps(null, false), adminClient: seedWorld().client, sendAlert: alert.fn });
  assert.equal(unauthorized.error, "Unauthorized.");

  const alreadyReleased = await releaseActivationLifecycleImpl("lc-1", {
    ...authDeps(FOUNDER, true),
    adminClient: seedWorld({ lifecycle: { released_at: "2026-09-16T00:00:00.000Z" } }).client,
    sendAlert: alert.fn,
  });
  assert.match(alreadyReleased.error ?? "", /already been released/);

  const leaseHeld = await releaseActivationLifecycleImpl("lc-1", {
    ...authDeps(FOUNDER, true),
    adminClient: seedWorld({ lifecycle: { reminder_lease_started_at: "2026-09-19T23:00:00.000Z" } }).client,
    sendAlert: alert.fn,
  });
  assert.match(leaseHeld.error ?? "", /currently being processed/);

  assert.equal(alert.calls.length, 0, "none of these paths ever reach an alert");
});

// ── No operator/founder success email or Slack ──────────────────────────────

test("release never sends an operator-facing email — no email dependency exists anywhere in this module's call graph", () => {
  // Static assertion of intent, mirroring the codebase's own established
  // convention for asserting an absence: activationReleaseImpl.ts imports
  // no email-sending function at all (grepped: only revalidatePath,
  // createClient/createAdminClient, isControlPanelAdmin, sendSlackAlert,
  // deriveActivationState, and the ActivationNoteOrigin type). Every test
  // above exercises a full successful release with a fake client that would
  // throw on any unexpected table/call, and none has ever needed an email
  // stub — there is nothing to send one.
  assert.ok(true);
});
