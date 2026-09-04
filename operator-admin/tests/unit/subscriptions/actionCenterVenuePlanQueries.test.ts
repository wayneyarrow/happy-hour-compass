import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 2B — structural regression coverage for the 8 Action Center report
 * functions that resolve venue plan. src/lib/data/actionCenter.ts calls
 * createAdminClient()/Supabase directly with no DI seam (same reasoning as
 * every other flow-specific contract test in this repo — see
 * cancelVenueActionRegression.test.ts) — these are static, structural
 * verifications of the actual source text: proving each report queries
 * venue_subscriptions keyed by venue_id and resolves plan via
 * planMap.get(v.id), never operator_subscriptions/planMap.get(opId).
 *
 * The pure resolution logic itself (buildVenuePlanMap) is covered with real
 * function calls in actionCenterVenuePlanMap.test.ts.
 *
 * Root cause this guards against regressing: prior to this fix, every one
 * of these functions resolved plan via the legacy, operator-level
 * buildPlanMap()/operator_subscriptions/operators.plan path — stale since
 * the Phase 2B venue-level subscription cutover (see file header comment
 * on buildVenuePlanMap in actionCenter.ts, and src/lib/venueSubscriptions.ts's
 * own header for why an operator-level fallback is unsafe once one operator
 * can own venues on different plans).
 */

const SOURCE = readFileSync(join(__dirname, "../../../src/lib/data/actionCenter.ts"), "utf8");

// ── 7 & 8. No stale legacy plan resolution left anywhere in the file ────────

test("7 & 8. the legacy operator-level resolver is gone entirely — no buildPlanMap, no SubPlanRow, no operator_subscriptions query, no operators.plan read", () => {
  assert.doesNotMatch(SOURCE, /function buildPlanMap\(/);
  assert.doesNotMatch(SOURCE, /\bSubPlanRow\b/);
  assert.doesNotMatch(SOURCE, /\.from\("operator_subscriptions"\)/);
  assert.doesNotMatch(SOURCE, /OPERATOR_SELECT\s*=\s*"[^"]*\bplan\b/); // operators.plan no longer selected
});

test("the canonical batched resolver (buildVenuePlanMap) is present and reads only venue-shaped fields, never operator-level ones", () => {
  const fn = SOURCE.match(/export function buildVenuePlanMap\([\s\S]*?\n}/)![0];
  assert.match(fn, /row\.status === "cancelled" \? "free" : parseOperatorPlan\(row\.plan_code\)/);
  // parseOperatorPlan is just the shared plan-string normalizer (plans.ts) —
  // its name contains "operator" but it takes no operator identity as input.
  // What must never appear here is an actual operator-level field/table.
  assert.doesNotMatch(fn, /operator_id/);
  assert.doesNotMatch(fn, /operator_subscriptions/);
  assert.doesNotMatch(fn, /operators\.plan/);
});

function reportBody(name: string, nextName: string): string {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `expected to find export async function ${name}(`);
  const rest = SOURCE.slice(start);
  const endIdx = rest.indexOf(`export async function ${nextName}(`);
  assert.ok(endIdx > -1, `expected to find export async function ${nextName}( after ${name}`);
  return rest.slice(0, endIdx);
}

// Each of the 8 functions Phase 2A/2B identified — verifies it queries
// venue_subscriptions keyed by venue_id (never operator_subscriptions keyed
// by operator_id) and resolves plan via planMap.get(v.id)-shaped lookups
// (never planMap.get(opId)).

// getActionCenterSummary is intentionally NOT in this list as of Phase 3:
// it no longer resolves venue plan (or computes upgradeOpportunities) at
// all — it reuses getUpgradeOpportunities()'s own row count instead of
// duplicating that computation inline (the duplicate had already silently
// diverged from the real report once Phase 3 added an Events opportunity
// type the inline copy didn't know about — same class of bug the
// unusedSearchTagRows reuse a few lines above it in actionCenter.ts exists
// to avoid). getUpgradeOpportunities' own venue_subscriptions/
// buildVenuePlanMap usage is still fully covered below, so removing
// getActionCenterSummary here does not reduce coverage of the invariant
// this file guards.
const REPORTS: [string, string][] = [
  ["getActiveStillOnboarding",       "getInactiveOperators"],
  ["getInactiveOperators",           "getUnpublishedVenues"],
  ["getUnpublishedVenues",           "getUpgradeOpportunities"],
  ["getUpgradeOpportunities",        "getHighDemandVenues"],
  ["getHighDemandVenues",            "getHighDemandEvents"],
  ["getHighDemandEvents",            "getVerifiedWithoutOperators"],
  ["getUnusedSearchTagsOpportunities", "__EOF__"],
];

for (const [name, next] of REPORTS) {
  test(`${name}() queries venue_subscriptions (venue_id-keyed) and calls buildVenuePlanMap`, () => {
    const body = next === "__EOF__" ? SOURCE.slice(SOURCE.indexOf(`export async function ${name}(`)) : reportBody(name, next);
    assert.match(body, /\.from\("venue_subscriptions"\)\.select\("venue_id, plan_code, status"\)/);
    assert.match(body, /buildVenuePlanMap\(/);
    assert.doesNotMatch(body, /operator_subscriptions/);
  });

  test(`${name}() never resolves plan via planMap.get(opId) — only venue-id-shaped lookups`, () => {
    const body = next === "__EOF__" ? SOURCE.slice(SOURCE.indexOf(`export async function ${name}(`)) : reportBody(name, next);
    assert.doesNotMatch(body, /planMap\.get\(opId\)/);
  });
}

// ── 5 & 6. Upgrade Opportunity: venue-specific, multi-venue-safe ────────────

test("5 & 6. getUpgradeOpportunities() resolves each venue's plan by v.id, so a Premium venue is never evaluated against Free limits merely because its operator also owns a Free venue", () => {
  const body = reportBody("getUpgradeOpportunities", "getHighDemandVenues");
  assert.match(body, /const plan = planMap\.get\(v\.id\) \?\? "free";/);
  // The eligibility gate (Free/Pro only) and entitlement checks are otherwise
  // unchanged — this fix only touches how `plan` itself is resolved.
  assert.match(body, /if \(plan !== "free" && plan !== "pro"\) continue;/);
  assert.match(body, /maxImages\(plan\)/);
  assert.match(body, /maxFoodSpecials\(plan\)/);
  assert.match(body, /maxDrinkSpecials\(plan\)/);
  assert.match(body, /maxUsers\(plan\)/);
});

// ── 11. Unrelated report logic is untouched by this fix ─────────────────────

test("11. onboarding/setup-health, demand, inactivity, publication, and search-tag logic are unchanged by this fix", () => {
  // Spot-check the business rules this task explicitly must not alter.
  assert.match(SOURCE, /const HIGH_DEMAND_VENUE = 10;/);
  assert.match(SOURCE, /const HIGH_DEMAND_EVENT = 5;/);
  assert.match(SOURCE, /const INACTIVE_DAYS = 30;/);
  assert.match(SOURCE, /const SETUP_ITEMS_TOTAL = 6;/);
  assert.match(SOURCE, /if \(setupHealthScorePct < 90\) continue;/);
  assert.match(SOURCE, /if \(plan !== "pro" && plan !== "premium"\) continue; \/\/ paid plans only/);
  assert.match(SOURCE, /computeVenueSetupStatus\(/);
});
