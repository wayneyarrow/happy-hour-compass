import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeCustomerSuccessClient } from "./support/fakeCustomerSuccessClient";
import {
  computeVenueViewMilestoneDecisions,
  applyVenueViewMilestoneDecisions,
  runVenueViewMilestoneDetection,
  type VenueViewMilestonePlan,
} from "../../../src/lib/customerSuccess/detectVenueViewMilestones";

// createAdminClient()'s real return type isn't constructible in a unit
// test — the fake client only implements the query-builder surface the
// detector actually calls (see fakeCustomerSuccessClient.ts's header).
type FakeAdmin = Parameters<typeof computeVenueViewMilestoneDecisions>[0];

// ── 11. Multiple venues evaluated in one run (+ corrected eligibility) ─────

test("multiple venues, mixed eligibility and history, evaluated in one run", async () => {
  const venues = [
    { id: "v1-first-run-below-threshold", is_published: true, is_verified: true, created_by_operator_id: "op-1" },
    { id: "v2-ongoing-growth", is_published: true, is_verified: true, created_by_operator_id: "op-2" },
    { id: "v3-unpublished", is_published: false, is_verified: true, created_by_operator_id: "op-3" },
    { id: "v4-seeded-unclaimed", is_published: true, is_verified: false, created_by_operator_id: null },
    { id: "v5-unverified-operator-linked", is_published: true, is_verified: false, created_by_operator_id: "op-5" },
  ];
  const viewCounts = new Map([
    ["v1-first-run-below-threshold", 20],
    ["v2-ongoing-growth", 112],
    ["v3-unpublished", 9999], // ineligible regardless of views
    ["v4-seeded-unclaimed", 9999], // ineligible regardless of views
    ["v5-unverified-operator-linked", 9999], // ineligible: operator-linked but unverified
  ]);

  const { client, csEvents, baselines } = createFakeCustomerSuccessClient({ venues, viewCounts });

  // v2 was already baselined by an earlier run (e.g. at 43 views, before crossing anything).
  baselines.push({
    id: "seed-baseline-v2",
    venue_id: "v2-ongoing-growth",
    event_type: "venue_view_milestone",
    metric_value_at_baseline: 43,
  });

  const result = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);

  assert.equal(result.venuesEvaluated, 2, "only the two published + verified + operator-owned venues are evaluated");
  assert.equal(result.venuesIgnoredIneligible, 3, "unpublished, seeded/unclaimed, and unverified venues are ignored");

  // v1: first-ever observation, below the first milestone → baseline only.
  assert.equal(result.venuesBaselined, 1);

  // v2: ongoing growth past an existing baseline → 100 pending, 50 superseded.
  assert.equal(result.milestonesNewlyAchieved, 1);
  assert.equal(result.milestonesSuperseded, 1);
  assert.equal(result.pendingMilestonesSuperseded, 0);
  assert.equal(result.errors.length, 0);

  const v2Events = csEvents.filter((e) => e.venue_id === "v2-ongoing-growth");
  assert.deepEqual(
    v2Events
      .map((e) => [e.milestone_value, e.communication_status])
      .sort((a, b) => (a[0] as number) - (b[0] as number)),
    [
      [50, "superseded"],
      [100, "pending"],
    ]
  );

  const v1Events = csEvents.filter((e) => e.venue_id === "v1-first-run-below-threshold");
  assert.equal(v1Events.length, 0, "v1 crossed nothing yet, so no milestone rows — only a baseline");
  assert.ok(baselines.some((b) => b.venue_id === "v1-first-run-below-threshold"));

  assert.equal(
    csEvents.some(
      (e) =>
        e.venue_id === "v3-unpublished" ||
        e.venue_id === "v4-seeded-unclaimed" ||
        e.venue_id === "v5-unverified-operator-linked"
    ),
    false,
    "ineligible venues never produce events regardless of view count"
  );
  assert.equal(
    baselines.some(
      (b) =>
        b.venue_id === "v3-unpublished" ||
        b.venue_id === "v4-seeded-unclaimed" ||
        b.venue_id === "v5-unverified-operator-linked"
    ),
    false,
    "ineligible venues are never baselined either"
  );
});

// ── Idempotency at the orchestration level ──────────────────────────────────

test("running detection twice in a row is a no-op the second time", async () => {
  const venues = [{ id: "v1", is_published: true, is_verified: true, created_by_operator_id: "op-1" }];
  const viewCounts = new Map([["v1", 260]]);
  const { client } = createFakeCustomerSuccessClient({ venues, viewCounts });

  const first = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);
  // First-ever run at 260 views: baseline written, 50 + 100 + 250 superseded, nothing pending (initialization rule).
  assert.equal(first.venuesBaselined, 1);
  assert.equal(first.milestonesSuperseded, 3);
  assert.equal(first.milestonesNewlyAchieved, 0);
  assert.equal(first.pendingMilestonesSuperseded, 0);

  const second = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);
  assert.deepEqual(second, {
    venuesEvaluated: 1,
    venuesIgnoredIneligible: 0,
    venuesBaselined: 0,
    milestonesNewlyAchieved: 0,
    milestonesSuperseded: 0,
    pendingMilestonesSuperseded: 0,
    errors: [],
  });
});

