import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseVerificationArgs,
  runOpenTrackingVerification,
  checkResendDomains,
  TEST_VENUE_NAME,
  type VerificationDeps,
  type ResendDomainInfo,
  type RegistryRowSnapshot,
} from "../../../src/lib/emailTracking/openTrackingVerification";
import type { sendTransactionalEmail } from "../../../src/lib/email";

const SECRET_API_KEY = "re_SECRET_should_never_print_123";
const SECRET_DB_KEY = "sb_secret_SHOULD_NEVER_PRINT_456";
const TEST_VENUE = { id: "11111111-1111-4111-8111-111111111111", name: TEST_VENUE_NAME };
const GOOD_DOMAINS: ResendDomainInfo[] = [
  { name: "happyhourcompass.com", status: "verified", open_tracking: false, click_tracking: false },
  { name: "updates.happyhourcompass.com", status: "verified", open_tracking: true, click_tracking: false },
];

type SendArgs = Parameters<typeof sendTransactionalEmail>[0];

function harness(overrides: Partial<VerificationDeps> & { envExtra?: Record<string, string>; sentFromDomain?: string } = {}) {
  const logs: string[] = [];
  const sends: { args: SendArgs; envDuring: { enabled?: string; domain?: string } }[] = [];
  const env: NodeJS.ProcessEnv = {
    RESEND_API_KEY: SECRET_API_KEY,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: SECRET_DB_KEY,
    TEST_EMAIL_RECIPIENT: "someone-else@example.com",
    ...(overrides.envExtra ?? {}),
  } as unknown as NodeJS.ProcessEnv;
  let lastSendKey = "";
  const row = (): RegistryRowSnapshot => ({
    id: "22222222-2222-4222-8222-222222222222",
    send_ref: "a".repeat(32),
    email_type: "customer_success_milestone",
    environment: "development",
    venue_id: TEST_VENUE.id,
    customer_success_event_id: null,
    status: "sent",
    provider_message_id: "re_msg_1",
    sent_from_domain: overrides.sentFromDomain ?? "updates.happyhourcompass.com",
    first_opened_at: null,
    open_notified_at: null,
  });
  const deps: VerificationDeps = {
    env,
    log: (l) => logs.push(l),
    findVenuesByExactName: async (name) => (name === TEST_VENUE_NAME ? [TEST_VENUE] : []),
    checkRegistryReady: async () => ({ ok: true }),
    listResendDomains: async () => GOOD_DOMAINS,
    findMessageBySendKey: async (key) => (key === lastSendKey ? row() : null),
    findMessageById: async () => row(),
    listEventsForMessage: async () => [{ outcome: "first_open", occurred_at: "2026-09-30T17:00:00.000Z" }],
    sendEmail: async (args) => {
      lastSendKey = args.idempotencyKey ?? "";
      sends.push({ args, envDuring: { enabled: env.EMAIL_OPEN_TRACKING_ENABLED, domain: env.EMAIL_TRACKED_SENDER_DOMAIN } });
      return { ok: true, id: "re_msg_1" };
    },
    randomId: () => "run-1",
    ...overrides,
  };
  return { deps, logs, sends, env };
}

function parse(argv: string[]) {
  const r = parseVerificationArgs(argv);
  if (!r.ok) throw new Error(r.error);
  return r.args;
}

// ── Arguments ────────────────────────────────────────────────────────────────

test("the recipient must be passed explicitly — never defaulted, never from TEST_EMAIL_RECIPIENT", () => {
  assert.equal(parseVerificationArgs([]).ok, false);
  assert.equal(parseVerificationArgs(["--send"]).ok, false);
  assert.deepEqual(parse(["--to", "me@example.com"]), { mode: "dry_run", to: "me@example.com", trackedDomain: "updates.happyhourcompass.com" });
});

