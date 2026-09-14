import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DELIVERY_ATTEMPTS,
  RETRY_DELAY_MS,
  STALE_PROCESSING_MINUTES,
  decideAfterFailedAttempt,
  isProcessingStale,
  customerSuccessIdempotencyKey,
} from "../../../src/lib/customerSuccess/deliveryRetryPolicy";

// ── Retry timing ─────────────────────────────────────────────────────────────

test("attempt 1 fails → retry scheduled ~1 hour later", () => {
  const now = new Date("2026-01-05T15:00:00Z");
  const decision = decideAfterFailedAttempt(1, now);
  assert.deepEqual(decision, { action: "retry", nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS) });
  assert.equal(decision.action === "retry" && decision.nextAttemptAt.toISOString(), "2026-01-05T16:00:00.000Z");
});

test("attempt 2 fails → retry scheduled ~1 hour later again", () => {
  const now = new Date("2026-01-05T16:00:00Z");
  const decision = decideAfterFailedAttempt(2, now);
  assert.equal(decision.action, "retry");
  assert.equal(decision.action === "retry" && decision.nextAttemptAt.toISOString(), "2026-01-05T17:00:00.000Z");
});

test("attempt 3 fails → terminal failed, no further retry", () => {
  const now = new Date("2026-01-05T17:00:00Z");
  const decision = decideAfterFailedAttempt(3, now);
  assert.deepEqual(decision, { action: "terminal_failed" });
});

test("MAX_DELIVERY_ATTEMPTS is exactly 3", () => {
  assert.equal(MAX_DELIVERY_ATTEMPTS, 3);
});

test("an attempt count beyond the max is also terminal (defensive)", () => {
  assert.deepEqual(decideAfterFailedAttempt(4, new Date()), { action: "terminal_failed" });
});

// ── Stale-processing detection ───────────────────────────────────────────────

test("a 'processing' claim younger than the stale threshold is not stale", () => {
  const startedAt = new Date("2026-01-05T15:00:00Z");
  const now = new Date(startedAt.getTime() + (STALE_PROCESSING_MINUTES - 1) * 60_000);
  assert.equal(isProcessingStale(startedAt, now), false);
});

test("a 'processing' claim older than the stale threshold is stale", () => {
  const startedAt = new Date("2026-01-05T15:00:00Z");
  const now = new Date(startedAt.getTime() + (STALE_PROCESSING_MINUTES + 1) * 60_000);
  assert.equal(isProcessingStale(startedAt, now), true);
});

// ── Deterministic idempotency key ───────────────────────────────────────────

test("the idempotency key is deterministic and stable across calls for the same event id", () => {
  const a = customerSuccessIdempotencyKey("event-123");
  const b = customerSuccessIdempotencyKey("event-123");
  assert.equal(a, b);
  assert.equal(a, "hhc-customer-success:event-123");
});

test("different events get different idempotency keys", () => {
  assert.notEqual(customerSuccessIdempotencyKey("event-A"), customerSuccessIdempotencyKey("event-B"));
});
