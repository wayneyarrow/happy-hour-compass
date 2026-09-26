// Must be first: routes external boundaries to in-process fakes.
import "./support/installBoundaryFakes";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { world, resetWorld } from "./support/world";
import { submitClaimAction, type ClaimFormState } from "../../../src/app/(consumer)/venue/[id]/claim/actions";
import { reviewClaimAction } from "../../../src/app/control-panel/claims/[id]/actions";
import OperatorVerifyPage from "../../../src/app/operator/verify/page";
import { requestVerificationCodeAction, verifyCodeAction } from "../../../src/app/operator/verify/actions";
import { completeAccountSetupAction } from "../../../src/app/operator/create-password/actions";
import { hasOperatorAccess } from "../../../src/lib/operatorAccess";
import { getRelatedClaimNotesForVenue } from "../../../src/lib/data/venueNotes";
import { runClaimAutoApproval } from "../../../src/lib/claims/claimAutoApprovalFlow";
import { safeClaimContinuation } from "../../../src/lib/claims/claimContinuation";
import { readVerificationLinkToken } from "../../../src/lib/activation/emailCodeVerificationTokens";

/**
 * CLAIM AUTO-APPROVAL — end to end through the REAL public claim action,
 * the real decision engine, provisioning, lifecycle, in-flow code delivery,
 * verify page, verification, activation, notes and notifications. Only
 * external services are faked (support/world.ts). Fixtures are fictional
 * (".example"/".test" data, made-up coordinates for a fixture venue).
 */

const SECRET = "fixture-hmac-secret-that-is-at-least-32-characters";
const SLUG = "kelowna-fixture-taproom";
const VENUE_ID = "00000000-0000-4000-8000-0000000fe001";
const FOUNDER = "hello@happyhourcompass.com";
const SUPABASE_FACING = /supabase\.co|\/auth\/v1\/|token_hash=|type=recovery/;

