import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Part 8 of the Phase 2B billing architecture review: the Control Panel
 * operators list must never present operators.plan as though it were the
 * operator's authoritative current subscription — plan is venue-level, and
 * a multi-venue operator's venues can hold different plans. Static
 * verification of the smallest-truthful-solution fix: an explicitly
 * labelled "Highest Venue Plan" aggregate, computed from venue_subscriptions,
 * never operators.plan.
 */

const PAGE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/operators/page.tsx"),
  "utf8"
);
const TABLE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/operators/OperatorsTable.tsx"),
  "utf8"
);

test("the operators list query no longer selects operators.plan", () => {
  const selectCall = PAGE_SOURCE.match(/\.from\("operators"\)\s*\n\s*\.select\("([^"]+)"\)/)![1];
  assert.doesNotMatch(selectCall, /\bplan\b/);
});

test("plan is computed per-operator from venue_subscriptions via highestPlan(), never operators.plan", () => {
  assert.match(PAGE_SOURCE, /from "@\/lib\/venueSubscriptions"/);
  assert.match(PAGE_SOURCE, /highestPlan\(/);
  assert.match(PAGE_SOURCE, /\.from\("venue_subscriptions"\)\.select\("venue_id, plan_code"\)/);
});

test("the computed field is named highestVenuePlan, not plan — cannot be mistaken for an operator-wide subscription field", () => {
  assert.match(PAGE_SOURCE, /highestVenuePlan:\s*highestVenuePlanForOperator/);
  assert.doesNotMatch(PAGE_SOURCE, /^\s*plan:\s*\(op\.plan/m);
});

test("OperatorRow type documents the highest-venue-plan semantics and does not carry a bare 'plan' field", () => {
  const type = TABLE_SOURCE.match(/export type OperatorRow = \{[\s\S]*?\n\};/)![0];
  assert.match(type, /highestVenuePlan: string;/);
  assert.doesNotMatch(type, /^\s*plan: string;/m);
});

test("the table column is explicitly labelled 'Highest Venue Plan', not the generic 'Plan'", () => {
  assert.match(TABLE_SOURCE, /Highest Venue Plan/);
});

test("the CSV export header also uses the explicit label", () => {
  assert.match(TABLE_SOURCE, /"Highest Venue Plan"/);
});

test("no remaining live reference to op.plan in the table component", () => {
  assert.doesNotMatch(TABLE_SOURCE, /\bop\.plan\b/);
});
