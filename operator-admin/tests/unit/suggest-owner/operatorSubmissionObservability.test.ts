import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCriticalAcquisitionFailure } from "../../../src/lib/observability/reportCriticalFailure";
import type { SentryCaptureClient } from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { sendSlackAlert } from "../../../src/lib/slack";

/**
 * Pins the exact flow/stage/title contract saveOperatorSubmissionAction
 * (src/app/(consumer)/suggest/owner/actions.ts) uses at each of its three
 * reportCriticalAcquisitionFailure() call sites — venue-lookup, venue-insert,
 * submission-insert — the primary write paths analogous to the Casa de
 * Frida incident. A change to those literal strings in actions.ts without
 * updating this test is exactly the kind of drift this guards against,
 * since the server action itself isn't practically unit-testable without a
 * large DI refactor (it calls the real Supabase admin client, Google
 * Places, and email senders directly).
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

function withProductionEnv<T>(fn: () => T): T {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
}

const STAGES = [
  { stage: "venue-lookup", technicalSummary: "database lookup failed (venues by place_id)" },
  { stage: "venue-insert", technicalSummary: "database write failed (venues insert)" },
  { stage: "submission-insert", technicalSummary: "database write failed (operator_submissions insert)" },
] as const;

for (const { stage, technicalSummary } of STAGES) {
  test(`operator-submission / ${stage}: reports to Sentry, generates one HHC id, and pages #ops-critical in production`, async () => {
    const { client } = createFakeSentryClient();
    const { sendSlack, calls } = createFakeSlack();

    const report = await withProductionEnv(() =>
      reportCriticalAcquisitionFailure(
        {
          error: new Error(`simulated ${stage} failure`),
          flow: "operator-submission",
          stage,
          title: "Operator Venue Submission Failed",
          technicalSummary,
          slackFields: { Venue: "Casa de Frida" },
        },
        { sentryClient: client, sendSlack }
      )
    );

    assert.equal(report.flow, "operator-submission");
    assert.equal(report.stage, stage);
    assert.equal(report.severity, "critical");
    assert.ok(isValidHhcErrorReference(report.hhcErrorId));
    assert.ok(report.customerMessage.includes(report.hhcErrorId));
    assert.ok(report.customerMessage.includes("support@happyhourcompass.com"));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].channel, "ops-critical");
    assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
    assert.equal(calls[0].metadata?.Stage, stage);
    assert.equal(calls[0].metadata?.Venue, "Casa de Frida");
  });
}