type Geo = "kelowna" | "vancouver" | "seattle" | "none";
const GEO_HEADERS: Record<Exclude<Geo, "none">, Record<string, string>> = {
  kelowna: { "x-vercel-ip-country": "CA", "x-vercel-ip-country-region": "BC", "x-vercel-ip-city": "Kelowna", "x-vercel-ip-latitude": "49.89", "x-vercel-ip-longitude": "-119.49" },
  vancouver: { "x-vercel-ip-country": "CA", "x-vercel-ip-country-region": "BC", "x-vercel-ip-city": "Vancouver", "x-vercel-ip-latitude": "49.28", "x-vercel-ip-longitude": "-123.12" },
  seattle: { "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "WA", "x-vercel-ip-city": "Seattle", "x-vercel-ip-latitude": "47.61", "x-vercel-ip-longitude": "-122.33" },
};

function seed({ flag = true, emailCode = true }: { flag?: boolean; emailCode?: boolean } = {}) {
  resetWorld();
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.fixture.example";
  process.env.RESEND_API_KEY = "re_fixture_not_a_real_key";
  process.env.VERCEL = "1";
  if (flag) process.env.CLAIM_AUTO_APPROVAL_ENABLED = "true";
  else delete process.env.CLAIM_AUTO_APPROVAL_ENABLED;
  if (emailCode) {
    process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED = "true";
    process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET = SECRET;
  } else {
    delete process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED;
    delete process.env.OPERATOR_VERIFICATION_CODE_HMAC_SECRET;
  }
  world.tables.venues.push({
    id: VENUE_ID,
    slug: SLUG,
    name: "Fixture Taproom",
    city: "Kelowna",
    country: "Canada",
    lat: 49.888,
    lng: -119.496,
    phone: "(250) 555-0100",
    website_url: "https://www.fixturetaproom.test",
    is_published: true,
    is_verified: false,
    claimed_at: null,
    claimed_by: null,
    created_by_operator_id: null,
  });
}

beforeEach(() => seed());

type Claimant = { first?: string; last?: string; role?: string; phone?: string; email?: string; geo?: Geo; ip?: string };
async function submitClaim(c: Claimant = {}, slug = SLUG): Promise<ClaimFormState> {
  world.requestHeaders = new Map([["x-forwarded-for", c.ip ?? "203.0.113.10"], ...Object.entries(c.geo && c.geo !== "none" ? GEO_HEADERS[c.geo] : {})]);
  const fd = new FormData();
  fd.set("first_name", c.first ?? "Casey");
  fd.set("last_name", c.last ?? "Claimant");
  fd.set("position", c.role ?? "Manager");
  fd.set("phone", c.phone ?? "(250) 555-0199");
  fd.set("email", c.email ?? "casey.claimant@gmail.com");
  fd.set("cf_turnstile_token", "fixture-turnstile");
  return submitClaimAction(slug, {}, fd);
}

const venue = () => world.tables.venues.find((v) => v.id === VENUE_ID)!;
const claims = () => world.tables.venue_claims.filter((c) => c.venue_id === VENUE_ID);
const founderEmails = () => world.emails.filter((e) => e.to === FOUNDER);
const emailsTo = (to: string) => world.emails.filter((e) => e.to === to);
const slackClaims = () => world.slack.filter((p) => p.channel === "venue-claims").map((p) => p.text ?? "");
const tokenOf = (path: string) => new URLSearchParams(path.split("?")[1]).get("t")!;
async function renderVerify(path: string) {
  return renderToStaticMarkup(await OperatorVerifyPage({ searchParams: Promise.resolve({ t: tokenOf(path) }) }));
}
async function venueStory() {
  const { notes } = await getRelatedClaimNotesForVenue(VENUE_ID);
  return [...notes].reverse().map((n) => n.note); // oldest first
}

// ── Golden path ──────────────────────────────────────────────────────────────

test("GOLDEN PATH: an ordinary claim auto-approves and the operator stays in the HHC flow through to Operator Admin", async () => {
  const EMAIL = "casey.claimant@gmail.com";
  // Gmail + Manager + phone mismatch + Vancouver IP (~270 km): all ordinary.
  const result = await submitClaim({ geo: "vancouver" });

  // Decision + claim
  assert.equal(result.success, true);
  assert.equal(claims().length, 1);
  assert.equal(claims()[0].status, "approved");
  assert.equal(claims()[0].reviewed_by, null, "no founder reviewed it");

  // Exactly one account, venue conditionally owned, badge NOT yet public
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operators.length, 1);
  const operator = world.tables.operators[0];
  assert.equal(venue().claimed_by, operator.id);
  assert.equal(venue().created_by_operator_id, operator.id);
  assert.equal(venue().is_verified, false, "not publicly verified until activation");

  // One verification-required lifecycle, first code issued and emailed automatically
  assert.equal(world.tables.operator_activation_lifecycles.length, 1);
  const lifecycle = world.tables.operator_activation_lifecycles[0];
  assert.equal(lifecycle.verification_required, true);
  assert.equal(lifecycle.origin_type, "claim");
  assert.equal(lifecycle.origin_claim_id, claims()[0].id);
  assert.equal(world.tables.operator_verification_codes.length, 1);
  const operatorMail = emailsTo(EMAIL);
  assert.equal(operatorMail.length, 1, "the claimant gets exactly one email: the code");
  const code = operatorMail[0].subject.match(/^(\d{6}) is your Happy Hour Compass verification code$/)?.[1];
  assert.ok(code);
  assert.equal(world.generateLinkCalls.length, 0, "no Supabase link generated at approval");
  for (const e of operatorMail) assert.ok(!SUPABASE_FACING.test(e.html + e.text));
  assert.ok(!operatorMail.some((e) => /We received your claim|finish setting up your account/i.test(e.subject)), "no 'we'll review' or continue-setup email");

  // Founder: auto-approved email + Slack
  const [founder] = founderEmails();
  assert.equal(founderEmails().length, 1);
  assert.equal(founder.subject, "[CLAIM AUTO-APPROVED] Fixture Taproom (Kelowna)");
  assert.match(founder.text, /Why it auto-approved:/);
  assert.match(founder.text, /Casey Claimant \(Manager\)/);
  assert.match(founder.text, /casey\.claimant@gmail\.com/);
  assert.match(founder.text, /Also noted \(not enough to require review\):\n• Claim phone \(250\) 555-0199 does not match the venue phone \(250\) 555-0100\./);
  assert.match(founder.text, /verifying their email in HHC now/);
  const [slack] = slackClaims();
  assert.match(slack, /^:white_check_mark: \*CLAIM AUTO-APPROVED\* — Fixture Taproom \(Kelowna\)/);

  // Browser: a safe, relative HHC next step — followed immediately
  assert.ok(result.verificationPath);
  assert.equal(safeClaimContinuation(result), result.verificationPath);
  assert.equal(readVerificationLinkToken(tokenOf(result.verificationPath!), SECRET), lifecycle.id);
  assert.equal(result.nextPath, undefined);

  // Verify page is already in code-entry state
  const html = await renderVerify(result.verificationPath!);
  assert.match(html, /We sent a 6-digit code to/);
  assert.match(html, /id="verification-code"/);
  assert.doesNotMatch(html, />Send code</);

  // Code → session → Set Password → activation
  const verified = await verifyCodeAction(tokenOf(result.verificationPath!), code!);
  assert.deepEqual(verified, { status: "verified", next: "/operator/create-password" });
  assert.equal(world.sessionUserId, operator.id);
  world.accessTokens.set("fixture-access", operator.id as string);
  assert.deepEqual(await completeAccountSetupAction("fixture-access"), { ok: true });
  assert.ok(world.tables.operators[0].account_activated_at);
  assert.equal(venue().is_verified, true, "publicly verified once activation completed");
  await completeAccountSetupAction("fixture-access"); // idempotent
  assert.equal(world.tables.venue_claim_notes.filter((n) => /now publicly verified/.test(n.note as string)).length, 1);

  // Operator Admin access
  assert.equal(await hasOperatorAccess(EMAIL), true);
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operators.length, 1);
  assert.equal(world.tables.operator_activation_lifecycles.length, 1);

  // Venue Internal Notes tell the story, in order, readable, without duplicates
  const story = await venueStory();
  const idx = (re: RegExp) => story.findIndex((n) => re.test(n));
  const order = [
    /Claim submitted by Casey Claimant \(casey\.claimant@gmail\.com, Manager\)/,
    /Claim auto-approved — no founder review needed\. No conflicts, and no combination of concerns that needs review\. Claimant role: Manager\./,
    /Activation window started/,
    /Operator account setup completed/,
    /Venue is now publicly verified/,
  ].map(idx);
  assert.ok(order.every((i) => i >= 0), JSON.stringify(story, null, 1));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "chronological");
  assert.equal(story.filter((n) => /Operator account setup completed/.test(n)).length, 1, "activation shown once, not twice");
  assert.ok(story.every((n) => n.startsWith("(via venue claim) ")));
});

