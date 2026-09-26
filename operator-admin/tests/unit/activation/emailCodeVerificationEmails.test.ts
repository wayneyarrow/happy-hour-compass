import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContinueSetupEmail,
  buildVerificationCodeEmail,
  sendContinueSetupEmail,
  sendVerificationCodeEmail,
} from "../../../src/lib/activation/emailCodeVerificationEmails";

/** Copy + send-shape tests. The send function is always a spy — no provider is reachable. */

const CONTINUE = "https://staging.example/operator/verify?t=abc.def";

test("code email: identifies HHC, shows the code prominently, explains purpose and expiry, and says to ignore if unexpected", () => {
  const { subject, html, text } = buildVerificationCodeEmail({ firstName: "Sam", code: "042917", expiresInMinutes: 10, continueUrl: CONTINUE });
  assert.equal(subject, "042917 is your Happy Hour Compass verification code");
  for (const body of [html, text]) {
    assert.ok(body.includes("042917"), "leading zeros preserved");
    assert.ok(body.includes("Happy Hour Compass"));
    assert.match(body, /continue setting up your venue account/);
    assert.match(body, /expires in 10 minutes/);
    assert.match(body, /safely ignore this email/);
    assert.ok(body.includes(CONTINUE));
  }
  assert.ok(!/unsubscribe|newsletter|special offer|promo/i.test(text), "no marketing content");
});

test("code email: escapes the first name in HTML and falls back to 'there'", () => {
  const { html } = buildVerificationCodeEmail({ firstName: "<b>Sam</b>", code: "123456", expiresInMinutes: 10, continueUrl: CONTINUE });
  assert.ok(!html.includes("<b>Sam</b>"));
  assert.ok(buildVerificationCodeEmail({ firstName: "  ", code: "123456", expiresInMinutes: 10, continueUrl: CONTINUE }).text.startsWith("Hi there,"));
});

test("code email: sent as a critical transactional email with the per-code idempotency key", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let captured: any = null;
  await sendVerificationCodeEmail(
    { to: "owner@venue.example", firstName: "Sam", code: "123456", expiresInMinutes: 10, continueUrl: CONTINUE, idempotencyKey: "hhc-operator-verification-code:c1" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async (p: any) => {
      captured = p;
      return { ok: true };
    }) as never
  );
  assert.equal(captured.type, "operator_verification_code");
  assert.equal(captured.criticality, "critical");
  assert.equal(captured.idempotencyKey, "hhc-operator-verification-code:c1");
  assert.equal(captured.to, "owner@venue.example");
});

test("continue-setup email: origin-specific copy, links to the HHC code screen, and never claims a 24-hour link lifetime", () => {
  const claim = buildContinueSetupEmail({ origin: "claim", firstName: "Sam", continueUrl: CONTINUE });
  const submission = buildContinueSetupEmail({ origin: "submission", firstName: "Sam", continueUrl: CONTINUE });
  assert.match(claim.subject, /claim was approved/);
  assert.match(submission.subject, /Your venue is on Happy Hour Compass/);
  for (const email of [claim, submission]) {
    assert.ok(email.html.includes(CONTINUE) && email.text.includes(CONTINUE));
    assert.match(email.text, /verify your email with a short code/);
    assert.ok(!/24 hours|supabase/i.test(email.html + email.text));
  }
});

test("continue-setup email: keeps each origin's existing email type so failure escalation is unchanged", async () => {
  const types: string[] = [];
  for (const origin of ["claim", "submission"] as const) {
    await sendContinueSetupEmail(
      { to: "a@b.example", firstName: null, origin, continueUrl: CONTINUE },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (p: any) => {
        types.push(`${p.type}/${p.criticality}`);
        return { ok: true };
      }) as never
    );
  }
  assert.deepEqual(types, ["claim_approval/critical", "operator_activation/critical"]);
});

test("continue-setup email fallback: understated copy + a clickable, wrapping link to the exact URL; CTA stays primary", () => {
  const url = "https://staging.example/operator/verify?t=11111111-1111-4111-8111-111111111111.AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789abcdE";
  const { html, text } = buildContinueSetupEmail({ origin: "submission", firstName: "Sam", continueUrl: url });

  // CTA still first and still the button.
  const ctaIdx = html.indexOf("Finish setting up my account");
  const fallbackIdx = html.indexOf("Button not working? Copy and paste this link into your browser:");
  assert.ok(ctaIdx !== -1 && fallbackIdx > ctaIdx, "fallback sits below the CTA");
  assert.ok(!html.includes("Or copy this URL"), "old raw-URL line replaced");

  // The fallback is a real link whose href and visible text are the exact, uncorrupted URL.
  const fallback = html.slice(fallbackIdx);
  const link = fallback.match(/<a href="([^"]+)" style="([^"]+)">([^<]+)<\/a>/);
  assert.ok(link, "fallback URL is an anchor");
  assert.equal(link![1], url);
  assert.equal(link![3], url);
  assert.match(fallback, /word-break:break-all;overflow-wrap:anywhere;/, "wraps on narrow screens");
  assert.match(link![2], /color:#94a3b8/, "subdued, not competing with the amber CTA");
  assert.equal(html.split(url).length - 1, 3, "URL appears exactly in: CTA href, fallback href, fallback text");

  // Well-formed: balanced anchors and paragraphs across the whole document.
  assert.equal((html.match(/<a\b/g) ?? []).length, (html.match(/<\/a>/g) ?? []).length);
  assert.equal((html.match(/<p\b/g) ?? []).length, (html.match(/<\/p>/g) ?? []).length);

  // Plain text keeps the bare, usable URL.
  assert.ok(text.split("\n").includes(url));
});
