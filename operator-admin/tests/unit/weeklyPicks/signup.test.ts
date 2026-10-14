import { test } from "node:test";
import assert from "node:assert/strict";
import { processWeeklyPicksSignup, type WeeklyPicksSignupDeps } from "../../../src/lib/weeklyPicks/signup";
import type { RequestWeeklyPicksDoubleOptInParams } from "../../../src/lib/brevo/client";
import { BrevoApiError } from "../../../src/lib/brevo/errors";
import { BrevoConfigError } from "../../../src/lib/brevo/config";
import { BrevoStagingGuardBlockedError } from "../../../src/lib/brevo/stagingGuard";
import { TURNSTILE_FAILURE_MESSAGE } from "../../../src/lib/turnstile";
import {
  WEEKLY_PICKS_GENERIC_ERROR_MESSAGE,
  WEEKLY_PICKS_STAGING_BLOCKED_MESSAGE,
  WEEKLY_PICKS_PLACEMENTS,
  WEEKLY_PICKS_CONSENT_REQUIRED_MESSAGE,
} from "../../../src/lib/weeklyPicks/weeklyPicks";

function makeDeps(
  opts: { turnstileOk?: boolean; brevo?: () => Promise<void>; slack?: () => Promise<"delivered" | "no-webhook" | "failed"> } = {}
) {
  const calls = {
    turnstile: [] as Array<[string | null, string | null]>,
    brevo: [] as RequestWeeklyPicksDoubleOptInParams[],
    reports: [] as Array<{ stage: string; severity: string; context: Record<string, unknown> }>,
    slack: [] as string[],
  };
  const deps: WeeklyPicksSignupDeps = {
    verifyTurnstile: async (token, ip) => {
      calls.turnstile.push([token, ip]);
      return opts.turnstileOk === false ? { success: false, reason: "failed" } : { success: true };
    },
    requestDoubleOptIn: async (params) => {
      calls.brevo.push(params);
      if (opts.brevo) await opts.brevo();
    },
    reportError: ({ stage, severity, context }) => {
      calls.reports.push({ stage, severity, context });
    },
    siteUrl: () => "https://staging.happyhourcompass.com",
    notifySlack: async (text) => {
      calls.slack.push(text);
      return opts.slack ? opts.slack() : "delivered";
    },
    environment: () => "staging",
  };
  return { deps, calls };
}

const VALID = {
  email: "  Wayne+WP@Example.com ",
  consent: "yes",
  placement: "homepage_main",
  turnstileToken: "tok",
  remoteIp: "203.0.113.5",
};

test("invalid or missing email → field error, no Turnstile or Brevo call", async () => {
  for (const email of ["", "   ", "not-an-email", "a@b", "a b@c.com", null, `${"x".repeat(250)}@e.com`]) {
    const { deps, calls } = makeDeps();
    const result = await processWeeklyPicksSignup({ ...VALID, email }, deps);
    assert.equal(result.status, "error");
    assert.ok(result.status === "error" && result.fieldErrors?.email, String(email));
    assert.equal(calls.turnstile.length, 0);
    assert.equal(calls.brevo.length, 0);
  }
});

test("unchecked (or forged) permission checkbox → consent field error, no calls", async () => {
  for (const consent of [null, "", "on", "true", "no"]) {
    const { deps, calls } = makeDeps();
    const result = await processWeeklyPicksSignup({ ...VALID, consent }, deps);
    assert.deepEqual(result, { status: "error", fieldErrors: { consent: WEEKLY_PICKS_CONSENT_REQUIRED_MESSAGE } });
    assert.equal(calls.turnstile.length + calls.brevo.length, 0);
  }
});

test("unknown placement → generic error, no calls", async () => {
  const { deps, calls } = makeDeps();
  const result = await processWeeklyPicksSignup({ ...VALID, placement: "anything-else" }, deps);
  assert.deepEqual(result, { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE });
  assert.equal(calls.turnstile.length + calls.brevo.length, 0);
});

