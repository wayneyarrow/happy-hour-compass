import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLoginOutcome,
  resolveConsumerRecoveryOutcome,
  shouldBlockAdminAccess,
} from "../../../src/lib/accessOutcome";

/**
 * Pins the Consumer/Business login & recovery decision table from the Casa
 * de Frida operator-login investigation fix — the one part of the flow with
 * no Supabase/DB I/O and therefore a clean DI seam (same reasoning as
 * computeActiveVenueId.test.ts). The DB-touching resolvers themselves
 * (hasConsumerProfile, hasOperatorAccess, resolveCurrentUserAccess) are not
 * unit-tested directly — real Supabase client calls, no DI seam, same
 * convention as every other flow-specific contract test in this repo.
 */

const CONSUMER_ONLY  = { isConsumer: true,  isOperator: false };
const OPERATOR_ONLY  = { isConsumer: false, isOperator: true };
const DUAL_ROLE      = { isConsumer: true,  isOperator: true };
const NEITHER        = { isConsumer: false, isOperator: false };

// ── A. Consumer-only user ───────────────────────────────────────────────────

test("Consumer-only + Consumer Login: granted", () => {
  assert.equal(resolveLoginOutcome("consumer", CONSUMER_ONLY), "granted");
});

test("Consumer-only + Business Login: wrong-context, not granted", () => {
  assert.equal(resolveLoginOutcome("business", CONSUMER_ONLY), "wrong-context");
});

// ── B. Operator-only user ───────────────────────────────────────────────────

test("Operator-only + Business Login: granted", () => {
  assert.equal(resolveLoginOutcome("business", OPERATOR_ONLY), "granted");
});

test("Operator-only + Consumer Login: wrong-context, not granted", () => {
  assert.equal(resolveLoginOutcome("consumer", OPERATOR_ONLY), "wrong-context");
});

// ── C. Consumer + Operator (dual-role, same email/Auth identity) ──────────

test("Dual-role + Consumer Login: granted (Consumer context)", () => {
  assert.equal(resolveLoginOutcome("consumer", DUAL_ROLE), "granted");
});

test("Dual-role + Business Login: granted (Operator context)", () => {
  assert.equal(resolveLoginOutcome("business", DUAL_ROLE), "granted");
});

// ── Neither role (edge case — should never dead-end silently) ─────────────

test("No account either way + Consumer Login: no-account, not wrong-context", () => {
  assert.equal(resolveLoginOutcome("consumer", NEITHER), "no-account");
});

test("No account either way + Business Login: no-account, not wrong-context", () => {
  assert.equal(resolveLoginOutcome("business", NEITHER), "no-account");
});

// ── D. Password-recovery context (Consumer recovery flow only — Business
//      recovery always lands in Business context by construction, see
//      operator/create-password/page.tsx) ─────────────────────────────────

test("Consumer-only via Consumer recovery: stays in Consumer context", () => {
  assert.equal(resolveConsumerRecoveryOutcome(CONSUMER_ONLY), "consumer-context");
});

test("Dual-role via Consumer recovery: stays in Consumer context (not bounced to Business)", () => {
  assert.equal(resolveConsumerRecoveryOutcome(DUAL_ROLE), "consumer-context");
});

test("Operator-only who accidentally used Consumer recovery: business-continuation, never consumer-context", () => {
  // This is the exact Casa de Frida scenario: the shared Auth password has
  // already been updated by this point (handled upstream in
  // reset-password/page.tsx's handleSubmit before this resolver is ever
  // called) — this only decides where the person lands, and must never
  // manufacture a Consumer account for them.
  assert.equal(resolveConsumerRecoveryOutcome(OPERATOR_ONLY), "business-continuation");
});

test("Neither role via Consumer recovery: no-account fallback, not business-continuation", () => {
  assert.equal(resolveConsumerRecoveryOutcome(NEITHER), "no-account");
});

// ── Direct /admin/* access — Consumer-only identity manually navigating to
//    an Operator route (src/app/admin/layout.tsx). Confirms the gate blocks
//    exactly the identity/impersonation combinations it must, and never the
//    ones it must not, before resolveOperatorContext() (and therefore
//    ensureOperatorForSession's auto-provisioning fallback) is ever reached. ──

test("Consumer-only, not impersonating, hits /admin/*: blocked", () => {
  assert.equal(
    shouldBlockAdminAccess({ isImpersonating: false, hasOperatorAccess: false }),
    true
  );
});

test("Operator (owner or member), not impersonating, hits /admin/*: allowed through", () => {
  assert.equal(
    shouldBlockAdminAccess({ isImpersonating: false, hasOperatorAccess: true }),
    false
  );
});

test("Founder/CP-admin impersonation session, no Business access of their own: allowed through", () => {
  // Impersonation is authorized by the session cookie, not this identity's
  // own operator access — must never be blocked here.
  assert.equal(
    shouldBlockAdminAccess({ isImpersonating: true, hasOperatorAccess: false }),
    false
  );
});

test("Impersonating AND happens to also have Business access: allowed through either way", () => {
  assert.equal(
    shouldBlockAdminAccess({ isImpersonating: true, hasOperatorAccess: true }),
    false
  );
});
