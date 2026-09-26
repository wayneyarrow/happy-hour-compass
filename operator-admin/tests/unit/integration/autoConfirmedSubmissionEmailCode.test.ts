// Must be first: routes external boundaries (Supabase, Next request, Resend,
// Slack, Turnstile, Google) to in-process fakes before any app module loads.
import "./support/installBoundaryFakes";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { world, resetWorld } from "./support/world";
import { lookupBusinessAction, saveOperatorSubmissionAction } from "../../../src/app/(consumer)/suggest/owner/actions";
import OperatorVerifyPage from "../../../src/app/operator/verify/page";
import { requestVerificationCodeAction, verifyCodeAction } from "../../../src/app/operator/verify/actions";
import { completeAccountSetupAction } from "../../../src/app/operator/create-password/actions";
import { hasOperatorAccess } from "../../../src/lib/operatorAccess";
import { readVerificationLinkToken } from "../../../src/lib/activation/emailCodeVerificationTokens";
import type { GoogleMatch } from "../../../src/lib/google/placesMatch";

/**
 * GOLDEN PATH — AUTO-CONFIRMED ADD YOUR VENUE + EMAIL-CODE VERIFICATION
 * ("stay in the flow" acceptance criteria).
 *
 * Drives the operator's journey through the REAL application code, in the
 * order a browser would, with only external services faked (world.ts):
 *
 *   lookupBusinessAction ─► saveOperatorSubmissionAction ─► (browser follows
 *   the returned verificationPath) ─► /operator/verify page (server render)
 *   ─► verifyCodeAction ─► /operator/create-password ─► completeAccountSetupAction
 *   ─► Operator Admin access
 *
 * NOT exercised here (see the report): the browser's supabase.auth.updateUser
 * password write inside the create-password page, the Next router itself,
 * middleware, and the Operator Admin UI. Those are covered by source
 * assertions below and by the live staging test of the shared tail.
 *
 * Fixtures are obviously fictional (".example" domains, a made-up place id);
 * nothing here can reach a real business, inbox, Slack, or database.
 */

const SECRET = "fixture-hmac-secret-that-is-at-least-32-characters";
const SITE = "https://staging.fixture.example";
const EMAIL = "operator@fixture.example";

const GOOGLE_FIXTURE: GoogleMatch = {
  placeId: "fixture-place-id-not-real-0001",
  name: "Fixture Test Taproom",
  formattedAddress: "123 Test Street, Kelowna, BC V1Y 0A0, Canada",
  streetAddress: "123 Test Street",
  city: "Kelowna",
  province: "British Columbia",
  provinceShort: "BC",
  postalCode: "V1Y 0A0",
  country: "Canada",
  lat: 49.88,
  lng: -119.49,
  phone: null,
  website: null,
  rating: null,
  reviewCount: null,
  photoReference: null,
};

const FORM = {
  businessName: "Fixture Test Taproom",
  streetAddress: "123 Test Street",
  city: "Kelowna",
  province: "BC",
  firstName: "Fixture",
  lastName: "Operator",
  position: "Owner",
  email: EMAIL,
};

function formData(values = FORM) {
  const fd = new FormData();
  fd.set("business_name", values.businessName);
  fd.set("street_address", values.streetAddress);
  fd.set("city", values.city);
  fd.set("province", values.province);
  fd.set("first_name", values.firstName);
  fd.set("last_name", values.lastName);
  fd.set("position", values.position);
  fd.set("email", values.email);
  return fd;
}

function setFlag(on: boolean, secret: string | null = SECRET) {
  if (on) process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED = "true";
  else delete process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED;
  if (secret) process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET = secret;
  else delete process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET;
}

beforeEach(() => {
  resetWorld({ googleCandidate: { ...GOOGLE_FIXTURE } });
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.RESEND_API_KEY = "re_fixture_not_a_real_key";
  setFlag(true);
});

/** Steps 1–2 exactly as the browser performs them (OwnerSubmissionFlow / AddVenueModalContent). */
async function submitThroughAddYourVenue(values = FORM) {
  const lookup = await lookupBusinessAction(formData(values));
  const save = await saveOperatorSubmissionAction({
    formValues: values,
    match: lookup.match,
    matchConfirmed: true,
    turnstileToken: "fixture-turnstile-token",
  });
  return { lookup, save };
}

async function renderVerifyPage(path: string) {
  const t = new URLSearchParams(path.split("?")[1] ?? "").get("t") ?? undefined;
  const element = await OperatorVerifyPage({ searchParams: Promise.resolve({ t }) });
  return renderToStaticMarkup(element);
}

