import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the paid-tier-upgrade defect found during Phase 2B
 * hosted staging QA: ChangePlanModal.tsx routed ANY transition ranked
 * "higher" (PLAN_RANK) to pro/premium through createCheckoutSessionAction —
 * including a venue that was ALREADY Stripe-backed (e.g. Pro -> Premium),
 * opening a brand-new Checkout Session for a Customer that already had an
 * active Subscription. If completed, this would create a second concurrent
 * Stripe subscription for the same venue/customer, instead of reusing
 * changePlanAction.ts's already-correct in-place stripe.subscriptions.update
 * path (the same path Premium -> Pro correctly used, since that direction is
 * a "downgrade" by PLAN_RANK and was never routed through Checkout).
 *
 * Fix: the Checkout-vs-in-place-update decision must depend on whether the
 * venue is CURRENTLY Stripe-backed (isCurrentlyStripeBacked, server-resolved
 * in page.tsx exactly like changePlanAction.ts's own definition), never on
 * PLAN_RANK direction alone.
 *
 * No React render harness exists in this repo (no testing-library/jsdom) and
 * ChangePlanModal.tsx calls resolveOperatorContext()/Stripe indirectly with
 * no DI seam either — same reasoning as every other flow-specific contract
 * test here — so this is a static, structural verification of the actual
 * source text and the exact boolean formula driving the routing decision.
 */

const MODAL_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/subscription/ChangePlanModal.tsx"),
  "utf8"
);
const PAGE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/subscription/page.tsx"),
  "utf8"
);
const ACTION_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/subscription/changePlanAction.ts"),
  "utf8"
);

// ── A/B: still-Free (or otherwise not-Stripe-backed) upgrades to a paid tier
// still need a brand-new Checkout Session ───────────────────────────────────

test("needsNewCheckout requires the venue to NOT already be Stripe-backed", () => {
  const decl = MODAL_SOURCE.match(/const needsNewCheckout =\s*\n([\s\S]*?);/)?.[1];
  assert.ok(decl, "could not find the needsNewCheckout declaration");
  assert.match(decl!, /!isCurrentlyStripeBacked/);
});

test("needsNewCheckout is scoped to the two self-serve Stripe-billable target plans (pro/premium) — free is never routed to Checkout", () => {
  const decl = MODAL_SOURCE.match(/const needsNewCheckout =\s*\n([\s\S]*?);/)?.[1];
  assert.match(decl!, /selectedPlan === "pro"/);
  assert.match(decl!, /selectedPlan === "premium"/);
});

// ── C/D: an already-Stripe-backed venue changing between paid tiers, in
// EITHER direction, must never re-derive the routing decision from
// PLAN_RANK/isUpgrade alone ─────────────────────────────────────────────────

test("the routing decision does not read PLAN_RANK or isUpgrade — only isCurrentlyStripeBacked and the target plan", () => {
  const decl = MODAL_SOURCE.match(/const needsNewCheckout =\s*\n([\s\S]*?);/)?.[1];
  assert.doesNotMatch(decl!, /PLAN_RANK/);
  assert.doesNotMatch(decl!, /isUpgrade/);
});

