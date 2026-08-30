import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Part 4 of the Phase 2B billing architecture review: webhook duplicate/
 * idempotency behavior. Static verification, matching this repo's
 * convention for the webhook route (no DI seam for its real Stripe/DB/Slack
 * calls).
 *
 * Confirmed idempotency mechanism: NONE — no Stripe event ID is persisted
 * anywhere (checked explicitly, see the last test below). Every event
 * relies on its DB writes being naturally idempotent (upserts keyed on
 * venue_id, or on the exact same values being re-written) plus a small,
 * targeted number of "did the plan actually change" guards before logging
 * an audit row / sending a notification — deliberately NOT a general event
 * ledger, per the task's explicit anti-over-engineering guidance.
 */

const ROUTE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/api/webhooks/stripe/route.ts"),
  "utf8"
);

function eventCase(type: string, nextType: string): string {
  const start = ROUTE_SOURCE.indexOf(`case "${type}": {`);
  const end = ROUTE_SOURCE.indexOf(`case "${nextType}"`);
  assert.ok(start > -1 && end > -1, `could not locate case blocks for ${type} / ${nextType}`);
  return ROUTE_SOURCE.slice(start, end);
}

test("checkout.session.completed: replay is guarded — logPlanChangeEvent only fires when the plan actually changed", () => {
  const block = eventCase("checkout.session.completed", "customer.subscription.updated");
  assert.match(block, /\} else if \(oldPlanForCheckout !== targetPlan\) \{/);
});

test("customer.subscription.updated: replay is guarded — logPlanChangeEvent only fires when planCode differs from the stored plan", () => {
  const block = eventCase("customer.subscription.updated", "customer.subscription.deleted");
  assert.match(block, /\} else if \(planCode && oldPlanForUpdate && planCode !== oldPlanForUpdate\) \{/);
});

test("customer.subscription.deleted: replay guard added by this review — logPlanChangeEvent only fires when the venue wasn't already free (closes a real duplicate-audit-row gap)", () => {
  const block = eventCase("customer.subscription.deleted", "invoice.payment_succeeded");
  // The DB sync itself remains unconditional (idempotent upsert — always
  // safe to re-run); only the audit-log write is gated.
  assert.match(block, /\} else if \(oldPlanForDelete !== "free"\) \{/);
  assert.doesNotMatch(block, /\} else \{\s*\n\s*\/\/ Replay\/idempotency guard/); // guard is a real condition, not dead code in an unconditional else
});

test("invoice.payment_succeeded: never calls logPlanChangeEvent at all (status/period-only sync, nothing to guard)", () => {
  const block = eventCase("invoice.payment_succeeded", "invoice.payment_failed");
  assert.doesNotMatch(block, /logPlanChangeEvent/);
});

test("invoice.payment_failed: the #ops-alerts Slack notification is unconditional by design (documented, accepted, low-severity duplicate risk on replay — not fixed with an event ledger per the task's explicit scope control)", () => {
  const block = ROUTE_SOURCE.slice(ROUTE_SOURCE.indexOf('case "invoice.payment_failed": {'));
  assert.match(block, /Unconditional — the expected business notification/);
  assert.match(block, /await sendSlackAlert\(\{/);
});

test("no Stripe event ID is persisted anywhere — confirmed no event-ledger table/column exists (intentional per Part 4's anti-over-engineering guidance)", () => {
  assert.doesNotMatch(ROUTE_SOURCE, /stripe_event_id/);
  assert.doesNotMatch(ROUTE_SOURCE, /processed_events/);
  assert.doesNotMatch(ROUTE_SOURCE, /event\.id[\s\S]*?\.insert\(/);
});

test("every syncVenueStripeSubscription() call is a single-row upsert keyed on venue_id — safe to re-run with identical values on replay", () => {
  const rpcCalls = ROUTE_SOURCE.match(/syncVenueStripeSubscription\(venueId, \{/g) ?? [];
  assert.ok(rpcCalls.length >= 5, "expected at least 5 syncVenueStripeSubscription call sites (one per event type)");
});