const codeFromEmail = (subject: string) => subject.match(/^(\d{6}) is your Happy Hour Compass verification code$/)?.[1] ?? null;
const SUPABASE_FACING = /supabase\.co|\/auth\/v1\/|token_hash=|type=recovery/;

// ── Golden path ──────────────────────────────────────────────────────────────

test("GOLDEN PATH: auto-confirmed submission keeps the operator in one HHC browser journey from submit to Operator Admin", async () => {
  // ── 1. Lookup (controlled Google fixture) passes the REAL confidence gate.
  const { lookup, save } = await submitThroughAddYourVenue();
  assert.equal(lookup.match?.placeId, GOOGLE_FIXTURE.placeId);

  // ── 2. Auto-approval: confirmed_auto, no founder-review state.
  assert.equal(save.success, true);
  assert.equal(save.routedStatus, "confirmed_auto");
  const [submission] = world.tables.operator_submissions;
  assert.equal(world.tables.operator_submissions.length, 1);
  assert.equal(submission.status, "confirmed_auto", "never enters pending_review/no_match");
  assert.equal(submission.reviewed_at ?? null, null, "no founder review happened or was needed");

  // ── Venue / operator / auth relationships, exactly once.
  assert.equal(world.tables.venues.length, 1);
  const [venue] = world.tables.venues;
  assert.equal(venue.place_id, GOOGLE_FIXTURE.placeId);
  assert.equal(venue.source, "operator_submission");
  assert.equal(venue.source_submission_id, submission.id);
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operators.length, 1);
  const [operator] = world.tables.operators;
  assert.equal(operator.id, world.authUsers[0].id, "operator row IS the auth user");
  assert.equal(operator.email, EMAIL);
  assert.equal(venue.claimed_by, operator.id);
  assert.equal(venue.created_by_operator_id, operator.id);
  assert.equal(submission.operator_id, operator.id);
  assert.equal(submission.venue_id, venue.id);

  // ── Exactly one verification-required lifecycle, origin = this submission.
  assert.equal(world.tables.operator_activation_lifecycles.length, 1);
  const [lifecycle] = world.tables.operator_activation_lifecycles;
  assert.equal(lifecycle.verification_required, true);
  assert.equal(lifecycle.origin_type, "submission");
  assert.equal(lifecycle.origin_submission_id, submission.id);
  assert.equal(lifecycle.operator_id, operator.id);

  // ── Initial code issued AUTOMATICALLY (no "Send code" click) and emailed.
  assert.equal(world.tables.operator_verification_codes.length, 1, "one code, issued during the submission itself");
  assert.equal(world.rpcCalls.filter((c) => c.name === "issue_operator_verification_code").length, 1);
  const operatorEmails = world.emails.filter((e) => e.to === EMAIL);
  assert.equal(operatorEmails.length, 1, "the operator gets exactly one email: the code");
  const code = codeFromEmail(operatorEmails[0].subject);
  assert.match(code ?? "", /^\d{6}$/);

  // ── No legacy Supabase setup email; no founder-approved continue-setup email.
  assert.equal(world.generateLinkCalls.length, 0, "no Supabase recovery link was even generated during the submission");
  assert.ok(!operatorEmails.some((e) => /set up your account|finish setting up your account/i.test(e.subject)));

  // ── A. The browser receives a direct HHC continuation (relative, same site).
  assert.ok(save.verificationPath, "the action hands the browser its next step");
  const path = save.verificationPath!;
  assert.match(path, /^\/operator\/verify\?t=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/, "relative HHC route, signed token only");
  assert.equal(readVerificationLinkToken(new URLSearchParams(path.split("?")[1]).get("t"), SECRET), lifecycle.id);

  // ── Both real clients follow that path immediately (no email step in between).
  for (const client of ["src/app/(consumer)/suggest/owner/OwnerSubmissionFlow.tsx", "src/app/(website)/acquisition/AddVenueModalContent.tsx"]) {
    const src = readFileSync(join(__dirname, "../../..", client), "utf8");
    assert.match(src, /if \(result\.verificationPath\) \{\s*window\.location\.assign\(result\.verificationPath\);/, `${client} navigates straight to it`);
  }

  // ── B/D/E. The verify page (real server render) shows the code is ALREADY waiting.
  const html = await renderVerifyPage(path);
  assert.match(html, /Verify your email/);
  assert.match(html, /We sent a 6-digit code to/);
  assert.match(html, /o\*+@fixture\.example/, "masked email, never the raw address");
  assert.ok(!html.includes(EMAIL));
  assert.match(html, /id="verification-code"/, "next action is typing the code");
  assert.match(html, /autoComplete="one-time-code"|autocomplete="one-time-code"/i);
  assert.ok(!/>Send code</.test(html), "no 'Send code' step before the first attempt");
  assert.equal(world.tables.operator_verification_codes.length, 1, "rendering the page issued nothing");

  // ── One mistyped code, then the right one — all on the HHC page.
  const wrong = await verifyCodeAction(new URLSearchParams(path.split("?")[1]).get("t")!, code === "000000" ? "111111" : "000000");
  assert.deepEqual(wrong, { status: "invalid_code" });
  const verified = await verifyCodeAction(new URLSearchParams(path.split("?")[1]).get("t")!, code!);

  // ── F. Verified → straight to the EXISTING HHC Set Password step, with a session.
  assert.deepEqual(verified, { status: "verified", next: "/operator/create-password" });
  assert.equal(world.sessionUserId, operator.id, "the same browser now holds this operator's session");
  assert.ok(world.cookies.has("hhc_operator_verified"), "verified-browser proof set for this browser");
  const lcAfterVerify = world.tables.operator_activation_lifecycles[0];
  assert.ok(lcAfterVerify.verification_completed_at, "verification recorded");
  assert.equal(world.tables.operator_verification_codes[0].consumed_at !== null, true);
  assert.equal(world.tables.operator_verification_codes[0].attempt_count, 1, "exactly the one wrong attempt");
  assert.equal(world.generateLinkCalls.length, 1, "one server-side link, exchanged in-process for the session");
  assert.equal(world.pendingRecoveryTokens.size, 0, "that link was consumed server-side, never handed out");
  assert.equal(operator.account_activated_at, null, "verification is NOT activation");

  // ── The create-password page uses the cookie session (no token in the URL) and ends at /admin/home.
  const createPassword = readFileSync(join(__dirname, "../../..", "src/app/operator/create-password/page.tsx"), "utf8");
  assert.match(createPassword, /--- Path C: pre-existing cookie session ---[\s\S]*supabase\.auth\.getSession\(\)/);
  assert.match(createPassword, /await completeAccountSetupAction\(session\.access_token\);[\s\S]*router\.push\("\/admin\/home"\);/);

  // ── G. Password set (browser-side updateUser — not executed here) → the REAL completion action.
  world.accessTokens.set("fixture-access-token", operator.id as string);
  const completion = await completeAccountSetupAction("fixture-access-token");
  assert.deepEqual(completion, { ok: true });
  const activated = world.tables.operators[0];
  assert.ok(activated.account_activated_at, "activation recorded by the existing activation system");
  assert.ok(
    new Date(lcAfterVerify.verification_completed_at as string).getTime() <= new Date(activated.account_activated_at as string).getTime(),
    "verified before activated"
  );
  assert.equal(
    world.tables.operator_submission_notes.filter((n) => n.event_type === "account_activated").length,
    1,
    "activated exactly once"
  );

  // ── Operator Admin access is by ownership + operators row (the normal model).
  assert.equal(await hasOperatorAccess(EMAIL), true);
  assert.equal(world.tables.venues.filter((v) => v.created_by_operator_id === operator.id).length, 1);

  // ── H. Nothing the operator saw or received points at Supabase.
  const seen = [JSON.stringify(save), path, html, JSON.stringify(wrong), JSON.stringify(verified), ...operatorEmails.flatMap((e) => [e.subject, e.html, e.text])];
  for (const s of seen) assert.ok(!SUPABASE_FACING.test(s), `Supabase-facing URL leaked: ${s.slice(0, 120)}`);

  // ── Still exactly one of everything after the whole journey.
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operators.length, 1);
  assert.equal(world.tables.operator_activation_lifecycles.length, 1);
  assert.equal(world.createUserCalls.length, 1);
});