test("clients: both claim forms follow only a validated server continuation, before the old 'we'll review' screen", () => {
  for (const f of ["src/app/(consumer)/venue/[id]/claim/ClaimForm.tsx", "src/app/(website)/acquisition/ClaimVenueModalContent.tsx"]) {
    const src = readFileSync(join(__dirname, "../../..", f), "utf8");
    assert.match(src, /const continuation = state\.success \? safeClaimContinuation\(state\) : null;/);
    assert.match(src, /if \(continuation\) window\.location\.assign\(continuation\);/);
    assert.ok(src.indexOf("if (continuation) {") < src.indexOf("if (state.success) {"), `${f}: continuation renders before the review screen`);
  }
  // Only the two server-shaped internal destinations pass.
  assert.equal(safeClaimContinuation({ verificationPath: "https://evil.example/x" }), null);
  assert.equal(safeClaimContinuation({ verificationPath: "/operator/verify?t=abc" }), null);
  assert.equal(safeClaimContinuation({ nextPath: "//evil.example" }), null);
  assert.equal(safeClaimContinuation({ nextPath: "/login" }), "/login");
});

// ── Manual review ────────────────────────────────────────────────────────────

test("MANUAL REVIEW: foreign IP + Server + phone mismatch → held; founder email + Slack say exactly why; nothing provisioned", async () => {
  const EMAIL = "sam.server@gmail.com";
  const result = await submitClaim({ email: EMAIL, role: "Server", geo: "seattle" });

  assert.deepEqual(result, { success: true }, "normal 'submitted for review' state");
  assert.equal(claims()[0].status, "pending");
  assert.equal(world.authUsers.length + world.tables.operators.length, 0);
  assert.equal(world.createUserCalls.length, 0);
  assert.equal(world.tables.operator_activation_lifecycles.length + world.tables.operator_verification_codes.length, 0);
  assert.equal(venue().claimed_by, null);

  const [founder] = founderEmails();
  assert.equal(founder.subject, "[Venue Claim — Manual Review] Fixture Taproom (Kelowna)");
  assert.match(founder.text, /Manual review required because:\n• The claim came from an IP in Seattle, WA, US; the venue is in Canada\.\n• Role entered: Server\.\n• Claim phone \(250\) 555-0199 does not match the venue phone \(250\) 555-0100\./);
  assert.doesNotMatch(founder.text, /\b[HCPR]\d\b/, "no reason codes");
  const [slack] = slackClaims();
  assert.match(slack, /^:mag: \*CLAIM NEEDS MANUAL REVIEW\* — Fixture Taproom \(Kelowna\)/);
  assert.match(slack, /Manual review required because:\n• The claim came from an IP in Seattle/);
  assert.equal(emailsTo(EMAIL).filter((e) => /We received your claim/.test(e.subject)).length, 1, "claimant confirmation as today");

  const decisionNote = world.tables.venue_claim_notes.find((n) => n.event_type === "auto_decision")!;
  assert.equal((decisionNote.metadata_json as { decision: string }).decision, "founder_review");
  assert.equal((decisionNote.metadata_json as { rule: string }).rule, "R1_foreign_ip_plus_caution");
  const story = await venueStory();
  assert.ok(story.some((n) => /Claim held for manual review\. The claim came from an IP in Seattle, WA, US; the venue is in Canada\. Role entered: Server\./.test(n)));
});

