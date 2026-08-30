import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for a defect found during the "Finalize and Commit"
 * pass (discovered while writing the cancellation disclosure copy): unlike
 * cancelActions.ts (fixed by the Phase 2B billing review), changePlanAction()
 * — the Change Plan modal's downgrade path AND the "Switch to Free Plan"
 * quick-action — wrote plan_code directly for every transition, including
 * one moving a venue OFF or WITHIN real Stripe billing, leaving the actual
 * Stripe subscription completely untouched (still billing the old amount
 * indefinitely). Same defect class, same fix pattern, applied here.
 *
 * changePlanAction() calls resolveOperatorContext()/Stripe/createAdminClient()
 * directly with no DI seam, so this is a static, structural verification of
 * the actual source text, matching every other flow-specific contract test
 * in this repo.
 */

const SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/subscription/changePlanAction.ts"),
  "utf8"
);

function branch(startMarker: string, endMarker: string): string {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start);
  assert.ok(start > -1 && end > -1, `could not isolate branch between "${startMarker}" and "${endMarker}"`);
  return SOURCE.slice(start, end);
}

test("no-op guard: targetPlan === oldPlan returns ok:true without touching Stripe or the DB", () => {
  assert.match(SOURCE, /if \(targetPlan === oldPlan\) \{/);
});

test("branches on whether the venue is CURRENTLY Stripe-backed — not on whether this is a downgrade, and not on impersonation status", () => {
  assert.match(SOURCE, /const isCurrentlyStripeBacked =/);
  assert.match(SOURCE, /if \(isCurrentlyStripeBacked\) \{/);
});

test("moving OFF Stripe billing (target not billable, e.g. → free): cancels the real Stripe subscription immediately", () => {
  const block = branch("if (!isStripeBillablePlan(targetPlan)) {", "// Staying on Stripe billing but changing tier");
  assert.match(block, /await stripe\.subscriptions\.cancel\(subscriptionId\);/);
});

test("moving OFF Stripe billing does NOT also call updateVenuePlan() or logPlanChangeEvent() — the resulting webhook is the sole writer, exactly like cancelActions.ts", () => {
  // The branch's own comment legitimately explains this rule in prose,
  // naming both functions — only an actual call is checked for here.
  const block = branch("if (!isStripeBillablePlan(targetPlan)) {", "// Staying on Stripe billing but changing tier");
  assert.doesNotMatch(block, /await updateVenuePlan\(/);
  assert.doesNotMatch(block, /await logPlanChangeEvent\(/);
  assert.match(block, /return \{ ok: true \};/);
});

test("changing tier while staying on Stripe billing (e.g. premium → pro): updates the real subscription's price, not merely the DB", () => {
  const block = branch("// Staying on Stripe billing but changing tier", "// Not currently Stripe-backed");
  assert.match(block, /stripe\.subscriptions\.retrieve\(subscriptionId\)/);
  assert.match(block, /stripe\.subscriptions\.update\(subscriptionId, \{/);
  assert.match(block, /items: \[\{ id: itemId, price: newPriceId \}\]/);
});

test("the in-place tier change uses proration_behavior: \"none\" — consistent with the product's existing no-refund/no-proration policy", () => {
  const block = branch("// Staying on Stripe billing but changing tier", "// Not currently Stripe-backed");
  assert.match(block, /proration_behavior:\s*"none"/);
});

test("the in-place tier change does NOT directly write the DB either — same single-writer rule as the cancel case", () => {
  const block = branch("// Staying on Stripe billing but changing tier", "// Not currently Stripe-backed");
  assert.doesNotMatch(block, /updateVenuePlan\(/);
  assert.doesNotMatch(block, /logPlanChangeEvent/);
});

test("a venue with NO active Stripe subscription (founder manual grant, or already Free/manual) still uses the direct DB write — unchanged", () => {
  const block = SOURCE.slice(SOURCE.indexOf("// Not currently Stripe-backed"));
  assert.match(block, /const result = await updateVenuePlan\(activeVenueId, targetPlan\);/);
  assert.match(block, /await logPlanChangeEvent\(/);
});

test("every new Stripe-interaction failure path reports critically and returns an error — never silently proceeds", () => {
  const criticalCalls = SOURCE.match(/await reportCriticalFailure\(\{/g) ?? [];
  assert.ok(criticalCalls.length >= 3, "expected at least 3 reportCriticalFailure call sites (client init, cancel failure, update failure)");
});

test("the venue's Stripe Customer is never deleted by this action — only the subscription is cancelled/updated", () => {
  assert.doesNotMatch(SOURCE, /stripe\.customers\.del/);
});
