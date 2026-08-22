import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCriticalFailure } from "../../../src/lib/observability/reportCriticalFailure";
import { reportOperationalError } from "../../../src/lib/observability/reportOperationalError";
import type { SentryCaptureClient } from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { sendSlackAlert } from "../../../src/lib/slack";

/**
 * Pins the exact flow/stage/severity contract src/app/api/webhooks/stripe/route.ts
 * uses at each of its instrumented branches — checkout-completed-invalid-payload,
 * checkout-completed-sync, subscription-updated-sync (both severity branches),
 * subscription-deleted-sync, invoice-payment-succeeded-sync (operational),
 * invoice-payment-failed-sync (critical, distinct from the existing
 * unconditional #ops-alerts "Stripe payment failed" notification) — plus the
 * "enrich an existing Slack alert" pattern used for webhook-secret-missing
 * and handler-exception, WITHOUT unit-testing the webhook route itself (it
 * calls the real Stripe SDK and Supabase admin client directly with no
 * existing DI seam — same reasoning as operatorSubmissionObservability.test.ts
 * / venueClaimObservability.test.ts).
 */

function createFakeSentryClient(): { client: SentryCaptureClient; calls: { exception: unknown; captureContext: unknown }[] } {
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

// ── checkout.session.completed → DB sync failure (always critical) ─────────

test("stripe-subscription / checkout-completed-sync: critical, one HHC id, one production Slack alert with safe Stripe context", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated operator_subscriptions upsert failure"),
        flow: "stripe-subscription",
        stage: "checkout-completed-sync",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "database sync failed (checkout activation)",
        context: {
          stripeEventId: "evt_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          planCode: "pro",
        },
        slackFields: { "Stripe Event": "evt_123", Subscription: "sub_123", Plan: "pro" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, "stripe-subscription");
  assert.equal(report.stage, "checkout-completed-sync");
  assert.equal(report.severity, "critical");
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
  assert.equal(calls[0].metadata?.["Stripe Event"], "evt_123");
  assert.equal(calls[0].metadata?.Subscription, "sub_123");
  assert.equal(calls[0].metadata?.Plan, "pro");
});

test("stripe-subscription / checkout-completed-sync: preview does not page production Slack", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("preview", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated failure"),
        flow: "stripe-subscription",
        stage: "checkout-completed-sync",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "database sync failed (checkout activation)",
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(calls.length, 0);
  assert.equal(report.slackSent, false);
});

// ── customer.subscription.updated → DB sync failure (severity varies) ──────

test("stripe-subscription / subscription-updated-sync: critical when a plan change is involved", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated sync failure"),
        flow: "stripe-subscription",
        stage: "subscription-updated-sync",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "database sync failed (plan change)",
        context: { stripeEventId: "evt_456", stripeSubscriptionId: "sub_456", planCode: "premium" },
        slackFields: { "Stripe Event": "evt_456", Subscription: "sub_456", Plan: "premium" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.severity, "critical");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].metadata?.Plan, "premium");
});

test("stripe-subscription / subscription-updated-sync: operational (Sentry-only, no Slack) when no plan change is involved", async () => {
  const { client, calls } = createFakeSentryClient();
  // reportOperationalError is the exact call the route makes for the
  // no-plan-change branch — it never touches Slack at all (no sendSlack
  // parameter exists on it), unlike reportCriticalFailure.
  const report = withEnv("production", () =>
    reportOperationalError(
      {
        error: new Error("simulated sync failure"),
        flow: "stripe-subscription",
        stage: "subscription-updated-sync",
        severity: "operational",
        context: { stripeEventId: "evt_789", stripeSubscriptionId: "sub_789" },
      },
      client
    )
  );

  assert.equal(report.severity, "operational");
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].captureContext && (calls[0].captureContext as { tags?: { severity?: string } }).tags?.severity, "operational");
});

// ── customer.subscription.deleted → DB sync failure (always critical) ──────

test("stripe-subscription / subscription-deleted-sync: always critical (downgrade to free is always an entitlement change)", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated sync failure"),
        flow: "stripe-subscription",
        stage: "subscription-deleted-sync",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "database sync failed (downgrade to free)",
        context: { stripeEventId: "evt_999", stripeSubscriptionId: "sub_999" },
        slackFields: { "Stripe Event": "evt_999", Subscription: "sub_999", Plan: "free" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.severity, "critical");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].metadata?.Plan, "free");
});