test("a race that produces a duplicate insert (Postgres 23505) is absorbed as a no-op, not an error", async () => {
  const venues = [{ id: "v1", is_published: true, is_verified: true, created_by_operator_id: "op-1" }];
  const viewCounts = new Map([["v1", 260]]);
  const { client, csEvents, baselines } = createFakeCustomerSuccessClient({ venues, viewCounts });

  // Simulate a concurrent run that already baselined this venue and recorded
  // both 50 and 100 as superseded, between this run's compute() and apply().
  baselines.push({
    id: "seed-baseline",
    venue_id: "v1",
    event_type: "venue_view_milestone",
    metric_value_at_baseline: 260,
  });
  csEvents.push(
    {
      id: "seed-event-50",
      venue_id: "v1",
      operator_id: "op-1",
      event_type: "venue_view_milestone",
      milestone_value: 50,
      metric_value_at_detection: 260,
      communication_status: "superseded",
      achieved_at: new Date().toISOString(),
    },
    {
      id: "seed-event-100",
      venue_id: "v1",
      operator_id: "op-1",
      event_type: "venue_view_milestone",
      milestone_value: 100,
      metric_value_at_detection: 260,
      communication_status: "superseded",
      achieved_at: new Date().toISOString(),
    }
  );

  // This run's plan was computed against a hasBaseline:false, milestone-250-
  // unrecorded view of the world (stale relative to the concurrent writer
  // above) — exactly the race applyVenueViewMilestoneDecisions must absorb.
  const stalePlan: VenueViewMilestonePlan = {
    venuesEvaluated: 1,
    venuesIgnoredIneligible: 0,
    entries: [
      {
        venue: { id: "v1", operatorId: "op-1" },
        currentViews: 260,
        decision: { baselineNeeded: true, newlyPending: null, newlySuperseded: [50, 100], pendingToSupersede: [] },
      },
    ],
  };

  const result = await applyVenueViewMilestoneDecisions(stalePlan, client as unknown as FakeAdmin);

  // Every proposed write in the stale plan collides with what the
  // concurrent run already wrote — all absorbed as no-ops, zero errors.
  assert.equal(result.venuesBaselined, 0);
  assert.equal(result.milestonesSuperseded, 0);
  assert.equal(result.milestonesNewlyAchieved, 0);
  assert.equal(result.pendingMilestonesSuperseded, 0);
  assert.deepEqual(result.errors, []);

  // State is exactly what the concurrent writer left it as — no duplicates.
  assert.equal(csEvents.filter((e) => e.venue_id === "v1").length, 2);
  assert.equal(baselines.filter((b) => b.venue_id === "v1").length, 1);
});

// ── Cross-run supersession (Correction Pass Section 2) ──────────────────────

test("50 becomes pending on run 1; 100 crossed on run 2 supersedes it; rerun is a no-op", async () => {
  const venues = [{ id: "v1", is_published: true, is_verified: true, created_by_operator_id: "op-1" }];
  const viewCounts = new Map([["v1", 52]]);
  const { client, csEvents, baselines } = createFakeCustomerSuccessClient({ venues, viewCounts });

  // Run 1: seed a prior baseline directly to simulate "already onboarded,
  // ongoing operation" rather than a first-run initialization pass, so run
  // 1 below exercises the ordinary crossing path (50 → pending) rather than
  // the initialization/backfill path.
  baselines.push({
    id: "seed-baseline",
    venue_id: "v1",
    event_type: "venue_view_milestone",
    metric_value_at_baseline: 10,
  });

  const run1 = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);
  assert.equal(run1.milestonesNewlyAchieved, 1);
  assert.deepEqual(
    csEvents.map((e) => [e.milestone_value, e.communication_status]),
    [[50, "pending"]]
  );

  // Run 2: venue now has 103 views. 50 must be superseded; 100 must be pending.
  viewCounts.set("v1", 103);
  const run2 = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);
  assert.equal(run2.milestonesNewlyAchieved, 1, "100 is newly inserted as pending");
  assert.equal(run2.pendingMilestonesSuperseded, 1, "the old 50 pending row is demoted, not re-inserted");
  assert.equal(run2.milestonesSuperseded, 0, "50 was demoted via UPDATE, not a fresh superseded INSERT");

  assert.deepEqual(
    csEvents
      .map((e) => [e.milestone_value, e.communication_status])
      .sort((a, b) => (a[0] as number) - (b[0] as number)),
    [
      [50, "superseded"],
      [100, "pending"],
    ]
  );
  assert.equal(csEvents.length, 2, "50 was updated in place, not duplicated as a second row");

  // Run 3: rerun at the same view count is a no-op.
  const run3 = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);
  assert.equal(run3.milestonesNewlyAchieved, 0);
  assert.equal(run3.milestonesSuperseded, 0);
  assert.equal(run3.pendingMilestonesSuperseded, 0);
  assert.equal(run3.venuesBaselined, 0);
  assert.equal(csEvents.length, 2);
});

