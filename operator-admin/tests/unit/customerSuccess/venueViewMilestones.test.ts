import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VENUE_VIEW_MILESTONES,
  resolveVenueViewMilestoneDecision,
} from "../../../src/lib/customerSuccess/venueViewMilestones";

// ── 1. Venue below first milestone ──────────────────────────────────────────

test("venue below the first milestone: no baseline yet → baseline written, nothing pending/superseded", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 20,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: false,
  });
  assert.deepEqual(decision, {
    baselineNeeded: true,
    newlyPending: null,
    newlySuperseded: [],
    pendingToSupersede: [],
  });
});

test("venue below the first milestone: already baselined → no-op", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 20,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.deepEqual(decision, {
    baselineNeeded: false,
    newlyPending: null,
    newlySuperseded: [],
    pendingToSupersede: [],
  });
});

// ── 2. Venue reaching exactly 50 ────────────────────────────────────────────

test("venue reaching exactly 50, already baselined at a lower count: 50 becomes pending", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 50,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.deepEqual(decision, {
    baselineNeeded: false,
    newlyPending: 50,
    newlySuperseded: [],
    pendingToSupersede: [],
  });
});

// ── 3. Same milestone checked twice (idempotency) ───────────────────────────

test("same milestone checked twice: second check with 50 already recorded (still pending) proposes nothing", () => {
  const first = resolveVenueViewMilestoneDecision({
    currentViews: 50,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.equal(first.newlyPending, 50);

  // Simulate the milestone now being recorded as pending, re-run at the same view count.
  const second = resolveVenueViewMilestoneDecision({
    currentViews: 50,
    alreadyRecordedMilestones: [50],
    pendingMilestones: [50],
    hasBaseline: true,
  });
  assert.deepEqual(second, {
    baselineNeeded: false,
    newlyPending: null,
    newlySuperseded: [],
    pendingToSupersede: [],
  });
});

test("re-running the exact same inputs always proposes the exact same outcome", () => {
  const input = {
    currentViews: 620,
    alreadyRecordedMilestones: [50, 100, 250],
    pendingMilestones: [250],
    hasBaseline: true,
  };
  const a = resolveVenueViewMilestoneDecision(input);
  const b = resolveVenueViewMilestoneDecision(input);
  assert.deepEqual(a, b);
});

// ── 4. Venue jumping from below 50 to above 100 (single run) ───────────────

test("jump from 43 to 112 views (already baselined at 43, no milestone crossed then): 100 pending, 50 superseded", () => {
  // First run at 43 views establishes the baseline; 43 < 50 so nothing crosses.
  const firstRun = resolveVenueViewMilestoneDecision({
    currentViews: 43,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: false,
  });
  assert.deepEqual(firstRun, {
    baselineNeeded: true,
    newlyPending: null,
    newlySuperseded: [],
    pendingToSupersede: [],
  });

  // Next run: now at 112 views, baseline already exists, nothing recorded yet.
  const secondRun = resolveVenueViewMilestoneDecision({
    currentViews: 112,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.deepEqual(secondRun, {
    baselineNeeded: false,
    newlyPending: 100,
    newlySuperseded: [50],
    pendingToSupersede: [],
  });
});

// ── 5. Venue between milestones ─────────────────────────────────────────────

test("venue between milestones (e.g. 180 views, 100 already recorded/sent): nothing new", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 180,
    alreadyRecordedMilestones: [50, 100],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.deepEqual(decision, {
    baselineNeeded: false,
    newlyPending: null,
    newlySuperseded: [],
    pendingToSupersede: [],
  });
});

// ── 6. Existing venue with historical views (initialization / Part C) ──────

test("existing venue with 183 historical views on first-ever run: both 50 and 100 superseded, none pending", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 183,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: false,
  });
  assert.deepEqual(decision, {
    baselineNeeded: true,
    newlyPending: null,
    newlySuperseded: [50, 100],
    pendingToSupersede: [],
  });
});

test("existing venue with a very high historical count (6000) on first-ever run: every milestone superseded", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 6000,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: false,
  });
  assert.deepEqual(decision, {
    baselineNeeded: true,
    newlyPending: null,
    newlySuperseded: [...VENUE_VIEW_MILESTONES],
    pendingToSupersede: [],
  });
});

// ── 7. Venue crossing its next milestone after initialization (Part D) ─────

test("venue crosses its next meaningful milestone after initialization: 183→260 views yields 250 pending", () => {
  // Initialization run recorded 50 and 100 as superseded and wrote the baseline.
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 260,
    alreadyRecordedMilestones: [50, 100],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.deepEqual(decision, {
    baselineNeeded: false,
    newlyPending: 250,
    newlySuperseded: [],
    pendingToSupersede: [],
  });
});