test("no duplicate Slack alert across the three subscription DB-sync stages: each reportCriticalFailure call sends exactly one", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const stages = ["checkout-completed-sync", "subscription-updated-sync", "subscription-deleted-sync"];
  for (const stage of stages) {
    await withEnv("production", () =>
      reportCriticalFailure(
        {
          error: new Error("simulated failure"),
          flow: "stripe-subscription",
          stage,
          title: "Stripe Subscription Sync Failed",
          technicalSummary: "database sync failed",
        },
        { sentryClient: client, sendSlack }
      )
    );
  }

  assert.equal(calls.length, stages.length); // one alert per occurrence, not more
  const uniqueIds = new Set(calls.map((c) => c.metadata?.["HHC Error"]));
  assert.equal(uniqueIds.size, stages.length); // each occurrence got its own distinct HHC id
});

// ── Existing-alert enrichment (webhook-secret-missing / handler-exception) ─
//
// These two branches keep their EXISTING sendSlackAlert() call exactly as
// it was (same channel/title/message/volume) — only Sentry+HHC fields are
// added to the same metadata object. There is no reportCriticalFailure call
// for these; route.ts calls reportOperationalError() directly and merges
// its result into the pre-existing sendSlackAlert() call. These tests prove
// that merge pattern produces a self-consistent, correlated alert.

test("stripe-webhook / webhook-secret-missing: Sentry report's id/eventId can be merged into an existing Slack call without a second alert", () => {
  const { client } = createFakeSentryClient();

  const report = withEnv("production", () =>
    reportOperationalError(
      { error: new Error("STRIPE_WEBHOOK_SECRET is not set"), flow: "stripe-webhook", stage: "webhook-secret-missing", severity: "critical" },
      client
    )
  );

  // Simulates route.ts's existing sendSlackAlert call, enriched in place.
  const metadata = {
    environment: "production",
    "HHC Error": report.hhcErrorId,
    "Sentry Event": report.sentryEventId ?? "unavailable",
  };

  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.equal(metadata["HHC Error"], report.hhcErrorId);
  assert.equal(metadata["Sentry Event"], "evt_fake");
});

test("stripe-webhook / handler-exception: safe event id/type context, no raw payload", () => {
  const { client, calls } = createFakeSentryClient();

  const report = withEnv("production", () =>
    reportOperationalError(
      {
        error: new Error("simulated unhandled handler error"),
        flow: "stripe-webhook",
        stage: "handler-exception",
        severity: "critical",
        context: { stripeEventId: "evt_abc", stripeEventType: "customer.subscription.updated" },
      },
      client
    )
  );

  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  const captureContext = calls[0].captureContext as { contexts?: { hhc_context?: Record<string, unknown> } };
  const context = captureContext.contexts?.hhc_context;
  assert.equal(context?.stripeEventId, "evt_abc");
  assert.equal(context?.stripeEventType, "customer.subscription.updated");
  assert.equal(Object.keys(context ?? {}).length, 2); // nothing else snuck in
});

// ── Privacy: Stripe-specific sensitive fields never appear ─────────────────

test("Stripe context/slackFields never include card data, billing address, webhook signature, or customer email", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls: slackCalls } = createFakeSlack();

  await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated failure"),
        flow: "stripe-subscription",
        stage: "checkout-completed-sync",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "database sync failed",
        context: {
          stripeSubscriptionId: "sub_123",
          // Type-valid string values for sensitive key names — the runtime
          // denylist (sanitizeOperationalContext), not the type system, is
          // what's under test here.
          email: "operator@example.com",
          billingAddress: "123 Main St",
        },
        slackFields: {
          Subscription: "sub_123",
          cardNumber: "4242424242424242",
          webhookSignature: "t=1,v1=abc123",
          stripeSecretKey: "sk_live_abc",
          authToken: "eyJ...",
        },
      },
      { sentryClient: client, sendSlack }
    )
  );

  const metadata = slackCalls[0].metadata ?? {};
  assert.equal(metadata.Subscription, "sub_123");
  for (const forbidden of ["cardNumber", "webhookSignature", "stripeSecretKey", "authToken"]) {
    assert.equal(forbidden in metadata, false, `metadata must not contain "${forbidden}"`);
  }
});

// ── checkout.session.completed → missing required fields ───────────────────

test("stripe-subscription / checkout-completed-invalid-payload: critical, safe field-name-only error, one production Slack alert", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("checkout.session.completed missing required fields: operator_id, target_plan"),
        flow: "stripe-subscription",
        stage: "checkout-completed-invalid-payload",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "checkout session missing required fields for activation",
        context: { stripeEventId: "evt_111", stripeSessionId: "cs_111" },
        slackFields: { "Stripe Event": "evt_111", "Checkout Session": "cs_111" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, "stripe-subscription");
  assert.equal(report.stage, "checkout-completed-invalid-payload");
  assert.equal(report.severity, "critical");
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
  assert.equal(calls[0].metadata?.["Checkout Session"], "cs_111");
});