test("MANUAL REVIEW (technical H7): email-code unavailable → notifications say auto-approval was unavailable, not that the claimant is risky", async () => {
  seed({ emailCode: false });
  await submitClaim({ geo: "kelowna" });
  assert.equal(claims()[0].status, "pending");
  const [founder] = founderEmails();
  assert.match(founder.text, /Manual review required — automatic approval was unavailable/);
  assert.match(founder.text, /No claimant risk signal triggered this review\./);
  assert.doesNotMatch(founder.text, /Manual review required because:/);
  assert.match(slackClaims()[0], /^:gear: \*CLAIM NEEDS MANUAL REVIEW — automatic approval unavailable\*/);
});

test("FLAG OFF: exactly today's founder-review flow — no evaluation, no new notes, original notification format", async () => {
  seed({ flag: false });
  const result = await submitClaim({ geo: "kelowna", phone: "(250) 555-0100" }); // would otherwise auto-approve
  assert.deepEqual(result, { success: true });
  assert.equal(claims()[0].status, "pending");
  assert.equal(world.tables.venue_claim_notes.length, 0, "no new claim notes");
  assert.equal(world.createUserCalls.length, 0);
  const [founder] = founderEmails();
  assert.equal(founder.subject, "[Venue Claim] Fixture Taproom (Kelowna)");
  assert.doesNotMatch(founder.text, /manual review|auto-approv/i);
  assert.equal(slackClaims()[0], `Fixture Taproom\nKelowna\n<https://staging.fixture.example/control-panel/claims/${claims()[0].id}|Open in Control Panel →>`);
});

