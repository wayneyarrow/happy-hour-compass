// Must be first: routes external boundaries to in-process fakes.
import "./support/installBoundaryFakes";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { world, resetWorld } from "./support/world";
import OperatorVerifyPage from "../../../src/app/operator/verify/page";
import { requestVerificationCodeAction, verifyCodeAction } from "../../../src/app/operator/verify/actions";
import { deliverDeferredActivationStart } from "../../../src/lib/activation/emailCodeActivationStart";
import { signVerificationLinkToken } from "../../../src/lib/activation/emailCodeVerificationTokens";
import { codeDeliveryFailedEventKey } from "../../../src/lib/activation/emailCodeVerificationService";

/**
 * VERIFICATION CODE DELIVERY STATE.
 *
 * A code row proves a code was issued, not that its email arrived. These
 * tests drive the REAL verify page and server actions (in-process world,
 * support/world.ts — no real DB, email, or Slack) through every delivery
 * outcome and assert the page only ever says "we sent a code" when the
 * server has no record of that code's delivery failing.
 *
 * Time: migration 100's cooldown/caps compare against code issued_at, so
 * "waiting" is modelled by ageing the lifecycle's code rows (ageCodes).
 */

const SECRET = "fixture-hmac-secret-that-is-at-least-32-characters";
const EMAIL = "operator@fixture.example";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000op01";
const LIFECYCLE_ID = "00000000-0000-4000-8000-0000000011fe";
const SUBMISSION_ID = "00000000-0000-4000-8000-0000000005b1";
const CLAIM_ID = "00000000-0000-4000-8000-00000000c1a1";
const PROVIDER_ERROR = "fake provider rejected the message";

function seed(origin: "submission" | "claim") {
  resetWorld();
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.fixture.example";
  process.env.RESEND_API_KEY = "re_fixture_not_a_real_key";
  process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED = "true";
  process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET = SECRET;
  world.authUsers.push({ id: OPERATOR_ID, email: EMAIL });
  world.tables.operators.push({ id: OPERATOR_ID, email: EMAIL, first_name: "Fixture", account_activated_at: null });
  if (origin === "claim") world.tables.venue_claims.push({ id: CLAIM_ID, status: "approved", email: EMAIL });
  else world.tables.operator_submissions.push({ id: SUBMISSION_ID, status: "confirmed_auto", email: EMAIL });
  world.tables.operator_activation_lifecycles.push({
    id: LIFECYCLE_ID,
    operator_id: OPERATOR_ID,
    origin_type: origin,
    origin_claim_id: origin === "claim" ? CLAIM_ID : null,
    origin_submission_id: origin === "submission" ? SUBMISSION_ID : null,
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
    reminder_stage: 0,
    expired_at: null,
    released_at: null,
    verification_required: true,
    verification_completed_at: null,
  });
}

beforeEach(() => seed("submission"));

const token = () => signVerificationLinkToken(LIFECYCLE_ID, SECRET)!;
const notesTable = () => (world.tables.venue_claims.length ? world.tables.venue_claim_notes : world.tables.operator_submission_notes);
const failureNotes = () => notesTable().filter((n) => n.event_type === "setup_delivery_failed");
const codes = () => world.tables.operator_verification_codes;
const currentCode = () => codes().find((c) => !c.consumed_at && !c.superseded_at)!;
const lastCodeFromEmail = () => world.emails.filter((e) => e.to === EMAIL).at(-1)?.subject.match(/^(\d{6})/)?.[1] ?? null;

/** Pretend `ms` has passed for this lifecycle's codes (cooldown / hourly / daily windows). */
function ageCodes(ms: number) {
  for (const c of codes()) {
    c.issued_at = new Date(new Date(c.issued_at as string).getTime() - ms).toISOString();
    c.expires_at = new Date(new Date(c.expires_at as string).getTime() - ms).toISOString();
  }
}

async function page() {
  return renderToStaticMarkup(await OperatorVerifyPage({ searchParams: Promise.resolve({ t: token() }) }));
}
const SAYS_SENT = /We sent a 6-digit code to/;
const HAS_CODE_FORM = /id="verification-code"/;
const OFFERS_NEW_CODE = /Send a new code/;
const SAYS_NOT_SENT = /We couldn’t send the code/;

// ── A. Successful initial delivery ───────────────────────────────────────────

test("A. code issued + email delivered → code-entry state, 'We sent you a code.' wording, no failure record", async () => {
  const result = await requestVerificationCodeAction(token());
  assert.equal(result.status, "code_sent");
  assert.equal(result.isResend, false, "first code → 'We sent you a code.'");
  const html = await page();
  assert.match(html, SAYS_SENT);
  assert.match(html, HAS_CODE_FORM);
  assert.equal(failureNotes().length, 0);
});

// ── B. Failed initial delivery ───────────────────────────────────────────────