test("Turnstile failure (or missing token) → turnstileFailed, no Brevo call", async () => {
  for (const turnstileToken of ["tok", "", null]) {
    const { deps, calls } = makeDeps({ turnstileOk: false });
    const result = await processWeeklyPicksSignup({ ...VALID, turnstileToken }, deps);
    assert.deepEqual(result, { status: "error", message: TURNSTILE_FAILURE_MESSAGE, turnstileFailed: true });
    assert.equal(calls.brevo.length, 0);
    assert.equal(calls.turnstile[0][0], turnstileToken || null);
  }
});

test("every placement: accepted, one Brevo request with normalized email, no attributes, placement never sent", async () => {
  for (const placement of WEEKLY_PICKS_PLACEMENTS) {
    const { deps, calls } = makeDeps();
    const result = await processWeeklyPicksSignup({ ...VALID, placement }, deps);
    assert.deepEqual(result, { status: "accepted" });
    assert.equal(calls.brevo.length, 1);
    assert.deepEqual(calls.brevo[0], {
      email: "wayne+wp@example.com",
      redirectionUrl: "https://staging.happyhourcompass.com/weekly-picks/confirmed",
    });
    assert.deepEqual(calls.turnstile[0], ["tok", "203.0.113.5"]);
  }
});

test("redirect URL never carries personal information", async () => {
  const { deps, calls } = makeDeps();
  await processWeeklyPicksSignup(VALID, deps);
  const url = new URL(calls.brevo[0].redirectionUrl);
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.ok(!calls.brevo[0].redirectionUrl.toLowerCase().includes("wayne"));
});

test("staging allowlist refusal → staging message, not reported as an incident", async () => {
  const { deps, calls } = makeDeps({ brevo: async () => { throw new BrevoStagingGuardBlockedError("x@example.com"); } });
  const result = await processWeeklyPicksSignup(VALID, deps);
  assert.deepEqual(result, { status: "error", message: WEEKLY_PICKS_STAGING_BLOCKED_MESSAGE });
  assert.equal(calls.reports.length, 0);
});

test("missing configuration → generic error + critical report", async () => {
  const { deps, calls } = makeDeps({ brevo: async () => { throw new BrevoConfigError("BREVO_WEEKLY_PICKS_LIST_ID is not set."); } });
  const result = await processWeeklyPicksSignup(VALID, deps);
  assert.deepEqual(result, { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE });
  assert.deepEqual(calls.reports.map((r) => [r.stage, r.severity]), [["config", "critical"]]);
});

test("Brevo 400 (including duplicate_request) and auth errors → generic error + report — never accepted", async () => {
  for (const [errorClass, status, code] of [
    ["invalid_request", 400, "duplicate_request"],
    ["invalid_request", 400, "Attribute not found"],
    ["auth", 401, "unauthorized"],
    ["unknown", null, null],
  ] as const) {
    const { deps, calls } = makeDeps({
      brevo: async () => { throw new BrevoApiError("failed for w***@example.com", errorClass, status, code); },
    });
    const result = await processWeeklyPicksSignup(VALID, deps);
    assert.deepEqual(result, { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE });
    assert.equal(calls.reports.length, 1);
    assert.equal(calls.reports[0].severity, "critical");
    assert.equal(calls.reports[0].context.brevoCode, code);
    assert.ok(!JSON.stringify(calls.reports[0].context).includes("@"), "report context carries no email");
  }
});

test("transient Brevo failure → generic retry message, no incident report", async () => {
  const { deps, calls } = makeDeps({ brevo: async () => { throw new BrevoApiError("timeout", "transient", 503); } });
  const result = await processWeeklyPicksSignup(VALID, deps);
  assert.deepEqual(result, { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE });
  assert.equal(calls.reports.length, 0);
});

test("unexpected thrown value → generic error + report", async () => {
  const { deps, calls } = makeDeps({ brevo: async () => { throw new Error("boom"); } });
  const result = await processWeeklyPicksSignup(VALID, deps);
  assert.deepEqual(result, { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE });
  assert.equal(calls.reports.length, 1);
});

