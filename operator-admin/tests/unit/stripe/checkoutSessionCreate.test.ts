import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCriticalFailure } from "../../../src/lib/observability/reportCriticalFailure";
import type { SentryCaptureClient } from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { sendSlackAlert } from "../../../src/lib/slack";

/**
 * Pins the exact flow/stage/title contract createCheckoutSessionAction
 * (src/app/admin/subscription/stripeActions.ts) uses at its
 * reportCriticalFailure() call sites — checkout-precondition (price ID /
 * Stripe client setup failures) and checkout-session-create (the actual
 * Stripe API call failing, or succeeding with no redirect url) — for a
 * legitimate, authenticated, authorized operator directly blocked from
 * ever reaching Stripe. The action itself isn't unit-tested directly (real
 * Supabase/Stripe SDK calls, no DI seam) — same reasoning as the other
 * flow-specific observability contract tests in this repo.
 */

function createFakeSentryClient(): { client: SentryCaptureClient } {
  return { client: { captureException: () => "evt_fake" } };
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

const STAGES = ["checkout-precondition", "checkout-session-create"] as const;

for (const stage of STAGES) {
  test(`stripe-checkout / ${stage}: customer gets the shared HHC support message, same id reaches Sentry and production Slack`, async () => {
    const { client } = createFakeSentryClient();
    const { sendSlack, calls } = createFakeSlack();

    const report = await withEnv("production", () =>
      reportCriticalFailure(
        {
          error: new Error(`simulated ${stage} failure`),
          flow: "stripe-checkout",
          stage,
          title: "Stripe Checkout Blocked",
          technicalSummary: "Stripe checkout session creation failed",
          context: { operatorId: "op-123", plan: "pro" },
          slackFields: { Plan: "pro", "Operator ID": "op-123" },
        },
        { sentryClient: client, sendSlack }
      )
    );

    assert.equal(report.flow, "stripe-checkout");
    assert.equal(report.stage, stage);
    assert.equal(report.severity, "critical");
    assert.ok(isValidHhcErrorReference(report.hhcErrorId));
    assert.ok(report.customerMessage.includes(report.hhcErrorId));
    assert.ok(report.customerMessage.includes("support@happyhourcompass.com"));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].channel, "ops-critical");
    assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
    assert.equal(calls[0].metadata?.Plan, "pro");
  });
}

test("stripe-checkout: preview does not page production Slack", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("preview", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated failure"),
        flow: "stripe-checkout",
        stage: "checkout-session-create",
        title: "Stripe Checkout Blocked",
        technicalSummary: "Stripe checkout session creation failed",
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(calls.length, 0);
  assert.equal(report.slackSent, false);
});

// ── Expected/customer-correctable outcomes are never instrumented ──────────
//
// createCheckoutSessionAction's "Not authenticated.", "Could not resolve
// operator.", "Only the admin can upgrade the plan.", and the (effectively
// unreachable given the plan: "pro"|"premium" type) "No price configured
// for that plan." branches never call reportCriticalFailure — confirmed by
// source review in the task report; there's nothing to unit-test for "does
// not call a function" beyond that review.

test("Stripe checkout context never includes an operator email or auth token", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated failure"),
        flow: "stripe-checkout",
        stage: "checkout-session-create",
        title: "Stripe Checkout Blocked",
        technicalSummary: "Stripe checkout session creation failed",
        slackFields: {
          Plan: "pro",
          "Operator ID": "op-123",
          // Type-valid string values for sensitive key names — the runtime
          // denylist is what's under test.
          email: "owner@example.com",
          authToken: "abc",
        },
      },
      { sentryClient: client, sendSlack }
    )
  );

  const metadata = calls[0].metadata ?? {};
  assert.equal(metadata.Plan, "pro");
  assert.equal("email" in metadata, false);
  assert.equal("authToken" in metadata, false);
});