test("venue never later receives 50/100 after initialization, even far past them", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 900,
    alreadyRecordedMilestones: [50, 100],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.equal(decision.newlyPending, 500);
  assert.deepEqual(decision.newlySuperseded, [250]);
  assert.ok(!decision.newlySuperseded.includes(50));
  assert.ok(!decision.newlySuperseded.includes(100));
});

// ── Multiple milestones skipped in one jump ─────────────────────────────────

test("skipping several milestones in one jump (baselined venue: 30 → 2600 views): 2500 pending, rest superseded", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 2600,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.deepEqual(decision, {
    baselineNeeded: false,
    newlyPending: 2500,
    newlySuperseded: [50, 100, 250, 500, 1000],
    pendingToSupersede: [],
  });
});

// ── Fully graduated venue ────────────────────────────────────────────────────

test("venue that has already recorded every milestone proposes nothing further, however high views go", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 50000,
    alreadyRecordedMilestones: [...VENUE_VIEW_MILESTONES],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.deepEqual(decision, {
    baselineNeeded: false,
    newlyPending: null,
    newlySuperseded: [],
    pendingToSupersede: [],
  });
});

// ── Threshold list sanity ────────────────────────────────────────────────────

test("VENUE_VIEW_MILESTONES is the specified ascending list", () => {
  assert.deepEqual(VENUE_VIEW_MILESTONES, [50, 100, 250, 500, 1000, 2500, 5000]);
});

// ── Cross-run supersession (Correction Pass Section 2) ──────────────────────

test("50 pending on run 1, 100 crossed on run 2: 50 is demoted, 100 becomes pending", () => {
  // Run 1: 52 views, baselined earlier, nothing recorded yet.
  const run1 = resolveVenueViewMilestoneDecision({
    currentViews: 52,
    alreadyRecordedMilestones: [],
    pendingMilestones: [],
    hasBaseline: true,
  });
  assert.deepEqual(run1, {
    baselineNeeded: false,
    newlyPending: 50,
    newlySuperseded: [],
    pendingToSupersede: [],
  });

  // Run 2: 103 views. 50 is now recorded AND still pending (not yet sent).
  const run2 = resolveVenueViewMilestoneDecision({
    currentViews: 103,
    alreadyRecordedMilestones: [50],
    pendingMilestones: [50],
    hasBaseline: true,
  });
  assert.deepEqual(run2, {
    baselineNeeded: false,
    newlyPending: 100,
    newlySuperseded: [],
    pendingToSupersede: [50],
  });
});

test("rerunning after cross-run supersession is a no-op", () => {
  // State after run 2 above: 50 = superseded, 100 = pending.
  const run3 = resolveVenueViewMilestoneDecision({
    currentViews: 103,
    alreadyRecordedMilestones: [50, 100],
    pendingMilestones: [100],
    hasBaseline: true,
  });
  assert.deepEqual(run3, {
    baselineNeeded: false,
    newlyPending: null,
    newlySuperseded: [],
    pendingToSupersede: [],
  });
});

test("an already-SENT milestone is never proposed for demotion when a higher one is crossed", () => {
  // 50 was sent (not pending) before 100 is crossed — must never appear in
  // pendingToSupersede, because sent milestones are never passed in
  // pendingMilestones by the caller (see detectVenueViewMilestones.ts).
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 103,
    alreadyRecordedMilestones: [50], // recorded (sent), so 50 is never re-proposed as crossed
    pendingMilestones: [], // NOT pending — it was sent, so the caller excludes it here
    hasBaseline: true,
  });
  assert.deepEqual(decision, {
    baselineNeeded: false,
    newlyPending: 100,
    newlySuperseded: [],
    pendingToSupersede: [], // nothing to demote — 50 was already sent, untouched
  });
});

test("50 pending, then a larger jump straight to 300 views: 50 and 100 superseded, 250 pending", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 300,
    alreadyRecordedMilestones: [50],
    pendingMilestones: [50],
    hasBaseline: true,
  });
  assert.deepEqual(decision, {
    baselineNeeded: false,
    newlyPending: 250,
    newlySuperseded: [100],
    pendingToSupersede: [50],
  });
});

test("never more than one pending milestone results from a single decision", () => {
  const decision = resolveVenueViewMilestoneDecision({
    currentViews: 5200,
    alreadyRecordedMilestones: [50, 100],
    pendingMilestones: [100],
    hasBaseline: true,
  });
  // Exactly one milestone ends up pending after this decision: the new one.
  assert.equal(decision.newlyPending, 5000);
  // The old pending (100) is demoted, not left dangling.
  assert.deepEqual(decision.pendingToSupersede, [100]);
});
