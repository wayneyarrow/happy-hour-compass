import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Finalize and Commit" task, Part 2: the operator-facing confirmation UI
 * for Cancel Venue (and the two other UI surfaces that now trigger the same
 * real Stripe behavior — the "Switch to Free Plan" quick-action and the
 * Change Plan modal's downgrade confirmation) must clearly disclose, before
 * confirmation, that:
 *   - the venue is unpublished immediately
 *   - any active paid subscription ends immediately
 *   - unused time remaining in the current billing period is not refunded
 */

const CANCEL_SECTION_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/venue/CancelVenueSection.tsx"),
  "utf8"
);
const CHANGE_PLAN_MODAL_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/subscription/ChangePlanModal.tsx"),
  "utf8"
);

test("Cancel Venue confirmation discloses immediate unpublish", () => {
  assert.match(CANCEL_SECTION_SOURCE, /unpublished immediately/);
});

test("Cancel Venue confirmation discloses that an active paid subscription ends immediately, with no refund for unused time", () => {
  assert.match(CANCEL_SECTION_SOURCE, /Any active paid subscription will end immediately\. Unused time remaining in the current billing period will not be refunded\./);
});

test("the disclosure is shown only for venues actually on a paid plan (isPaidPlan) — not a false claim for a Free venue with nothing to end", () => {
  const confirmStep = CANCEL_SECTION_SOURCE.split('{step === "confirm" && (')[1];
  assert.match(confirmStep, /\{isPaidPlan && \(/);
});

test("the 'Switch to Free Plan' quick-action carries the same billing disclosure — it now triggers the same real Stripe cancellation", () => {
  const paidSavePathStep = CANCEL_SECTION_SOURCE.split('{step === "paid-save-path" && (')[1].split('{switchError')[0];
  assert.match(paidSavePathStep, /Any active paid subscription will end immediately/);
  assert.match(paidSavePathStep, /will not be refunded/);
});

test("the Change Plan modal's non-Checkout downgrade confirmation carries the same billing disclosure", () => {
  assert.match(
    CHANGE_PLAN_MODAL_SOURCE,
    /Your plan will change immediately\. Any active paid subscription will end immediately, and unused time remaining in the current billing period will not be refunded\./
  );
});

test("the Change Plan modal's upgrade confirmation is unaffected — the billing disclosure applies only to non-Checkout downgrades", () => {
  const messageBlock = CHANGE_PLAN_MODAL_SOURCE.match(/\{isStripeCheckout[\s\S]*?\}\s*\n\s*<\/p>/)![0];
  assert.match(messageBlock, /: isUpgrade\s*\n\s*\? "Your plan will change immediately\."/);
});
