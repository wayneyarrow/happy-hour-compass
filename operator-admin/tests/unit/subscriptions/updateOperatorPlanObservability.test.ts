import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportCriticalFailure } from "../../../src/lib/observability/reportCriticalFailure";
import type { SentryCaptureClient } from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { sendSlackAlert } from "../../../src/lib/slack";

/**
 * Pins the atomic-RPC entitlement-write architecture in src/lib/subscriptions.ts
 * (migration 081_operator_plan_entitlement_atomic_sync.sql) — WITHOUT unit-
 * testing subscriptions.ts's real functions directly (they call the real
 * Supabase admin client with no existing DI seam — same reasoning as
 * webhookSync.test.ts / operatorSubmissionObservability.test.ts /
 * venueClaimObservability.test.ts). Two complementary techniques:
 *
 *   1. Dynamic contract-pinning — call reportCriticalFailure() directly with
 *      the exact flow/stage/context updateOperatorPlan()'s single remaining
 *      failure branch uses.
 *   2. Static structural regression — read subscriptions.ts's source text
 *      and assert the exact shape of both functions: exactly one RPC call
 *      site per plan-changing path, no lingering two-write fallthrough
 *      pattern, correct return statements, and (for syncStripeSubscription)
 *      zero reportCriticalFailure() call sites — ownership for that
 *      function's plan-changing failure now lives entirely in the Stripe
 *      webhook route, which these tests also structurally re-verify is
 *      untouched.
 */

const SUBSCRIPTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/subscriptions.ts"),
  "utf8"
);
const STRIPE_ROUTE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/api/webhooks/stripe/route.ts"),
  "utf8"
);

function updateOperatorPlanBody(): string {
  return SUBSCRIPTIONS_SOURCE.match(/export async function updateOperatorPlan[\s\S]*?\n\}/)![0];
}
function syncStripeSubscriptionBody(): string {
  return SUBSCRIPTIONS_SOURCE.match(/export async function syncStripeSubscription[\s\S]*?\n\}/)![0];
}

function createFakeSentryClient(): {
  client: SentryCaptureClient;
  calls: { exception: unknown; captureContext: unknown }[];
} {
  const calls: { exception: unknown; captureContext: unknown }[] = [];
  return {
    client: {
      captureException(exception, captureContext) {
        calls.push({ exception, captureContext });
        return "evt_fake";
      },
    },
    calls,
  };
}

function createFakeSlack(): { sendSlack: typeof sendSlackAlert; calls: Parameters<typeof sendSlackAlert>[0][] } {
  const calls: Parameters<typeof sendSlackAlert>[0][] = [];
  const sendSlack = (async (params: Parameters<typeof sendSlackAlert>[0]) => {
    calls.push(params);
    return "delivered" as const;
  }) as typeof sendSlackAlert;
  return { sendSlack, calls };
}

