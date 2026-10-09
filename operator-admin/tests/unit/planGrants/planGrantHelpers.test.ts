import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countRawSpecials,
  enforcedPolicy,
  summarizePausedContent,
  takeFirst,
  truncateRawSpecials,
  UNRESTRICTED_POLICY,
} from "@/lib/planGrants/contentPolicy";
import {
  PlanContextUnavailableError,
  resolveVenuePlanContext,
  VENUE_PLAN_CONTEXT_EMBED,
} from "@/lib/planGrants/publicPlanState";
import { accessThroughEndIso, daysUntil, lastAccessDateLabel, zonedMidnightIso } from "@/lib/planGrants/grantDates";
import { describePlanBadges } from "@/lib/planGrants/planBadges";
import { resolveEffectiveAccess, noGrantAccess, type PlanGrant } from "@/lib/planGrants/grantState";
import { formatPlanGrantEvent, formatPlanGrantExpiry } from "@/lib/planGrants/grantTimeline";

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T07:00:00.000Z");
const OWNER = { createdByOperatorId: "op-1", claimedAt: "2026-09-01T00:00:00.000Z" };

function grant(overrides: Partial<PlanGrant> = {}): PlanGrant {
  return {
    id: "g-1",
    venueId: "v-1",
    planCode: "premium",
    grantType: "comp",
    startsAt: new Date(T0).toISOString(),
    endsAt: null,
    reason: "Launch partner",
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

// ── Deterministic content selection ──────────────────────────────────────────

test("truncateRawSpecials keeps the first N items in stored order (JSON)", () => {
  const raw = JSON.stringify([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }]);
  assert.deepEqual(JSON.parse(truncateRawSpecials(raw, 3)!), [{ name: "A" }, { name: "B" }, { name: "C" }]);
  assert.equal(truncateRawSpecials(raw, Infinity), raw, "unrestricted is untouched");
  assert.equal(truncateRawSpecials(raw, 10), raw, "under the limit is untouched");
});

test("truncateRawSpecials handles legacy pipe/newline text and empty values", () => {
  assert.equal(truncateRawSpecials("a | b | c | d", 2), "a | b");
  assert.equal(truncateRawSpecials("a\nb\nc\nd", 3), "a\nb\nc");
  assert.equal(truncateRawSpecials(null, 3), null);
  assert.equal(truncateRawSpecials("", 3), "");
  assert.equal(countRawSpecials("a | b | c"), 3);
  assert.equal(countRawSpecials(JSON.stringify(["x", "", null, "y"])), 2);
});

test("takeFirst is order-preserving and a no-op when unrestricted", () => {
  assert.deepEqual(takeFirst([1, 2, 3, 4, 5, 6], 5), [1, 2, 3, 4, 5]);
  const list = [1, 2];
  assert.equal(takeFirst(list, Infinity), list);
});

test("summarizePausedContent counts only content outside the effective plan, excluding seeded recurring", () => {
  const counts = {
    recurringEvents: 4, seededRecurringEvents: 1, weeklySpecials: 3, seededWeeklySpecials: 3,
    foodSpecials: 8, drinkSpecials: 2, images: 12, searchTags: 6,
  };
  const free = summarizePausedContent(enforcedPolicy("free"), counts);
  assert.deepEqual(free, {
    recurringEvents: 3, weeklySpecials: 0, foodSpecials: 5, drinkSpecials: 0, images: 7, searchTags: 6, total: 21,
  });
  const pro = summarizePausedContent(enforcedPolicy("pro"), counts);
  assert.equal(pro.recurringEvents, 0);
  assert.equal(pro.images, 2);
  assert.equal(pro.foodSpecials, 2);
  assert.equal(pro.searchTags, 1);
  assert.equal(summarizePausedContent(UNRESTRICTED_POLICY, counts).total, 0);
});

// ── Public plan context (embedded in the content query) ──────────────────────

/** A venue row exactly as PostgREST returns VENUE_PLAN_CONTEXT_EMBED. */
function venueRow(grants: PlanGrant[], billing: string | null = null, owner = OWNER) {
  return {
    plan_ctx_operator_id: owner.createdByOperatorId,
    plan_ctx_claimed_at: owner.claimedAt,
    plan_ctx_subscription: billing ? { plan_code: billing } : null,
    plan_ctx_grants: grants.map((g) => ({
      id: g.id, venue_id: g.venueId, plan_code: g.planCode, grant_type: g.grantType,
      starts_at: g.startsAt, ends_at: g.endsAt, reason: g.reason, operator_id: g.operatorId,
      owner_claimed_at: g.ownerClaimedAt, created_by_email: g.createdByEmail, created_at: g.createdAt,
      revoked_at: g.revokedAt, end_reason: g.endReason, revoked_by_email: g.revokedByEmail, revoke_reason: g.revokeReason,
    })),
  };
}

test("embed fragment aliases every field (never collides with or changes existing venue columns)", () => {
  assert.match(VENUE_PLAN_CONTEXT_EMBED, /^plan_ctx_operator_id:created_by_operator_id, plan_ctx_claimed_at:claimed_at, plan_ctx_subscription:venue_subscriptions\(plan_code\), plan_ctx_grants:venue_plan_grants!venue_plan_grants_venue_id_fkey\(/);
});

test("successful lookup, no grants → unrestricted, ranking = billing plan (existing behaviour)", () => {
  const ctx = resolveVenuePlanContext(venueRow([], "pro"), T0);
  assert.deepEqual(ctx.policy, UNRESTRICTED_POLICY);
  assert.equal(ctx.rankingPlan, "pro");
  // Array-shaped to-one embed is normalised too.
  const arr = { ...venueRow([]), plan_ctx_subscription: [{ plan_code: "premium" }] };
  assert.equal(resolveVenuePlanContext(arr, T0).rankingPlan, "premium");
});

test("successful lookup with grants: active lifts ranking; expired recipient enforced at billing plan", () => {
  const active = resolveVenuePlanContext(venueRow([grant()]), T0 + DAY);
  assert.deepEqual(active.policy, { enforced: true, plan: "premium" });
  assert.equal(active.rankingPlan, "premium");

  const expired = grant({ grantType: "trial", startsAt: new Date(T0 - 40 * DAY).toISOString(), endsAt: new Date(T0 - 10 * DAY).toISOString() });
  const ctx = resolveVenuePlanContext(venueRow([expired], "pro"), T0);
  assert.deepEqual(ctx.policy, { enforced: true, plan: "pro" });
  assert.equal(ctx.rankingPlan, "pro");

  const scheduled = grant({ startsAt: new Date(T0 + 5 * DAY).toISOString() });
  assert.deepEqual(resolveVenuePlanContext(venueRow([scheduled]), T0).policy, UNRESTRICTED_POLICY);
});

function omit(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

test("FAILURE PATH: a venue row without the grant embed throws — never silently unrestricted", () => {
  assert.throws(() => resolveVenuePlanContext(omit(venueRow([grant()]), "plan_ctx_grants"), T0), PlanContextUnavailableError);
  assert.throws(() => resolveVenuePlanContext({ ...venueRow([]), plan_ctx_grants: null }, T0), PlanContextUnavailableError);
});

test("FAILURE PATH: missing billing or ownership embed throws (a recipient's tier can't be guessed)", () => {
  assert.throws(() => resolveVenuePlanContext(omit(venueRow([grant()]), "plan_ctx_subscription"), T0), PlanContextUnavailableError);
  assert.throws(() => resolveVenuePlanContext(omit(venueRow([grant()]), "plan_ctx_claimed_at"), T0), PlanContextUnavailableError);
});

test("a row with no venue at all (no venue → no grants possible) is unrestricted", () => {
  assert.deepEqual(resolveVenuePlanContext(null, T0).policy, UNRESTRICTED_POLICY);
  assert.deepEqual(resolveVenuePlanContext(undefined, T0).policy, UNRESTRICTED_POLICY);
});

// ── Founder date entry (Pacific) ─────────────────────────────────────────────

test("grant dates are interpreted in Pacific time; 'access through D' ends at the next local midnight", () => {
  assert.equal(zonedMidnightIso("2026-10-09"), "2026-10-09T07:00:00.000Z"); // PDT
  assert.equal(zonedMidnightIso("2026-12-01"), "2026-12-01T08:00:00.000Z"); // PST
  assert.equal(accessThroughEndIso("2026-10-31"), "2026-11-01T07:00:00.000Z"); // DST ends Nov 1 at 2am
  assert.equal(accessThroughEndIso("2026-11-01"), "2026-11-02T08:00:00.000Z");
  assert.equal(lastAccessDateLabel("2026-11-01T07:00:00.000Z"), "Oct 31, 2026");
  assert.equal(zonedMidnightIso("2026-02-30"), null);
  assert.equal(zonedMidnightIso("not a date"), null);
  assert.equal(daysUntil(new Date(T0 + 2.5 * DAY).toISOString(), T0), 3);
  assert.equal(daysUntil(new Date(T0 - 1).toISOString(), T0), 0);
});

// ── Funnel badges: billing vs grant kept separate ────────────────────────────

test("badges: grant-only venue is 'Premium Comp · Non-paying' and counts as non-paying", () => {
  const access = resolveEffectiveAccess({ billingPlan: "free", grants: [grant()], venue: OWNER, nowMs: T0 + DAY });
  const { badges, paidStatus } = describePlanBadges({ billingPlan: "free", billingKind: "manual", access });
  assert.deepEqual(badges.map((b) => b.label), ["Premium Comp · Non-paying"]);
  assert.equal(badges[0].detail, "No expiry");
  assert.equal(paidStatus, "non_paying_grant");
});

test("badges: Pro payer with Premium Comp shows both statuses and counts as paying", () => {
  const access = resolveEffectiveAccess({ billingPlan: "pro", grants: [grant({ endsAt: new Date(T0 + 10 * DAY).toISOString() })], venue: OWNER, nowMs: T0 + DAY });
  const { badges, paidStatus } = describePlanBadges({ billingPlan: "pro", billingKind: "stripe", access });
  assert.deepEqual(badges.map((b) => b.label), ["Pro Paid", "Premium Comp"]);
  assert.match(badges[1].detail ?? "", /^Through /);
  assert.equal(paidStatus, "paying");
});

test("badges: Pro Trial on a Free venue; superseded grant; manual billing row; plain Free", () => {
  const trial = resolveEffectiveAccess({ billingPlan: "free", grants: [grant({ planCode: "pro", grantType: "trial", endsAt: new Date(T0 + 14 * DAY).toISOString() })], venue: OWNER, nowMs: T0 + DAY });
  assert.equal(describePlanBadges({ billingPlan: "free", billingKind: "manual", access: trial }).badges[0].label, "Pro Trial · Non-paying");

  const superseded = resolveEffectiveAccess({ billingPlan: "premium", grants: [grant()], venue: OWNER, nowMs: T0 + DAY });
  assert.deepEqual(
    describePlanBadges({ billingPlan: "premium", billingKind: "stripe", access: superseded }).badges.map((b) => b.label),
    ["Premium Paid", "Premium Comp (superseded)"]
  );

  const manual = describePlanBadges({ billingPlan: "premium", billingKind: "manual", access: noGrantAccess("premium") });
  assert.deepEqual(manual.badges.map((b) => b.label), ["Premium · Manual (not Stripe-billed)"]);
  assert.equal(manual.paidStatus, "manual");

  const free = describePlanBadges({ billingPlan: "free", billingKind: "manual", access: noGrantAccess("free") });
  assert.deepEqual(free.badges.map((b) => b.label), ["Free"]);
  assert.equal(free.paidStatus, null);
});

// ── Timeline ─────────────────────────────────────────────────────────────────

test("timeline: founder events keep the founder as author; expiry is a synthetic system entry", () => {
  const g = grant({ grantType: "trial", endsAt: new Date(T0 + 14 * DAY).toISOString() });
  const granted = formatPlanGrantEvent(
    { id: "e1", grant_id: g.id, event_type: "granted", actor_email: "founder@example.com", previous_ends_at: null, new_ends_at: g.endsAt, note: "Launch", metadata_json: { scheduled: false }, created_at: g.createdAt },
    g
  );
  assert.ok(granted);
  assert.match(granted.note, /^Premium Trial granted \(access through .+\)\. Non-paying grant\. Reason: Launch$/);
  assert.equal(granted.actorEmail, "founder@example.com");

  const ownership = formatPlanGrantEvent(
    { id: "e2", grant_id: g.id, event_type: "ownership_changed", actor_email: null, previous_ends_at: g.endsAt, new_ends_at: null, note: null, metadata_json: {}, created_at: g.createdAt },
    g
  );
  assert.match(ownership!.note, /ended permanently — venue ownership changed/);
  assert.equal(ownership!.actorEmail, null);

  assert.equal(formatPlanGrantExpiry(g, T0 + 13 * DAY), null, "not yet expired");
  assert.match(formatPlanGrantExpiry(g, T0 + 15 * DAY)!.note, /^Premium Trial expired/);
  assert.equal(
    formatPlanGrantExpiry({ ...g, revokedAt: new Date(T0 + DAY).toISOString(), endReason: "revoked" }, T0 + 15 * DAY),
    null,
    "a grant revoked before its end date never also shows as expired"
  );
});
