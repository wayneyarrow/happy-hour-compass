import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reportCriticalAcquisitionFailure,
} from "../../../src/lib/observability/reportCriticalFailure";
import type {
  SentryCaptureClient,
  SentryCaptureContext,
} from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { sendSlackAlert } from "../../../src/lib/slack";

// ── Fakes ────────────────────────────────────────────────────────────────────
//
// Same narrow-DI pattern already used throughout this foundation
// (reportOperationalError.test.ts's fake SentryCaptureClient;
// tests/unit/google/support/*'s fake Supabase clients).

type RecordedCapture = { exception: unknown; captureContext: SentryCaptureContext | undefined };

function createFakeSentryClient(eventId = "evt_fake"): { client: SentryCaptureClient; calls: RecordedCapture[] } {
  const calls: RecordedCapture[] = [];
  return {
    client: {
      captureException(exception, captureContext) {
        calls.push({ exception, captureContext });
        return eventId;
      },
    },
    calls,
  };
}

type RecordedSlackCall = Parameters<typeof sendSlackAlert>[0];

function createFakeSlack(): { sendSlack: typeof sendSlackAlert; calls: RecordedSlackCall[] } {
  const calls: RecordedSlackCall[] = [];
  const sendSlack = (async (params: RecordedSlackCall) => {
    calls.push(params);
    return "delivered" as const;
  }) as typeof sendSlackAlert;
  return { sendSlack, calls };
}

function withVercelEnv<T>(env: string | undefined, fn: () => T): T {
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

const baseParams = {
  error: new Error("insert failed"),
  flow: "operator-submission",
  stage: "venue-insert",
  title: "Operator Venue Submission Failed",
  technicalSummary: "database write failed (venues insert)",
};

// ── Sentry capture ───────────────────────────────────────────────────────────

test("captures the error via reportOperationalError exactly once", async () => {
  const { client, calls } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  assert.equal(calls.length, 1);
});

test("severity is always critical, regardless of caller input (not exposed as a param)", async () => {
  const { client, calls } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  assert.equal(calls[0].captureContext?.tags?.severity, "critical");
});

test("Sentry tags carry the correct flow/stage/environment", async () => {
  const { client, calls } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  await withVercelEnv("preview", () =>
    reportCriticalAcquisitionFailure(
      { ...baseParams, flow: "venue-claim", stage: "claim-insert" },
      { sentryClient: client, sendSlack }
    )
  );

  const tags = calls[0].captureContext?.tags;
  assert.equal(tags?.flow, "venue-claim");
  assert.equal(tags?.stage, "claim-insert");
  assert.equal(tags?.environment, "preview");
});

// ── HHC ID correlation ───────────────────────────────────────────────────────

test("exactly one HHC id is generated, and it matches the id in the Sentry tag, the customer message, and the Slack alert", async () => {
  const { client, calls: sentryCalls } = createFakeSentryClient();
  const { sendSlack, calls: slackCalls } = createFakeSlack();

  const report = await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.equal(sentryCalls[0].captureContext?.tags?.hhc_error_id, report.hhcErrorId);
  assert.ok(report.customerMessage.includes(report.hhcErrorId));
  assert.ok(String(slackCalls[0].metadata?.["HHC Error"]).includes(report.hhcErrorId));
});

test("customer message contains the support email", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  const report = await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  assert.ok(report.customerMessage.includes("support@happyhourcompass.com"));
});

// ── Production-only Slack guard ──────────────────────────────────────────────

test("production environment sends exactly one #ops-critical alert", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].severity, "critical");
  assert.equal(report.slackSent, true);
});

test("preview environment does NOT send the production Slack alert", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withVercelEnv("preview", () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  assert.equal(calls.length, 0);
  assert.equal(report.slackSent, false);
  // Sentry still receives the correctly-tagged event even when Slack is skipped.
  assert.equal(report.environment, "preview");
});

test("development/local environment does NOT send the production Slack alert", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  await withVercelEnv(undefined, () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  assert.equal(calls.length, 0);
});