// ── Hard conditions end to end ───────────────────────────────────────────────

test("H1: an open needs_more_info claim for the venue → review", async () => {
  world.tables.venue_claims.push({ id: "c-open", venue_id: VENUE_ID, status: "needs_more_info", email: "other@x.example" });
  await submitClaim();
  assert.equal(claims().find((c) => c.id !== "c-open")!.status, "pending");
  assert.match(founderEmails()[0].text, /Another claim for this venue is still open \(status: needs more info\)/);
});

test("H5: a consumer-account email → review, and provisioning is never attempted", async () => {
  world.tables.consumer_profiles = [{ id: "cons-1", email: "casey.claimant@gmail.com" }];
  await submitClaim({ phone: "(250) 555-0100" }); // even a phone match can't override H
  assert.equal(claims()[0].status, "pending");
  assert.equal(world.createUserCalls.length, 0);
  assert.match(founderEmails()[0].text, /already has a consumer Happy Hour Compass account/);
});

test("H6: the 4th claim from the same email in 24h → review (the first three are unaffected by this rule)", async () => {
  for (let i = 1; i <= 3; i++) world.tables.venue_claims.push({ id: `prior-${i}`, venue_id: `other-venue-${i}`, status: "rejected", email: "casey.claimant@gmail.com", created_at: new Date().toISOString() });
  await submitClaim();
  assert.match(founderEmails()[0].text, /High claim volume in the last 24 hours: 4 claims from casey\.claimant@gmail\.com/);
});

// ── Existing operators ───────────────────────────────────────────────────────

test("returning ACTIVATED operator: venue added to their account, /login next step, no new account, no lifecycle, verified now", async () => {
  const EMAIL = "known.operator@fixture.example";
  world.authUsers.push({ id: "op-known", email: EMAIL });
  world.tables.operators.push({ id: "op-known", email: EMAIL, account_activated_at: "2026-09-01T00:00:00.000Z" });
  const result = await submitClaim({ email: EMAIL, role: "Other", geo: "seattle" }); // cautions, but P3 overrides

  assert.equal(result.nextPath, "/login");
  assert.equal(result.verificationPath, undefined);
  assert.equal(safeClaimContinuation(result), "/login");
  assert.equal(claims()[0].status, "approved");
  assert.equal(venue().claimed_by, "op-known");
  assert.equal(venue().is_verified, true, "nothing left to activate, so verified now");
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operators.length, 1);
  assert.equal(world.createUserCalls.length, 1, "createUser attempted once and resolved to the existing account");
  assert.equal(world.tables.operator_activation_lifecycles.length, 0);
  assert.equal(world.tables.operator_verification_codes.length, 0);
  const mail = emailsTo(EMAIL);
  assert.equal(mail.length, 1);
  assert.ok(mail[0].html.includes("https://staging.fixture.example/login"));
  assert.match(founderEmails()[0].text, /Existing activated operator/);
});

test("UNACTIVATED operator with a live email-code lifecycle: reused, never duplicated", async () => {
  // First claim (another venue) creates the operator + email-code lifecycle.
  world.tables.venues.push({ ...venue(), id: "00000000-0000-4000-8000-0000000fe002", slug: "second-venue", name: "Second Venue", phone: null, website_url: null });
  const first = await submitClaim({ geo: "kelowna" }, "second-venue");
  assert.ok(first.verificationPath);
  const second = await submitClaim({ geo: "kelowna" });
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operator_activation_lifecycles.length, 1, "the live lifecycle is reused");
  assert.ok(second.verificationPath);
  assert.equal(tokenOf(second.verificationPath!), tokenOf(first.verificationPath!), "same code screen");
  assert.equal(venue().claimed_by, world.tables.operators[0].id);
});

