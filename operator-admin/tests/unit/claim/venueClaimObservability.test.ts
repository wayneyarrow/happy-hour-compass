import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCriticalAcquisitionFailure } from "../../../src/lib/observability/reportCriticalFailure";
import type { SentryCaptureClient } from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { sendSlackAlert } from "../../../src/lib/slack";

/**
 * Pins the exact flow/stage/title contract submitClaimAction
 * (src/app/(consumer)/venue/[id]/claim/actions.ts) uses at its one
 * reportCriticalAcquisitionFailure() call site — the primary venue_claims
 * insert failure the observability audit identified as a live blind spot.
 * The action itself isn't practically unit-testable without a large DI
 * refactor (it calls the real Supabase admin client directly) — see
 * operatorSubmissionObservability.test.ts for the same reasoning.
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

test("venue-claim / claim-insert: reports to Sentry, generates one HHC id, and pages #ops-critical in production", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalAcquisitionFailure(
      {
        error: new Error("simulated venue_claims insert failure"),
        flow: "venue-claim",
        stage: "claim-insert",
        title: "Venue Claim Failed",
        technicalSummary: "database write failed (venue_claims insert)",
        context: { venueId: "v-123" },
        slackFields: { Venue: "Browns Social House", "Venue ID": "v-123" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, "venue-claim");
  assert.equal(report.stage, "claim-insert");
  assert.equal(report.severity, "critical");
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.ok(report.customerMessage.includes(report.hhcErrorId));
  assert.ok(report.customerMessage.includes("support@happyhourcompass.com"));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].title, "Venue Claim Failed");
  assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
  assert.equal(calls[0].metadata?.Venue, "Browns Social House");
});

test("venue-claim / claim-insert: preview environment does not page production Slack", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("preview", () =>
    reportCriticalAcquisitionFailure(
      {
        error: new Error("simulated venue_claims insert failure"),
        flow: "venue-claim",
        stage: "claim-insert",
        title: "Venue Claim Failed",
        technicalSummary: "database write failed (venue_claims insert)",
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(calls.length, 0);
  assert.equal(report.slackSent, false);
});

// ── Ordinary business-rule outcomes are not instrumented ────────────────────
//
// submitClaimAction's 23505 (unique_violation — "already under review") and
// venue-not-found/already-claimed branches never call
// reportCriticalAcquisitionFailure at all (see actions.ts) — they return
// their existing specific copy unchanged, exactly as before this task.
// There is nothing to unit-test for "doesn't call a function" beyond
// reviewing the diff itself, which the task report documents explicitly.