function withEnv<T>(env: string | undefined, fn: () => T): T {
  const previous = process.env.VERCEL_ENV;
  if (env === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = env;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
}

function contextOf(call: { captureContext: unknown }): Record<string, unknown> | undefined {
  return (call.captureContext as { contexts?: { hhc_context?: Record<string, unknown> } } | undefined)
    ?.contexts?.hhc_context;
}

/** Strips `//` line comments so structural regexes don't false-match prose
 * inside a comment. */
function stripLineComments(code: string): string {
  return code
    .split("\n")
    .map(line => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// A. updateOperatorPlan()
// ═══════════════════════════════════════════════════════════════════════════

test("updateOperatorPlan(): exactly one RPC call site, no legacy two-write pattern remains", () => {
  const body = updateOperatorPlanBody();
  assert.equal((body.match(/\.rpc\("sync_operator_plan_entitlement"/g) ?? []).length, 1);
  // No more direct writes to either table inside this function — both are
  // now inside the atomic RPC.
  assert.doesNotMatch(body, /\.from\("operator_subscriptions"\)/);
  assert.doesNotMatch(body, /\.from\("operators"\)/);
  // No more a second, independently-failable branch.
  assert.doesNotMatch(stripLineComments(body), /if \(opError\)/);
  assert.doesNotMatch(stripLineComments(body), /if \(subError\)/);
});

test("updateOperatorPlan(): successful path returns { ok: true } unconditionally", () => {
  const body = updateOperatorPlanBody();
  assert.match(body, /\n {2}return \{ ok: true \};\n\}/);
});

test("updateOperatorPlan(): RPC failure returns { ok: false, error, hhcErrorId } — no legacy false-success branch remains", () => {
  const body = updateOperatorPlanBody();
  assert.match(body, /return \{ ok: false, error: error\.message, hhcErrorId: report\.hhcErrorId \};/);
  // The old "logs the failure but still falls through to ok:true" comment/
  // shape must not still exist anywhere in this function.
  assert.doesNotMatch(body, /still updated successfully/);
});

test("updateOperatorPlan(): exactly one reportCriticalFailure() call site — no duplicate HHC reporting", () => {
  const body = updateOperatorPlanBody();
  assert.equal((body.match(/reportCriticalFailure\(\{/g) ?? []).length, 1);
});

test("operator-plan-update / entitlement-write: critical, one HHC id, one production Slack alert, safe context", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated sync_operator_plan_entitlement RPC failure"),
        flow: "operator-plan-update",
        stage: "entitlement-write",
        title: "Operator Plan Update Failed",
        technicalSummary: "atomic database write failed (operator_subscriptions + operators.plan)",
        context: { operatorId: "op_1", targetPlan: "pro" },
        slackFields: { "Operator ID": "op_1", "Target Plan": "pro" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, "operator-plan-update");
  assert.equal(report.stage, "entitlement-write");
  assert.equal(report.severity, "critical");
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
});

// ═══════════════════════════════════════════════════════════════════════════
// B. syncStripeSubscription() — plan-changing sync
// ═══════════════════════════════════════════════════════════════════════════

test("syncStripeSubscription(): plan-changing branch uses exactly one RPC call site, no legacy two-write pattern", () => {
  const body = syncStripeSubscriptionBody();
  assert.equal((body.match(/\.rpc\("sync_operator_plan_entitlement"/g) ?? []).length, 1);
  assert.doesNotMatch(stripLineComments(body), /if \(opError\)/);
});

test("syncStripeSubscription(): plan-changing RPC success returns { ok: true }", () => {
  const body = syncStripeSubscriptionBody();
  // The RPC-branch success return, distinct from the status-only branch's.
  const rpcBranch = body.split('sync.planCode !== undefined')[1].split("return { ok: true };")[0];
  assert.ok(rpcBranch.includes("await supabase.rpc"));
});

test("syncStripeSubscription(): plan-changing RPC failure returns { ok: false, error } — no partial-success result remains", () => {
  const body = syncStripeSubscriptionBody();
  assert.match(body, /if \(error\) \{[\s\S]*?return \{ ok: false, error: error\.message \};/);
});

test("syncStripeSubscription(): zero reportCriticalFailure() call sites — ownership stays entirely with the Stripe webhook route", () => {
  // Comments are stripped first — the function's own doc comment mentions
  // "reportCriticalFailure()" in prose to explain why it's absent, which
  // would otherwise false-match a naive substring count.
  const body = stripLineComments(syncStripeSubscriptionBody());
  assert.equal((body.match(/reportCriticalFailure\(/g) ?? []).length, 0);
});

test("subscriptions.ts still imports reportCriticalFailure (used once, by updateOperatorPlan only)", () => {
  assert.match(SUBSCRIPTIONS_SOURCE, /import \{ reportCriticalFailure \} from "@\/lib\/observability\/reportCriticalFailure";/);
  assert.equal((SUBSCRIPTIONS_SOURCE.match(/reportCriticalFailure\(\{/g) ?? []).length, 1);
});

test("Stripe webhook route.ts reporting call counts match the Phase 2B billing-review baseline", () => {
  // Baseline as of the Phase 2B billing architecture review: 7 literal
  // `await reportCriticalFailure({` call sites — the 6 from the original
  // Phase 2B venue-resolution cutover (5 direct: checkout-completed-invalid-
  // payload, checkout-completed-sync, subscription-updated-sync's planCode
  // branch, subscription-deleted-sync, invoice-payment-failed-sync; plus 1
  // inside the shared reportVenueMismatch() helper, called from all 5 event
  // branches) PLUS 1 new one added by this review: the
  // "checkout-completed-possible-duplicate-subscription" guard in
  // checkout.session.completed, which flags (but does not block) the case
  // where a venue already had a different active subscription id when a
  // new checkout.session.completed arrives — see Part 2 of the review.
  // reportOperationalError call sites remain 4 (webhook-secret-missing,
  // handler-exception, subscription-updated-sync's non-planCode branch,
  // invoice-payment-succeeded-sync) — unchanged.
  assert.equal((STRIPE_ROUTE_SOURCE.match(/await reportCriticalFailure\(\{/g) ?? []).length, 7);
  assert.equal((STRIPE_ROUTE_SOURCE.match(/reportOperationalError\(\{/g) ?? []).length, 4);
});

test("Stripe webhook route.ts: every event branch resolves venue via metadata/customer/subscription mapping, never via operator_id", () => {
  // Part 8 of the Phase 2B task: operator_id must never determine
  // entitlement ownership. Confirms no event branch calls a
  // resolveVenueBy...(operatorId) style lookup, and that the one
  // operator-keyed helper this route ever had (resolveOperatorByCustomer)
  // is gone.
  assert.doesNotMatch(STRIPE_ROUTE_SOURCE, /resolveOperatorByCustomer/);
  assert.doesNotMatch(STRIPE_ROUTE_SOURCE, /resolveVenueBy\w*\(\s*operatorId/);
  assert.match(STRIPE_ROUTE_SOURCE, /function resolveVenueByCustomer/);
  assert.match(STRIPE_ROUTE_SOURCE, /function resolveVenueBySubscriptionId/);
});

test("Stripe webhook route.ts: never calls sync_operator_plan_entitlement or writes operators.plan/operator_subscriptions", () => {
  assert.doesNotMatch(STRIPE_ROUTE_SOURCE, /syncStripeSubscription/);
  assert.doesNotMatch(STRIPE_ROUTE_SOURCE, /sync_operator_plan_entitlement/);
  assert.doesNotMatch(STRIPE_ROUTE_SOURCE, /getOperatorPlanCode/);
  assert.match(STRIPE_ROUTE_SOURCE, /from "@\/lib\/venueSubscriptions"/);
});

test("stripe-subscription / entitlement-write (via the webhook route's existing ownership): critical, one HHC id, one production Slack alert, safe Stripe context", async () => {
  // Pins the contract the webhook route already uses for a syncStripeSubscription
  // failure — unchanged by this task, still the sole reporter for the now-
  // unified (single) failure mode of a plan-changing sync.
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated syncStripeSubscription failure"),
        flow: "stripe-subscription",
        stage: "checkout-completed-sync",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "database sync failed (checkout activation)",
        context: { stripeEventId: "evt_1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", planCode: "pro" },
        slackFields: { "Stripe Event": "evt_1", Subscription: "sub_1", Plan: "pro" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, "stripe-subscription");
  assert.equal(report.severity, "critical");
  assert.equal(calls.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// C. syncStripeSubscription() — status/period-only sync (no planCode)
// ═══════════════════════════════════════════════════════════════════════════

test("syncStripeSubscription(): status/period-only branch never touches operators.plan and never calls the RPC", () => {
  const body = syncStripeSubscriptionBody();
  const statusOnlyBranch = body.split("return { ok: true };\n  }")[1] ?? "";
  assert.ok(statusOnlyBranch.length > 0, "could not isolate the status/period-only branch");
  assert.doesNotMatch(statusOnlyBranch, /\.from\("operators"\)/);
  assert.doesNotMatch(statusOnlyBranch, /\.rpc\(/);
  assert.match(statusOnlyBranch, /\.from\("operator_subscriptions"\)/);
});

test("syncStripeSubscription(): status/period-only upsert still writes the same fields as before (billing_provider, IDs, status, period dates)", () => {
  const body = syncStripeSubscriptionBody();
  const statusOnlyBranch = body.split("return { ok: true };\n  }")[1] ?? "";
  for (const field of [
    "billing_provider:",
    "billing_provider_customer_id:",
    "billing_provider_subscription_id:",
    "status:",
    "current_period_start:",
    "current_period_end:",
    "updated_at:",
  ]) {
    assert.ok(statusOnlyBranch.includes(field), `expected status-only upsert to still set ${field}`);
  }
});

test("syncStripeSubscription(): the gate deciding plan-changing vs status-only sync is unchanged (sync.planCode !== undefined)", () => {
  const body = syncStripeSubscriptionBody();
  assert.match(body, /if \(sync\.planCode !== undefined\) \{/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-cutting: distinct HHC ids, no fingerprint, privacy, prod-only Slack
// ═══════════════════════════════════════════════════════════════════════════

test("updateOperatorPlan's failure and the webhook route's own reporting each produce their own distinct HHC id", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  const reports = await withEnv("production", async () => [
    await reportCriticalFailure(
      { error: new Error("x"), flow: "operator-plan-update", stage: "entitlement-write", title: "t", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    ),
    await reportCriticalFailure(
      { error: new Error("x"), flow: "stripe-subscription", stage: "checkout-completed-sync", title: "t", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    ),
  ]);

  assert.notEqual(reports[0].hhcErrorId, reports[1].hhcErrorId);
});

test("no fingerprint is ever set for the entitlement-write stage", async () => {
  const { client, calls } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  await withEnv("production", () =>
    reportCriticalFailure(
      { error: new Error("simulated"), flow: "operator-plan-update", stage: "entitlement-write", title: "t", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal((calls[0].captureContext as { fingerprint?: unknown } | undefined)?.fingerprint, undefined);
});

test("preview environment does not page production #ops-critical for the entitlement-write stage", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("preview", () =>
    reportCriticalFailure(
      { error: new Error("simulated"), flow: "operator-plan-update", stage: "entitlement-write", title: "t", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(calls.length, 0);
  assert.equal(report.slackSent, false);
});

test("subscriptions.ts observability context never includes email, name, or other PII, even if mistakenly passed", async () => {
  const { client, calls: sentryCalls } = createFakeSentryClient();
  const { sendSlack, calls: slackCalls } = createFakeSlack();

  await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated"),
        flow: "operator-plan-update",
        stage: "entitlement-write",
        title: "t",
        technicalSummary: "x",
        context: {
          operatorId: "op_4",
          targetPlan: "pro",
          changedByEmail: "someone@example.com",
          name: "Someone Person",
        },
        slackFields: { "Operator ID": "op_4", email: "someone@example.com" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  const context = contextOf(sentryCalls[0]) ?? {};
  assert.equal(context.operatorId, "op_4");
  assert.equal(context.targetPlan, "pro");
  for (const forbidden of ["changedByEmail", "name"]) {
    assert.equal(forbidden in context, false, `Sentry context must not contain "${forbidden}"`);
  }
  const metadata = slackCalls[0].metadata ?? {};
  assert.equal(metadata["Operator ID"], "op_4");
  assert.equal("email" in metadata, false);
});

test("real subscriptions.ts call site never passes email/name context — confirmed by source read", () => {
  const reportBlocks = SUBSCRIPTIONS_SOURCE.split("await reportCriticalFailure({").slice(1);
  assert.equal(reportBlocks.length, 1, "expected exactly 1 reportCriticalFailure call site in subscriptions.ts");
  const callSite = reportBlocks[0].split("});")[0];
  assert.doesNotMatch(callSite, /email/i);
  assert.doesNotMatch(callSite, /changedBy/i);
});

test("subscriptions.ts does not import or call sendSlackAlert directly — Slack stays owned by reportCriticalFailure", () => {
  assert.doesNotMatch(SUBSCRIPTIONS_SOURCE, /sendSlackAlert/);
  assert.doesNotMatch(SUBSCRIPTIONS_SOURCE, /from ["']@\/lib\/slack["']/);
});

test("both functions call the RPC through the standard createAdminClient() service-role client — no new client/auth path introduced", () => {
  assert.equal((SUBSCRIPTIONS_SOURCE.match(/createAdminClient\(\)/g) ?? []).length >= 2, true);
});