test("real production sendSlackAlert is never invoked when the default dependency is used outside production (no accidental live call)", async () => {
  const { client } = createFakeSentryClient();
  // No sendSlack override — uses the real sendSlackAlert. In test/dev, no
  // SLACK_OPS_CRITICAL_WEBHOOK_URL env var is set, so sendSlackAlert itself
  // is a safe no-op ("no-webhook") even if this were reached. Belt-and-braces
  // check that the preview guard prevents it from being reached at all.
  const previousWebhook = process.env.SLACK_OPS_CRITICAL_WEBHOOK_URL;
  delete process.env.SLACK_OPS_CRITICAL_WEBHOOK_URL;
  try {
    const report = await withVercelEnv("preview", () =>
      reportCriticalAcquisitionFailure(baseParams, { sentryClient: client })
    );
    assert.equal(report.slackSent, false);
  } finally {
    if (previousWebhook !== undefined) process.env.SLACK_OPS_CRITICAL_WEBHOOK_URL = previousWebhook;
  }
});

// ── Slack alert content ──────────────────────────────────────────────────────

test("Slack alert includes safe flow/stage/environment/Sentry-event context", async () => {
  const { client } = createFakeSentryClient("evt_xyz789");
  const { sendSlack, calls } = createFakeSlack();

  await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  const metadata = calls[0].metadata;
  assert.equal(metadata?.Flow, "operator-submission");
  assert.equal(metadata?.Stage, "venue-insert");
  assert.equal(metadata?.Environment, "production");
  assert.equal(metadata?.["Sentry Event"], "evt_xyz789");
  assert.equal(metadata?.Failure, "database write failed (venues insert)");
});

test("Slack alert merges caller-supplied safe slackFields (e.g. venue name)", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(
      { ...baseParams, slackFields: { Venue: "Casa de Frida", "Venue ID": "715ef4a4-..." } },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(calls[0].metadata?.Venue, "Casa de Frida");
  assert.equal(calls[0].metadata?.["Venue ID"], "715ef4a4-...");
});

test("Slack alert title matches the caller-supplied title", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(
      { ...baseParams, title: "Venue Claim Failed" },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(calls[0].title, "Venue Claim Failed");
});

// ── Privacy ──────────────────────────────────────────────────────────────────

test("Slack metadata never includes sensitive slackFields (email/phone/token/etc.)", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(
      {
        ...baseParams,
        // These keys are all type-valid (string values) — the guard being
        // tested here is sanitizeOperationalContext's RUNTIME key-name
        // denylist, not a type-level restriction, so no @ts-expect-error
        // is needed or applicable.
        slackFields: {
          Venue: "Casa de Frida",
          email: "someone@example.com",
          phone: "555-0100",
          turnstileToken: "abc123",
          authToken: "secret",
        },
      },
      { sentryClient: client, sendSlack }
    )
  );

  const metadata = calls[0].metadata ?? {};
  assert.equal(metadata.Venue, "Casa de Frida");
  assert.equal("email" in metadata, false);
  assert.equal("phone" in metadata, false);
  assert.equal("turnstileToken" in metadata, false);
  assert.equal("authToken" in metadata, false);
});

test("Sentry context never includes sensitive fields (same sanitizer as reportOperationalError)", async () => {
  const { client, calls } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(
      {
        ...baseParams,
        // Same reasoning as above — a type-valid string value for a
        // sensitive key name; the runtime denylist is what's under test.
        context: { venueId: "v-1", email: "someone@example.com" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  const context = calls[0].captureContext?.contexts?.hhc_context as Record<string, unknown> | undefined;
  assert.equal(context?.venueId, "v-1");
  assert.equal(context && "email" in context, false);
});

// ── Grouping ─────────────────────────────────────────────────────────────────

test("does not set a Sentry fingerprint from the HHC id (default grouping preserved)", async () => {
  const { client, calls } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  await withVercelEnv("production", () =>
    reportCriticalAcquisitionFailure(baseParams, { sentryClient: client, sendSlack })
  );

  assert.equal(calls[0].captureContext?.fingerprint, undefined);
});