test("homepage split: 0 → bottom only; 1 → main only; 2+ → main after first, bottom after rest; order kept", async () => {
  const { splitSectionsAroundSignup } = await import("../../../src/lib/weeklyPicks/weeklyPicks");
  assert.deepEqual(splitSectionsAroundSignup([]), { first: [], rest: [], showMainSignup: false, showBottomSignup: true });
  assert.deepEqual(splitSectionsAroundSignup(["a"]), { first: ["a"], rest: [], showMainSignup: true, showBottomSignup: false });
  assert.deepEqual(splitSectionsAroundSignup(["a", "b", "c"]), { first: ["a"], rest: ["b", "c"], showMainSignup: true, showBottomSignup: true });
});

// ── Slack: "Newsletter signup requested" ─────────────────────────────────────

const EXPECTED_SLACK_TEXT = [
  "*Newsletter signup requested*",
  "Email: wayne+wp@example.com",
  "Placement: homepage_main",
  "Environment: staging",
  "Confirmation is handled by Brevo; this alert does not mean a new subscriber was confirmed.",
].join("\n");

test("Slack: accepted request posts exactly one alert with email, placement and environment", async () => {
  const { deps, calls } = makeDeps();
  const result = await processWeeklyPicksSignup(VALID, deps);
  assert.deepEqual(result, { status: "accepted" });
  assert.deepEqual(calls.slack, [EXPECTED_SLACK_TEXT]);
});

test("Slack: nothing is sent for validation, consent, placement or Turnstile failures", async () => {
  const cases = [
    { input: { ...VALID, email: "nope" } },
    { input: { ...VALID, consent: null } },
    { input: { ...VALID, placement: "x" } },
    { input: VALID, turnstileOk: false },
  ];
  for (const c of cases) {
    const { deps, calls } = makeDeps({ turnstileOk: c.turnstileOk });
    const result = await processWeeklyPicksSignup(c.input, deps);
    assert.equal(result.status, "error");
    assert.equal(calls.slack.length, 0);
  }
});

test("Slack: nothing is sent when staging blocks the address or Brevo fails", async () => {
  const failures: Array<() => never> = [
    () => { throw new BrevoStagingGuardBlockedError("x@example.com"); },
    () => { throw new BrevoConfigError("missing"); },
    () => { throw new BrevoApiError("dup", "invalid_request", 400, "duplicate_request"); },
    () => { throw new BrevoApiError("down", "transient", 502); },
    () => { throw new Error("boom"); },
  ];
  for (const fail of failures) {
    const { deps, calls } = makeDeps({ brevo: async () => fail() });
    const result = await processWeeklyPicksSignup(VALID, deps);
    assert.equal(result.status, "error");
    assert.equal(calls.slack.length, 0);
  }
});

test("Slack: a failed, missing or throwing webhook never fails the signup", async () => {
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    for (const slack of [
      async () => "failed" as const,
      async () => "no-webhook" as const,
      async () => { throw new Error("slack exploded"); },
    ]) {
      const { deps, calls } = makeDeps({ slack });
      const result = await processWeeklyPicksSignup(VALID, deps);
      assert.deepEqual(result, { status: "accepted" });
      assert.equal(calls.slack.length, 1);
    }
  } finally {
    console.error = originalError;
  }
  // "failed" and the exception are logged; "no-webhook" (channel not configured) is not.
  assert.equal(logged.length, 2);
  assert.ok(String(logged[0][0]).includes("Slack notification not delivered"));
  assert.ok(String(logged[1][0]).includes("Slack notification threw"));
});

test("Slack: the default dependency posts to #consumer-signup", async () => {
  const { defaultWeeklyPicksSignupDeps } = await import("../../../src/lib/weeklyPicks/signup");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(__dirname, "../../../src/lib/weeklyPicks/signup.ts"), "utf8");
  assert.match(src, /sendSlackAcquisitionNotification\(\{ channel: "consumer-signup", text \}\)/);
  assert.equal(typeof defaultWeeklyPicksSignupDeps.notifySlack, "function");
});
