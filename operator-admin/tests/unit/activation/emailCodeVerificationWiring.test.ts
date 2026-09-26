import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Source-wiring checks for the email-code activation flow (migration 100
 * foundation + Phase 2B wiring). Phase 1B pinned "nothing imports these
 * modules"; Phase 2B deliberately wires them, so these checks now pin
 * WHERE they may be wired, that the pure modules stay pure, that the
 * feature flag is read at exactly one decision point, and that the
 * existing reminder orchestrator / state derivation remain untouched.
 */

const SRC_ROOT = join(__dirname, "../../../src");
const ACTIVATION_DIR = join(SRC_ROOT, "lib/activation");

/** Pure modules: no I/O of any kind. */
const PURE_MODULES = [
  "emailCodeVerificationConfig",
  "emailCodeVerificationPolicy",
  "emailCodeVerificationTypes",
  "emailCodeVerificationTokens",
];
const ALL_EMAIL_CODE_MODULES = [
  ...PURE_MODULES,
  "emailCodeVerificationService",
  "emailCodeVerificationEmails",
  "emailCodeActivationStart",
];

/**
 * The only application files allowed to import any email-code module.
 * Adding a new importer is a deliberate change — update this list.
 */
const ALLOWED_IMPORTERS = new Set([
  // the modules themselves
  ...ALL_EMAIL_CODE_MODULES.map((m) => `lib/activation/${m}.ts`),
  // the verification screen
  "app/operator/verify/actions.ts",
  "app/operator/verify/page.tsx",
  "app/operator/verify/VerifyEmailCodeScreen.tsx",
  "app/operator/verify/verifyScreenLogic.ts",
  // the four provisionOperatorForVenue() call sites
  "app/control-panel/claims/[id]/actions.ts",
  "app/control-panel/operator-submissions/[id]/actions.ts",
  "app/(consumer)/suggest/owner/actions.ts",
  // links for verification-required lifecycles
  "lib/activation/activationReminderEmails.ts",
  "app/control-panel/claims/[id]/resendClaimSetupEmailImpl.ts",
  "app/control-panel/operator-submissions/[id]/resendSubmissionSetupEmailImpl.ts",
  // password-recovery gate (hardening): both Forgot Password actions + the activation backstop
  "app/forgot-password/actions.ts",
  "app/(consumer-auth)/account/forgot-password/actions.ts",
  "lib/operatorActivation.ts",
]);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => readFileSync(join(SRC_ROOT, rel), "utf8");

test("only the allowlisted files import any email-code module", () => {
  const offenders: string[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file);
    if (ALLOWED_IMPORTERS.has(rel)) continue;
    const code = stripComments(readFileSync(file, "utf8"));
    if (ALL_EMAIL_CODE_MODULES.some((m) => code.includes(m))) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test("pure modules never use Math.random, console logging, or network/database/email clients", () => {
  for (const name of PURE_MODULES) {
    const file = join(ACTIVATION_DIR, `${name}.ts`);
    const code = stripComments(readFileSync(file, "utf8"));
    assert.ok(!code.includes("Math.random"), `${name} uses Math.random`);
    assert.ok(!/console\./.test(code), `${name} logs to console`);
    const importSpecifiers = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of importSpecifiers) {
      assert.ok(spec === "node:crypto" || spec.startsWith("./emailCodeVerification"), `${name} imports ${spec}`);
    }
    assert.ok(!/\bfetch\(|createAdminClient|sendSlackAlert/.test(code), `${name} performs I/O`);
  }
});

test("policy module uses node:crypto for randomness and comparison", () => {
  const code = stripComments(readFileSync(join(ACTIVATION_DIR, "emailCodeVerificationPolicy.ts"), "utf8"));
  assert.match(code, /from "node:crypto"/);
  assert.match(code, /randomInt/);
  assert.match(code, /timingSafeEqual/);
  assert.ok(!/process\.env/.test(code), "policy module must not read environment variables");
});

test("config module never reads a NEXT_PUBLIC_ variable and reads env only inside functions", () => {
  const code = stripComments(readFileSync(join(ACTIVATION_DIR, "emailCodeVerificationConfig.ts"), "utf8"));
  assert.ok(!code.includes("NEXT_PUBLIC_"));
  const topLevel = code.replace(/export function[\s\S]*?\n}\n/g, "");
  assert.ok(!/process\.env/.test(topLevel), "process.env read at module import time");
});

test("the feature flag is read at exactly one decision point (planActivationVerificationMode)", () => {
  const readers: string[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file);
    if (rel === "lib/activation/emailCodeVerificationConfig.ts") continue;
    const code = stripComments(readFileSync(file, "utf8"));
    if (/isOperatorEmailCodeVerificationEnabled|OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED/.test(code)) readers.push(rel);
  }
  assert.deepEqual(readers, ["lib/activation/emailCodeActivationStart.ts"]);
});

