import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sendSlackAcquisitionNotification } from "../../../src/lib/slack";
import { notifyContentCreated } from "../../../src/lib/customerSuccess/contentCreatedSlack";

/**
 * sendSlackAcquisitionNotification() delivery results — the helper every
 * #customer-success notification goes through. fetch is stubbed; no real
 * webhook is ever called (the URL below is a fake, non-routable value).
 */

const ENV = "SLACK_CUSTOMER_SUCCESS_WEBHOOK_URL";
const FAKE_WEBHOOK = "https://hooks.slack.invalid/services/T000/B000/fake-secret-token";

const realFetch = globalThis.fetch;
const realConsoleError = console.error;
const realEnv = process.env[ENV];

let calls: { url: string; init?: RequestInit }[] = [];
let logged: unknown[][] = [];

function stubFetch(impl: () => Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return impl();
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  logged = [];
  process.env[ENV] = FAKE_WEBHOOK;
  console.error = (...args: unknown[]) => { logged.push(args); };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
  if (realEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = realEnv;
});

const send = () => sendSlackAcquisitionNotification({ channel: "customer-success", text: "hello" });

test("2xx response → delivered, exactly one POST, nothing logged", async () => {
  stubFetch(async () => new Response("ok", { status: 200 }));
  assert.equal(await send(), "delivered");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(logged.length, 0);
});

for (const [status, body] of [[404, "no_service"], [400, "invalid_payload"], [410, "channel_is_archived"], [500, ""]] as const) {
  test(`HTTP ${status} → failed, exactly one POST (no retry), logged without the webhook URL`, async () => {
    stubFetch(async () => new Response(body, { status }));
    assert.equal(await send(), "failed");
    assert.equal(calls.length, 1);
    assert.equal(logged.length, 1);
    const line = JSON.stringify(logged[0]);
    assert.match(line, /\[SLACK\] Acquisition notification failed:/);
    assert.match(line, new RegExp(`"status":${status}`));
    if (body) assert.match(line, new RegExp(body));
    assert.doesNotMatch(line, /hooks\.slack|fake-secret-token/);
  });
}

test("network error → failed, exactly one POST (no retry), logged without the webhook URL", async () => {
  stubFetch(async () => { throw new TypeError("fetch failed"); });
  assert.equal(await send(), "failed");
  assert.equal(calls.length, 1);
  assert.equal(logged.length, 1);
  const line = JSON.stringify(logged[0]);
  assert.match(line, /fetch failed/);
  assert.doesNotMatch(line, /hooks\.slack|fake-secret-token/);
});

test("no webhook configured → no-webhook, no request", async () => {
  delete process.env[ENV];
  stubFetch(async () => new Response("ok", { status: 200 }));
  assert.equal(await send(), "no-webhook");
  assert.equal(calls.length, 0);
});

// ── Creation notification: failure is reported, never thrown ────────────────

const CREATED = {
  kind: "daily_special" as const,
  venueName: "Test Venue",
  venueId: "00000000-0000-4000-8000-000000000000",
  title: "Test Special",
  schedule: "One-time — Tue, Sep 29, 2026",
  isPublished: true,
};

test("notifyContentCreated: HTTP error resolves to failed (does not throw), one POST", async () => {
  stubFetch(async () => new Response("no_service", { status: 404 }));
  assert.equal(await notifyContentCreated(CREATED), "failed");
  assert.equal(calls.length, 1);
});

test("notifyContentCreated: network error resolves to failed (does not throw), one POST", async () => {
  stubFetch(async () => { throw new TypeError("fetch failed"); });
  assert.equal(await notifyContentCreated(CREATED), "failed");
  assert.equal(calls.length, 1);
});

test("create actions ignore the Slack result — the save still returns its savedId", () => {
  const SRC = join(__dirname, "../../../src/app/admin");
  for (const file of ["daily-specials/actions.ts", "events/actions.ts"]) {
    const src = readFileSync(join(SRC, file), "utf8");
    const tail = src.slice(src.indexOf("if (shouldNotifyContentCreated(ctx))"));
    // Awaited as a statement (result unused), followed by the success return.
    assert.match(tail, /^\s*if \(shouldNotifyContentCreated\(ctx\)\) \{[\s\S]*?\n\s+await notifyContentCreated\(\{/);
    assert.doesNotMatch(tail, /=\s*await notifyContentCreated/);
    assert.match(tail, /return \{ savedId: inserted\.id( as string)? \};/);
  }
});
