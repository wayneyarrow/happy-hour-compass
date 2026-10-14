import { test } from "node:test";
import assert from "node:assert/strict";
import { requestWeeklyPicksDoubleOptIn } from "../../../src/lib/brevo/client";
import { BrevoApiError } from "../../../src/lib/brevo/errors";
import { BrevoConfigError } from "../../../src/lib/brevo/config";
import { BrevoStagingGuardBlockedError } from "../../../src/lib/brevo/stagingGuard";
import { withBrevoEnv } from "./support/testEnv";

type FetchCall = { url: string; init: RequestInit };

function installFakeFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const PARAMS = {
  email: "wayne@example.com",
  redirectionUrl: "https://staging.happyhourcompass.com/weekly-picks/confirmed",
};

const STAGING_ENV = {
  BREVO_API_KEY: "fake-key",
  BREVO_WEEKLY_PICKS_LIST_ID: "2",
  BREVO_WEEKLY_PICKS_DOI_TEMPLATE_ID: "34",
  BREVO_TEST_EMAIL: "Wayne@Example.com",
  VERCEL_ENV: "preview",
};

async function withSetup(
  env: Parameters<typeof withBrevoEnv>[0],
  handler: (call: FetchCall) => Response | Promise<Response>,
  body: (calls: FetchCall[]) => Promise<void>
) {
  const restoreEnv = withBrevoEnv(env);
  const fake = installFakeFetch(handler);
  try {
    await body(fake.calls);
  } finally {
    fake.restore();
    restoreEnv();
  }
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

test("missing Weekly Picks configuration throws BrevoConfigError and never calls fetch", async () => {
  for (const missing of ["BREVO_API_KEY", "BREVO_WEEKLY_PICKS_LIST_ID", "BREVO_WEEKLY_PICKS_DOI_TEMPLATE_ID"] as const) {
    await withSetup({ ...STAGING_ENV, [missing]: undefined }, () => json(201, {}), async (calls) => {
      await assert.rejects(() => requestWeeklyPicksDoubleOptIn(PARAMS), BrevoConfigError);
      assert.equal(calls.length, 0, missing);
    });
  }
  await withSetup({ ...STAGING_ENV, BREVO_WEEKLY_PICKS_LIST_ID: "abc" }, () => json(201, {}), async (calls) => {
    await assert.rejects(() => requestWeeklyPicksDoubleOptIn(PARAMS), BrevoConfigError);
    assert.equal(calls.length, 0);
  });
});

test("outside Production with BREVO_TEST_EMAIL unset, fails CLOSED — no request for any address", async () => {
  for (const vercelEnv of ["preview", "development", undefined]) {
    await withSetup({ ...STAGING_ENV, BREVO_TEST_EMAIL: undefined, VERCEL_ENV: vercelEnv }, () => json(201, {}), async (calls) => {
      await assert.rejects(() => requestWeeklyPicksDoubleOptIn(PARAMS), BrevoStagingGuardBlockedError);
      assert.equal(calls.length, 0);
    });
  }
});

test("outside Production, a non-allowlisted address is blocked before any request", async () => {
  await withSetup(STAGING_ENV, () => json(201, {}), async (calls) => {
    await assert.rejects(
      () => requestWeeklyPicksDoubleOptIn({ ...PARAMS, email: "real-subscriber@example.com" }),
      BrevoStagingGuardBlockedError
    );
    assert.equal(calls.length, 0);
  });
});

test("allowlisted address: one DOI request with exactly the expected shape", async () => {
  await withSetup(STAGING_ENV, () => json(201, {}), async (calls) => {
    await requestWeeklyPicksDoubleOptIn(PARAMS);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, "https://api.brevo.com/v3/contacts/doubleOptinConfirmation");
    assert.equal(call.init.method, "POST");
    assert.equal((call.init.headers as Record<string, string>)["api-key"], "fake-key");
    const body = JSON.parse(String(call.init.body));
    assert.deepEqual(body, {
      email: "wayne@example.com",
      includeListIds: [2],
      templateId: 34,
      redirectionUrl: PARAMS.redirectionUrl,
    });
    // No attributes at all: an existing contact's names/identifiers are never touched; nor is the blocklist.
    assert.ok(!("attributes" in body) && !("emailBlacklisted" in body) && !("updateEnabled" in body) && !("listIds" in body));
  });
});

test("Production allows any address (no allowlist)", async () => {
  await withSetup({ ...STAGING_ENV, BREVO_TEST_EMAIL: undefined, VERCEL_ENV: "production" }, () => json(201, {}), async (calls) => {
    await requestWeeklyPicksDoubleOptIn({ ...PARAMS, email: "someone@example.com" });
    assert.equal(calls.length, 1);
  });
});

test("2xx responses resolve (201 documented; 204 tolerated)", async () => {
  for (const status of [201, 204]) {
    await withSetup(STAGING_ENV, () => new Response(status === 204 ? null : "{}", { status }), async () => {
      await requestWeeklyPicksDoubleOptIn(PARAMS);
    });
  }
});

test("documented 400 codes are NOT treated as success — duplicate_request included", async () => {
  for (const code of ["duplicate_request", "invalid_parameter", "Attribute not found", "Request already processed"]) {
    await withSetup(STAGING_ENV, () => json(400, { code, message: `msg for ${code}` }), async () => {
      await assert.rejects(
        () => requestWeeklyPicksDoubleOptIn(PARAMS),
        (err: unknown) =>
          err instanceof BrevoApiError &&
          err.errorClass === "invalid_request" &&
          err.status === 400 &&
          err.brevoCode === code
      );
    });
  }
});

test("401 → auth, 429/5xx/network → transient; messages mask the email", async () => {
  const cases: Array<[() => Response, string]> = [
    [() => json(401, { code: "unauthorized", message: "Key not found" }), "auth"],
    [() => json(429, { message: "Too many requests" }), "transient"],
    [() => new Response("oops", { status: 502 }), "transient"],
    [() => { throw new TypeError("fetch failed"); }, "transient"],
  ];
  for (const [handler, expected] of cases) {
    await withSetup(STAGING_ENV, handler, async () => {
      await assert.rejects(
        () => requestWeeklyPicksDoubleOptIn(PARAMS),
        (err: unknown) =>
          err instanceof BrevoApiError && err.errorClass === expected && !err.message.includes("wayne@example.com")
      );
    });
  }
});
