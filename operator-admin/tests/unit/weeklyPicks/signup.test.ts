import { test } from "node:test";
import assert from "node:assert/strict";
import { processWeeklyPicksSignup, type WeeklyPicksSignupDeps } from "../../../src/lib/weeklyPicks/signup";
import type { RequestWeeklyPicksDoubleOptInParams } from "../../../src/lib/brevo/client";
import { BrevoApiError } from "../../../src/lib/brevo/errors";
import { BrevoConfigError } from "../../../src/lib/brevo/config";
import { BrevoStagingGuardBlockedError } from "../../../src/lib/brevo/stagingGuard";
import { TURNSTILE_FAILURE_MESSAGE } from "../../../src/lib/turnstile";
import {
  WEEKLY_PICKS_CONSENT_VERSION,
  WEEKLY_PICKS_GENERIC_ERROR_MESSAGE,
  WEEKLY_PICKS_STAGING_BLOCKED_MESSAGE,
  WEEKLY_PICKS_PLACEMENTS,
  WEEKLY_PICKS_CONSENT_REQUIRED_MESSAGE,
} from "../../../src/lib/weeklyPicks/weeklyPicks";

const NOW = new Date("2026-10-14T18:00:00.000Z");

function makeDeps(opts: { turnstileOk?: boolean; brevo?: () => Promise<void> } = {}) {
  const calls = {
    turnstile: [] as Array<[string | null, string | null]>,
    brevo: [] as RequestWeeklyPicksDoubleOptInParams[],
    reports: [] as Array<{ stage: string; severity: string; context: Record<string, unknown> }>,
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
    now: () => NOW,
    siteUrl: () => "https://staging.happyhourcompass.com",
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

test("every placement: accepted, one Brevo request with normalized email and only the approved attributes", async () => {
  for (const placement of WEEKLY_PICKS_PLACEMENTS) {
    const { deps, calls } = makeDeps();
    const result = await processWeeklyPicksSignup({ ...VALID, placement }, deps);
    assert.deepEqual(result, { status: "accepted" });
    assert.equal(calls.brevo.length, 1);
    assert.deepEqual(calls.brevo[0], {
      email: "wayne+wp@example.com",
      attributes: {
        WEEKLY_PICKS_SOURCE: placement,
        WEEKLY_PICKS_CONSENT_AT: NOW.toISOString(),
        WEEKLY_PICKS_CONSENT_VERSION,
      },
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