test("the reminder orchestrator, reminder policy, and state derivation stay untouched by verification fields", () => {
  for (const name of ["activationState.ts", "processActivationReminders.ts", "activationReminderPolicy.ts"]) {
    const code = readFileSync(join(ACTIVATION_DIR, name), "utf8");
    assert.ok(!/verification_required|verification_completed_at|verificationRequired/.test(code), `${name} references verification fields`);
  }
});

test("the lifecycle INSERT only adds verification_required when explicitly requested (legacy payload unchanged)", () => {
  const code = stripComments(readFileSync(join(ACTIVATION_DIR, "activationLifecycle.ts"), "utf8"));
  assert.match(code, /verificationRequired = false,/);
  assert.match(code, /\.\.\.\(verificationRequired \? \{ verification_required: true \} : \{\}\),/);
  assert.ok(!/verification_completed_at/.test(code), "the lifecycle insert must never write verification_completed_at");
});

test("every provisioning call site decides the flow via planActivationVerificationMode before provisioning", () => {
  for (const rel of [
    "app/control-panel/claims/[id]/actions.ts",
    "app/control-panel/operator-submissions/[id]/actions.ts",
    "app/(consumer)/suggest/owner/actions.ts",
  ]) {
    const code = read(rel);
    const provisionCalls = [...code.matchAll(/await provisionOperatorForVenue\(\{/g)].length;
    const plans = [...code.matchAll(/await planActivationVerificationMode\(/g)].length;
    const defers = [...code.matchAll(/deferNewOperatorSetupEmail: verificationPlan === "email_code",/g)].length;
    assert.ok(provisionCalls > 0, `${rel} has no provisioning call`);
    assert.equal(plans, provisionCalls, `${rel}: one plan per provisioning call`);
    assert.equal(defers, provisionCalls, `${rel}: every provisioning call passes the plan`);
    const planIdx = code.indexOf("await planActivationVerificationMode(");
    assert.ok(planIdx < code.indexOf("await provisionOperatorForVenue({"), `${rel}: plan must precede provisioning`);
  }
});

test("verify-page server actions expose only fixed client inputs (no deps parameter)", () => {
  const code = stripComments(read("app/operator/verify/actions.ts"));
  assert.match(code, /^"use server";/);
  const signatures = [...code.matchAll(/export async function (\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(signatures, [
    ["requestVerificationCodeAction", "token: string"],
    ["verifyCodeAction", "token: string, code: string"],
    ["continueAfterVerificationAction", "token: string"],
  ]);
  assert.ok(!/deps/.test(code), "no DI seam may exist on network-reachable actions");
});

test("the verify page and its client component never import server-only secrets or admin clients", () => {
  const screen = stripComments(read("app/operator/verify/VerifyEmailCodeScreen.tsx"));
  const logic = stripComments(read("app/operator/verify/verifyScreenLogic.ts"));
  for (const code of [screen, logic]) {
    assert.ok(!/createAdminClient|emailCodeVerificationService|emailCodeVerificationPolicy|emailCodeVerificationTokens|emailCodeVerificationConfig|process\.env/.test(code));
  }
  assert.match(screen, /^"use client";/);
});

test("provisioning: the deferral returns BEFORE any recovery link is generated, and only for a genuinely new operator", () => {
  const code = stripComments(read("lib/operatorActivation.ts"));
  const deferIdx = code.indexOf("if (deferNewOperatorSetupEmail && !isReturningOperator) {");
  const generateIdx = code.indexOf("supabase.auth.admin.generateLink(");
  const sendIdx = code.indexOf("await sendEmail(actionLink, isReturningOperator)");
  assert.ok(deferIdx !== -1, "deferral branch present and gated on !isReturningOperator");
  assert.ok(deferIdx < generateIdx && deferIdx < sendIdx, "deferral must precede link generation and the email send");
  const branch = code.slice(deferIdx, code.indexOf("}", code.indexOf("return { ok: true, authUserId, setupEmailDeferred: true };")));
  assert.ok(!/generateLink|sendEmail\(/.test(branch), "the deferral branch neither generates a link nor sends an email");
  assert.match(code, /deferNewOperatorSetupEmail = false,/, "defaults to the legacy flow");
  assert.ok(!/createUser\([\s\S]*deferNewOperatorSetupEmail/.test(code.slice(0, deferIdx)), "deferral never changes auth-user creation");
});

test("call sites: the deferred email is delivered only AFTER the lifecycle is claimed, with the matching origin and delivery mode", () => {
  const cases: [string, string, string][] = [
    ["app/control-panel/claims/[id]/actions.ts", '"email_link"', '"claim"'],
    ["app/control-panel/operator-submissions/[id]/actions.ts", '"email_link"', '"submission"'],
    ["app/(consumer)/suggest/owner/actions.ts", '"in_flow"', '"submission"'],
  ];
  for (const [rel, delivery, origin] of cases) {
    const code = stripComments(read(rel));
    const claims = [...code.matchAll(/await claimOrReuseActivationLifecycle\(\{/g)].map((m) => m.index!);
    const delivers = [...code.matchAll(/await deliverDeferredActivationStart\(\{/g)].map((m) => m.index!);
    assert.equal(delivers.length, claims.length, `${rel}: one delivery per lifecycle claim`);
    delivers.forEach((d, i) => assert.ok(d > claims[i], `${rel}: delivery #${i + 1} must follow its lifecycle claim`));
    for (const d of delivers) {
      const block = code.slice(d, d + 400);
      assert.ok(block.includes(`delivery:`) && block.includes(delivery), `${rel}: delivery mode`);
      assert.ok(block.includes(`origin:`) && block.includes(origin), `${rel}: origin`);
    }
    for (const c of claims) {
      assert.match(code.slice(c, c + 300), /verificationRequired: (setupEmailDeferred|provisionResult\.setupEmailDeferred === true),/, `${rel}: lifecycle mode follows the deferral`);
    }
  }
});

test("Add Your Venue clients only navigate to the verify screen when the server returned a verificationPath", () => {
  for (const rel of ["app/(consumer)/suggest/owner/OwnerSubmissionFlow.tsx", "app/(website)/acquisition/AddVenueModalContent.tsx"]) {
    const code = stripComments(read(rel));
    const navigations = [...code.matchAll(/window\.location\.assign\(result\.verificationPath\)/g)].length;
    assert.equal(navigations, 1, `${rel}: exactly one guarded navigation (confirm-match path only)`);
    assert.match(code, /if \(result\.verificationPath\) \{\s*window\.location\.assign\(result\.verificationPath\);\s*return;\s*\}/);
  }
});

test("recovery gate: operator Forgot Password checks the gate before generating any recovery link", () => {
  const code = stripComments(read("app/forgot-password/actions.ts"));
  const gateIdx = code.indexOf("await resolvePasswordRecoveryGate(supabase, {");
  const linkIdx = code.indexOf("await generateLinkWithRetry(supabase, {");
  assert.ok(gateIdx !== -1 && linkIdx !== -1 && gateIdx < linkIdx);
  assert.match(code, /\.select\("id, first_name, account_activated_at"\)/, "activation state comes from the row it already reads");
  const branch = code.slice(gateIdx, linkIdx);
  assert.match(branch, /if \(gate\.kind === "error"\) \{\s*return \{ success: true \};\s*\}/, "fails closed, same response");
  assert.match(branch, /if \(gate\.kind === "requires_email_code"\) \{\s*await sendContinueSetupInsteadOfRecovery\(\{ gate, to: email, firstName \}\);\s*return \{ success: true \};\s*\}/);
  // Team members (no operators row) never reach the gate — unchanged.
  assert.ok(gateIdx < code.indexOf("getActiveMemberMembershipByEmail(email)"));
});

test("recovery gate: consumer Forgot Password checks the gate before generating any recovery link", () => {
  const code = stripComments(read("app/(consumer-auth)/account/forgot-password/actions.ts"));
  const gateIdx = code.indexOf("await resolvePasswordRecoveryGateForEmail(supabase, normalizedEmail)");
  const linkIdx = code.indexOf("await generateLinkWithRetry(supabase, {");
  assert.ok(gateIdx !== -1 && linkIdx !== -1 && gateIdx < linkIdx);
  const branch = code.slice(gateIdx, linkIdx);
  assert.match(branch, /if \(gate\.kind === "error"\) return \{ ok: true \};/);
  assert.match(branch, /sendContinueSetupInsteadOfRecovery\(\{ gate, to: normalizedEmail, firstName: null \}\);\s*return \{ ok: true \};/);
  assert.ok(code.indexOf("verifyTurnstileToken(") < gateIdx, "Turnstile still runs first");
});

test("activation backstop: completeOperatorAccountActivation refuses an unverified email-code lifecycle before the atomic update", () => {
  const code = stripComments(read("lib/operatorActivation.ts"));
  const fnIdx = code.indexOf("export async function completeOperatorAccountActivation(");
  const gateIdx = code.indexOf("await resolvePasswordRecoveryGate(supabase, { id: operatorId, accountActivatedAt: null });", fnIdx);
  const updateIdx = code.indexOf('.update({ account_activated_at: new Date().toISOString() })', fnIdx);
  assert.ok(fnIdx !== -1 && gateIdx > fnIdx && gateIdx < updateIdx);
  assert.match(code.slice(gateIdx, updateIdx), /if \(gate\.kind === "requires_email_code"\) \{[\s\S]*?return;\s*\}/);
  assert.ok(!/gate\.kind === "error"/.test(code.slice(gateIdx, updateIdx)), "a read error must fall through to the unchanged update");
});
