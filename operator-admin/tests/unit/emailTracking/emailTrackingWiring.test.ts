import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Source-level guarantees for the email send registry & open tracking —
 * the properties a behavioural test can't see (a future direct Resend call,
 * click tracking switched on in code, a send path losing its venue context).
 */

const ROOT = join(__dirname, "../../..");
const SRC = join(ROOT, "src");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (p: string) => stripComments(readFileSync(join(SRC, p), "utf8"));

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL = listFiles(SRC).map((f) => ({ file: relative(SRC, f), code: stripComments(readFileSync(f, "utf8")) }));

test("sendTransactionalEmail is the ONLY Resend send path — no other file sends through the SDK", () => {
  const senders = ALL.filter((f) => /\.emails\.send\(|\.batch\.send\(|api\.resend\.com\/emails/.test(f.code)).map((f) => f.file);
  assert.deepEqual(senders, ["lib/email.ts"]);
  const constructors = ALL.filter((f) => /new Resend\(/.test(f.code)).map((f) => f.file).sort();
  assert.deepEqual(constructors, ["lib/email.ts", "lib/emailTracking/resendWebhookHandler.ts"]);
});

test("sendTransactionalEmail: request planned from the send key alone, registered, sent (with variant fallback), then recorded", () => {
  const code = read("lib/email.ts");
  const start = code.indexOf("export async function sendTransactionalEmail(");
  const end = code.indexOf("\nasync function escalateEmailFailure", start);
  const body = code.slice(start, end);
  const planIdx = body.indexOf("planSendVariants(");
  const reg = body.indexOf("await registerEmailSend(");
  const send = body.indexOf("await sendWithVariants(");
  const rec = body.indexOf("await recordEmailSendResult(");
  assert.ok(planIdx !== -1 && reg !== -1 && send !== -1 && rec !== -1);
  assert.ok(planIdx < reg && reg < send && send < rec, "plan → register → send → record");
  // The provider request never reads registry output: variants are planned before registration.
  const planCall = body.slice(planIdx, body.indexOf("});", planIdx));
  assert.ok(!/registered/.test(planCall), "variants never depend on the registry");
  assert.match(body, /sendRef: computeSendRef\(sendKey\)/);
  assert.match(body, /hasIdempotencyKey: Boolean\(idempotencyKey\)/);
  // One SDK call site, using only per-variant params and ALWAYS the caller's idempotency key.
  assert.equal((body.match(/resend\.emails\.send\(/g) ?? []).length, 1);
  assert.match(body, /from: p\.from, to, subject, html, text, replyTo: p\.replyTo, \.\.\.\(p\.tags \? \{ tags: p\.tags \} : \{\}\)/);
  assert.match(body, /idempotencyKey \? \{ idempotencyKey \} : undefined/);
  // Failure escalation happens once, on the FINAL outcome (after any fallback).
  assert.equal((body.match(/escalateEmailFailure\(/g) ?? []).length, 1);
  // Registration only runs when tracking is on.
  assert.match(body, /const registered = trackingEnabled \? await registerEmailSend\(/);
});

test("registry calls are time-bounded and never throw into the send path", () => {
  const code = read("lib/emailTracking/emailSendRegistry.ts");
  assert.match(code, /export async function registerEmailSend[\s\S]*?withTimeout\(registerUnbounded/);
  assert.match(code, /export async function recordEmailSendResult[\s\S]*?withTimeout\(recordUnbounded/);
});

test("click tracking stays off: no code enables click/open tracking or edits the Resend domain", () => {
  for (const f of ALL) {
    // Reading a domain's tracking flags (the verification preflight) is fine; SETTING either is not.
    assert.ok(!/(click_tracking|clickTracking|open_tracking|openTracking)\s*[:=]\s*true/.test(f.code), `${f.file} must not enable tracking`);
    assert.ok(!/\.domains\.(update|create|remove)\(|api\.resend\.com\/domains/.test(f.code), `${f.file} must not modify Resend domains`);
  }
});

test("the Resend webhook route passes the RAW body and svix headers to the handler, which verifies before parsing", () => {
  const route = read("app/api/webhooks/resend/route.ts");
  assert.match(route, /await request\.text\(\)/);
  assert.ok(!/request\.json\(\)|JSON\.parse/.test(route));
  for (const h of ["svix-id", "svix-timestamp", "svix-signature"]) assert.ok(route.includes(h));
  const handler = read("lib/emailTracking/resendWebhookHandler.ts");
  assert.ok(handler.indexOf("webhooks.verify(") !== -1);
  assert.ok(!/JSON\.parse/.test(handler), "the verified SDK result is the only parsed payload");
});

test("the email-open-tracking cron requires CRON_SECRET and reads no request parameters", () => {
  const route = read("app/api/cron/email-open-tracking/route.ts");
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /`Bearer \$\{expected\}`/);
  assert.ok(!/searchParams|request\.json|request\.text|formData/.test(route));
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  assert.ok(vercel.crons.some((c: { path: string }) => c.path === "/api/cron/email-open-tracking"));
});

test("every operator/Customer Success send path passes registry context (record)", () => {
  const expectations: [string, RegExp][] = [
    ["lib/customerSuccess/processCustomerSuccessDeliveries.ts", /record: \{\s*venueId: event\.venueId,[\s\S]*customerSuccessEventId: event\.id/],
    ["lib/activation/activationReminderEmails.ts", /record: \{ lifecycleId, context: \{ reminderStage: stage \} \}/],
    ["lib/activation/emailCodeVerificationService.ts", /hhc-operator-verification-code:[\s\S]{0,80}record: \{\s*lifecycleId: ctx\.lifecycleId/],
    ["lib/activation/emailCodeVerificationService.ts", /trigger: "recovery_redirect"/],
    ["lib/activation/emailCodeActivationStart.ts", /trigger: "continue_setup"/],
    ["lib/activation/legacyActivationResumeImpl.ts", /trigger: "legacy_resume"/],
    ["app/control-panel/claims/[id]/resendClaimSetupEmailImpl.ts", /trigger: "founder_resend"/],
    ["app/control-panel/operator-submissions/[id]/resendSubmissionSetupEmailImpl.ts", /trigger: "founder_resend"/],
    ["lib/operatorActivation.ts", /await sendEmail\(actionLink, isReturningOperator, \{ venueId, operatorId: authUserId \}\)/],
  ];
  for (const [file, re] of expectations) assert.match(read(file), re, file);

  // Every provisioning callback forwards the record it is given.
  for (const file of [
    "app/control-panel/claims/[id]/actions.ts",
    "app/control-panel/operator-submissions/[id]/actions.ts",
    "app/(consumer)/suggest/owner/actions.ts",
    "lib/claims/claimAutoApprovalFlow.ts",
  ]) {
    const code = read(file);
    assert.ok(!/sendEmail: \(\w+, \w+\) =>/.test(code), `${file}: provisioning callback must accept the record argument`);
    assert.ok(!/sendLegacySetupEmail: \(\w+\) =>/.test(code), `${file}: legacy fallback callback must accept the record argument`);
  }
});

test("founder-inbox emails never carry venue context (the founder's own opens must not appear on a venue timeline)", () => {
  const email = read("lib/email.ts");
  const fns = email.split(/\nexport async function /).slice(1);
  const founderFns = fns.filter((f) => /const to\s*=\s*getFounderNotificationEmail\(\)/.test(f));
  assert.ok(founderFns.length >= 10, "founder notification helpers found");
  for (const f of founderFns) assert.ok(!/\brecord\b/.test(f), `founder helper ${f.slice(0, f.indexOf("("))} must not pass record`);
  for (const file of ["lib/claims/claimAutoApprovalNotifications.ts", "lib/activation/activationExpiryNotifications.ts"]) {
    assert.ok(!/\brecord:/.test(read(file)), file);
  }
});

test("customer-facing emails with a real venue/claim/submission association pass it", () => {
  const expectations: [string, RegExp][] = [
    ["app/(consumer)/venue/[id]/claim/actions.ts", /sendClaimSubmissionConfirmationEmail\(\{[\s\S]*?record:\s*\{ venueId: venueRow\.id as string, claimId: insertedClaim\.id as string \}/],
    ["lib/claims/claimAutoApprovalFlow.ts", /sendClaimSubmissionConfirmationEmail\(\{[\s\S]*?record: \{ venueId: input\.venue\.id, claimId: input\.claim\.id \}/],
    ["app/control-panel/claims/[id]/actions.ts", /sendClaimMoreInfoEmail\(\{[\s\S]*?record: \{ venueId: claimRow\.venue_id as string, claimId \}/],
    ["app/(consumer)/suggest/owner/actions.ts", /sendOperatorSubmissionConfirmationEmail\(\{[\s\S]*?record:\s*\{ venueId, submissionId: insertedSubmission\?\.id \?\? null \}/],
    ["app/control-panel/operator-submissions/[id]/actions.ts", /sendOperatorSubmissionMoreInfoEmail\(\{[\s\S]*?record:\s*\{ submissionId \}/],
    ["app/control-panel/operator-submissions/[id]/actions.ts", /sendOperatorSubmissionClosedEmail\(\{[\s\S]*?record:\s*\{ submissionId \}/],
    ["app/admin/users/actions.ts", /sendMemberInviteEmail\(\{[\s\S]*?record:\s*\{ venueId: ctx\.activeVenueId \?\? null, operatorId \}/],
  ];
  for (const [file, re] of expectations) assert.match(read(file), re, file);
});

test("the live activation reminder worker itself is untouched — only the email helper gained a registry record", () => {
  const worker = read("lib/activation/processActivationReminders.ts");
  assert.ok(!/emailTracking|registerEmailSend|record:/.test(worker));
});
