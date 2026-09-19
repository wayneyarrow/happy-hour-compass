import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 2A-4 — structural wiring checks for the new "Operator activation
 * reviews" Action Center card. src/lib/data/actionCenter.ts and
 * action-center/page.tsx call createAdminClient()/Supabase and render JSX
 * directly with no DI seam (same reasoning as every other flow-specific
 * contract test in this repo — see actionCenterVenuePlanQueries.test.ts) —
 * these are static, structural verifications of the actual source text.
 * The real query behavior (union/dedup, exclusions, N+1-safety) is covered
 * with real function calls in activationReviews.test.ts.
 */

const ACTION_CENTER_SOURCE = readFileSync(join(__dirname, "../../../src/lib/data/actionCenter.ts"), "utf8");
const PAGE_SOURCE = readFileSync(join(__dirname, "../../../src/app/control-panel/action-center/page.tsx"), "utf8");
const REPORT_PAGE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/action-center/reports/operator-activation-reviews/page.tsx"),
  "utf8"
);

test("actionCenter.ts imports and wires getOperatorActivationReviewSummary into getActionCenterSummary()", () => {
  assert.match(ACTION_CENTER_SOURCE, /from "@\/lib\/activation\/activationReviews"/);
  assert.match(ACTION_CENTER_SOURCE, /getOperatorActivationReviewSummary\(/);
  assert.match(ACTION_CENTER_SOURCE, /operatorActivationReviews:\s*number/);
});

test("actionCenter.ts's summary reuses the review function's own total rather than a separate count computation — matches the established anti-drift convention", () => {
  assert.match(ACTION_CENTER_SOURCE, /operatorActivationReviews:\s*operatorActivationReviewsBreakdown\.total/);
});

test("the Action Center page lists the new card, pointing at the correct report route", () => {
  assert.match(PAGE_SOURCE, /operatorActivationReviews/);
  assert.match(PAGE_SOURCE, /\/control-panel\/action-center\/reports\/operator-activation-reviews/);
  assert.match(PAGE_SOURCE, /Operator activation reviews/i);
});

test("the report page queries lifecycle candidates directly via getOperatorActivationReviews — never by fetching every claim/submission first", () => {
  assert.match(REPORT_PAGE_SOURCE, /getOperatorActivationReviews\(/);
  assert.doesNotMatch(REPORT_PAGE_SOURCE, /from\("venue_claims"\)/);
  assert.doesNotMatch(REPORT_PAGE_SOURCE, /from\("operator_submissions"\)/);
});

test("Action Center authorization is inherited from the existing /control-panel layout gate — no separate auth check was added to the new page or report", () => {
  assert.doesNotMatch(PAGE_SOURCE, /isControlPanelAdmin/);
  assert.doesNotMatch(REPORT_PAGE_SOURCE, /isControlPanelAdmin/);
});
