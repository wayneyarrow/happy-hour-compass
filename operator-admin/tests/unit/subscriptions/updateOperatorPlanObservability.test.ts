import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportCriticalFailure } from "../../../src/lib/observability/reportCriticalFailure";
import type { SentryCaptureClient } from "../../../src/lib/observability/reportOperationalError";
import { isValidHhcErrorReference } from "../../../src/lib/observability/errorReference";
import { sendSlackAlert } from "../../../src/lib/slack";

/**
 * Pins the exact flow/stage/severity/context contract src/lib/subscriptions.ts
 * uses at its three instrumented failure branches — updateOperatorPlan()'s
 * "subscription-upsert" and "operators-plan-sync" stages (flow
 * "operator-plan-update"), and syncStripeSubscription()'s previously-
 * unreported "operators-plan-sync" stage (flow "stripe-subscription", the
 * same flow the Stripe webhook route already uses for that function's
 * primary-write failures) — WITHOUT unit-testing subscriptions.ts's real
 * functions directly (they call the real Supabase admin client with no
 * existing DI seam — same reasoning as webhookSync.test.ts /
 * operatorSubmissionObservability.test.ts / venueClaimObservability.test.ts).
 *
 * Because there is no DI seam, "existing return behavior is unchanged" is
 * verified separately below via a static read of subscriptions.ts's source
 * text (SUBSCRIPTIONS_SOURCE), asserting the exact pre-existing return
 * statements and write count are still present and unchanged — a
 * lightweight regression guard that doesn't require a live Supabase
 * connection.
 */

const SUBSCRIPTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/subscriptions.ts"),
  "utf8"
);

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

/** Strips `//` line comments so structural regexes below don't false-match
 * prose inside a comment (e.g. "...its own returned { ok: false }..."). */
function stripLineComments(code: string): string {
  return code
    .split("\n")
    .map(line => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function contextOf(call: { captureContext: unknown }): Record<string, unknown> | undefined {
  return (call.captureContext as { contexts?: { hhc_context?: Record<string, unknown> } } | undefined)
    ?.contexts?.hhc_context;
}

// ── updateOperatorPlan() / write 1 — subscription-upsert ───────────────────

test("operator-plan-update / subscription-upsert: critical, one HHC id, one production Slack alert, safe context", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated operator_subscriptions upsert failure"),
        flow: "operator-plan-update",
        stage: "subscription-upsert",
        title: "Operator Plan Update Failed",
        technicalSummary: "database write failed (operator_subscriptions upsert)",
        context: { operatorId: "op_1", targetPlan: "pro" },
        slackFields: { "Operator ID": "op_1", "Target Plan": "pro" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, "operator-plan-update");
  assert.equal(report.stage, "subscription-upsert");
  assert.equal(report.severity, "critical");
  assert.ok(isValidHhcErrorReference(report.hhcErrorId));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].metadata?.["HHC Error"], report.hhcErrorId);
  assert.equal(calls[0].metadata?.["Operator ID"], "op_1");
  assert.equal(calls[0].metadata?.["Target Plan"], "pro");
});

// ── updateOperatorPlan() / write 2 — operators-plan-sync ────────────────────

test("operator-plan-update / operators-plan-sync: critical, one HHC id, one production Slack alert, safe context", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated operators.plan update failure"),
        flow: "operator-plan-update",
        stage: "operators-plan-sync",
        title: "Operator Plan Update Failed",
        technicalSummary: "database write failed (operators.plan sync — enforcement mirror stale)",
        context: { operatorId: "op_2", targetPlan: "free" },
        slackFields: { "Operator ID": "op_2", "Target Plan": "free" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, "operator-plan-update");
  assert.equal(report.stage, "operators-plan-sync");
  assert.equal(report.severity, "critical");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
});

// ── syncStripeSubscription() / operators-plan-sync (previously unreported) ──

test("stripe-subscription / operators-plan-sync: critical, one HHC id, one production Slack alert, safe Stripe context", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated operators.plan sync failure (Stripe path)"),
        flow: "stripe-subscription",
        stage: "operators-plan-sync",
        title: "Stripe Subscription Plan Sync Failed",
        technicalSummary: "database write failed (operators.plan sync — enforcement mirror stale)",
        context: {
          operatorId: "op_3",
          targetPlan: "premium",
          stripeSubscriptionId: "sub_123",
          stripeCustomerId: "cus_123",
        },
        slackFields: { "Operator ID": "op_3", "Target Plan": "premium", Subscription: "sub_123" },
      },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(report.flow, "stripe-subscription");
  assert.equal(report.stage, "operators-plan-sync");
  assert.equal(report.severity, "critical");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "ops-critical");
  assert.equal(calls[0].metadata?.["Subscription"], "sub_123");
});

