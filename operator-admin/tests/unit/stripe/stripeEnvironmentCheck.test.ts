import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkStripeEnvironment,
  classifyStripeKey,
  isStagingDiagnosticAllowed,
  StripeGetError,
  REQUIRED_WEBHOOK_EVENTS,
} from "@/lib/stripeEnvironmentCheck";

/**
 * TEMPORARY staging Stripe diagnostic — removed with the page before
 * production promotion. Proves: no Stripe request unless the key is test
 * mode; correct pass/fail per check (incl. wildcard webhook events); and that
 * no credential, price ID, endpoint ID or Stripe error text can reach the
 * output.
 */

// Fake keys are assembled at runtime so no Stripe-key-shaped literal exists
// in the repository (GitHub push protection scans for them).
const fakeKey = (mode: "test" | "live") => ["sk", mode, `FAKEKEYBODY${"0".repeat(20)}`].join("_");
const TEST_KEY = fakeKey("test");
const LIVE_KEY = fakeKey("live");
const PRO = "price_PRO_SECRETISH_123";
const PREMIUM = "price_PREMIUM_SECRETISH_456";
const WHSEC = ["whsec", "FAKESECRET"].join("_");
const URL_ = "https://staging.happyhourcompass.com/api/webhooks/stripe";

const goodPrice = { id: "x", livemode: false, active: true, recurring: { interval: "month" } };
const endpoint = (over: Record<string, unknown> = {}) => ({
  id: "we_ENDPOINT_ID_789", url: URL_, status: "enabled", enabled_events: [...REQUIRED_WEBHOOK_EVENTS], ...over,
});

function fakeGet(routes: Record<string, unknown | Error>) {
  const calls: string[] = [];
  const get = async (path: string) => {
    calls.push(path);
    const hit = routes[path.startsWith("/v1/prices/") ? path : "/v1/webhook_endpoints"];
    if (hit instanceof Error) throw hit;
    return hit;
  };
  return { get, calls };
}

const base = (get: (p: string) => Promise<unknown>, key = TEST_KEY) => ({
  secretKey: key, proPriceId: PRO, premiumPriceId: PREMIUM, webhookSecret: WHSEC, expectedWebhookUrl: URL_, get,
});

const OK_ROUTES = {
  [`/v1/prices/${PRO}`]: goodPrice,
  [`/v1/prices/${PREMIUM}`]: goodPrice,
  "/v1/webhook_endpoints": { data: [endpoint()] },
};

test("key mode classification", () => {
  assert.equal(classifyStripeKey(TEST_KEY), "test");
  assert.equal(classifyStripeKey("rk_test_x"), "test");
  assert.equal(classifyStripeKey(LIVE_KEY), "live");
  assert.equal(classifyStripeKey("whsec_x"), "unknown");
  assert.equal(classifyStripeKey(""), "unknown");
  assert.equal(classifyStripeKey(undefined), "unknown");
});

for (const [label, key] of [["live", LIVE_KEY], ["unknown/missing", ""]] as const) {
  test(`${label} key → NO Stripe requests at all, nothing passes`, async () => {
    const { get, calls } = fakeGet(OK_ROUTES);
    const r = await checkStripeEnvironment(base(get, key));
    assert.equal(calls.length, 0);
    assert.equal(r.readyForCheckoutQa, false);
    assert.equal(r.proPrice.status, "not_checked");
    assert.equal(r.webhook.status, "not_checked");
  });
}

test("test key, test-mode prices, enabled endpoint with the five events → ready", async () => {
  const { get, calls } = fakeGet(OK_ROUTES);
  const r = await checkStripeEnvironment(base(get));
  assert.equal(r.mode, "test");
  assert.deepEqual([r.proPrice.status, r.premiumPrice.status, r.webhook.status], ["pass", "pass", "pass"]);
  assert.equal(r.readyForCheckoutQa, true);
  assert.deepEqual(calls.sort(), [`/v1/prices/${PREMIUM}`, `/v1/prices/${PRO}`, "/v1/webhook_endpoints?limit=100"].sort());
});

test("wildcard webhook subscription (*) passes", async () => {
  const { get } = fakeGet({ ...OK_ROUTES, "/v1/webhook_endpoints": { data: [endpoint({ enabled_events: ["*"] })] } });
  const r = await checkStripeEnvironment(base(get));
  assert.equal(r.webhook.status, "pass");
});

test("webhook missing events / disabled / wrong URL fail with event NAMES only", async () => {
  let { get } = fakeGet({ ...OK_ROUTES, "/v1/webhook_endpoints": { data: [endpoint({ enabled_events: ["checkout.session.completed"] })] } });
  let r = await checkStripeEnvironment(base(get));
  assert.equal(r.webhook.detail, "missing_events");
  assert.deepEqual(r.webhook.missingEvents, REQUIRED_WEBHOOK_EVENTS.slice(1));
  assert.equal(r.readyForCheckoutQa, false);

  ({ get } = fakeGet({ ...OK_ROUTES, "/v1/webhook_endpoints": { data: [endpoint({ status: "disabled" })] } }));
  r = await checkStripeEnvironment(base(get));
  assert.equal(r.webhook.detail, "disabled");

  ({ get } = fakeGet({ ...OK_ROUTES, "/v1/webhook_endpoints": { data: [endpoint({ url: "https://happy-hour-compass.vercel.app/api/webhooks/stripe" })] } }));
  r = await checkStripeEnvironment(base(get));
  assert.equal(r.webhook.detail, "not_found");
});

