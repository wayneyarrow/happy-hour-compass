import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of the Phase 2B Stripe webhook venue-resolution
 * cutover (src/app/api/webhooks/stripe/route.ts). Part 8 of the task:
 * every event handler must resolve a VENUE (metadata → customer mapping →
 * subscription mapping), never an operator, and must FAIL LOUDLY rather
 * than guess when metadata and the stored mapping disagree.
 */

const ROUTE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/api/webhooks/stripe/route.ts"),
  "utf8"
);

const EVENT_CASES = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
];

test("all 5 documented event types are handled", () => {
  for (const eventType of EVENT_CASES) {
    assert.match(ROUTE_SOURCE, new RegExp(`case "${eventType.replace(/\./g, "\\.")}":`));
  }
});

test("resolveVenueForEvent() is called from every subscription/invoice event branch (not checkout, which resolves + mismatch-checks directly against metadata)", () => {
  const occurrences = ROUTE_SOURCE.match(/await resolveVenueForEvent\(\{/g) ?? [];
  // customer.subscription.updated, customer.subscription.deleted,
  // invoice.payment_succeeded, invoice.payment_failed = 4 call sites.
  // checkout.session.completed uses the same helper too (5th) to confirm no
  // pre-existing customer mapping disagrees with its metadata.
  assert.equal(occurrences.length, 5);
});

test("every resolveVenueForEvent() call site checks the mismatch branch before proceeding", () => {
  const mismatchChecks = ROUTE_SOURCE.match(/if \(resolution\.mismatch\) \{/g) ?? [];
  assert.equal(mismatchChecks.length, 5);
});

test("a mismatch is reported via reportVenueMismatch() and the event is dropped (break) without writing anything", () => {
  const mismatchBranches = ROUTE_SOURCE.match(/if \(resolution\.mismatch\) \{[\s\S]*?\n {6}\}/g) ?? [];
  assert.equal(mismatchBranches.length, 5);
  for (const branch of mismatchBranches) {
    assert.match(branch, /await reportVenueMismatch\(/);
    assert.match(branch, /break;/);
    assert.doesNotMatch(branch, /syncVenueStripeSubscription/);
  }
});

test("resolveVenueForEvent() looks up customer AND subscription mappings in parallel (Promise.all), then delegates the decision to the pure resolveVenueIdentity()", () => {
  // Billing review fix: the original implementation only consulted
  // subscription id when customer id was ABSENT (a short-circuiting
  // ternary), so a customer mapped to Venue A and a subscription mapped to
  // Venue B would silently resolve to A without ever noticing B disagreed.
  // Both are now always looked up in parallel and cross-checked by the pure
  // decision function — see stripeVenueIdentity.ts and
  // webhookVenueIdentityMismatch.test.ts for the executable scenario
  // coverage (Next.js forbids extra named exports from a route.ts file, so
  // the actual decision logic lives in its own module, not inline here).
  const fn = ROUTE_SOURCE.split("async function resolveVenueForEvent(")[1]
    .split("/** Reports a venue-resolution mismatch")[0];
  assert.match(fn, /Promise\.all\(\[\s*\n\s*params\.customerId \? resolveVenueByCustomer\(params\.customerId\) : Promise\.resolve\(null\),\s*\n\s*params\.subscriptionId \? resolveVenueBySubscriptionId\(params\.subscriptionId\) : Promise\.resolve\(null\),\s*\n\s*\]\)/);
  assert.match(fn, /return resolveVenueIdentity\(\{/);
});

test("route.ts imports resolveVenueIdentity from its own module — the mismatch-detection decision is not duplicated inline", () => {
  assert.match(ROUTE_SOURCE, /import \{ resolveVenueIdentity, type ResolveVenueResult, type VenueIdentityCandidate \} from "@\/lib\/stripeVenueIdentity";/);
  assert.doesNotMatch(ROUTE_SOURCE, /metadataVenueId && mappedVenueId && mappedVenueId !== params\.metadataVenueId/);
});

test("venue lookups query venue_subscriptions only — never operators or operator_subscriptions", () => {
  const byCustomer = ROUTE_SOURCE.match(/async function resolveVenueByCustomer[\s\S]*?\n\}/)![0];
  const bySubscription = ROUTE_SOURCE.match(/async function resolveVenueBySubscriptionId[\s\S]*?\n\}/)![0];
  for (const fn of [byCustomer, bySubscription]) {
    assert.match(fn, /\.from\("venue_subscriptions"\)/);
    assert.doesNotMatch(fn, /\.from\("operators"\)/);
    assert.doesNotMatch(fn, /\.from\("operator_subscriptions"\)/);
  }
});

test("checkout.session.completed requires metadata.venue_id (not operator_id) as one of its required fields, and reports critically if missing", () => {
  const checkoutCase = ROUTE_SOURCE.split('case "checkout.session.completed": {')[1].split('case "customer.subscription.updated"')[0];
  assert.match(checkoutCase, /if \(!metadataVenueId \|\| !targetPlan \|\| !customerId \|\| !subscriptionId\)/);
});

test("customer.subscription.updated tracks cancel_at_period_end from the Stripe subscription object", () => {
  const updatedCase = ROUTE_SOURCE.split('case "customer.subscription.updated": {')[1].split('case "customer.subscription.deleted"')[0];
  assert.match(updatedCase, /const cancelAtPeriodEnd = sub\.cancel_at_period_end === true;/);
  assert.match(updatedCase, /cancelAtPeriodEnd,/);
});

test("customer.subscription.deleted resets cancel_at_period_end and downgrades only the resolved venue, never a sibling", () => {
  const deletedCase = ROUTE_SOURCE.split('case "customer.subscription.deleted": {')[1].split('case "invoice.payment_succeeded"')[0];
  assert.match(deletedCase, /planCode:\s*"free"/);
  assert.match(deletedCase, /status:\s*"cancelled"/);
  assert.match(deletedCase, /cancelAtPeriodEnd: false/);
});

test("invoice.payment_failed identifies the venue explicitly in the unconditional Slack alert, not the operator", () => {
  const failedCase = ROUTE_SOURCE.split('case "invoice.payment_failed": {')[1];
  const slackCall = failedCase.match(/await sendSlackAlert\(\{[\s\S]*?\}\);/)![0];
  assert.match(slackCall, /venue_id:\s*venueId/);
});