test("stay-in-the-flow guard: the journey never depends on an email LINK — the only operator email carries a code and at most a fallback link", async () => {
  const { save } = await submitThroughAddYourVenue();
  const operatorEmails = world.emails.filter((e) => e.to === EMAIL);
  assert.equal(operatorEmails.length, 1);
  assert.ok(codeFromEmail(operatorEmails[0].subject), "the email's job is to carry the code");
  // The browser already has the destination; following any email link is optional.
  assert.ok(save.verificationPath);
  const html = await renderVerifyPage(save.verificationPath!);
  assert.match(html, /We sent a 6-digit code to/);
});

test("in-flow first click on the page is a genuine RESEND (the initial code was already sent)", async () => {
  const { save } = await submitThroughAddYourVenue();
  const t = new URLSearchParams(save.verificationPath!.split("?")[1]).get("t")!;
  const tooSoon = await requestVerificationCodeAction(t);
  assert.equal(tooSoon.status, "resend_cooldown", "cooldown applies to the automatic first send");
  assert.equal(world.emails.filter((e) => e.to === EMAIL).length, 1);
});

// ── Failure / fallback behaviour ─────────────────────────────────────────────

test("fallback: no confident Google match → founder review, no provisioning, no code, no redirect", async () => {
  resetWorld({ googleCandidate: null });
  const { lookup, save } = await submitThroughAddYourVenue();
  assert.equal(lookup.match, null);
  const res = await saveOperatorSubmissionAction({ formValues: FORM, match: null, matchConfirmed: false, turnstileToken: "t" });
  for (const r of [save, res]) {
    assert.equal(r.routedStatus, "no_match");
    assert.equal(r.verificationPath, undefined);
  }
  assert.equal(world.tables.operators.length + world.tables.operator_activation_lifecycles.length + world.tables.operator_verification_codes.length, 0);
  assert.equal(world.createUserCalls.length, 0);
});