test("prices: live-mode/missing (404) fail; live object, inactive, one-time fail; missing config fails", async () => {
  let { get } = fakeGet({ ...OK_ROUTES, [`/v1/prices/${PRO}`]: new StripeGetError(404) });
  let r = await checkStripeEnvironment(base(get));
  assert.equal(r.proPrice.detail, "not_found_in_test_mode");
  assert.equal(r.readyForCheckoutQa, false);

  ({ get } = fakeGet({ ...OK_ROUTES, [`/v1/prices/${PRO}`]: { ...goodPrice, livemode: true } }));
  assert.equal((await checkStripeEnvironment(base(get))).proPrice.detail, "not_test_mode");
  ({ get } = fakeGet({ ...OK_ROUTES, [`/v1/prices/${PRO}`]: { ...goodPrice, active: false } }));
  assert.equal((await checkStripeEnvironment(base(get))).proPrice.detail, "inactive");
  ({ get } = fakeGet({ ...OK_ROUTES, [`/v1/prices/${PRO}`]: { ...goodPrice, recurring: null } }));
  assert.equal((await checkStripeEnvironment(base(get))).proPrice.detail, "not_recurring");

  ({ get } = fakeGet(OK_ROUTES));
  r = await checkStripeEnvironment({ ...base(get), premiumPriceId: undefined });
  assert.equal(r.premiumPrice.detail, "not_configured");
  assert.equal(r.readyForCheckoutQa, false);
});

test("auth / rate-limit / network errors are inconclusive (unknown), never 'not found'", async () => {
  for (const status of [0, 401, 429, 500]) {
    const { get } = fakeGet({ [`/v1/prices/${PRO}`]: new StripeGetError(status), [`/v1/prices/${PREMIUM}`]: goodPrice, "/v1/webhook_endpoints": new StripeGetError(status) });
    const r = await checkStripeEnvironment(base(get));
    assert.equal(r.proPrice.status, "unknown", `price status ${status}`);
    assert.equal(r.webhook.status, "unknown", `webhook status ${status}`);
    assert.equal(r.readyForCheckoutQa, false);
  }
});

test("missing webhook secret blocks readiness even if everything else passes", async () => {
  const { get } = fakeGet(OK_ROUTES);
  const r = await checkStripeEnvironment({ ...base(get), webhookSecret: "" });
  assert.equal(r.webhookSecretConfigured, false);
  assert.equal(r.readyForCheckoutQa, false);
});

test("NO LEAKS: report never contains the key, price IDs, endpoint IDs, webhook secret or Stripe error text", async () => {
  const leakyError = Object.assign(new Error(`Invalid API Key provided: ${TEST_KEY}`), { raw: { message: TEST_KEY } });
  const scenarios = [
    fakeGet(OK_ROUTES),
    fakeGet({ ...OK_ROUTES, "/v1/webhook_endpoints": { data: [endpoint({ enabled_events: ["*"] })] } }),
    fakeGet({ [`/v1/prices/${PRO}`]: leakyError, [`/v1/prices/${PREMIUM}`]: new StripeGetError(404), "/v1/webhook_endpoints": leakyError }),
  ];
  for (const { get } of scenarios) {
    const json = JSON.stringify(await checkStripeEnvironment(base(get)));
    for (const secret of [TEST_KEY, "FAKEKEYBODY", PRO, PREMIUM, WHSEC, "we_ENDPOINT_ID_789", "Invalid API Key"]) {
      assert.ok(!json.includes(secret), `report leaked ${secret}`);
    }
  }
});

test("staging gate: only the staging site URL in a non-production Vercel environment", () => {
  assert.equal(isStagingDiagnosticAllowed("https://staging.happyhourcompass.com", "preview"), true);
  assert.equal(isStagingDiagnosticAllowed("https://staging.happyhourcompass.com", "production"), false);
  assert.equal(isStagingDiagnosticAllowed("https://staging.happyhourcompass.com", undefined), false);
  assert.equal(isStagingDiagnosticAllowed("https://happyhourcompass.com", "preview"), false);
  assert.equal(isStagingDiagnosticAllowed("https://happy-hour-compass.vercel.app", "production"), false);
  assert.equal(isStagingDiagnosticAllowed("http://localhost:3000", "development"), false);
});

test("page: dynamic + uncached, gated before any env/Stripe access, GET-only, no logging, error bodies unread", () => {
  const src = readFileSync(join(__dirname, "../../../src/app/control-panel/integrations/stripe-check/page.tsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /export const dynamic = "force-dynamic";/);
  assert.match(code, /export const revalidate = 0;/);
  assert.match(code, /export const fetchCache = "force-no-store";/);
  assert.match(code, /noStore\(\);/);
  assert.match(code, /cache: "no-store"/);
  assert.match(code, /method: "GET"/);
  assert.doesNotMatch(code, /method: "(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(code, /from "stripe"|getStripeClient|console\./);
  // Gate order: staging gate → admin re-check → only then read secrets / call Stripe.
  const gate = code.indexOf("isStagingDiagnosticAllowed(");
  const admin = code.indexOf("isControlPanelAdmin(");
  const secret = code.indexOf("process.env.STRIPE_SECRET_KEY");
  assert.ok(gate > 0 && gate < admin && admin < secret, "gates must precede secret access");
  // Error responses are rejected by status before any body read.
  assert.match(code, /if \(!res\.ok\) throw new StripeGetError\(res\.status\);\s*return res\.json\(\);/);
  // Not linked from Control Panel navigation.
  const nav = readFileSync(join(__dirname, "../../../src/app/control-panel/ControlPanelSideNav.tsx"), "utf8");
  assert.doesNotMatch(nav, /stripe-check/);
});