test("exactly one recipient; unknown or malformed arguments are refused", () => {
  for (const argv of [
    ["--to", "a@x.com", "--to", "b@x.com"],
    ["--to", "a@x.com,b@x.com"],
    ["--to", "not-an-email"],
    ["--to", "a@x.com", "--force"],
    ["--to", "a@x.com", "--tracked-domain", "evil.com"],
    ["--to", "a@x.com", "--tracked-domain", "happyhourcompass.com"],
    ["--status", "abc"],
    ["--status", "22222222-2222-4222-8222-222222222222", "--send"],
  ]) {
    assert.equal(parseVerificationArgs(argv).ok, false, argv.join(" "));
  }
  assert.equal(parse(["--to", "a@x.com", "--send"]).mode, "send");
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test("refuses to run in production (every mode) and sends nothing", async () => {
  for (const argv of [["--to", "me@example.com", "--send"], ["--to", "me@example.com"], ["--status", "22222222-2222-4222-8222-222222222222"]]) {
    const h = harness({ envExtra: { VERCEL_ENV: "production" } });
    assert.equal(await runOpenTrackingVerification(parse(argv), h.deps), 1);
    assert.equal(h.sends.length, 0);
    assert.match(h.logs.join("\n"), /REFUSED/);
  }
});

test("dry run (the default) never sends, even when every check passes", async () => {
  const h = harness();
  assert.equal(await runOpenTrackingVerification(parse(["--to", "me@example.com"]), h.deps), 0);
  assert.equal(h.sends.length, 0);
  assert.match(h.logs.join("\n"), /DRY RUN complete — preflight passed/);
});

test("--send is refused (nothing sent) unless exactly one venue is named HHC Verification Test Venue", async () => {
  for (const venues of [[], [TEST_VENUE, { ...TEST_VENUE, id: "other" }]]) {
    const h = harness({ findVenuesByExactName: async () => venues });
    assert.equal(await runOpenTrackingVerification(parse(["--to", "me@example.com", "--send"]), h.deps), 1);
    assert.equal(h.sends.length, 0);
  }
});

test("--send is refused when migration 102 isn't applied", async () => {
  const h = harness({ checkRegistryReady: async () => ({ error: 'relation "public.email_messages" does not exist' }) });
  assert.equal(await runOpenTrackingVerification(parse(["--to", "me@example.com", "--send"]), h.deps), 1);
  assert.equal(h.sends.length, 0);
});

test("--send is refused unless Resend is configured safely (read-only check)", () => {
  assert.deepEqual(checkResendDomains(GOOD_DOMAINS, "updates.happyhourcompass.com"), []);
  const bad: [string, ResendDomainInfo[]][] = [
    ["root open tracking on", [{ ...GOOD_DOMAINS[0], open_tracking: true }, GOOD_DOMAINS[1]]],
    ["root click tracking on", [{ ...GOOD_DOMAINS[0], click_tracking: true }, GOOD_DOMAINS[1]]],
    ["subdomain missing", [GOOD_DOMAINS[0]]],
    ["subdomain unverified", [GOOD_DOMAINS[0], { ...GOOD_DOMAINS[1], status: "pending" }]],
    ["subdomain open tracking off", [GOOD_DOMAINS[0], { ...GOOD_DOMAINS[1], open_tracking: false }]],
    ["subdomain click tracking on", [GOOD_DOMAINS[0], { ...GOOD_DOMAINS[1], click_tracking: true }]],
  ];
  for (const [label, domains] of bad) assert.ok(checkResendDomains(domains, "updates.happyhourcompass.com").length > 0, label);
});

test("--send with a bad Resend configuration sends nothing", async () => {
  const h = harness({ listResendDomains: async () => [{ ...GOOD_DOMAINS[0], open_tracking: true }, GOOD_DOMAINS[1]] });
  assert.equal(await runOpenTrackingVerification(parse(["--to", "me@example.com", "--send"]), h.deps), 1);
  assert.equal(h.sends.length, 0);
});

// ── The one send ─────────────────────────────────────────────────────────────

test("--send sends EXACTLY one milestone-template email through the normal path, linked only to the test venue", async () => {
  const h = harness();
  assert.equal(await runOpenTrackingVerification(parse(["--to", "me@example.com", "--send"]), h.deps), 0);
  assert.equal(h.sends.length, 1);
  const { args, envDuring } = h.sends[0];
  assert.equal(args.type, "customer_success_milestone");
  assert.equal(args.to, "me@example.com");
  assert.equal(args.from, "Wayne <wayne@happyhourcompass.com>", "the real CS sender — sendTransactionalEmail moves it to the subdomain");
  assert.equal(args.replyTo, "wayne@happyhourcompass.com");
  assert.match(args.subject, /^\[HHC open-tracking test\] .*HHC Verification Test Venue/);
  assert.match(args.idempotencyKey ?? "", /^hhc-email-open-verification:/);
  assert.deepEqual(args.record, { venueId: TEST_VENUE.id, context: { milestone: 50 } });
  assert.ok(!("customerSuccessEventId" in (args.record ?? {})), "never linked to a real customer_success_events row");
  assert.deepEqual(envDuring, { enabled: "true", domain: "updates.happyhourcompass.com" }, "tracking enabled for the send itself");
  assert.equal(h.env.EMAIL_OPEN_TRACKING_ENABLED, undefined, "…and restored for the rest of the process");
  assert.equal(h.env.EMAIL_TRACKED_SENDER_DOMAIN, undefined);
});

test("--send prints the ids needed to verify the webhook and timeline, and never prints secrets", async () => {
  const h = harness();
  await runOpenTrackingVerification(parse(["--to", "me@example.com", "--send"]), h.deps);
  const out = h.logs.join("\n");
  assert.match(out, /email_messages\.id\): 22222222-2222-4222-8222-222222222222/);
  assert.match(out, /send_ref: a{32}/);
  assert.match(out, /provider_message_id: re_msg_1/);
  assert.match(out, /sent_from_domain: updates\.happyhourcompass\.com/);
  assert.match(out, /--status 22222222-2222-4222-8222-222222222222/);
  assert.ok(!out.includes(SECRET_API_KEY) && !out.includes(SECRET_DB_KEY), "no secret values");
  assert.match(out, /RESEND_API_KEY=yes/);
});

test("a send that fell back to the root domain is flagged as unable to report an open", async () => {
  const h = harness({ sentFromDomain: "happyhourcompass.com" });
  assert.equal(await runOpenTrackingVerification(parse(["--to", "me@example.com", "--send"]), h.deps), 1);
  assert.equal(h.sends.length, 1);
  assert.match(h.logs.join("\n"), /will NOT report an open/);
});

test("a provider failure is reported once and never retried by the script", async () => {
  const h = harness({ sendEmail: async () => ({ ok: false, error: "rate limited" }) });
  assert.equal(await runOpenTrackingVerification(parse(["--to", "me@example.com", "--send"]), h.deps), 1);
  assert.match(h.logs.join("\n"), /SEND FAILED: rate limited/);
});

test("every run prints proof that a flag-off production milestone is the legacy request", async () => {
  const h = harness({ envExtra: { EMAIL_TRACKED_SENDER_DOMAIN: "updates.happyhourcompass.com" } });
  await runOpenTrackingVerification(parse(["--to", "me@example.com"]), h.deps);
  assert.match(
    h.logs.join("\n"),
    /EMAIL_OPEN_TRACKING_ENABLED unset is sent as: From Wayne <wayne@happyhourcompass\.com> · Reply-To wayne@happyhourcompass\.com · tags: none/
  );
});

test("--status is read-only and reports the open and matched webhook events", async () => {
  const h = harness();
  assert.equal(await runOpenTrackingVerification(parse(["--status", "22222222-2222-4222-8222-222222222222"]), h.deps), 0);
  assert.equal(h.sends.length, 0);
  assert.match(h.logs.join("\n"), /Webhook events matched: 1 — first_open@2026-09-30T17:00:00\.000Z/);
});

// ── Source guarantees ────────────────────────────────────────────────────────

test("the script and its module never touch customer_success_events, the CS delivery run, the cron, or Resend domain settings", () => {
  const ROOT = join(__dirname, "../../..");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const file of ["src/lib/emailTracking/openTrackingVerification.ts", "scripts/verifyEmailOpenTracking.ts"]) {
    const code = strip(readFileSync(join(ROOT, file), "utf8"));
    assert.ok(!/from\(\s*["'`]customer_success_events/.test(code), `${file}: reads/writes customer_success_events`);
    assert.ok(!/processCustomerSuccessDeliveries\(|detectVenueViewMilestones|api\/cron/.test(code), `${file}: CS pipeline/cron`);
    assert.ok(!/domains\.(update|create|remove|verify)\(/.test(code), `${file}: provider settings`);
    assert.ok(!/verification_code|VerificationCode/.test(code), `${file}: verification codes`);
    assert.ok(!/console\.\w+\([^)]*process\.env\.\w+/.test(code), `${file}: prints an env value`);
  }
  const script = strip(readFileSync(join(ROOT, "scripts/verifyEmailOpenTracking.ts"), "utf8"));
  assert.ok(!/TEST_EMAIL_RECIPIENT/.test(script), "no env-var recipient fallback");
});
