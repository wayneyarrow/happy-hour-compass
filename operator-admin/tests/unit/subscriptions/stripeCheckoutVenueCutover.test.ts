import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of the Phase 2B Stripe Checkout/Customer Portal
 * cutover (src/app/admin/subscription/stripeActions.ts). Both actions call
 * resolveOperatorContext()/Stripe directly with no DI seam, so this is a
 * structural verification of the source text, matching this repo's
 * established convention for this class of file.
 */

const STRIPE_ACTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/admin/subscription/stripeActions.ts"),
  "utf8"
);

function fnBody(name: string): string {
  const match = STRIPE_ACTIONS_SOURCE.match(
    new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`)
  );
  assert.ok(match, `could not locate function ${name}`);
  return match![0];
}

// ═══════════════════════════════════════════════════════════════════════════
// createCheckoutSessionAction
// ═══════════════════════════════════════════════════════════════════════════

test("createCheckoutSessionAction takes no venue parameter — cannot be spoofed by a client-supplied venue id", () => {
  assert.match(STRIPE_ACTIONS_SOURCE, /export async function createCheckoutSessionAction\(\s*\n\s*plan: "pro" \| "premium"\s*\n\)/);
});

test("createCheckoutSessionAction resolves the billed venue exclusively from ctx.activeVenueId", () => {
  const body = fnBody("createCheckoutSessionAction");
  assert.match(body, /const activeVenueId = ctx\.activeVenueId;/);
  assert.match(body, /if \(!activeVenueId\) \{/);
});

test("createCheckoutSessionAction metadata includes venue_id, operator_id, and target_plan on the session and the subscription_data — and venue_id/operator_id on the Stripe Customer object created during first-checkout reservation", () => {
  const body = fnBody("createCheckoutSessionAction");
  const metadataBlocks = body.match(/metadata: \{[\s\S]*?\}/g) ?? [];
  // 3 blocks as of the billing review's customer-reservation fix: the
  // Checkout Session's own metadata, subscription_data.metadata, and the
  // new stripe.customers.create() call's metadata (first-checkout only).
  assert.equal(metadataBlocks.length, 3, "expected 3 metadata blocks (session + subscription_data + customer creation)");
  const sessionAndSubBlocks = metadataBlocks.filter((b) => b.includes("target_plan"));
  assert.equal(sessionAndSubBlocks.length, 2, "expected exactly 2 metadata blocks carrying target_plan (session + subscription_data)");
  for (const block of sessionAndSubBlocks) {
    assert.match(block, /venue_id:\s*activeVenueId/);
    assert.match(block, /operator_id:\s*operatorId/);
    assert.match(block, /target_plan:\s*plan/);
  }
  const customerCreateBlock = metadataBlocks.find((b) => !b.includes("target_plan"));
  assert.ok(customerCreateBlock, "expected a metadata block on stripe.customers.create() without target_plan");
  assert.match(customerCreateBlock!, /venue_id:\s*activeVenueId/);
  assert.match(customerCreateBlock!, /operator_id:\s*operatorId/);
});

test("createCheckoutSessionAction resolves the Stripe customer from THIS venue's own subscription row, never an operator-level lookup", () => {
  const body = fnBody("createCheckoutSessionAction");
  assert.match(body, /getVenueSubscription\(activeVenueId\)/);
  assert.doesNotMatch(body, /getOperatorSubscription/);
});

test("createCheckoutSessionAction never grants paid entitlement before Stripe redirect — activation (plan_code away from Free) happens only in the webhook", () => {
  // Billing review fix (Part 2): a first-checkout reservation now DOES
  // write a venue_subscriptions row before redirecting to Stripe — but
  // only to atomically claim exactly one Stripe Customer for the venue
  // (plan_code stays 'free', no subscription id yet). The invariant that
  // must hold is narrower than "no DB write at all": no PAID entitlement
  // (updateVenuePlan / syncVenueStripeSubscription, or any plan_code other
  // than 'free') is ever written here.
  const body = fnBody("createCheckoutSessionAction");
  assert.doesNotMatch(body, /updateVenuePlan\(/);
  assert.doesNotMatch(body, /syncVenueStripeSubscription\(/);
  assert.doesNotMatch(body, /plan_code:\s*"(?!free")/);
});

test("createCheckoutSessionAction's only DB write is the atomic reservation helper — plan_code is hardcoded 'free' there, never the target plan", () => {
  const body = fnBody("createCheckoutSessionAction");
  assert.match(body, /reserveVenueStripeCustomer\(activeVenueId, newCustomer\.id\)/);
  const reservationHelperBody = readFileSync(
    join(__dirname, "../../../src/lib/venueSubscriptions.ts"),
    "utf8"
  ).match(/export async function reserveVenueStripeCustomer[\s\S]*?\n\}/)![0];
  assert.match(reservationHelperBody, /plan_code:\s*"free",/);
});

// ═══════════════════════════════════════════════════════════════════════════
// createPortalSessionAction
// ═══════════════════════════════════════════════════════════════════════════

test("createPortalSessionAction resolves the billed venue exclusively from ctx.activeVenueId and uses only that venue's Stripe customer", () => {
  const body = fnBody("createPortalSessionAction");
  assert.match(body, /const activeVenueId = ctx\.activeVenueId;/);
  assert.match(body, /getVenueSubscription\(activeVenueId\)/);
  assert.doesNotMatch(body, /getOperatorSubscription/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-cutting: no operator-level plan/subscription helpers anywhere in file
// ═══════════════════════════════════════════════════════════════════════════

test("stripeActions.ts imports only the venue-scoped subscription helper, not the legacy operator one", () => {
  assert.match(STRIPE_ACTIONS_SOURCE, /from "@\/lib\/venueSubscriptions"/);
  assert.doesNotMatch(STRIPE_ACTIONS_SOURCE, /from "@\/lib\/subscriptions"/);
});