test("fallback: a venue already exists for this Google place → pending founder review, not auto-approval", async () => {
  world.tables.venues.push({ id: "existing-venue", place_id: GOOGLE_FIXTURE.placeId, claimed_by: null, created_by_operator_id: null });
  const { save } = await submitThroughAddYourVenue();
  assert.equal(save.routedStatus, "pending_review");
  assert.equal(save.verificationPath, undefined);
  assert.equal(world.createUserCalls.length + world.tables.operator_activation_lifecycles.length, 0);
});

test("fallback: flag OFF → the unchanged legacy flow (Supabase setup-link email, legacy lifecycle, no code, no redirect)", async () => {
  setFlag(false);
  const { save } = await submitThroughAddYourVenue();
  assert.equal(save.routedStatus, "confirmed_auto");
  assert.equal(save.verificationPath, undefined);
  assert.deepEqual(Object.keys(save).sort(), ["routedStatus", "success"], "identical legacy response shape");
  const [lifecycle] = world.tables.operator_activation_lifecycles;
  assert.equal(lifecycle.verification_required, false);
  assert.equal(world.tables.operator_verification_codes.length, 0);
  assert.equal(world.rpcCalls.length, 0);
  assert.equal(world.generateLinkCalls.length, 1);
  assert.equal(world.generateLinkCalls[0].type, "recovery");
  const operatorEmails = world.emails.filter((e) => e.to === EMAIL);
  assert.equal(operatorEmails.length, 1);
  assert.match(operatorEmails[0].subject, /set up your account/);
  assert.match(operatorEmails[0].text, /fakeproject\.supabase\.co\/auth\/v1\/verify/, "legacy still uses the Supabase link, as before");
});

test("fallback: flag ON but HMAC secret missing → legacy flow (never a half-configured email-code flow)", async () => {
  setFlag(true, null);
  const { save } = await submitThroughAddYourVenue();
  assert.equal(save.verificationPath, undefined);
  assert.equal(world.tables.operator_activation_lifecycles[0].verification_required, false);
  assert.equal(world.tables.operator_verification_codes.length, 0);
});

test("failure: initial code issuance fails → operator still lands on the verify page, which offers 'Send code' (no false 'code sent' claim)", async () => {
  world.failRpc.add("issue_operator_verification_code");
  const { save } = await submitThroughAddYourVenue();
  assert.ok(save.verificationPath);
  assert.equal(world.tables.operator_verification_codes.length, 0);
  assert.equal(world.emails.filter((e) => e.to === EMAIL).length, 0);
  world.failRpc.clear();
  const html = await renderVerifyPage(save.verificationPath!);
  assert.ok(!/We sent a 6-digit code/.test(html));
  assert.match(html, />Send code</);
});

