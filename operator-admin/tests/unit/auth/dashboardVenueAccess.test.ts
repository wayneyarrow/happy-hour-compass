import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldBlockAdminAccess } from "../../../src/lib/accessOutcome";

/**
 * Pins the authorization gate now applied to the deprecated (but still
 * routable) /dashboard/venues/[id]/{edit,events,hours} pages and their two
 * server actions (edit/actions.ts, hours/actions.ts) — the same
 * authorization class already closed for /admin/* (see
 * src/app/admin/layout.tsx and tests/unit/auth/accessOutcome.test.ts's
 * original "Direct /admin/* access" tests).
 *
 * All five call sites (the new src/app/dashboard/venues/[id]/layout.tsx,
 * plus the two actions) gate on the exact same shouldBlockAdminAccess()
 * pure decision already proven there — reused rather than re-derived, so
 * this file's job is to pin that the DASHBOARD scenario maps onto the same
 * inputs/outputs, not to re-test the function's own boolean matrix.
 *
 * hasOperatorAccess() itself (src/lib/operatorAccess.ts) is what actually
 * distinguishes an owner (a row in `operators`) from an active member (a
 * row in `operator_memberships`) — both real Supabase admin-client calls,
 * no DI seam, not unit-tested directly (same convention as every other
 * flow-specific contract test in this repo). From shouldBlockAdminAccess()'s
 * point of view they are indistinguishable and must be: both collapse to
 * `hasOperatorAccess: true`, which is exactly the "owner OR active
 * operator membership" requirement — this is what these tests assert.
 *
 * None of these dashboard routes support impersonation via
 * ensureOperatorForSession() (edit/{page,actions}.ts, events/page.tsx,
 * hours/page.tsx call it directly, with no imp_session_id cookie handling).
 * hours/actions.ts is the one exception — it resolves via
 * resolveOperatorContext(), so its added gate independently checks the
 * impersonation cookie first, exactly like admin/layout.tsx, and exempts a
 * valid impersonation session the same way.
 */

test("Business owner (operators row) reaching a dashboard venue route: not blocked", () => {
  // hasOperatorAccess() resolves true here via the `operators` table match.
  assert.equal(
    shouldBlockAdminAccess({ isImpersonating: false, hasOperatorAccess: true }),
    false
  );
});

test("Active Operator member (operator_memberships row, no owner row) reaching a dashboard venue route: not blocked", () => {
  // hasOperatorAccess() resolves true here via the active-member fallback
  // (getActiveMemberMembershipByEmail) — same boolean as the owner case,
  // by design: shouldBlockAdminAccess() must not distinguish them.
  assert.equal(
    shouldBlockAdminAccess({ isImpersonating: false, hasOperatorAccess: true }),
    false
  );
});

test("Consumer-only identity reaching a dashboard venue route: blocked before ensureOperatorForSession/resolveOperatorContext is ever called", () => {
  // hasOperatorAccess() resolves false — no `operators` row, no active
  // membership. The layout/action returns before calling
  // ensureOperatorForSession() or resolveOperatorContext() at all (see
  // src/app/dashboard/venues/[id]/layout.tsx and the guards added to
  // edit/actions.ts and hours/actions.ts) — confirmed by code inspection:
  // in every one of the five call sites, this check now runs strictly
  // before the operator-provisioning call, and returns/redirects instead of
  // proceeding to it.
  assert.equal(
    shouldBlockAdminAccess({ isImpersonating: false, hasOperatorAccess: false }),
    true
  );
});

test("Founder/CP-admin impersonating a venue via hours/actions.ts, no Business access of their own: not blocked", () => {
  assert.equal(
    shouldBlockAdminAccess({ isImpersonating: true, hasOperatorAccess: false }),
    false
  );
});