test("an already-SENT milestone is never touched when a higher one is later crossed", async () => {
  const venues = [{ id: "v1", is_published: true, is_verified: true, created_by_operator_id: "op-1" }];
  const viewCounts = new Map([["v1", 103]]);
  const { client, csEvents, baselines } = createFakeCustomerSuccessClient({ venues, viewCounts });

  baselines.push({
    id: "seed-baseline",
    venue_id: "v1",
    event_type: "venue_view_milestone",
    metric_value_at_baseline: 10,
  });
  // Simulate Phase 1B having already sent the 50 milestone.
  csEvents.push({
    id: "seed-event-50-sent",
    venue_id: "v1",
    operator_id: "op-1",
    event_type: "venue_view_milestone",
    milestone_value: 50,
    metric_value_at_detection: 52,
    communication_status: "sent",
    achieved_at: new Date().toISOString(),
  });

  const result = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);

  assert.equal(result.milestonesNewlyAchieved, 1, "100 becomes pending");
  assert.equal(result.pendingMilestonesSuperseded, 0, "nothing was pending to demote — 50 was already sent");

  const fiftyRow = csEvents.find((e) => e.milestone_value === 50);
  assert.equal(fiftyRow?.communication_status, "sent", "the sent row for 50 is completely untouched");

  const hundredRow = csEvents.find((e) => e.milestone_value === 100);
  assert.equal(hundredRow?.communication_status, "pending");
});

test("50 pending, then a larger jump straight to 300 views: 50 and 100 superseded, only 250 remains pending", async () => {
  const venues = [{ id: "v1", is_published: true, is_verified: true, created_by_operator_id: "op-1" }];
  const viewCounts = new Map([["v1", 52]]);
  const { client, csEvents, baselines } = createFakeCustomerSuccessClient({ venues, viewCounts });

  baselines.push({
    id: "seed-baseline",
    venue_id: "v1",
    event_type: "venue_view_milestone",
    metric_value_at_baseline: 10,
  });

  await runVenueViewMilestoneDetection(client as unknown as FakeAdmin); // 50 → pending

  viewCounts.set("v1", 300);
  const result = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);

  assert.equal(result.milestonesNewlyAchieved, 1, "only 250 is newly pending");
  assert.equal(result.milestonesSuperseded, 1, "100 is inserted directly as superseded");
  assert.equal(result.pendingMilestonesSuperseded, 1, "the old 50 pending row is demoted");

  const byMilestone = new Map(csEvents.map((e) => [e.milestone_value, e.communication_status]));
  assert.equal(byMilestone.get(50), "superseded");
  assert.equal(byMilestone.get(100), "superseded");
  assert.equal(byMilestone.get(250), "pending");

  const pendingRows = csEvents.filter((e) => e.communication_status === "pending");
  assert.equal(pendingRows.length, 1, "never more than one unsent pending milestone for the same venue");
});

// ── Baselining only starts once a venue becomes eligible (Correction Pass Section 3) ─

test("a seeded venue with historical views is only baselined once it becomes eligible (claimed + verified)", async () => {
  const venues = [
    { id: "v1", is_published: false, is_verified: false, created_by_operator_id: null as string | null },
  ];
  // 180 historical views accumulated while seeded/unclaimed/unverified.
  const viewCounts = new Map([["v1", 180]]);
  const { client, csEvents, baselines } = createFakeCustomerSuccessClient({ venues, viewCounts });

  const whileIneligible = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);
  assert.equal(whileIneligible.venuesEvaluated, 0);
  assert.equal(whileIneligible.venuesBaselined, 0);
  assert.equal(csEvents.length, 0);
  assert.equal(baselines.length, 0, "an ineligible venue is never baselined despite having views");

  // Operator claims it, claim is approved, venue becomes published + verified
  // + operator-linked (provisionOperatorForVenue's atomic flip), and picks
  // up a few more views along the way.
  venues[0].is_published = true;
  venues[0].is_verified = true;
  venues[0].created_by_operator_id = "op-1";
  viewCounts.set("v1", 210);

  const firstEligibleRun = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);
  assert.equal(firstEligibleRun.venuesEvaluated, 1);
  assert.equal(firstEligibleRun.venuesBaselined, 1, "first-ever observation now that it's eligible");
  assert.equal(firstEligibleRun.milestonesNewlyAchieved, 0, "no pending — historical crossings are baselined");
  assert.equal(firstEligibleRun.milestonesSuperseded, 2, "50 and 100 are both backfilled as history");

  const statuses = csEvents.map((e) => [e.milestone_value, e.communication_status]).sort((a, b) => (a[0] as number) - (b[0] as number));
  assert.deepEqual(statuses, [
    [50, "superseded"],
    [100, "superseded"],
  ]);

  // Its next meaningful milestone should be 250.
  viewCounts.set("v1", 260);
  const nextRun = await runVenueViewMilestoneDetection(client as unknown as FakeAdmin);
  assert.equal(nextRun.milestonesNewlyAchieved, 1);
  const twoFifty = csEvents.find((e) => e.milestone_value === 250);
  assert.equal(twoFifty?.communication_status, "pending");
});