test("handleConfirm branches on needsNewCheckout, not on a separately re-derived rank-based flag", () => {
  const block = MODAL_SOURCE.slice(
    MODAL_SOURCE.indexOf("function handleConfirm"),
    MODAL_SOURCE.indexOf("// Auto-open on mount")
  );
  assert.match(block, /if \(needsNewCheckout\) \{/);
  assert.doesNotMatch(block, /isStripeUpgrade/);
  assert.doesNotMatch(block, /PLAN_RANK\[selectedPlan\] > PLAN_RANK\[visibleCurrentPlan\]/);
});

test("the non-Checkout branch of handleConfirm calls changePlanAction — the same server action already implementing the in-place Stripe subscription update for Stripe-backed tier changes", () => {
  const block = MODAL_SOURCE.slice(
    MODAL_SOURCE.indexOf("function handleConfirm"),
    MODAL_SOURCE.indexOf("// Auto-open on mount")
  );
  assert.match(block, /await changePlanAction\(selectedPlan\)/);
});

test("changePlanAction.ts's Stripe-backed + Stripe-billable-target branch (the path Pro<->Premium now reaches) updates the existing subscription in place — unchanged by this fix", () => {
  const block = ACTION_SOURCE.slice(
    ACTION_SOURCE.indexOf("// Staying on Stripe billing but changing tier"),
    ACTION_SOURCE.indexOf("// Not currently Stripe-backed")
  );
  assert.match(block, /stripe\.subscriptions\.retrieve\(subscriptionId\)/);
  assert.match(block, /stripe\.subscriptions\.update\(subscriptionId, \{/);
  assert.doesNotMatch(block, /checkout\.sessions\.create/);
});

// ── E: paid Stripe-backed -> Free must still go through changePlanAction's
// cancellation branch, never Checkout ───────────────────────────────────────

test("moving to Free is never treated as needing a new Checkout — 'free' is excluded from the pro/premium check", () => {
  const decl = MODAL_SOURCE.match(/const needsNewCheckout =\s*\n([\s\S]*?);/)?.[1];
  assert.doesNotMatch(decl!, /selectedPlan === "free"/);
});

// ── F: no client-supplied venue/customer/subscription identity anywhere in
// this routing path — active-venue server resolution only, unchanged ───────

test("neither createCheckoutSessionAction's plan param nor changePlanAction's newPlan param carry a venue/customer/subscription id — both remain server-resolved from the active venue only", () => {
  assert.doesNotMatch(MODAL_SOURCE, /createCheckoutSessionAction\([^)]*venueId/i);
  assert.doesNotMatch(MODAL_SOURCE, /changePlanAction\([^)]*venueId/i);
  assert.doesNotMatch(MODAL_SOURCE, /createCheckoutSessionAction\([^)]*customerId/i);
});

// ── Prop plumbing: isCurrentlyStripeBacked must be computed with the exact
// same definition changePlanAction.ts itself uses, and passed through from
// page.tsx (not re-derived insecurely from client-visible state) ───────────

test("page.tsx computes isCurrentlyStripeBacked using the exact same definition changePlanAction.ts uses (billing_provider === stripe AND a subscription id exists)", () => {
  const decl = PAGE_SOURCE.match(/const isCurrentlyStripeBacked =\s*\n([\s\S]*?);/)?.[1];
  assert.ok(decl, "could not find isCurrentlyStripeBacked in page.tsx");
  assert.match(decl!, /billingProvider === "stripe"/);
  assert.match(decl!, /billing_provider_subscription_id/);

  assert.match(ACTION_SOURCE, /const isCurrentlyStripeBacked =\s*\n\s*subscription\?\.billing_provider === "stripe" && !!subscription\.billing_provider_subscription_id;/);
});

test("page.tsx passes isCurrentlyStripeBacked into ChangePlanModal", () => {
  assert.match(PAGE_SOURCE, /isCurrentlyStripeBacked=\{isCurrentlyStripeBacked\}/);
});

test("ChangePlanModal's props type declares isCurrentlyStripeBacked as a plain boolean (server-resolved, not a raw provider/customer-id pair the client could reinterpret)", () => {
  assert.match(MODAL_SOURCE, /isCurrentlyStripeBacked: boolean;/);
});

// ── ConfirmView copy/labels must reflect the corrected routing, not the old
// rank-based isStripeCheckout ───────────────────────────────────────────────

test("isStripeCheckout passed to ConfirmView is exactly needsNewCheckout — not re-derived from isUpgrade", () => {
  assert.match(MODAL_SOURCE, /isStripeCheckout=\{needsNewCheckout\}/);
  assert.doesNotMatch(MODAL_SOURCE, /isStripeCheckout=\{isUpgrade/);
});