test("UNACTIVATED operator with a grandfathered LEGACY lifecycle: founder review (H7), never converted", async () => {
  world.authUsers.push({ id: "op-legacy", email: "casey.claimant@gmail.com" });
  world.tables.operators.push({ id: "op-legacy", email: "casey.claimant@gmail.com", account_activated_at: null });
  world.tables.operator_activation_lifecycles.push({
    id: "lc-legacy", operator_id: "op-legacy", origin_type: "claim", origin_claim_id: "c-old", origin_submission_id: null,
    started_at: new Date().toISOString(), deadline_at: "2099-01-01T00:00:00.000Z", reminder_stage: 1,
    expired_at: null, released_at: null, verification_required: false, verification_completed_at: null,
  });
  await submitClaim({ geo: "kelowna" });
  assert.equal(claims()[0].status, "pending");
  assert.equal(world.tables.operator_activation_lifecycles[0].verification_required, false);
  assert.equal(world.createUserCalls.length, 0);
  assert.match(founderEmails()[0].text, /older \(setup-link\) activation in progress/);
});

// ── Concurrency / idempotency ────────────────────────────────────────────────

test("retry / double-submit by the same claimant: the same HHC next step, nothing new created or sent", async () => {
  const first = await submitClaim({ geo: "kelowna" });
  const mailBefore = world.emails.length;
  const again = await submitClaim({ geo: "kelowna" });
  assert.equal(again.verificationPath, first.verificationPath);
  assert.equal(claims().length, 1);
  assert.equal(world.authUsers.length, 1);
  assert.equal(world.tables.operator_activation_lifecycles.length, 1);
  assert.equal(world.tables.operator_verification_codes.length, 1);
  assert.equal(world.emails.length, mailBefore);
});

test("a different claimant after an auto-approval gets the normal 'not available' answer (no continuation leak)", async () => {
  await submitClaim({ geo: "kelowna" });
  const other = await submitClaim({ email: "someone.else@gmail.com", geo: "kelowna" });
  assert.deepEqual(other, { error: "This venue is not available to claim." });
});

test("two claimants at once (different emails): exactly one owner; the other is held/refused; nothing overwritten", async () => {
  const [a, b] = await Promise.all([
    submitClaim({ email: "first.person@gmail.com", geo: "kelowna" }),
    submitClaim({ email: "second.person@gmail.com", geo: "kelowna" }),
  ]);
  const winners = [a, b].filter((r) => r.verificationPath);
  assert.equal(winners.length, 1, JSON.stringify([a, b]));
  const owner = world.tables.operators.find((o) => o.id === venue().claimed_by)!;
  assert.ok(owner);
  assert.equal(world.tables.operators.length, 1, "no stray operator for the loser");
  assert.equal(claims().filter((c) => c.status === "approved").length, 1);
});

