import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static structural verification of src/lib/venueSubscriptions.ts (Phase 2A
 * foundation) — WITHOUT unit-testing its real Supabase-calling functions
 * directly (they use the real admin client with no DI seam, same reasoning
 * as tests/unit/subscriptions/updateOperatorPlanObservability.test.ts for
 * the operator-level equivalent). Two things this file exists to guard
 * forever, not just at introduction:
 *
 *   1. getVenueSubscription()/getVenuePlanCode() must NEVER read
 *      operators.plan or operator_subscriptions — the one rule Phase 2
 *      depends on (see venueSubscriptions.ts's own header). A future edit
 *      that "helpfully" adds an operator-level fallback here would silently
 *      reintroduce the exact cross-venue entitlement leak Phase 2 exists to
 *      fix.
 *   2. The legacy src/lib/subscriptions.ts (operator-level) file remains
 *      completely unchanged in every functional way — only a documentation
 *      comment was added in Phase 2A.
 */

const VENUE_SUBSCRIPTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/venueSubscriptions.ts"),
  "utf8"
);
const LEGACY_SUBSCRIPTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/subscriptions.ts"),
  "utf8"
);

function fnBody(source: string, name: string): string {
  const match = source.match(new RegExp(`export (?:async )?function ${name}[\\s\\S]*?\\n\\}`));
  assert.ok(match, `could not locate function ${name}`);
  return match![0];
}

// ═══════════════════════════════════════════════════════════════════════════
// A. No operator-level fallback, anywhere in the public read contract
// ═══════════════════════════════════════════════════════════════════════════

test("getVenueSubscription() never queries operators or operator_subscriptions", () => {
  const body = fnBody(VENUE_SUBSCRIPTIONS_SOURCE, "getVenueSubscription");
  assert.doesNotMatch(body, /\.from\("operators"\)/);
  assert.doesNotMatch(body, /\.from\("operator_subscriptions"\)/);
  assert.match(body, /\.from\("venue_subscriptions"\)/);
});

test("getVenuePlanCode() never queries operators or operator_subscriptions and has no 3-step fallback chain", () => {
  const body = fnBody(VENUE_SUBSCRIPTIONS_SOURCE, "getVenuePlanCode");
  assert.doesNotMatch(body, /\.from\("operators"\)/);
  assert.doesNotMatch(body, /\.from\("operator_subscriptions"\)/);
  assert.doesNotMatch(body, /operators\.plan/);
});

test("resolvePlanCodeFromVenueSubscription() is a pure 2-branch function — row → plan_code, else 'free' — with no operator table/column reference", () => {
  const body = fnBody(VENUE_SUBSCRIPTIONS_SOURCE, "resolvePlanCodeFromVenueSubscription");
  assert.match(body, /return "free"/);
  assert.match(body, /return row\.plan_code/);
  // "OperatorPlan" (the shared plan-value type, reused deliberately — see
  // Part 6 of the Phase 2A task) legitimately appears in the signature; only
  // an actual operator TABLE/COLUMN reference would be a real violation.
  assert.doesNotMatch(body, /\.from\("operators?"?\)/);
  assert.doesNotMatch(body, /operators?\.plan\b/i);
});

test("updateVenuePlan() writes through sync_venue_plan_entitlement exactly once and never touches operators or venues.plan", () => {
  const body = fnBody(VENUE_SUBSCRIPTIONS_SOURCE, "updateVenuePlan");
  assert.equal((body.match(/\.rpc\("sync_venue_plan_entitlement"/g) ?? []).length, 1);
  assert.doesNotMatch(body, /\.from\("operators"\)/);
  assert.doesNotMatch(body, /UPDATE public\.venues/i);
  assert.doesNotMatch(body, /venues\.plan/);
});

test("syncVenueStripeSubscription() plan-changing branch uses the venue RPC, not the operator RPC", () => {
  const body = fnBody(VENUE_SUBSCRIPTIONS_SOURCE, "syncVenueStripeSubscription");
  assert.match(body, /\.rpc\("sync_venue_plan_entitlement"/);
  assert.doesNotMatch(body, /sync_operator_plan_entitlement/);
  assert.doesNotMatch(body, /\.from\("operators"\)/);
  assert.doesNotMatch(body, /\.from\("operator_subscriptions"\)/);
});

test("the file's header explicitly documents the no-operator-fallback contract (guards against silent doc drift)", () => {
  assert.match(VENUE_SUBSCRIPTIONS_SOURCE, /NO OPERATOR-LEVEL FALLBACK/);
  assert.match(VENUE_SUBSCRIPTIONS_SOURCE, /no row\s+→\s+'free'/);
});

// ═══════════════════════════════════════════════════════════════════════════
// B. No live wiring — Phase 2A must not call this file from application code
// ═══════════════════════════════════════════════════════════════════════════

test("venueSubscriptions.ts is not imported by the live Stripe webhook route or subscription page in Phase 2A", () => {
  const webhookSource = readFileSync(
    join(__dirname, "../../../src/app/api/webhooks/stripe/route.ts"),
    "utf8"
  );
  const subscriptionPageSource = readFileSync(
    join(__dirname, "../../../src/app/admin/subscription/page.tsx"),
    "utf8"
  );
  assert.doesNotMatch(webhookSource, /venueSubscriptions/);
  assert.doesNotMatch(subscriptionPageSource, /venueSubscriptions/);
});

test("changePlanAction.ts and cancelActions.ts are not wired to venue-scoped helpers in Phase 2A", () => {
  const changePlanSource = readFileSync(
    join(__dirname, "../../../src/app/admin/subscription/changePlanAction.ts"),
    "utf8"
  );
  const cancelActionsSource = readFileSync(
    join(__dirname, "../../../src/app/admin/venue/cancelActions.ts"),
    "utf8"
  );
  assert.doesNotMatch(changePlanSource, /venueSubscriptions/);
  assert.doesNotMatch(cancelActionsSource, /venueSubscriptions/);
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Legacy operator-level file: unchanged in every functional way
// ═══════════════════════════════════════════════════════════════════════════

test("legacy subscriptions.ts still exports the same operator-level functions, unchanged", () => {
  assert.match(LEGACY_SUBSCRIPTIONS_SOURCE, /export async function getOperatorPlanCode/);
  assert.match(LEGACY_SUBSCRIPTIONS_SOURCE, /export async function updateOperatorPlan/);
  assert.match(LEGACY_SUBSCRIPTIONS_SOURCE, /export async function syncStripeSubscription/);
  assert.match(LEGACY_SUBSCRIPTIONS_SOURCE, /export async function getOperatorSubscription/);
});

test("legacy getOperatorPlanCode() still has its 3-step fallback chain unchanged — Phase 2A does not touch operator-level resolution", () => {
  const body = fnBody(LEGACY_SUBSCRIPTIONS_SOURCE, "getOperatorPlanCode");
  assert.match(body, /subscription\.plan_code/);
  assert.match(body, /\.from\("operators"\)/);
  assert.match(body, /\.select\("plan"\)/);
});

test("legacy updateOperatorPlan()/syncStripeSubscription() still call sync_operator_plan_entitlement, unchanged", () => {
  assert.match(LEGACY_SUBSCRIPTIONS_SOURCE, /\.rpc\("sync_operator_plan_entitlement"/);
});