// ── Distinct occurrences → distinct HHC ids ─────────────────────────────────

test("each of the three failure branches produces its own distinct HHC id", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  const reports = await withEnv("production", async () => [
    await reportCriticalFailure(
      { error: new Error("x"), flow: "operator-plan-update", stage: "subscription-upsert", title: "t", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    ),
    await reportCriticalFailure(
      { error: new Error("x"), flow: "operator-plan-update", stage: "operators-plan-sync", title: "t", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    ),
    await reportCriticalFailure(
      { error: new Error("x"), flow: "stripe-subscription", stage: "operators-plan-sync", title: "t", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    ),
  ]);

  const ids = reports.map(r => r.hhcErrorId);
  assert.equal(new Set(ids).size, 3);
});

// ── Privacy ──────────────────────────────────────────────────────────────────

test("subscriptions.ts observability context never includes email, name, or other PII, even if mistakenly passed", async () => {
  const { client, calls: sentryCalls } = createFakeSentryClient();
  const { sendSlack, calls: slackCalls } = createFakeSlack();

  await withEnv("production", () =>
    reportCriticalFailure(
      {
        error: new Error("simulated"),
        flow: "operator-plan-update",
        stage: "subscription-upsert",
        title: "t",
        technicalSummary: "x",
        context: {
          operatorId: "op_4",
          targetPlan: "pro",
          // Type-valid string values for sensitive key names — the runtime
          // denylist (sanitizeOperationalContext) is what's under test.
          // "name" (bare, anchored) is dropped by the hardened sanitizer;
          // "operatorName" deliberately is NOT (same allowance as the
          // existing venueName/businessName precedent) — not asserted here.
          changedByEmail: "someone@example.com",
          name: "Someone Person",
        },
        slackFields: {
          "Operator ID": "op_4",
          email: "someone@example.com",
        },
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

test("real subscriptions.ts call sites never pass email/name context — confirmed by source read", () => {
  // Static guard: neither instrumented call site in the real source should
  // ever pass changedByEmail/operatorEmail/anything name-like — only
  // operatorId/targetPlan/Stripe IDs, matching the minimal-context rule.
  // Indentation-agnostic split on the call boundary rather than a single
  // regex, since the three call sites sit at different nesting depths
  // (updateOperatorPlan's two calls vs. syncStripeSubscription's one, nested
  // one level deeper inside `if (sync.planCode !== undefined) { ... }`).
  const reportBlocks = SUBSCRIPTIONS_SOURCE.split("await reportCriticalFailure({").slice(1);
  assert.equal(reportBlocks.length, 3, "expected exactly 3 reportCriticalFailure call sites in subscriptions.ts");
  for (const block of reportBlocks) {
    const callSite = block.split("});")[0]; // up to this call's closing brace
    assert.doesNotMatch(callSite, /email/i);
    assert.doesNotMatch(callSite, /changedBy/i);
  }
});

// ── Grouping ─────────────────────────────────────────────────────────────────

test("no subscriptions.ts stage ever sets a Sentry fingerprint from the HHC id", async () => {
  const { client, calls } = createFakeSentryClient();
  const { sendSlack } = createFakeSlack();

  for (const [flow, stage] of [
    ["operator-plan-update", "subscription-upsert"],
    ["operator-plan-update", "operators-plan-sync"],
    ["stripe-subscription", "operators-plan-sync"],
  ] as const) {
    await withEnv("production", () =>
      reportCriticalFailure(
        { error: new Error("simulated"), flow, stage, title: "t", technicalSummary: "x" },
        { sentryClient: client, sendSlack }
      )
    );
  }

  for (const call of calls) {
    assert.equal((call.captureContext as { fingerprint?: unknown } | undefined)?.fingerprint, undefined);
  }
});

// ── Environment gating ───────────────────────────────────────────────────────

test("preview environment does not page production #ops-critical for any of the three branches", async () => {
  const { client } = createFakeSentryClient();
  const { sendSlack, calls } = createFakeSlack();

  const report = await withEnv("preview", () =>
    reportCriticalFailure(
      { error: new Error("simulated"), flow: "operator-plan-update", stage: "operators-plan-sync", title: "t", technicalSummary: "x" },
      { sentryClient: client, sendSlack }
    )
  );

  assert.equal(calls.length, 0);
  assert.equal(report.slackSent, false);
});

// ── No new direct Slack call introduced in subscriptions.ts ────────────────

test("subscriptions.ts does not import or call sendSlackAlert directly — Slack stays owned by reportCriticalFailure", () => {
  assert.doesNotMatch(SUBSCRIPTIONS_SOURCE, /sendSlackAlert/);
  assert.doesNotMatch(SUBSCRIPTIONS_SOURCE, /from ["']@\/lib\/slack["']/);
});

// ── Structural regression guard: return-value/control-flow behavior unchanged ─
//
// No DI seam exists for createAdminClient() in this file (see file header),
// so "existing return behavior is unchanged" is verified here via a static
// read of the source rather than executing the real functions.

test("updateOperatorPlan() still returns { ok: false, error: subError.message } on write-1 failure", () => {
  assert.match(SUBSCRIPTIONS_SOURCE, /return \{ ok: false, error: subError\.message \};/);
});

test("updateOperatorPlan() still returns { ok: true } unconditionally after a write-2 (operators.plan) failure", () => {
  const fnMatch = SUBSCRIPTIONS_SOURCE.match(
    /export async function updateOperatorPlan[\s\S]*?\n\}/
  );
  assert.ok(fnMatch, "could not locate updateOperatorPlan() in source");
  const fnBody = fnMatch![0];
  // The opError branch must never contain its own return statement (i.e. it
  // must fall through to the function's final `return { ok: true };`).
  // Comments are stripped first so explanatory prose (e.g. "...its own
  // returned { ok: false }...") can't false-match this check.
  const opErrorBlock = fnBody.match(/if \(opError\) \{[\s\S]*?\n {2}\}/);
  assert.ok(opErrorBlock, "could not locate the opError branch");
  assert.doesNotMatch(stripLineComments(opErrorBlock![0]), /\breturn\b/);
  assert.match(fnBody, /\n {2}return \{ ok: true \};\n\}/);
});

test("syncStripeSubscription() still returns { ok: true } unconditionally after a write-2 (operators.plan) failure", () => {
  const fnMatch = SUBSCRIPTIONS_SOURCE.match(
    /export async function syncStripeSubscription[\s\S]*?\n\}/
  );
  assert.ok(fnMatch, "could not locate syncStripeSubscription() in source");
  const fnBody = fnMatch![0];
  const opErrorBlock = fnBody.match(/if \(opError\) \{[\s\S]*?\n {4}\}/);
  assert.ok(opErrorBlock, "could not locate the opError branch");
  assert.doesNotMatch(stripLineComments(opErrorBlock![0]), /\breturn\b/);
  assert.match(fnBody, /\n {2}return \{ ok: true \};\n\}/);
});

test("syncStripeSubscription()'s primary-write (subError) failure still returns { ok: false, error } unchanged — this is the branch the Stripe webhook route already instruments, not duplicated here", () => {
  const fnMatch = SUBSCRIPTIONS_SOURCE.match(
    /export async function syncStripeSubscription[\s\S]*?\n\}/
  );
  assert.ok(fnMatch);
  const fnBody = fnMatch![0];
  const subErrorBlock = fnBody.match(/if \(subError\) \{[\s\S]*?\n {2}\}/);
  assert.ok(subErrorBlock, "could not locate the subError branch");
  // No reportCriticalFailure call in this branch — it's already owned by the
  // Stripe webhook route (keyed off this function's returned { ok: false }).
  assert.doesNotMatch(subErrorBlock![0], /reportCriticalFailure/);
  assert.match(subErrorBlock![0], /return \{ ok: false, error: subError\.message \};/);
});

test("exactly two Supabase writes remain in updateOperatorPlan() and syncStripeSubscription() — no write added, removed, or reordered", () => {
  const updateFn = SUBSCRIPTIONS_SOURCE.match(/export async function updateOperatorPlan[\s\S]*?\n\}/)![0];
  const syncFn = SUBSCRIPTIONS_SOURCE.match(/export async function syncStripeSubscription[\s\S]*?\n\}/)![0];

  assert.equal((updateFn.match(/\.from\("operator_subscriptions"\)/g) ?? []).length, 1);
  assert.equal((updateFn.match(/\.from\("operators"\)/g) ?? []).length, 1);
  assert.equal((syncFn.match(/\.from\("operator_subscriptions"\)/g) ?? []).length, 1);
  assert.equal((syncFn.match(/\.from\("operators"\)/g) ?? []).length, 1);

  // No transaction/RPC wrapping was introduced.
  assert.doesNotMatch(updateFn, /\.rpc\(/);
  assert.doesNotMatch(syncFn, /\.rpc\(/);
});
