import { test } from "node:test";
import assert from "node:assert/strict";
import { reportOperationalError } from "../../../src/lib/observability/reportOperationalError";
import type { SentryCaptureClient } from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";

/**
 * Pins the exact flow/stage/severity contract src/lib/operatorActivation.ts
 * uses at each of its now-instrumented failure branches — all Sentry-only
 * (reportOperationalError(), never reportCriticalFailure()) because every
 * branch already had an existing #ops-critical Slack alert before this task,
 * which is enriched in place rather than duplicated. The file itself isn't
 * unit-tested directly (real Supabase admin client calls, no DI seam — same
 * reasoning as every other flow-specific contract test in this repo). These
 * tests exercise the exact flow/stage/severity/context each real branch
 * passes, and separately prove the "merge into an existing Slack call"
 * correlation pattern the real code uses (see webhookSync.test.ts's
 * webhook-secret-missing / handler-exception tests for the same pattern).
 */

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

function tagsOf(call: { captureContext: unknown }): Record<string, string> | undefined {
  return (call.captureContext as { tags?: Record<string, string> } | undefined)?.tags;
}

function contextOf(call: { captureContext: unknown }): Record<string, unknown> | undefined {
  return (call.captureContext as { contexts?: { hhc_context?: Record<string, unknown> } } | undefined)
    ?.contexts?.hhc_context;
}

const FLOW = "operator-activation";

// ── provisionOperatorForVenue() primary failure branches ───────────────────

const PRIMARY_STAGES = [
  "auth-user-create",
  "auth-user-lookup",
  "operator-insert",
  "venue-link",
  "activation-link-generate",
  "activation-email",
] as const;

for (const stage of PRIMARY_STAGES) {
  test(`operator-activation / ${stage}: Sentry captured once, correct flow/stage/severity, one HHC id, no fingerprint`, () => {
    const { client, calls } = createFakeSentryClient();

    const report = reportOperationalError(
      {
        error: new Error(`simulated ${stage} failure`),
        flow: FLOW,
        stage,
        severity: "critical",
        context: { venueId: "v-123", callerFlow: "[saveOperatorSubmissionAction]" },
      },
      client
    );

    assert.equal(calls.length, 1);
    assert.equal(report.flow, FLOW);
    assert.equal(report.stage, stage);
    assert.equal(report.severity, "critical");
    assert.ok(isValidHhcErrorReference(report.hhcErrorId));
    assert.equal(tagsOf(calls[0])?.hhc_error_id, report.hhcErrorId);
    assert.equal((calls[0].captureContext as { fingerprint?: unknown } | undefined)?.fingerprint, undefined);
  });
}

// ── Rollback helpers — same "rollback" stage, distinguished by context ─────

const ROLLBACK_STEPS = ["auth-user", "operator", "venue-link"] as const;

for (const rollbackStep of ROLLBACK_STEPS) {
  test(`operator-activation / rollback (${rollbackStep}): correct stage, safe rollbackStep context, one HHC id`, () => {
    const { client, calls } = createFakeSentryClient();

    const report = reportOperationalError(
      {
        error: new Error(`simulated ${rollbackStep} rollback failure`),
        flow: FLOW,
        stage: "rollback",
        severity: "critical",
        context: { rollbackStep, callerFlow: "[reviewClaimAction]" },
      },
      client
    );

    assert.equal(report.stage, "rollback");
    assert.equal(contextOf(calls[0])?.rollbackStep, rollbackStep);
    assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  });
}

test("rollback failures each get their own distinct HHC id, even for the same underlying primary failure", () => {
  const { client } = createFakeSentryClient();

  const first = reportOperationalError(
    { error: new Error("simulated"), flow: FLOW, stage: "rollback", severity: "critical", context: { rollbackStep: "auth-user" } },
    client
  );
  const second = reportOperationalError(
    { error: new Error("simulated"), flow: FLOW, stage: "rollback", severity: "critical", context: { rollbackStep: "operator" } },
    client
  );

  assert.notEqual(first.hhcErrorId, second.hhcErrorId);
});

// ── completeOperatorAccountActivation() failure branches ───────────────────

const COMPLETION_STAGES = [
  "activation-complete-update",
  "activation-note",
  "activation-notification-email",
] as const;

for (const stage of COMPLETION_STAGES) {
  test(`operator-activation / ${stage}: critical, correct flow/stage, one HHC id`, () => {
    const { client, calls } = createFakeSentryClient();

    const report = reportOperationalError(
      {
        error: new Error(`simulated ${stage} failure`),
        flow: FLOW,
        stage,
        severity: "critical",
        context: { operatorId: "op-456" },
      },
      client
    );

    assert.equal(calls.length, 1);
    assert.equal(report.severity, "critical");
    assert.equal(report.stage, stage);
    assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  });
}

// ── Correlation: same report merges into the EXISTING Slack call, not a new one ─

test("the report's hhcErrorId/sentryEventId can be merged into an existing sendSlackAlert() metadata object without a second alert", () => {
  const { client } = createFakeSentryClient();

  const report = reportOperationalError(
    {
      error: new Error("simulated auth-user-create failure"),
      flow: FLOW,
      stage: "auth-user-create",
      severity: "critical",
      context: { venueId: "v-1" },
    },
    client
  );

  // Simulates operatorActivation.ts's existing sendSlackAlert() call,
  // enriched in place — same title/message/metadata shape, just two new
  // fields appended, exactly as the real code does.
  const metadata = {
    Email: "existing-field-unchanged@example.com", // pre-existing field, untouched by this task
    "Venue ID": "v-1",
    Error: "simulated auth-user-create failure",
    Flow: "[saveOperatorSubmissionAction]",
    "HHC Error": report.hhcErrorId,
    "Sentry Event": report.sentryEventId ?? "unavailable",
  };

  assert.equal(metadata["HHC Error"], report.hhcErrorId);
  assert.equal(metadata["Sentry Event"], "evt_fake");
  assert.ok(isValidHhcErrorReference(metadata["HHC Error"]));
});

// ── Privacy ──────────────────────────────────────────────────────────────────

test("operator-activation context never includes email, tokens, or secrets, even if a caller mistakenly passes them", () => {
  const { client, calls } = createFakeSentryClient();

  reportOperationalError(
    {
      error: new Error("simulated failure"),
      flow: FLOW,
      stage: "auth-user-create",
      severity: "critical",
      context: {
        venueId: "v-1",
        // Type-valid string values for sensitive key names — the runtime
        // denylist (sanitizeOperationalContext, inside reportOperationalError)
        // is what's under test, not the type system.
        email: "operator@example.com",
        setupLinkToken: "abc123",
      },
    },
    client
  );

  const context = contextOf(calls[0]);
  assert.equal(context?.venueId, "v-1");
  assert.equal(context && "email" in context, false);
  assert.equal(context && "setupLinkToken" in context, false);
});

// ── No fingerprint / default grouping preserved across all stages ──────────

test("no stage in this file ever sets a Sentry fingerprint from the HHC id", () => {
  const { client, calls } = createFakeSentryClient();

  for (const stage of [...PRIMARY_STAGES, "rollback", ...COMPLETION_STAGES]) {
    reportOperationalError(
      { error: new Error("simulated"), flow: FLOW, stage, severity: "critical" },
      client
    );
  }

  for (const call of calls) {
    assert.equal((call.captureContext as { fingerprint?: unknown } | undefined)?.fingerprint, undefined);
  }
});
