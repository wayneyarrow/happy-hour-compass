/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSetupRequestEmail, chooseRecoveryEmail } from "../../../src/lib/activation/finalSetupEmail";
import { renderVenueViewMilestoneEmail, FINISH_SETUP_PATH } from "../../../src/lib/customerSuccess/milestoneEmailTemplate";
import { parseDeliverySnapshot, parseMilestoneDeferral } from "../../../src/lib/customerSuccess/deliverySnapshot";
import { NEVER_TRACKED_SENDER_EMAIL_TYPES } from "../../../src/lib/emailTracking/emailTrackingPolicy";
import { generateFinalSetupLinkImpl, sendFinalSetupEmailImpl } from "../../../src/lib/activation/finalSetupFollowUpImpl";
import { createFakeActivationReminderClient, makeLifecycleRow } from "./support/fakeActivationReminderClient";
import { createMemoryContactCoordinator } from "./support/memoryContactCoordinator";

const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ── Milestone template ───────────────────────────────────────────────────────

test("standard milestone is unchanged by the variant work; the incomplete variant only adds the finish-setup block", () => {
  const base = { milestone: 50, firstName: "Jeremy", venueName: "Moxies" };
  const standard = renderVenueViewMilestoneEmail(base);
  const explicitStandard = renderVenueViewMilestoneEmail({ ...base, variant: "standard" });
  assert.deepEqual(explicitStandard, standard);
  assert.doesNotMatch(standard.html + standard.text, /finish-setup|Finish your setup/);
  const incomplete = renderVenueViewMilestoneEmail({ ...base, variant: "incomplete_setup" });
  assert.equal(incomplete.subject, standard.subject);
  assert.match(incomplete.html, new RegExp(`href="[^"]*${FINISH_SETUP_PATH}"`));
  // Approved copy (2026-10): no possessive venue name.
  assert.match(incomplete.html, /Make the most of those views/);
  assert.match(incomplete.html, /People are finding Moxies on Happy Hour Compass\. Finish setting up your account so you can keep your happy hour details and events up to date\./);
  assert.match(incomplete.html, /Finish your setup &rarr;/);
  assert.match(incomplete.html, /Already set up\? You can ignore this\./);
  assert.match(incomplete.text, /Make the most of those views\n\nPeople are finding Moxies on Happy Hour Compass\./);
  assert.doesNotMatch(incomplete.html + incomplete.text, /Moxies(’|')s/, "no possessive venue name");
  assert.doesNotMatch(incomplete.html + incomplete.text, /token|type=recovery/);
});

test("incomplete variant escapes the venue name in HTML only", () => {
  const r = renderVenueViewMilestoneEmail({ milestone: 50, firstName: "A", venueName: 'Pub <b>&"', variant: "incomplete_setup" });
  assert.doesNotMatch(r.html, /Pub <b>/);
  assert.match(r.text, /Pub <b>&"/);
});

test("snapshot variant parsing is backward compatible; deferral metadata round-trips", () => {
  assert.deepEqual(parseDeliverySnapshot({ deliverySnapshot: { recipientFirstName: "A", venueName: "V" } }), { recipientFirstName: "A", venueName: "V" });
  assert.equal(parseDeliverySnapshot({ deliverySnapshot: { recipientFirstName: "A", venueName: "V", variant: "incomplete_setup" } })?.variant, "incomplete_setup");
  assert.equal(parseDeliverySnapshot({ deliverySnapshot: { recipientFirstName: "A", venueName: "V", variant: "bogus" } })?.variant, undefined);
  const d = { deferredAt: "2026-10-05T22:00:00Z", deferredUntil: "2026-10-07T22:00:00Z", reason: "recent_setup_contact", contactAt: "2026-10-05T12:00:00Z", contactKind: "reminder" };
  assert.deepEqual(parseMilestoneDeferral({ coordination: { lastDeferral: d } }), d);
  assert.equal(parseMilestoneDeferral({ coordination: { lastDeferral: { ...d, reason: "x" } } }), null);
});

// ── Finish-setup CTA flow ────────────────────────────────────────────────────

test("finish-setup requests: setup wording only for an unactivated owner; everyone else keeps today's reset email", () => {
  assert.equal(chooseRecoveryEmail({ intent: "setup", isOwner: true, activated: false }), "setup");
  assert.equal(chooseRecoveryEmail({ intent: "setup", isOwner: true, activated: true }), "reset");
  assert.equal(chooseRecoveryEmail({ intent: "reset", isOwner: true, activated: false }), "reset", "/forgot-password is unchanged");
  assert.equal(chooseRecoveryEmail({ intent: "setup", isOwner: false, activated: false }), "reset");
});

test("setup-request email: setup wording, replacement and expiry notice, never 'reset', escaped name", () => {
  const e = buildSetupRequestEmail({ firstName: "<i>Jo</i>", setupLink: "https://x.test/operator/create-password?token_hash=abc&type=recovery&intent=setup" });
  assert.equal(e.subject, "Finish setting up your Happy Hour Compass account");
  assert.match(e.text, /expires in 24 hours and replaces any earlier setup link/);
  assert.doesNotMatch(e.subject + e.html + e.text, /reset/i);
  assert.match(e.html, /Hi &lt;i&gt;Jo&lt;\/i&gt;/);
  assert.ok(NEVER_TRACKED_SENDER_EMAIL_TYPES.has("operator_setup_request"), "carries a credential link — never open-tracked");
});

test("the finish-setup page only renders the request form (no token on load) and posts intent=setup through the shared, Turnstile-gated action", () => {
  const page = code("src/app/operator/finish-setup/page.tsx");
  assert.match(page, /<ForgotPasswordForm showLinkExpiredMessage=\{false\} intent="setup" \/>/);
  assert.doesNotMatch(page, /generateLink|verifyOtp|token_hash|createAdminClient/);
  const form = read("src/app/forgot-password/ForgotPasswordForm.tsx");
  assert.match(form, /<input type="hidden" name="intent" value=\{intent\} \/>/);
  assert.match(form, /<Turnstile/);
  assert.match(form, /Requesting a new setup email replaces any earlier setup links\./);
  const action = code("src/app/forgot-password/actions.ts");
  assert.match(action, /resolvePasswordRecoveryGate\(/, "code-flow gate preserved");
  assert.match(action, /sendSetupRequestEmail\(\{ to: email, firstName, setupLink: `\$\{resetLink\}&intent=setup` \}\)/);
});

test("sendTransactionalEmail records setup-contact evidence before the provider call and after registry registration", () => {
  const src = code("src/lib/email.ts");
  const fn = src.slice(src.indexOf("export async function sendTransactionalEmail("));
  const evidence = fn.indexOf("await recordSetupContactBeforeSend(");
  const send = fn.indexOf("await sendWithVariants(");
  assert.ok(evidence > 0 && send > evidence, "evidence is written before the provider is called");
});

test("the milestone worker never generates a setup link", () => {
  const src = code("src/lib/customerSuccess/processCustomerSuccessDeliveries.ts");
  assert.doesNotMatch(src, /generateLink|token_hash|buildTokenHashRecoveryLink/);
});

// ── Founder follow-up evidence ───────────────────────────────────────────────

function followUpWorld() {
  const lifecycle = makeLifecycleRow({
    id: "lc-1",
    operator_id: "op-1",
    origin_type: "claim",
    origin_claim_id: "claim-1",
    origin_submission_id: null,
    deadline_at: "2026-10-02T23:41:30.607Z",
    expired_at: "2026-10-03T00:00:00.000Z",
    reminder_stage: 3,
  });
  return createFakeActivationReminderClient({
    lifecycles: [lifecycle],
    operators: [{ id: "op-1", email: "gm@venue.example", first_name: "Jeremy", last_name: null, account_activated_at: null }],
    claims: [{ id: "claim-1", venue_id: "v-1" }],
    venues: [{ id: "v-1", name: "Venue", created_by_operator_id: "op-1" }],
  });
}

function followUpDeps(fake: ReturnType<typeof followUpWorld>, contact: ReturnType<typeof createMemoryContactCoordinator>) {
  return {
    authClient: { auth: { getUser: async () => ({ data: { user: { id: "f-1", email: "wayne@happyhourcompass.com" } } }) } } as any,
    adminClient: fake.client,
    checkAdmin: async () => true,
    generateLink: (async () => ({ data: { properties: { hashed_token: "h" }, user: null }, error: null })) as any,
    sendEmail: (async () => ({ ok: true, id: "re" })) as any,
    sendAlert: (async () => "delivered") as any,
    revalidate: () => {},
    now: () => new Date("2026-10-03T18:00:00.000Z"),
    siteUrl: "https://staging.example.test",
    coordinator: contact.coordinator,
  };
}

test("Copy setup link records a precautionary pause (never email evidence); Final resend records a founder setup contact; both release their contact claim", async () => {
  const contact = createMemoryContactCoordinator();
  const copy = await generateFinalSetupLinkImpl({ type: "claim", claimId: "claim-1" }, followUpDeps(followUpWorld(), contact));
  assert.equal(copy.ok, true);
  assert.equal(contact.rows[0].last_setup_pause_at, "2026-10-03T18:00:00.000Z");
  assert.equal(contact.rows[0].last_setup_contact_at, null, "a copied link is not an email");
  assert.equal(contact.rows[0].setup_contact_claimed_at, null);

  const contact2 = createMemoryContactCoordinator();
  const send = await sendFinalSetupEmailImpl({ type: "claim", claimId: "claim-1" }, followUpDeps(followUpWorld(), contact2));
  assert.equal(send.success, true);
  assert.equal(contact2.rows[0].last_setup_contact_kind, "founder_final_resend");
  assert.equal(contact2.rows[0].last_setup_pause_at, null);
  assert.equal(contact2.rows[0].setup_contact_claimed_at, null);
});

// ── Claim holders send only through the time-bounded guard ───────────────────

test("every contact-claim holder sends inside runHoldingContactClaim, and the initial send has no 'send anyway' path", () => {
  const holders = [
    "src/lib/customerSuccess/processCustomerSuccessDeliveries.ts",
    "src/lib/activation/processActivationReminders.ts",
    "src/lib/activation/finalSetupFollowUpImpl.ts",
    "src/app/control-panel/claims/[id]/resendClaimSetupEmailImpl.ts",
    "src/app/control-panel/operator-submissions/[id]/resendSubmissionSetupEmailImpl.ts",
    "src/lib/activation/setupContactAutomatic.ts",
    "src/lib/activation/deferredInitialSetup.ts",
  ];
  for (const p of holders) assert.match(code(p), /runHoldingContactClaim\(/, `${p} must send under the claim guard`);
  const automatic = code("src/lib/activation/setupContactAutomatic.ts");
  assert.doesNotMatch(automatic, /anyway/);
  assert.match(automatic, /return params\.onDeferred\(\)/);
  assert.match(automatic, /return params\.onUnavailable\(/);
  // The claim lifetime is never shortened to fit a request; holders never cut a started send short.
  assert.match(code("src/lib/activation/setupContactPolicy.ts"), /SETUP_CONTACT_CLAIM_TTL_MS = 6 \* 60 \* 1000/);
  assert.doesNotMatch(code("src/lib/email.ts"), /Promise\.race|setTimeout/);
  const email = code("src/lib/email.ts");
  const fn = email.slice(email.indexOf("export async function sendTransactionalEmail("));
  assert.ok(fn.indexOf("contactClaimSendGuard(type)") > 0 && fn.indexOf("contactClaimSendGuard(type)") < fn.indexOf("sendWithVariants("), "guard checked before the provider call");
});

test("every automatic initial-send call site supplies a queued result and a not-sent result (nothing is ever sent without the claim)", () => {
  for (const p of ["src/lib/operatorActivation.ts", "src/lib/activation/emailCodeActivationStart.ts", "src/lib/activation/legacyActivationResumeImpl.ts"]) {
    const src = code(p);
    const call = src.slice(src.search(/withAutomaticSetupContact(<[^(]*>)?\(/));
    assert.match(call.slice(0, 700), /onDeferred:/, p);
    assert.match(call.slice(0, 700), /onUnavailable:/, p);
  }
});
