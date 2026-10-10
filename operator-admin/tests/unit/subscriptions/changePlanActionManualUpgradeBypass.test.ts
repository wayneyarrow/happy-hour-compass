import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

/**
 * Manual-upgrade bypass fix — behavioural tests of the REAL
 * changePlanAction() with every dependency stubbed (CommonJS require cache),
 * recording every side effect. Proves that a rejected request makes no
 * billing write (updateVenuePlan / Stripe), no plan-history write
 * (logPlanChangeEvent), no audit/note write, no notification (plan-change
 * Slack/email live inside logPlanChangeEvent; critical alerts inside
 * reportCriticalFailure) and no cache revalidation — while Free transitions,
 * verified founder impersonation and Stripe-backed changes still work.
 */

type Calls = Record<string, unknown[][]>;
const calls: Calls = {};
const record = (name: string) => (...args: unknown[]) => {
  (calls[name] ??= []).push(args);
};

type Sub = {
  plan_code: string;
  status: string;
  billing_provider: string;
  billing_provider_customer_id: string | null;
  billing_provider_subscription_id: string | null;
} | null;

const state: {
  ctx: Record<string, unknown>;
  role: string | null;
  subscription: Sub;
  authEmail: string | null;
  isAdmin: boolean;
} = { ctx: {}, role: "owner", subscription: null, authEmail: null, isAdmin: false };

const fakeStripe = {
  subscriptions: {
    cancel: async (...a: unknown[]) => { record("stripe.cancel")(...a); return {}; },
    retrieve: async (...a: unknown[]) => { record("stripe.retrieve")(...a); return { items: { data: [{ id: "si_1" }] } }; },
    update: async (...a: unknown[]) => { record("stripe.update")(...a); return {}; },
  },
};

function stub(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier);
  const m = new Module(filename);
  m.filename = filename;
  m.loaded = true;
  m.exports = exports;
  require.cache[filename] = m;
}

stub("@/lib/impersonation", { resolveOperatorContext: async () => state.ctx });
stub("@/lib/memberships", { getMembershipRole: async () => state.role });
stub("@/lib/venueSubscriptions", {
  getVenueSubscription: async () => state.subscription,
  updateVenuePlan: async (...a: unknown[]) => { record("updateVenuePlan")(...a); return { ok: true }; },
});
stub("@/lib/stripe", {
  getStripeClient: () => { record("getStripeClient")(); return fakeStripe; },
  getStripePriceId: (plan: string) => `price_${plan}`,
  isStripeBillablePlan: (plan: string) => plan === "pro" || plan === "premium",
});
stub("next/cache", { revalidatePath: record("revalidatePath") });
stub("@/lib/data/venueNotes", { addSystemVenueNote: async (...a: unknown[]) => record("addSystemVenueNote")(...a) });
stub("@/lib/auditLog", { logAuditEvent: async (...a: unknown[]) => record("logAuditEvent")(...a) });
stub("@/lib/planChangeEvents", { logPlanChangeEvent: async (...a: unknown[]) => record("logPlanChangeEvent")(...a) });
stub("@/lib/observability/reportCriticalFailure", {
  reportCriticalFailure: async (...a: unknown[]) => { record("reportCriticalFailure")(...a); return { customerMessage: "x" }; },
});
stub("@/lib/supabase/server", {
  createAdminClient: () => {
    record("createAdminClient")();
    return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "V" } }) }) }) }) };
  },
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.authEmail ? { email: state.authEmail } : null } }) } }),
});
stub("@/lib/controlPanelAuth", { isControlPanelAdmin: async () => state.isAdmin });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { changePlanAction } = require("@/app/admin/subscription/changePlanAction") as typeof import("@/app/admin/subscription/changePlanAction");

const OWNER_CTX = {
  operator: { id: "op-1", email: "owner@example.com" },
  user: { email: "owner@example.com" },
  isImpersonating: false,
  founderEmail: null,
  activeVenueId: "venue-1",
};
const IMPERSONATION_CTX = {
  operator: { id: "op-1", email: "owner@example.com" },
  user: null,
  isImpersonating: true,
  founderEmail: "founder@example.com",
  activeVenueId: "venue-1",
};

const WRITES = [
  "updateVenuePlan", "logPlanChangeEvent", "logAuditEvent", "addSystemVenueNote",
  "revalidatePath", "getStripeClient", "stripe.cancel", "stripe.update", "stripe.retrieve",
  "reportCriticalFailure", "createAdminClient",
];
function assertNoWrites() {
  for (const name of WRITES) assert.equal(calls[name]?.length ?? 0, 0, `${name} must not be called`);
}

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  state.ctx = OWNER_CTX;
  state.role = "owner";
  state.subscription = null;
  state.authEmail = null;
  state.isAdmin = false;
});

// ── Rejected: normal operator, no Stripe-backed subscription ────────────────