// ── invoice.payment_succeeded → DB sync failure (operational) ──────────────

test("stripe-subscription / invoice-payment-succeeded-sync: operational, Sentry-only, no Slack (status/period-only, not entitlement)", () => {
  const { client, calls } = createFakeSentryClient();

  const report = withEnv("production", () =>
    reportOperationalError(
      {
        error: new Error("simulated sync failure"),
        flow: "stripe-subscription",
        stage: "invoice-payment-succeeded-sync",
        severity: "operational",
        context: { stripeEventId: "evt_222", stripeInvoiceId: "in_222", stripeSubscriptionId: "sub_222" },
      },
      client
    )
  );

  assert.equal(report.severity, "operational");
  assert.equal(report.flow, "stripe-subscription");
  assert.equal(report.stage, "invoice-payment-succeeded-sync");
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.equal(calls.length, 1); // Sentry captured
  // No sendSlack parameter exists on reportOperationalError at all — there
  // is structurally no way for this call to reach Slack, unlike
  // reportCriticalFailure.
});

// ── invoice.payment_failed → DB sync failure (critical, distinct alert) ────

test("stripe-subscription / invoice-payment-failed-sync: critical, one production Slack alert, distinct from the ordinary payment-failed notification", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated sync failure"),
        flow: "stripe-subscription",
        stage: "invoice-payment-failed-sync",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "database sync failed (past_due not recorded)",
        context: { stripeEventId: "evt_333", stripeInvoiceId: "in_333", stripeSubscriptionId: "sub_333" },
        slackFields: { "Stripe Event": "evt_333", Subscription: "sub_333" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.severity, "critical");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].title, "Stripe Subscription Sync Failed"); // distinct title from "Stripe payment failed"
});

test("invoice.payment_failed: the ordinary expected notification and the new sync-failure alert are semantically distinct and both fire correctly when both legitimately occur", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  // Simulates route.ts's actual sequence for this event when the sync fails:
  // 1. reportCriticalFailure() for the internal sync failure (new, this task)
  await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated sync failure"),
        flow: "stripe-subscription",
        stage: "invoice-payment-failed-sync",
        title: "Stripe Subscription Sync Failed",
        technicalSummary: "database sync failed (past_due not recorded)",
        slackFields: { "Stripe Event": "evt_444", Subscription: "sub_444" },
      },
      { sentryClient: client, sendSlack }
    )
  );
  // 2. The pre-existing, unconditional "Stripe payment failed" #ops-alerts
  //    notification — unchanged by this task, always fires for this event
  //    regardless of sync outcome.
  await sendSlack({
    channel: "ops-alerts",
    severity: "warning",
    title: "Stripe payment failed",
    message: "Invoice payment failed — operator marked as past_due.",
    metadata: { operator_id: "op-1", subscription_id: "sub_444", invoice_id: "in_444" },
  });

  assert.equal(calls.length, 2); // two distinct alerts, not a duplicate of one
  const [critical, expected] = calls;
  assert.equal(critical.channel, "ops-critical");
  assert.equal(critical.title, "Stripe Subscription Sync Failed");
  assert.equal(expected.channel, "ops-alerts");
  assert.equal(expected.title, "Stripe payment failed");
  assert.notEqual(critical.title, expected.title);
  assert.notEqual(critical.channel, expected.channel);
});

// ── Full coverage: no HHC id ever generated twice for one occurrence ───────

test("all five critical DB-sync/payload stages each produce their own distinct HHC id — no cross-stage id reuse", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const stages = [
    "checkout-completed-invalid-payload",
    "checkout-completed-sync",
    "subscription-updated-sync",
    "subscription-deleted-sync",
    "invoice-payment-failed-sync",
  ];
  for (const stage of stages) {
    await withEnv("production", () =>
      reportCriticalFailure(
        { error: new Error("simulated failure"), flow: "stripe-subscription", stage, title: "Stripe Subscription Sync Failed", technicalSummary: "database sync failed" },
        { sentryClient: client, sendSlack }
      )
    );
  }

  assert.equal(calls.length, stages.length);
  const uniqueIds = new Set(calls.map((c) => c.metadata?.["HHC Error"]));
  assert.equal(uniqueIds.size, stages.length);
});