test("conditional ownership: if the venue gets claimed during processing, nothing is overwritten and the claim returns to founder review", async () => {
  // Simulate a concurrent founder approval landing between eligibility and linking.
  world.authUsers.push({ id: "op-other", email: "winner@fixture.example" });
  world.tables.operators.push({ id: "op-other", email: "winner@fixture.example", account_activated_at: "2026-09-01T00:00:00.000Z" });
  Object.assign(venue(), { claimed_at: new Date().toISOString(), claimed_by: "op-other", created_by_operator_id: "op-other" });
  world.tables.venue_claims.push({ id: "c-race", venue_id: VENUE_ID, status: "pending", email: "casey.claimant@gmail.com", first_name: "Casey", last_name: "Claimant", position: "Manager", phone: "(250) 555-0199" });

  const result = await runClaimAutoApproval({
    claim: { id: "c-race", email: "casey.claimant@gmail.com", phone: "(250) 555-0199", position: "Manager", ipAddress: null },
    // The (stale) snapshot the claim action saw: still unclaimed.
    venue: { id: VENUE_ID, name: "Fixture Taproom", country: "Canada", lat: 49.888, lng: -119.496, phone: "(250) 555-0100", websiteUrl: null, claimedAt: null, claimedBy: null, createdByOperatorId: null },
    requestHeaders: new Headers(),
    claimant: { firstName: "Casey", lastName: "Claimant", email: "casey.claimant@gmail.com", phone: "(250) 555-0199", position: "Manager" },
    venueCity: "Kelowna",
    submittedAt: "now",
  });

  assert.deepEqual(result, { outcome: "founder_review" });
  assert.equal(venue().claimed_by, "op-other", "never overwritten");
  assert.equal(world.tables.venue_claims.find((c) => c.id === "c-race")!.status, "pending", "back in the founder queue");
  assert.equal(world.tables.operators.length, 1, "the claimant's operator row was rolled back");
  assert.equal(world.authUsers.filter((u) => u.email === "casey.claimant@gmail.com").length, 0, "and their auth user");
  assert.equal(world.tables.operator_activation_lifecycles.length, 0);
  const note = world.tables.venue_claim_notes.find((n) => /ownership changed/.test(n.note as string))!;
  assert.match(note.note as string, /Automatic approval could not complete because the venue's ownership changed while this claim was processing/);
  const [founder] = founderEmails();
  assert.match(founder.text, /Manual review required because:\n• Automatic approval could not complete because the venue's ownership changed/);
});

// ── Shared delivery-failure behaviour ────────────────────────────────────────

test("auto-approved claim whose code email FAILS: no false 'sent', recovery works, then verifies", async () => {
  world.emailSendFails = true;
  const result = await submitClaim({ geo: "kelowna" });
  assert.ok(result.verificationPath, "still in the flow");
  const html = await renderVerify(result.verificationPath!);
  assert.doesNotMatch(html, /We sent a 6-digit code to/);
  assert.match(html, /We couldn’t send the code/);
  assert.equal(world.tables.venue_claim_notes.filter((n) => n.event_type === "setup_delivery_failed").length, 1, "recorded on the claim (so on the venue's notes too)");

  world.emailSendFails = false;
  for (const c of world.tables.operator_verification_codes) c.issued_at = new Date(Date.now() - 61_000).toISOString();
  assert.equal((await requestVerificationCodeAction(tokenOf(result.verificationPath!))).status, "code_sent");
  const code = emailsTo("casey.claimant@gmail.com").at(-1)!.subject.slice(0, 6);
  assert.equal((await verifyCodeAction(tokenOf(result.verificationPath!), code)).status, "verified");
  assert.ok((await venueStory()).some((n) => /Verification code email delivery failed/.test(n)));
});

// ── Founder approval unchanged ───────────────────────────────────────────────

test("founder-approved claims are unchanged: approving a held claim still verifies the venue at approval", async () => {
  await submitClaim({ email: "sam.server@gmail.com", role: "Server", geo: "seattle" });
  world.authUsers.push({ id: "admin-1", email: "founder@fixture.example" });
  world.tables.platform_admins = [{ id: "pa", email: "founder@fixture.example", status: "active" }];
  world.sessionUserId = "admin-1";
  const fd = new FormData();
  fd.set("action", "approve");
  const r = await reviewClaimAction(claims()[0].id as string, {}, fd);
  assert.equal(r.success, true);
  assert.equal(venue().is_verified, true);
  assert.equal(claims()[0].reviewed_by, "admin-1");
});

test("released venue: a new claim follows the normal rules again (prior approved claim doesn't block)", async () => {
  world.tables.venue_claims.push({ id: "c-released", venue_id: VENUE_ID, status: "approved", email: "gone@fixture.example" });
  const r = await submitClaim({ geo: "kelowna" });
  assert.ok(r.verificationPath);
});