for (const plan of ["pro", "premium", "enterprise"] as const) {
  test(`owner with NO subscription row requesting ${plan} is rejected with no writes or notifications`, async () => {
    const r = await changePlanAction(plan);
    assert.equal(r.ok, false);
    assert.ok(r.error);
    assertNoWrites();
  });
}

test("owner with a reserved Stripe customer but no subscription (pre-Checkout row) cannot take Premium", async () => {
  state.subscription = { plan_code: "free", status: "active", billing_provider: "stripe", billing_provider_customer_id: "cus_1", billing_provider_subscription_id: null };
  const r = await changePlanAction("premium");
  assert.equal(r.ok, false);
  assertNoWrites();
});

test("owner on a manual (non-Stripe) paid row cannot move to another paid tier", async () => {
  state.subscription = { plan_code: "premium", status: "active", billing_provider: "manual", billing_provider_customer_id: null, billing_provider_subscription_id: null };
  const r = await changePlanAction("pro");
  assert.equal(r.ok, false);
  assertNoWrites();
});

test("owner on a Stripe-backed subscription cannot request Enterprise (would otherwise cancel billing) — no Stripe call", async () => {
  state.subscription = { plan_code: "pro", status: "active", billing_provider: "stripe", billing_provider_customer_id: "cus_1", billing_provider_subscription_id: "sub_1" };
  const r = await changePlanAction("enterprise");
  assert.equal(r.ok, false);
  assertNoWrites();
});

// ── Impersonation must be verified server-side ──────────────────────────────

test("impersonation cookie without the founder's live login is rejected before any write", async () => {
  state.ctx = IMPERSONATION_CTX;
  state.authEmail = null;
  const r = await changePlanAction("premium");
  assert.equal(r.ok, false);
  assertNoWrites();
});

test("impersonation session used by a different signed-in user is rejected", async () => {
  state.ctx = IMPERSONATION_CTX;
  state.authEmail = "someone-else@example.com";
  state.isAdmin = true;
  const r = await changePlanAction("premium");
  assert.equal(r.ok, false);
  assertNoWrites();
});

test("impersonation by a founder no longer on the admin allowlist is rejected", async () => {
  state.ctx = IMPERSONATION_CTX;
  state.authEmail = "founder@example.com";
  state.isAdmin = false;
  const r = await changePlanAction("premium");
  assert.equal(r.ok, false);
  assertNoWrites();
});

// ── Preserved behaviour ──────────────────────────────────────────────────────

test("verified founder impersonation can still set a plan manually (existing support path)", async () => {
  state.ctx = IMPERSONATION_CTX;
  state.authEmail = "Founder@Example.com";
  state.isAdmin = true;
  const r = await changePlanAction("premium");
  assert.equal(r.ok, true);
  assert.deepEqual(calls.updateVenuePlan, [["venue-1", "premium"]]);
  assert.equal(calls.logPlanChangeEvent?.length, 1);
  assert.equal((calls.logPlanChangeEvent![0][0] as { trigger: string }).trigger, "impersonation");
});

test("owner on a manual paid row can still move to Free (existing downgrade path)", async () => {
  state.subscription = { plan_code: "premium", status: "active", billing_provider: "manual", billing_provider_customer_id: null, billing_provider_subscription_id: null };
  const r = await changePlanAction("free");
  assert.equal(r.ok, true);
  assert.deepEqual(calls.updateVenuePlan, [["venue-1", "free"]]);
  assert.equal((calls.logPlanChangeEvent![0][0] as { trigger: string }).trigger, "manual_admin");
});

test("Stripe-backed owner: Pro → Premium still updates the real subscription in place (no DB write)", async () => {
  state.subscription = { plan_code: "pro", status: "active", billing_provider: "stripe", billing_provider_customer_id: "cus_1", billing_provider_subscription_id: "sub_1" };
  const r = await changePlanAction("premium");
  assert.equal(r.ok, true);
  assert.equal(calls["stripe.update"]?.length, 1);
  assert.equal(calls.updateVenuePlan?.length ?? 0, 0);
  assert.equal(calls.logPlanChangeEvent?.length ?? 0, 0);
});

test("Stripe-backed owner: → Free still cancels the real subscription (webhook writes the downgrade)", async () => {
  state.subscription = { plan_code: "premium", status: "active", billing_provider: "stripe", billing_provider_customer_id: "cus_1", billing_provider_subscription_id: "sub_1" };
  const r = await changePlanAction("free");
  assert.equal(r.ok, true);
  assert.equal(calls["stripe.cancel"]?.length, 1);
  assert.equal(calls.updateVenuePlan?.length ?? 0, 0);
});

test("existing guards are unchanged: a member (non-owner) is rejected before any write", async () => {
  state.role = "member";
  const r = await changePlanAction("free");
  assert.equal(r.ok, false);
  assertNoWrites();
});
