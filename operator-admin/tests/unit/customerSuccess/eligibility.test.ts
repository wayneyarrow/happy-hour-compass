import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligibleForCustomerSuccess } from "../../../src/lib/customerSuccess/eligibility";

// ── Seeded/unclaimed venue → ineligible ─────────────────────────────────────

test("a seeded/unclaimed venue (no created_by_operator_id, unverified) is never eligible", () => {
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: true, isVerified: false, createdByOperatorId: null }),
    false
  );
});

// ── Seeded venue after approved claim/verification → eligible ──────────────

test("a seeded venue that has been claimed, approved, and verified is eligible", () => {
  // Mirrors provisionOperatorForVenue()'s atomic UPDATE: is_verified and
  // created_by_operator_id flip together at claim approval.
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: true, isVerified: true, createdByOperatorId: "op-1" }),
    true
  );
});

// ── Operator-submitted venue before approval → ineligible ──────────────────

test("an operator-submitted venue awaiting approval (unverified, unlinked, unpublished) is not eligible", () => {
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: false, isVerified: false, createdByOperatorId: null }),
    false
  );
});

// ── Operator-submitted venue after approval/verification → eligible ────────

test("an operator-submitted venue that has been approved, published, and verified is eligible", () => {
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: true, isVerified: true, createdByOperatorId: "op-2" }),
    true
  );
});

// ── Published but unverified venue → ineligible ─────────────────────────────

test("a published, operator-linked but UNVERIFIED venue is not eligible", () => {
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: true, isVerified: false, createdByOperatorId: "op-3" }),
    false
  );
});

// ── Verified but unpublished venue → ineligible ─────────────────────────────

test("a verified, operator-linked but UNPUBLISHED (e.g. churned) venue is not eligible", () => {
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: false, isVerified: true, createdByOperatorId: "op-4" }),
    false
  );
});

// ── Operator-linked but unverified venue → ineligible (published or not) ───

test("an operator-linked, unverified venue is not eligible regardless of publish state", () => {
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: true, isVerified: false, createdByOperatorId: "op-5" }),
    false
  );
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: false, isVerified: false, createdByOperatorId: "op-5" }),
    false
  );
});

// ── Legitimate verified operator-managed venue → eligible ──────────────────

test("a legitimate published + verified + operator-managed venue is eligible", () => {
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: true, isVerified: true, createdByOperatorId: "op-6" }),
    true
  );
});

// ── Verified seeded venue with no operator relationship → ineligible ───────

test(
  "a seeded venue manually verified via the Happy Hour certification pass (verified-no-operator) " +
    "is still not eligible — verification alone doesn't establish a real customer relationship",
  () => {
    assert.equal(
      isEligibleForCustomerSuccess({ isPublished: true, isVerified: true, createdByOperatorId: null }),
      false
    );
  }
);

// ── Test venue ───────────────────────────────────────────────────────────────

test(
  "KNOWN GAP: HHC has no canonical 'test venue' field today, so a real published, verified, " +
    "operator-owned venue used for internal QA is indistinguishable from a genuine one and passes " +
    "eligibility — documented in eligibility.ts and the Phase 1A correction report, not silently assumed",
  () => {
    assert.equal(
      isEligibleForCustomerSuccess({ isPublished: true, isVerified: true, createdByOperatorId: "qa-operator" }),
      true
    );
  }
);

// ── Every condition failing at once ─────────────────────────────────────────

test("a venue failing every condition is not eligible", () => {
  assert.equal(
    isEligibleForCustomerSuccess({ isPublished: false, isVerified: false, createdByOperatorId: null }),
    false
  );
});
