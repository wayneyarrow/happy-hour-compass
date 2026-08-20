import { test } from "node:test";
import assert from "node:assert/strict";
import { hashWebhookPayload } from "../../../src/lib/brevo/webhookDedupe";

test("the same payload object hashes identically across calls", () => {
  const payload = { event: "unsubscribed", email: "wayne@example.com", date: "2026-08-20" };
  assert.equal(hashWebhookPayload(payload), hashWebhookPayload(payload));
});

test("key order does not affect the hash (canonicalization) — a genuine redelivery dedupes correctly", () => {
  const a = { event: "unsubscribed", email: "wayne@example.com", date: "2026-08-20" };
  const b = { date: "2026-08-20", email: "wayne@example.com", event: "unsubscribed" };
  assert.equal(hashWebhookPayload(a), hashWebhookPayload(b));
});

test("different content produces a different hash", () => {
  const a = { event: "unsubscribed", email: "wayne@example.com" };
  const b = { event: "unsubscribed", email: "someone-else@example.com" };
  assert.notEqual(hashWebhookPayload(a), hashWebhookPayload(b));
});

test("nested objects and arrays are canonicalized consistently", () => {
  const a = { event: "unsubscribed", tag: ["a", "b"], meta: { x: 1, y: 2 } };
  const b = { meta: { y: 2, x: 1 }, tag: ["a", "b"], event: "unsubscribed" };
  assert.equal(hashWebhookPayload(a), hashWebhookPayload(b));
});

test("array order still matters (arrays are not sorted, only object keys are)", () => {
  const a = { tag: ["a", "b"] };
  const b = { tag: ["b", "a"] };
  assert.notEqual(hashWebhookPayload(a), hashWebhookPayload(b));
});

test("produces a 64-character lowercase hex sha256 digest", () => {
  const hash = hashWebhookPayload({ event: "unsubscribed" });
  assert.match(hash, /^[0-9a-f]{64}$/);
});