test("B. code issued + email FAILS → no 'sent' claim; the page offers a new code; failure recorded against that code", async () => {
  world.emailSendFails = true;
  const result = await requestVerificationCodeAction(token());
  assert.equal(result.status, "send_failed");
  assert.equal(codes().length, 1, "the code was issued (and counts toward limits)");

  const html = await page();
  assert.doesNotMatch(html, SAYS_SENT);
  assert.doesNotMatch(html, HAS_CODE_FORM);
  assert.match(html, SAYS_NOT_SENT);
  assert.match(html, OFFERS_NEW_CODE);

  const [note] = failureNotes();
  assert.equal(failureNotes().length, 1);
  assert.equal(note.event_key, codeDeliveryFailedEventKey(currentCode().id as string), "tied to exactly this code");
  assert.equal(note.submission_id, SUBMISSION_ID);
  assert.equal(note.created_by_email, "Happy Hour Compass");
  assert.deepEqual(note.metadata_json, { flow: "submission" });
});

// ── C. Recovery ──────────────────────────────────────────────────────────────

test("C. failed first delivery → wait out the cooldown → Send code → delivered → code entry → the new code verifies", async () => {
  world.emailSendFails = true;
  await requestVerificationCodeAction(token());
  const failedCodeId = currentCode().id;

  world.emailSendFails = false;
  ageCodes(61_000);
  const retry = await requestVerificationCodeAction(token());
  assert.equal(retry.status, "code_sent");
  assert.equal(retry.isResend, false, "the operator never received the first code, so this is still 'We sent you a code.'");
  assert.ok(codes().find((c) => c.id === failedCodeId)!.superseded_at, "the undelivered code was invalidated by the existing supersede rule");

  const html = await page();
  assert.match(html, SAYS_SENT);
  assert.match(html, HAS_CODE_FORM);

  const verified = await verifyCodeAction(token(), lastCodeFromEmail()!);
  assert.deepEqual(verified, { status: "verified", next: "/operator/create-password" });
});

// ── D. Failed resend ─────────────────────────────────────────────────────────

test("D. delivered code → resend whose email FAILS → page does not claim the replacement was delivered; recovery still works", async () => {
  await requestVerificationCodeAction(token());
  assert.match(await page(), SAYS_SENT);

  world.emailSendFails = true;
  ageCodes(61_000);
  const resend = await requestVerificationCodeAction(token());
  assert.equal(resend.status, "send_failed");
  const html = await page();
  assert.doesNotMatch(html, SAYS_SENT, "the old code was superseded and the replacement never arrived");
  assert.doesNotMatch(html, HAS_CODE_FORM);
  assert.match(html, OFFERS_NEW_CODE);

  world.emailSendFails = false;
  ageCodes(61_000);
  const again = await requestVerificationCodeAction(token());
  assert.equal(again.status, "code_sent");
  assert.equal(again.isResend, true, "an earlier code WAS delivered, so this is 'We sent you a new code.'");
  assert.match(await page(), SAYS_SENT);
  assert.equal((await verifyCodeAction(token(), lastCodeFromEmail()!)).status, "verified");
});

// ── E. An old failure never poisons a new success ────────────────────────────

test("E. code A fails, code B succeeds → B is shown as delivered; A's failure stays as history", async () => {
  world.emailSendFails = true;
  await requestVerificationCodeAction(token());
  const codeA = currentCode().id as string;
  world.emailSendFails = false;
  ageCodes(61_000);
  await requestVerificationCodeAction(token());
  const codeB = currentCode().id as string;
  assert.notEqual(codeA, codeB);
  assert.match(await page(), SAYS_SENT);
  assert.deepEqual(failureNotes().map((n) => n.event_key), [codeDeliveryFailedEventKey(codeA)], "history kept, only for A");
});

// ── F. Refresh is server-authoritative ───────────────────────────────────────

test("F. refresh after a failure stays 'send a new code'; refresh after success stays code-entry", async () => {
  world.emailSendFails = true;
  await requestVerificationCodeAction(token());
  for (let i = 0; i < 3; i++) {
    const html = await page();
    assert.doesNotMatch(html, SAYS_SENT);
    assert.match(html, OFFERS_NEW_CODE);
  }
  world.emailSendFails = false;
  ageCodes(61_000);
  await requestVerificationCodeAction(token());
  for (let i = 0; i < 3; i++) assert.match(await page(), SAYS_SENT);
  assert.equal(codes().length, 2, "reloading issued nothing");
});

// ── G. Nothing sensitive leaks ───────────────────────────────────────────────

