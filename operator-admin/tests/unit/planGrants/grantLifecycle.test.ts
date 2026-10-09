import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getGrantStatus,
  grantHasStarted,
  resolveEffectiveAccess,
  type PlanGrant,
  type VenueOwnership,
} from "@/lib/planGrants/grantState";
import {
  enforcedPolicy,
  isDailySpecialPubliclyActive,
  isEventPubliclyActive,
  publicFoodSpecialLimit,
  publicImageLimit,
  publicSearchTagLimit,
  UNRESTRICTED_POLICY,
  type PublicContentPolicy,
} from "@/lib/planGrants/contentPolicy";
import type { OperatorPlan } from "@/lib/plans";

/**
 * Comp / Trial Part 1 — lifecycle scenarios required before implementation
 * sign-off. Everything here runs through the same pure functions every
 * surface uses (resolveEffectiveAccess → public content policy), so a pass
 * here is the actual entitlement behaviour, not a model of it.
 *
 * Billing plans are passed exactly as each surface reads them from
 * venue_subscriptions; these tests never model Stripe writes, because grants
 * never perform any.
 */

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T07:00:00.000Z");
const OWNER: VenueOwnership = { createdByOperatorId: "op-1", claimedAt: "2026-09-01T00:00:00.000Z" };

function grant(overrides: Partial<PlanGrant> = {}): PlanGrant {
  return {
    id: overrides.id ?? "g-1",
    venueId: "v-1",
    planCode: "premium",
    grantType: "trial",
    startsAt: new Date(T0).toISOString(),
    endsAt: new Date(T0 + 30 * DAY).toISOString(),
    reason: "test",
    operatorId: "op-1",
    ownerClaimedAt: OWNER.claimedAt,
    createdByEmail: "founder@example.com",
    createdAt: new Date(T0).toISOString(),
    revokedAt: null,
    endReason: null,
    revokedByEmail: null,
    revokeReason: null,
    ...overrides,
  };
}

function policyAt(billingPlan: OperatorPlan, grants: PlanGrant[], nowMs: number, venue: VenueOwnership = OWNER): PublicContentPolicy {
  const a = resolveEffectiveAccess({ billingPlan, grants, venue, nowMs });
  return a.contentEnforced ? enforcedPolicy(a.effectivePlan) : UNRESTRICTED_POLICY;
}

const recurringEvent = { recurrence: "weekly", isSeededEvent: false };
const weeklySpecial = { scheduleType: "weekly", isSeededSpecial: false };

// ── Required scenarios ───────────────────────────────────────────────────────

test("Premium Trial expires → Free limits (paid-only content paused, preserved)", () => {
  const trial = grant();
  const during = resolveEffectiveAccess({ billingPlan: "free", grants: [trial], venue: OWNER, nowMs: T0 + DAY });
  assert.equal(during.effectivePlan, "premium");
  assert.equal(during.source, "grant");

  const after = policyAt("free", [trial], T0 + 31 * DAY);
  assert.deepEqual(after, { enforced: true, plan: "free" });
  assert.equal(isEventPubliclyActive(after, recurringEvent), false);
  assert.equal(isDailySpecialPubliclyActive(after, weeklySpecial), false);
  assert.equal(publicFoodSpecialLimit(after), 3);
  assert.equal(publicImageLimit(after), 5);
  assert.equal(publicSearchTagLimit(after), 0);
});

test("Expired Premium Trial → Pro Comp → Pro limits only (Premium-only content stays paused)", () => {
  const trial = grant({ id: "trial" });
  const comp = grant({
    id: "comp",
    planCode: "pro",
    grantType: "comp",
    startsAt: new Date(T0 + 40 * DAY).toISOString(),
    endsAt: null,
  });
  const p = policyAt("free", [trial, comp], T0 + 41 * DAY);
  assert.deepEqual(p, { enforced: true, plan: "pro" });
  assert.equal(publicImageLimit(p), 10, "Pro image limit, not Premium's 25");
  assert.equal(publicFoodSpecialLimit(p), 6);
  assert.equal(publicSearchTagLimit(p), 5);
  assert.equal(isEventPubliclyActive(p, recurringEvent), true, "recurring is a Pro feature");
});

test("Pro Paid + Premium Comp expires → Pro limits (paying venue never downgraded below its subscription)", () => {
  const comp = grant({ grantType: "comp" });
  const during = resolveEffectiveAccess({ billingPlan: "pro", grants: [comp], venue: OWNER, nowMs: T0 + DAY });
  assert.equal(during.effectivePlan, "premium");
  assert.equal(during.billingPlan, "pro");

  const after = resolveEffectiveAccess({ billingPlan: "pro", grants: [comp], venue: OWNER, nowMs: T0 + 31 * DAY });
  assert.equal(after.effectivePlan, "pro");
  assert.equal(after.source, "subscription");
  assert.deepEqual(policyAt("pro", [comp], T0 + 31 * DAY), { enforced: true, plan: "pro" });
});

