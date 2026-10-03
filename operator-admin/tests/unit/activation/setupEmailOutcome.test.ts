import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approvalBanner,
  describeSetupEmail,
  setupEmailOutcomeOf,
  setupEmailOutcomeOfDelivery,
} from "../../../src/lib/activation/setupEmailOutcome";

test("send results map to sent / queued / unconfirmed / failed — a failure is only 'failed' when the provider definitely didn't send", () => {
  assert.equal(setupEmailOutcomeOf({ ok: true }), "sent");
  assert.equal(setupEmailOutcomeOf({ ok: true, queued: true }), "queued");
  assert.equal(setupEmailOutcomeOf({ ok: false, deliveryUncertain: true }), "unconfirmed");
  assert.equal(setupEmailOutcomeOf({ ok: false }), "unconfirmed", "unknown ⇒ conservative");
  assert.equal(setupEmailOutcomeOf({ ok: false, deliveryUncertain: false }), "failed");
});

test("deferred email-code start results map to the same four outcomes (null when nothing was needed)", () => {
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "continue_email_sent" }), "sent");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "legacy_fallback_sent" }), "sent");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "setup_email_queued" }), "queued");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "failed", uncertain: true }), "unconfirmed");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "failed", uncertain: false }), "failed");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "failed" }), "failed");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "code_issued", codeStatus: "code_sent" }), "sent");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "code_issued", codeStatus: "resend_cooldown" }), "sent", "a concurrent request just sent one");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "code_issued", codeStatus: "send_failed" }), "failed");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "code_issued", codeStatus: "unavailable" }), "failed");
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "code_issued", codeStatus: "verified" }), null);
  assert.equal(setupEmailOutcomeOfDelivery({ kind: "nothing_to_send" }), null);
});

test("wording: only 'sent' ever says sent; queued/unconfirmed/failed each say what to do", () => {
  assert.equal(describeSetupEmail("sent", "a@b.c"), "setup email sent to a@b.c");
  for (const o of ["queued", "unconfirmed", "failed"] as const) {
    assert.doesNotMatch(describeSetupEmail(o, "a@b.c"), /\bsent to\b/);
    assert.doesNotMatch(approvalBanner("Approved", o), /setup email sent/);
  }
  assert.match(describeSetupEmail("queued", "a@b.c"), /goes out automatically within about an hour/);
  assert.match(describeSetupEmail("unconfirmed", "a@b.c"), /may or may not have arrived/);
  assert.match(describeSetupEmail("failed", "a@b.c"), /use Resend setup email/);
  assert.equal(approvalBanner("Approved", "sent"), "Approved — setup email sent");
  assert.equal(approvalBanner("Approved", null), "Approved");
  assert.match(approvalBanner("Approved", "unconfirmed"), /Check the Resend log before using Resend setup email/);
});

test("every approval path reports the setup email through the shared outcome — none hard-codes 'sent'", () => {
  const root = join(__dirname, "../../..");
  const code = (p: string) => readFileSync(join(root, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const paths = [
    "src/app/control-panel/claims/[id]/actions.ts",
    "src/app/control-panel/operator-submissions/[id]/actions.ts",
    "src/app/(consumer)/suggest/owner/actions.ts",
    "src/lib/claims/claimAutoApprovalFlow.ts",
  ];
  for (const p of paths) {
    const src = code(p);
    assert.match(src, /setupEmailOutcomeOfDelivery\(delivery\)/, `${p}: deferred start outcome`);
    assert.match(src, /describeSetupEmail\(/, `${p}: timeline wording`);
    assert.doesNotMatch(src, /deferredEmailFailed/, `${p}: no binary failed/sent flag`);
    assert.doesNotMatch(src, /(setup|activation) email sent/i, `${p}: never claims 'sent' in a literal`);
  }
  for (const p of paths.slice(0, 2)) assert.match(code(p), /approvalBanner\(/, `${p}: founder banner`);
  const provisioning = code("src/lib/operatorActivation.ts");
  assert.match(provisioning, /onDeferred: \(\) => \(\{ ok: true, queued: true \}\)/);
  assert.match(provisioning, /return \{ ok: true, authUserId, setupEmail \}/);
});