test("failure: code issued but its EMAIL fails → the verify page does not claim it was sent; it offers a new code", async () => {
  world.emailSendFails = true;
  const { save } = await submitThroughAddYourVenue();
  assert.equal(world.tables.operator_verification_codes.length, 1, "the code was issued");
  assert.equal(world.emails.filter((e) => e.to === EMAIL).length, 0, "but nothing was delivered");
  assert.ok(save.verificationPath, "the operator still lands on the HHC verify page");
  const html = await renderVerifyPage(save.verificationPath!);
  assert.ok(!/We sent a 6-digit code/.test(html), "no false 'code sent' claim");
  assert.ok(!/id="verification-code"/.test(html), "no code-entry form for an undelivered code");
  assert.match(html, /We couldn’t send the code/);
  assert.match(html, /Send a new code/);
  const failure = world.tables.operator_submission_notes.filter((n) => n.event_type === "setup_delivery_failed");
  assert.equal(failure.length, 1, "failure recorded once, on this submission's Internal Notes");
});

test("failure: provisioning fails → an error response, no success, no lifecycle, no code, no redirect", async () => {
  world.createUserFailsWith = "Database error creating new user";
  const { save } = await submitThroughAddYourVenue();
  assert.ok(save.error);
  assert.equal(save.success, undefined);
  assert.equal(save.verificationPath, undefined);
  assert.equal(world.tables.operator_submissions.length, 0, "no orphan submission row");
  assert.equal(world.tables.operator_activation_lifecycles.length + world.tables.operator_verification_codes.length, 0);
});

test("duplicate: a retried submission for the same operator (second venue) reuses the one operator and the one live lifecycle", async () => {
  await submitThroughAddYourVenue();
  world.googleCandidate = { ...GOOGLE_FIXTURE, placeId: "fixture-place-id-not-real-0002", name: "Fixture Test Taproom Two", streetAddress: "124 Test Street" };
  const second = await submitThroughAddYourVenue({ ...FORM, businessName: "Fixture Test Taproom Two", streetAddress: "124 Test Street" });
  assert.equal(second.save.routedStatus, "confirmed_auto");
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operators.length, 1);
  assert.equal(world.tables.operator_activation_lifecycles.length, 1, "the live lifecycle is reused, never duplicated");
  assert.equal(world.tables.operator_activation_lifecycles[0].verification_required, true);
  assert.ok(second.save.verificationPath, "operator continues on the same code screen");
  assert.equal(world.tables.operator_verification_codes.length, 1, "within the cooldown no second code is issued");
});

test("duplicate: concurrent identical submissions never produce two operators, auth users, or live lifecycles", async () => {
  await Promise.all([submitThroughAddYourVenue(), submitThroughAddYourVenue()]);
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operators.length, 1);
  assert.ok(world.tables.operator_activation_lifecycles.length <= 1);
  assert.ok(world.tables.operator_verification_codes.filter((c) => !c.superseded_at && !c.consumed_at).length <= 1);
});

test("returning operator (already activated) keeps the existing 'venue added' path — no lifecycle, no code, no redirect", async () => {
  world.authUsers.push({ id: "op-returning", email: EMAIL });
  world.tables.operators.push({ id: "op-returning", email: EMAIL, account_activated_at: "2026-09-01T00:00:00.000Z" });
  const { save } = await submitThroughAddYourVenue();
  assert.equal(save.routedStatus, "confirmed_auto");
  assert.equal(save.verificationPath, undefined);
  assert.equal(world.tables.operator_activation_lifecycles.length, 0);
  assert.equal(world.tables.operator_verification_codes.length, 0);
  const mail = world.emails.filter((e) => e.to === EMAIL);
  assert.equal(mail.length, 1);
  assert.ok(mail[0].html.includes(`${SITE}/login`), "plain sign-in link, as before");
});

test("grandfathered: an operator with a live LEGACY lifecycle is not converted to email-code", async () => {
  world.authUsers.push({ id: "op-legacy", email: EMAIL });
  world.tables.operators.push({ id: "op-legacy", email: EMAIL, account_activated_at: null });
  world.tables.operator_activation_lifecycles.push({
    id: "lc-legacy",
    operator_id: "op-legacy",
    origin_type: "claim",
    origin_claim_id: "c-legacy",
    origin_submission_id: null,
    started_at: "2026-09-20T00:00:00.000Z",
    deadline_at: "2099-01-01T00:00:00.000Z",
    reminder_stage: 1,
    expired_at: null,
    released_at: null,
    verification_required: false,
    verification_completed_at: null,
  });
  const { save } = await submitThroughAddYourVenue();
  assert.equal(save.verificationPath, undefined);
  assert.equal(world.tables.operator_activation_lifecycles.length, 1);
  assert.equal(world.tables.operator_activation_lifecycles[0].verification_required, false, "never converted");
  assert.equal(world.tables.operator_activation_lifecycles[0].reminder_stage, 1, "untouched");
  assert.equal(world.tables.operator_verification_codes.length, 0);
});
