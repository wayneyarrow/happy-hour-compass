import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConsumerDisplayName } from "../../../src/lib/consumerName";

test("first + last name joins into a combined display name", () => {
  assert.equal(buildConsumerDisplayName("Mindy", "Green"), "Mindy Green");
});

test("first name only produces a first-only display name", () => {
  assert.equal(buildConsumerDisplayName("Mindy", null), "Mindy");
});

test("last name is optional — a null/undefined last name never gets invented text", () => {
  assert.equal(buildConsumerDisplayName("Mindy", undefined), "Mindy");
});

test("whitespace is trimmed from both first and last name", () => {
  assert.equal(buildConsumerDisplayName("  Mindy  ", "  Green  "), "Mindy Green");
});

test("an empty-string last name is treated the same as no last name", () => {
  assert.equal(buildConsumerDisplayName("Mindy", "   "), "Mindy");
});

test("both null returns null, not an empty string", () => {
  assert.equal(buildConsumerDisplayName(null, null), null);
});

test("first name null but last name present still returns just the last name (never invents a first name)", () => {
  assert.equal(buildConsumerDisplayName(null, "Green"), "Green");
});