test("G. the failure state exposes no code, digest, lifecycle/operator id, provider error, or API key", async () => {
  world.emailSendFails = true;
  const result = await requestVerificationCodeAction(token());
  const html = await page();
  const code = codes()[0];
  const secrets = [code.code_digest as string, LIFECYCLE_ID, OPERATOR_ID, PROVIDER_ERROR, "re_fixture_not_a_real_key", SECRET, EMAIL];
  const browserFacing = JSON.stringify(result) + html.replace(/[?&]t=[^"&\s]+/g, "");
  for (const s of secrets) assert.ok(!browserFacing.includes(s), `browser saw ${s.slice(0, 20)}…`);
  const persisted = JSON.stringify(failureNotes());
  for (const s of [code.code_digest as string, PROVIDER_ERROR, "re_fixture_not_a_real_key", SECRET]) {
    assert.ok(!persisted.includes(s), `note persisted ${s.slice(0, 20)}…`);
  }
  assert.deepEqual(Object.keys(result).sort(), ["resendAvailableAt", "status"], "only status + when a retry is allowed");
});

// ── H. Limits are not bypassed by failures ───────────────────────────────────

test("H1. a failed delivery keeps the 60s cooldown (no instant re-send loop), and the page shows exactly when a new code is allowed", async () => {
  world.emailSendFails = true;
  const failed = await requestVerificationCodeAction(token());
  assert.ok(failed.resendAvailableAt, "the UI is told when it can retry");
  world.emailSendFails = false;
  const tooSoon = await requestVerificationCodeAction(token());
  assert.equal(tooSoon.status, "resend_cooldown", "migration 100's cooldown still applies");
  assert.equal(codes().length, 1);
  assert.equal(world.emails.length, 0);
  assert.match(await page(), /Send a new code in \d:\d\d/, "the button counts down instead of silently refusing");
});

test("H2. failed deliveries still count toward the rolling 24h cap (10 codes) — failures can't be used to farm issuances", async () => {
  world.emailSendFails = true;
  for (let i = 1; i <= 10; i++) {
    const r = await requestVerificationCodeAction(token());
    assert.equal(r.status, "send_failed", `attempt ${i}`);
    ageCodes(i % 5 === 0 ? 3_601_000 : 61_000); // step past the hourly window every 5
  }
  const eleventh = await requestVerificationCodeAction(token());
  assert.equal(eleventh.status, "rate_limited");
  assert.equal(codes().length, 10);
  assert.equal(failureNotes().length, 10, "one failure record per code, no duplicates");
  assert.match(await page(), /For your security, please wait before trying again/);
});

// ── I. Origin-agnostic: claim-origin lifecycles ──────────────────────────────

test("I1. a claim-origin lifecycle gets the same failure + recovery behaviour, recorded on the claim's Internal Notes", async () => {
  seed("claim");
  world.emailSendFails = true;
  await requestVerificationCodeAction(token());
  assert.doesNotMatch(await page(), SAYS_SENT);
  assert.equal(world.tables.venue_claim_notes.filter((n) => n.event_type === "setup_delivery_failed").length, 1);
  assert.equal(world.tables.venue_claim_notes[0].claim_id, CLAIM_ID);
  assert.equal(world.tables.operator_submission_notes.length, 0);

  world.emailSendFails = false;
  ageCodes(61_000);
  assert.equal((await requestVerificationCodeAction(token())).status, "code_sent");
  assert.match(await page(), SAYS_SENT);
  assert.equal((await verifyCodeAction(token(), lastCodeFromEmail()!)).status, "verified");
});

test("I2. the future auto-approved claim entry point (deliverDeferredActivationStart in_flow, origin claim) inherits it with no claim-specific code", async () => {
  seed("claim");
  world.emailSendFails = true;
  const lc = world.tables.operator_activation_lifecycles[0];
  const result = await deliverDeferredActivationStart({
    lifecycleResult: {
      decision: "started",
      lifecycle: {
        id: LIFECYCLE_ID,
        operatorId: OPERATOR_ID,
        originType: "claim",
        originClaimId: CLAIM_ID,
        originSubmissionId: null,
        startedAt: lc.started_at as string,
        deadlineAt: lc.deadline_at as string,
        reminderStage: 0,
        expiredAt: null,
        releasedAt: null,
        verificationRequired: true,
      },
    },
    delivery: "in_flow",
    origin: "claim",
    recipient: { email: EMAIL, firstName: "Fixture" },
    logTag: "[test]",
    sendLegacySetupEmail: async () => {
      throw new Error("legacy email must not be used");
    },
  });
  assert.equal(result.kind, "code_issued");
  const html = renderToStaticMarkup(
    await OperatorVerifyPage({ searchParams: Promise.resolve({ t: new URLSearchParams((result as { verificationPath: string }).verificationPath.split("?")[1]).get("t")! }) })
  );
  assert.doesNotMatch(html, SAYS_SENT);
  assert.match(html, OFFERS_NEW_CODE);
});

// ── Client: a failed send from the button switches to the same server state ──

test("client: a 'send_failed' result replaces any stale code form with the 'send a new code' state (matches reload)", () => {
  const src = readFileSync(join(__dirname, "../../..", "src/app/operator/verify/VerifyEmailCodeScreen.tsx"), "utf8");
  assert.match(
    src,
    /result\.status === "send_failed"\) \{[\s\S]*?applyPending\(result, \{ hasCurrentCode: false, notice: "delivery_failed", expiresAt: null \}\);/
  );
  assert.match(src, /pending\.notice === "delivery_failed" \? "send_failed"/, "the notice uses the existing failure copy");
});