test("Trial converts to paid → later paid cancellation falls back to current entitlement (approved Option 1)", () => {
  const trial = grant();
  // Bought Premium during the trial: billing Premium, trial still active.
  const paid = policyAt("premium", [trial], T0 + 10 * DAY);
  assert.deepEqual(paid, { enforced: true, plan: "premium" });
  // Trial ends while paying: nothing changes — Premium billing covers it.
  assert.deepEqual(policyAt("premium", [trial], T0 + 31 * DAY), { enforced: true, plan: "premium" });
  // Stripe later cancels (billing Free — written by the unchanged webhook):
  // public content follows the current entitlement; nothing is deleted.
  const cancelled = policyAt("free", [trial], T0 + 60 * DAY);
  assert.deepEqual(cancelled, { enforced: true, plan: "free" });
  // A venue that never had a grant keeps today's cancellation behaviour.
  assert.deepEqual(policyAt("free", [], T0 + 60 * DAY), UNRESTRICTED_POLICY);
});

test("Comp survives a paid cancellation while active, then freezes when it ends", () => {
  const comp = grant({ grantType: "comp", endsAt: new Date(T0 + 90 * DAY).toISOString() });
  // Paid cancellation mid-comp (billing back to Free): comp still covers Premium.
  const midComp = resolveEffectiveAccess({ billingPlan: "free", grants: [comp], venue: OWNER, nowMs: T0 + 45 * DAY });
  assert.equal(midComp.effectivePlan, "premium");
  assert.equal(isEventPubliclyActive(policyAt("free", [comp], T0 + 45 * DAY), recurringEvent), true);
  // Comp ends: freezes to Free.
  const after = policyAt("free", [comp], T0 + 91 * DAY);
  assert.deepEqual(after, { enforced: true, plan: "free" });
  assert.equal(isEventPubliclyActive(after, recurringEvent), false);
});

test("Release / ownership transfer permanently invalidates the grant (trigger revocation)", () => {
  const released = grant({
    grantType: "comp",
    endsAt: null,
    revokedAt: new Date(T0 + 10 * DAY).toISOString(),
    endReason: "ownership_changed",
  });
  // Even if the same operator later re-claims (same operator id), the grant
  // never becomes active again — revoked_at is terminal.
  const later = resolveEffectiveAccess({
    billingPlan: "free",
    grants: [released],
    venue: { createdByOperatorId: "op-1", claimedAt: "2026-12-01T00:00:00.000Z" },
    nowMs: T0 + 100 * DAY,
  });
  assert.equal(later.activeGrant, null);
  assert.equal(later.effectivePlan, "free");
  assert.equal(getGrantStatus(released, OWNER, T0 + 100 * DAY), "ended_ownership_changed");
  // Venue-scoped enforcement continues: grant-era content never reappears.
  assert.equal(later.contentEnforced, true);
});

test("Venue cancellation permanently invalidates the grant", () => {
  const cancelled = grant({
    grantType: "comp",
    endsAt: null,
    revokedAt: new Date(T0 + 5 * DAY).toISOString(),
    endReason: "venue_cancelled",
  });
  const a = resolveEffectiveAccess({ billingPlan: "free", grants: [cancelled], venue: OWNER, nowMs: T0 + 6 * DAY });
  assert.equal(a.activeGrant, null);
  assert.equal(getGrantStatus(cancelled, OWNER, T0 + 6 * DAY), "ended_venue_cancelled");
  // Reactivating the venue changes nothing — revoked_at is never cleared.
  const reactivated = resolveEffectiveAccess({ billingPlan: "free", grants: [cancelled], venue: OWNER, nowMs: T0 + 60 * DAY });
  assert.equal(reactivated.activeGrant, null);
});

test("Read-time fallback: an A → B → A ownership round trip never reactivates a grant, even with no revocation recorded", () => {
  const comp = grant({ grantType: "comp", endsAt: null });
  // Same operator id, but claimed_at was rewritten by the re-claim.
  const sameOperatorReclaimed: VenueOwnership = { createdByOperatorId: "op-1", claimedAt: "2026-11-15T00:00:00.000Z" };
  const a = resolveEffectiveAccess({ billingPlan: "free", grants: [comp], venue: sameOperatorReclaimed, nowMs: T0 + 50 * DAY });
  assert.equal(a.activeGrant, null);
  assert.equal(getGrantStatus(comp, sameOperatorReclaimed, T0 + 50 * DAY), "invalidated");
  // Different owner → also inactive.
  const other = resolveEffectiveAccess({
    billingPlan: "free",
    grants: [comp],
    venue: { createdByOperatorId: "op-2", claimedAt: OWNER.claimedAt },
    nowMs: T0 + 1,
  });
  assert.equal(other.activeGrant, null);
});

// ── Scheduled / immediate consistency ────────────────────────────────────────

