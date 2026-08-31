import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyVenueLane,
  SETUP_STALLED_AFTER_DAYS,
  type VenueLaneClassificationInput,
} from "../../../src/lib/data/venueFunnel";
import { buildVenuePlanMap } from "../../../src/lib/data/actionCenter";

/**
 * Phase 2C — Venue Funnel V1 lane precedence.
 *
 * classifyVenueLane() is a pure function (no I/O) — exported specifically
 * for direct, real-function-call testing, the same rationale as
 * resolvePlanCodeFromVenueSubscription() and computeActiveVenueId(). The
 * DB-fetching side of venueFunnel.ts (getVenueFunnelData) has no DI seam and
 * is covered by structural source-text tests in
 * venueFunnelDataArchitecture.test.ts instead.
 */

function baseInput(overrides: Partial<VenueLaneClassificationInput> = {}): VenueLaneClassificationInput {
  return {
    plan: "free",
    isUpgradeOpportunity: false,
    onboardingComplete: false,
    missingItemsCount: 6,
    accountActivatedAt: null,
    claimedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    operatorLastSeenAt: null,
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ── 3 & 4. Setup Sent vs. Setup Stalled ──────────────────────────────────────

test("3. account not activated, < SETUP_STALLED_AFTER_DAYS since claimed_at → Setup Sent — Awaiting Account", () => {
  const result = classifyVenueLane(baseInput({ claimedAt: daysAgo(1) }));
  assert.equal(result.laneKey, "setup_sent");
  assert.equal(result.ageDays, 1);
  assert.equal(result.ageLabel, "Since setup sent");
});

test("4. account not activated, >= SETUP_STALLED_AFTER_DAYS since claimed_at → Setup Stalled / No Response", () => {
  assert.equal(SETUP_STALLED_AFTER_DAYS, 3);
  const result = classifyVenueLane(baseInput({ claimedAt: daysAgo(3) }));
  assert.equal(result.laneKey, "setup_stalled");
  assert.equal(result.ageDays, 3);
});

test("a venue must appear in exactly one of Setup Sent / Setup Stalled at the 3-day boundary — never both", () => {
  const at2days = classifyVenueLane(baseInput({ claimedAt: daysAgo(2) }));
  const at3days = classifyVenueLane(baseInput({ claimedAt: daysAgo(3) }));
  assert.equal(at2days.laneKey, "setup_sent");
  assert.equal(at3days.laneKey, "setup_stalled");
});

// ── 5 & 6. Account Created vs. Onboarding In Progress ────────────────────────

test("5. account activated, zero readiness progress (6 of 6 missing) → Account Created — Not Started", () => {
  const result = classifyVenueLane(baseInput({ accountActivatedAt: daysAgo(1), missingItemsCount: 6 }));
  assert.equal(result.laneKey, "account_created");
  assert.equal(result.ageLabel, "Since account activated");
});

test("6. account activated, partial readiness progress (< 6 of 6 missing) → Onboarding In Progress", () => {
  const result = classifyVenueLane(baseInput({ accountActivatedAt: daysAgo(1), missingItemsCount: 5 }));
  assert.equal(result.laneKey, "onboarding_in_progress");
});

// ── 7 & 8. Onboarding Complete — automatic and manual ────────────────────────

test("7. automatic onboarding complete → Onboarding Complete", () => {
  const result = classifyVenueLane(baseInput({ accountActivatedAt: daysAgo(10), onboardingComplete: true, missingItemsCount: 0 }));
  assert.equal(result.laneKey, "onboarding_complete");
});

test("8. onboardingComplete=true regardless of mode — manual vs automatic both land in Onboarding Complete; the 'manual' distinction is card metadata (onboardingCompletionMode), not a separate lane", () => {
  // classifyVenueLane doesn't take completion mode as input at all — by
  // design, per the task's explicit "Manual completion should not create a
  // separate lane." A manually-completed venue can still have missing items.
  const manual = classifyVenueLane(baseInput({ accountActivatedAt: daysAgo(10), onboardingComplete: true, missingItemsCount: 1 }));
  assert.equal(manual.laneKey, "onboarding_complete");
});

// ── Phase 2C correction: the manual-completion indicator follows the venue
// downstream — it must remain true (as card metadata, applied separately —
// see venueFunnelDataArchitecture.test.ts) no matter which lane a manually
// completed venue ends up classified into. These three scenarios exercise
// the exact examples from the task spec; classifyVenueLane() itself never
// sees onboardingCompletionMode (proven above and in
// venueFunnelDataArchitecture.test.ts) — what these confirm is that a
// manually-completed venue (onboardingComplete: true) reaches every one of
// the three lanes the task calls out, exactly like an automatically-complete
// venue would, so the card's separately-carried onboardingCompletionMode is
// never at odds with an unreachable lane.

test("manually completed Free venue with no further qualifiers → Onboarding Complete (where the Complete — Manual badge shows)", () => {
  const result = classifyVenueLane(baseInput({ accountActivatedAt: daysAgo(5), onboardingComplete: true, missingItemsCount: 1 }));
  assert.equal(result.laneKey, "onboarding_complete");
});

test("manually completed venue that also qualifies for Upgrade Opportunity → Upgrade Opportunity (manual indicator still applies as card metadata)", () => {
  const result = classifyVenueLane(
    baseInput({ accountActivatedAt: daysAgo(5), onboardingComplete: true, missingItemsCount: 1, isUpgradeOpportunity: true })
  );
  assert.equal(result.laneKey, "upgrade_opportunity");
});

test("manually completed venue later on a Premium subscription → Paid Plan (manual indicator still applies alongside the Premium plan badge)", () => {
  const result = classifyVenueLane(
    baseInput({ accountActivatedAt: daysAgo(5), onboardingComplete: true, missingItemsCount: 1, isUpgradeOpportunity: true, plan: "premium" })
  );
  assert.equal(result.laneKey, "paid_plan");
});

// ── 9 & 16. Publication never drives lane progression ────────────────────────

test("9 & 16. a published-before-claimed seeded venue reaches Onboarding In Progress once any signal is done — publication is not part of the classification input at all", () => {
  // classifyVenueLane has no isPublished field in its input type — it is
  // architecturally impossible for publication to influence the result.
  // This models the exact Phase 2 scenario: a seeded venue was already
  // published, so "Not published" was never one of its missing items —
  // once the operator's account is activated, it lands directly in
  // Onboarding In Progress rather than ever passing through Account
  // Created — Not Started (which requires ALL 6 signals missing).
  const result = classifyVenueLane(baseInput({ accountActivatedAt: daysAgo(1), missingItemsCount: 5 }));
  assert.equal(result.laneKey, "onboarding_in_progress");
});

test("classifyVenueLane's input type carries no publication field", () => {
  const input: VenueLaneClassificationInput = baseInput();
  assert.ok(!("isPublished" in input));
  assert.ok(!("is_published" in input));
});

// ── 10 & 11. Precedence — Upgrade Opportunity and Paid Plan ───────────────────

test("10. Upgrade Opportunity takes precedence over Onboarding Complete", () => {
  const result = classifyVenueLane(baseInput({ onboardingComplete: true, isUpgradeOpportunity: true, missingItemsCount: 0 }));
  assert.equal(result.laneKey, "upgrade_opportunity");
});

test("11. Paid Plan takes precedence over Upgrade Opportunity", () => {
  const result = classifyVenueLane(baseInput({ plan: "pro", isUpgradeOpportunity: true, onboardingComplete: true }));
  assert.equal(result.laneKey, "paid_plan");
});

test("Paid Plan takes precedence over every other condition simultaneously true", () => {
  const result = classifyVenueLane(
    baseInput({
      plan: "premium",
      isUpgradeOpportunity: true,
      onboardingComplete: true,
      accountActivatedAt: daysAgo(1),
      missingItemsCount: 0,
    })
  );
  assert.equal(result.laneKey, "paid_plan");
});

// ── 12 & 13. Past-due / cancelled — composed with the Phase 2B plan resolver ──

test("12. a past_due Premium subscription still resolves to Premium (buildVenuePlanMap) and classifies as Paid Plan", () => {
  const planMap = buildVenuePlanMap([{ venue_id: "v1", plan_code: "premium", status: "past_due" }]);
  const plan = planMap.get("v1") ?? "free";
  assert.equal(plan, "premium");
  const result = classifyVenueLane(baseInput({ plan }));
  assert.equal(result.laneKey, "paid_plan");
});

test("13. a cancelled subscription resolves to Free (buildVenuePlanMap) and is NOT classified as Paid — falls through to whatever else applies", () => {
  const planMap = buildVenuePlanMap([{ venue_id: "v1", plan_code: "premium", status: "cancelled" }]);
  const plan = planMap.get("v1") ?? "free";
  assert.equal(plan, "free");
  const result = classifyVenueLane(baseInput({ plan, onboardingComplete: true }));
  assert.notEqual(result.laneKey, "paid_plan");
  assert.equal(result.laneKey, "onboarding_complete");
});

// ── 14. Exactly one primary lane per venue ────────────────────────────────────

test("14. every classification returns exactly one laneKey — never a set/array — across every precedence branch", () => {
  const scenarios: VenueLaneClassificationInput[] = [
    baseInput({ claimedAt: daysAgo(1) }),
    baseInput({ claimedAt: daysAgo(5) }),
    baseInput({ accountActivatedAt: daysAgo(1), missingItemsCount: 6 }),
    baseInput({ accountActivatedAt: daysAgo(1), missingItemsCount: 3 }),
    baseInput({ onboardingComplete: true }),
    baseInput({ isUpgradeOpportunity: true, onboardingComplete: true }),
    baseInput({ plan: "pro", isUpgradeOpportunity: true, onboardingComplete: true }),
  ];
  for (const s of scenarios) {
    const result = classifyVenueLane(s);
    assert.equal(typeof result.laneKey, "string");
  }
});

// ── 17. Plan is resolved per-venue, never leaking across an operator's venues ─

test("17. two venues sharing the same operator (same accountActivatedAt/operatorLastSeenAt) but different plans classify independently by venue-level plan", () => {
  const sharedOperatorFields = { accountActivatedAt: daysAgo(30), operatorLastSeenAt: daysAgo(1) };
  const premiumVenue = classifyVenueLane(baseInput({ ...sharedOperatorFields, plan: "premium", missingItemsCount: 0 }));
  const freeVenue     = classifyVenueLane(baseInput({ ...sharedOperatorFields, plan: "free", missingItemsCount: 2 }));
  assert.equal(premiumVenue.laneKey, "paid_plan");
  assert.equal(freeVenue.laneKey, "onboarding_in_progress");
  assert.notEqual(premiumVenue.laneKey, freeVenue.laneKey);
});

// ── possiblyInactive soft badge — Onboarding In Progress only ────────────────

test("possiblyInactive is only ever set for Onboarding In Progress, never for any other lane", () => {
  const paid = classifyVenueLane(baseInput({ plan: "pro", updatedAt: daysAgo(400) }));
  assert.equal(paid.possiblyInactive, false);

  const stalled = classifyVenueLane(baseInput({ claimedAt: daysAgo(400), updatedAt: daysAgo(400) }));
  assert.equal(stalled.possiblyInactive, false);
});

test("possiblyInactive is true when both venue.updated_at and operator.last_seen_at are stale (>= INACTIVE_DAYS)", () => {
  const result = classifyVenueLane(
    baseInput({ accountActivatedAt: daysAgo(60), missingItemsCount: 3, updatedAt: daysAgo(60), operatorLastSeenAt: daysAgo(60) })
  );
  assert.equal(result.laneKey, "onboarding_in_progress");
  assert.equal(result.possiblyInactive, true);
});

test("possiblyInactive is false when the operator has been seen recently, even if venue.updated_at is stale", () => {
  const result = classifyVenueLane(
    baseInput({ accountActivatedAt: daysAgo(60), missingItemsCount: 3, updatedAt: daysAgo(60), operatorLastSeenAt: daysAgo(1) })
  );
  assert.equal(result.laneKey, "onboarding_in_progress");
  assert.equal(result.possiblyInactive, false);
});

test("possiblyInactive is false when the operator has never logged in (last_seen_at null) but venue.updated_at is recent", () => {
  const result = classifyVenueLane(
    baseInput({ accountActivatedAt: daysAgo(60), missingItemsCount: 3, updatedAt: daysAgo(1), operatorLastSeenAt: null })
  );
  assert.equal(result.possiblyInactive, false);
});
