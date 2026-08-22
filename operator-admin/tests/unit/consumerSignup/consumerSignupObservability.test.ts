import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCriticalFailure } from "../../../src/lib/observability/reportCriticalFailure";
import { reportOperationalError } from "../../../src/lib/observability/reportOperationalError";
import type { SentryCaptureClient } from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { sendSlackAlert } from "../../../src/lib/slack";

/**
 * Pins the exact flow/stage/severity contract Consumer Signup's three
 * instrumented call sites use — createConsumerProfile() (sign-up/actions.ts,
 * shared by the signup action and /auth/confirm's retry), the generateLink
 * failure in createConsumerAccount() (sign-up/actions.ts), the confirmation
 * email failure (also createConsumerAccount()), and /auth/callback's own
 * parallel consumer_profiles fallback insert (route.ts). None of these files
 * are unit-tested directly — they call the real Supabase admin client, and
 * /auth/confirm/page.tsx is a client component — same reasoning as every
 * other flow-specific contract test in this repo.
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

function tagsOf(call: { captureContext: unknown }): Record<string, string> | undefined {
  return (call.captureContext as { tags?: Record<string, string> } | undefined)?.tags;
}

const FLOW = "consumer-signup";

// ── auth-user-create (generateLink failure — always critical) ──────────────

test("consumer-signup / auth-user-create: critical, one HHC id, one production Slack alert, customer message correlated", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated generateLink failure"),
        flow: FLOW,
        stage: "auth-user-create",
        title: "Consumer Signup Failed",
        technicalSummary: "Supabase generateLink (signup) failed",
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, FLOW);
  assert.equal(report.stage, "auth-user-create");
  assert.equal(report.severity, "critical");
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.ok(report.customerMessage.includes(report.hhcErrorId));
  assert.ok(report.customerMessage.includes("support@happyhourcompass.com"));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
});

test("consumer-signup / auth-user-create: preview does not page production Slack", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("preview", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated generateLink failure"),
        flow: FLOW,
        stage: "auth-user-create",
        title: "Consumer Signup Failed",
        technicalSummary: "Supabase generateLink (signup) failed",
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(calls.length, 0);
  assert.equal(report.slackSent, false);
});

// ── profile-create — first attempt (operational, Sentry-only) ──────────────

test("consumer-signup / profile-create, first attempt: operational, Sentry-only, no Slack", () => {
  const { client, calls } = createFakeSentryClient();

  const report = reportOperationalError(
    {
      error: new Error("simulated consumer_profiles upsert failure"),
      flow: FLOW,
      stage: "profile-create",
      severity: "operational",
      context: { isRetryAttempt: false, userId: "u-1" },
    },
    client
  );

  assert.equal(report.severity, "operational");
  assert.equal(report.stage, "profile-create");
  assert.equal(calls.length, 1); // Sentry captured
  assert.equal(contextOf(calls[0])?.isRetryAttempt, false);
  // No sendSlack parameter exists on reportOperationalError — structurally
  // cannot reach Slack, unlike reportCriticalFailure.
});

// ── profile-create — retry (critical, one Slack alert) ──────────────────────

test("consumer-signup / profile-create, retry (isRetryAttempt: true): critical, one production Slack alert", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated retry upsert failure"),
        flow: FLOW,
        stage: "profile-create",
        title: "Consumer Profile Creation Failed",
        technicalSummary: "database write failed (consumer_profiles upsert, retry)",
        context: { isRetryAttempt: true, userId: "u-2" },
        slackFields: { "User ID": "u-2" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.severity, "critical");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].metadata?.["User ID"], "u-2");
  assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
});

test("profile-create first-attempt and retry failures each get their own distinct HHC id", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  const firstAttempt = reportOperationalError(
    { error: new Error("simulated"), flow: FLOW, stage: "profile-create", severity: "operational", context: { isRetryAttempt: false } },
    client
  );
  const retry = await withEnv("production", () =>
    reportCriticalFailure(
      { error: new Error("simulated"), flow: FLOW, stage: "profile-create", title: "x", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    )
  );

  assert.notEqual(firstAttempt.hhcErrorId, retry.hhcErrorId);
});

// ── confirmation-email-send (Sentry-only — Slack lives in the shared email subsystem) ─

test("consumer-signup / confirmation-email-send: critical severity, Sentry-only, correct context", () => {
  const { client, calls } = createFakeSentryClient();

  const report = reportOperationalError(
    {
      error: new Error("simulated confirmation email failure"),
      flow: FLOW,
      stage: "confirmation-email-send",
      severity: "critical",
      context: { userId: "u-3" },
    },
    client
  );

  assert.equal(report.severity, "critical");
  assert.equal(report.stage, "confirmation-email-send");
  assert.equal(calls.length, 1);
  assert.equal(tagsOf(calls[0])?.hhc_error_id, report.hhcErrorId);
});

// ── Grouping ─────────────────────────────────────────────────────────────────

test("no stage in consumer-signup ever sets a Sentry fingerprint from the HHC id", () => {
  const { client, calls } = createFakeSentryClient();

  for (const stage of ["auth-user-create", "profile-create", "confirmation-email-send"]) {
    reportOperationalError(
      { error: new Error("simulated"), flow: FLOW, stage, severity: "critical" },
      client
    );
  }

  for (const call of calls) {
    assert.equal((call.captureContext as { fingerprint?: unknown } | undefined)?.fingerprint, undefined);
  }
});

// ── Privacy ──────────────────────────────────────────────────────────────────

test("consumer-signup context/slackFields never include email, password, or tokens, even if mistakenly passed", async () => {
  const { client, calls: sentryCalls } = createFakeSentryClient();
  const { sendSlack, calls: slackCalls } = createFakeSlack();

  await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated"),
        flow: FLOW,
        stage: "auth-user-create",
        title: "Consumer Signup Failed",
        technicalSummary: "x",
        context: {
          userId: "u-4",
          // Type-valid string values for sensitive key names — the runtime
          // denylist (sanitizeOperationalContext) is what's under test.
          email: "consumer@example.com",
          password: "hunter2",
          confirmationToken: "abc123",
        },
        slackFields: {
          "User ID": "u-4",
          email: "consumer@example.com",
          authToken: "xyz",
        },
      },
      { sentryClient: client, sendSlack }
    )
  );

  const context = contextOf(sentryCalls[0]) ?? {};
  assert.equal(context.userId, "u-4");
  for (const forbidden of ["email", "password", "confirmationToken"]) {
    assert.equal(forbidden in context, false, `Sentry context must not contain "${forbidden}"`);
  }

  const metadata = slackCalls[0].metadata ?? {};
  assert.equal(metadata["User ID"], "u-4");
  assert.equal("email" in metadata, false);
  assert.equal("authToken" in metadata, false);
});

// ── Personal-name gap — hardened, no longer an accepted leak ───────────────
//
// A prior version of this test file documented an ACCEPTED gap:
// sanitizeOperationalContext()'s denylist (shared, already-deployed
// infrastructure — src/lib/observability/reportOperationalError.ts) matched
// email/phone/address/token/password/secret/cookie/signature/ssn/card/auth*
// key-name patterns, but not generic name-like keys such as "firstName" or
// "lastName". That gap has since been closed directly in the shared
// sanitizer (see reportOperationalError.ts's SENSITIVE_CONTEXT_KEY_PATTERN
// and reportOperationalError.test.ts's own dedicated tests for the full
// fix). This test now proves the fix from Consumer Signup's own vantage
// point — a real personal-name key is dropped, and no real call site in
// this flow needed to change (they never passed name fields to begin with).
test("firstName is now correctly dropped by the hardened shared sanitizer, even though no real call site here ever passed it", () => {
  const { client, calls } = createFakeSentryClient();

  reportOperationalError(
    {
      error: new Error("simulated"),
      flow: FLOW,
      stage: "profile-create",
      severity: "operational",
      // "firstName" is type-valid (a string value) — the type system alone
      // never prevented this; the runtime denylist is what's under test.
      context: { userId: "u-5", firstName: "Mindy" },
    },
    client
  );

  const context = contextOf(calls[0]) ?? {};
  assert.equal(context.userId, "u-5"); // safe field still survives
  assert.equal("firstName" in context, false); // personal-name field now dropped
});