test("A future grant changes nothing before starts_at — no access, no enforcement", () => {
  const scheduled = grant({ startsAt: new Date(T0 + 10 * DAY).toISOString(), endsAt: new Date(T0 + 40 * DAY).toISOString() });
  const before = resolveEffectiveAccess({ billingPlan: "free", grants: [scheduled], venue: OWNER, nowMs: T0 + 9 * DAY });
  assert.equal(before.effectivePlan, "free");
  assert.equal(before.contentEnforced, false);
  assert.equal(before.scheduledGrant?.id, scheduled.id);
  assert.deepEqual(policyAt("free", [scheduled], T0 + 9 * DAY), UNRESTRICTED_POLICY);

  const after = resolveEffectiveAccess({ billingPlan: "free", grants: [scheduled], venue: OWNER, nowMs: T0 + 10 * DAY });
  assert.equal(after.effectivePlan, "premium");
  assert.equal(after.contentEnforced, true);
});

test("Cancelling a grant before it starts never activates enforcement, even after the planned start date passes", () => {
  const cancelled = grant({
    startsAt: new Date(T0 + 10 * DAY).toISOString(),
    revokedAt: new Date(T0 + 2 * DAY).toISOString(),
    endReason: "revoked",
  });
  assert.equal(grantHasStarted(cancelled, T0 + 20 * DAY), false);
  assert.equal(getGrantStatus(cancelled, OWNER, T0 + 20 * DAY), "cancelled_before_start");
  assert.deepEqual(policyAt("free", [cancelled], T0 + 20 * DAY), UNRESTRICTED_POLICY);
});

test("An ownership change before a scheduled grant starts never activates enforcement", () => {
  const scheduled = grant({
    startsAt: new Date(T0 + 10 * DAY).toISOString(),
    revokedAt: new Date(T0 + 3 * DAY).toISOString(),
    endReason: "ownership_changed",
  });
  assert.deepEqual(policyAt("free", [scheduled], T0 + 30 * DAY), UNRESTRICTED_POLICY);
});

test("Immediate grant then immediate revocation: it started, so enforcement is venue-scoped from then on", () => {
  const immediate = grant({
    startsAt: new Date(T0).toISOString(),
    revokedAt: new Date(T0 + 60_000).toISOString(),
    endReason: "revoked",
  });
  assert.equal(grantHasStarted(immediate, T0 + 120_000), true);
  assert.equal(getGrantStatus(immediate, OWNER, T0 + 120_000), "revoked");
  assert.deepEqual(policyAt("free", [immediate], T0 + 120_000), { enforced: true, plan: "free" });
});

test("A revocation at exactly starts_at counts as cancelled before start", () => {
  const g = grant({ revokedAt: new Date(T0).toISOString(), endReason: "revoked" });
  assert.equal(grantHasStarted(g, T0 + DAY), false);
});

test("Expiry boundary: ends_at is exclusive", () => {
  const g = grant();
  const end = Date.parse(g.endsAt!);
  assert.equal(getGrantStatus(g, OWNER, end - 1), "active");
  assert.equal(getGrantStatus(g, OWNER, end), "expired");
});

// ── Paid authority / restoration ─────────────────────────────────────────────

test("A grant never lowers access below an active paid subscription", () => {
  const proComp = grant({ planCode: "pro", grantType: "comp", endsAt: null });
  const a = resolveEffectiveAccess({ billingPlan: "premium", grants: [proComp], venue: OWNER, nowMs: T0 + DAY });
  assert.equal(a.effectivePlan, "premium");
  assert.equal(a.source, "subscription");
});

test("A later paid subscription restores content up to its own tier only", () => {
  const trial = grant();
  const p = policyAt("pro", [trial], T0 + 40 * DAY);
  assert.deepEqual(p, { enforced: true, plan: "pro" });
  assert.equal(publicImageLimit(p), 10);
});

test("Venues that never had a grant are completely unaffected", () => {
  const a = resolveEffectiveAccess({ billingPlan: "free", grants: [], venue: OWNER, nowMs: T0 });
  assert.equal(a.contentEnforced, false);
  assert.equal(a.effectivePlan, "free");
  assert.deepEqual(policyAt("premium", [], T0), UNRESTRICTED_POLICY);
});

test("Seeded / grandfathered recurring content stays active under Free enforcement", () => {
  const free = enforcedPolicy("free");
  assert.equal(isEventPubliclyActive(free, { recurrence: "weekly", isSeededEvent: true }), true);
  assert.equal(isDailySpecialPubliclyActive(free, { scheduleType: "weekly", isSeededSpecial: true }), true);
  assert.equal(isEventPubliclyActive(free, { recurrence: "none", isSeededEvent: false }), true, "one-time events unaffected");
  assert.equal(isDailySpecialPubliclyActive(free, { scheduleType: "one_time", isSeededSpecial: false }), true);
});
