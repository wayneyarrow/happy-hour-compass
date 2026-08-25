import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProvinceState, isValidProvinceState } from "../../../src/lib/geo/provinceState";

// ── Valid — abbreviations ──────────────────────────────────────────────────

test("normalizeProvinceState accepts a valid Canadian abbreviation", () => {
  assert.equal(normalizeProvinceState("BC"), "BC");
  assert.equal(normalizeProvinceState("bc"), "BC");
  assert.equal(normalizeProvinceState(" On "), "ON");
});

test("normalizeProvinceState accepts a valid US abbreviation", () => {
  assert.equal(normalizeProvinceState("WA"), "WA");
  assert.equal(normalizeProvinceState("ca"), "CA");
});

// ── Valid — full names ─────────────────────────────────────────────────────

test("normalizeProvinceState accepts a valid Canadian full name, any case", () => {
  assert.equal(normalizeProvinceState("British Columbia"), "BC");
  assert.equal(normalizeProvinceState("british columbia"), "BC");
  assert.equal(normalizeProvinceState("Ontario"), "ON");
  assert.equal(normalizeProvinceState("Newfoundland and Labrador"), "NL");
});

test("normalizeProvinceState accepts a valid US full name, any case", () => {
  assert.equal(normalizeProvinceState("Washington"), "WA");
  assert.equal(normalizeProvinceState("california"), "CA");
  assert.equal(normalizeProvinceState("New York"), "NY");
});

test("normalizeProvinceState is accent- and whitespace-insensitive", () => {
  assert.equal(normalizeProvinceState("Québec"), "QC");
  assert.equal(normalizeProvinceState("  quebec  "), "QC");
  assert.equal(normalizeProvinceState("British   Columbia"), "BC");
});

// ── Invalid ─────────────────────────────────────────────────────────────────

test("normalizeProvinceState rejects the SpearHead-style garbage value", () => {
  assert.equal(normalizeProvinceState("Yes"), null);
  assert.equal(isValidProvinceState("Yes"), false);
});

test("normalizeProvinceState rejects other plausible-looking garbage", () => {
  for (const v of ["No", "Maybe", "123", "asdf", "N/A", "TBD"]) {
    assert.equal(normalizeProvinceState(v), null, `expected "${v}" to be invalid`);
  }
});

test("normalizeProvinceState rejects empty/null/undefined", () => {
  assert.equal(normalizeProvinceState(""), null);
  assert.equal(normalizeProvinceState("   "), null);
  assert.equal(normalizeProvinceState(null), null);
  assert.equal(normalizeProvinceState(undefined), null);
});

test("isValidProvinceState mirrors normalizeProvinceState", () => {
  assert.equal(isValidProvinceState("BC"), true);
  assert.equal(isValidProvinceState("British Columbia"), true);
  assert.equal(isValidProvinceState("Yes"), false);
});
