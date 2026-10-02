/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles for provider/client seams */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sendActivationExpirySlackNotification,
  sendActivationExpiryFounderEmail,
  buildActivationExpiryFollowUpSlackText,
  type ActivationExpiryFollowUpDetails,
} from "../../../src/lib/activation/activationExpiryNotifications";
import { expiryFounderEmailIdempotencyKey } from "../../../src/lib/activation/activationReminderPolicy";

function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return fn().finally(() => {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  });
}

function details(overrides: Partial<ActivationExpiryFollowUpDetails> = {}): ActivationExpiryFollowUpDetails {
  return {
    lifecycleId: "lc-1",
    venueId: "venue-1",
    venueName: "Buffalo Rouge Brewing Co.",
    firstName: "Kelly",
    lastName: "Terris",
    email: "kelly@example.com",
    phones: [{ label: "business, from submission", value: "250-555-0100" }],
    origin: "submission",
    originId: "sub-1",
    startedAt: "2026-09-18T23:41:30.607Z",
    deadlineAt: "2026-10-02T23:41:30.607Z",
    totalViews: 1234,
    setupEmailHistory: [
      { label: "Reminder 1", at: "2026-09-21T23:41:30.607Z" },
      { label: "Reminder 2", at: "2026-09-25T23:41:30.607Z" },
    ],
    ...overrides,
  };
}

function captureSlack() {
  const calls: { channel: string; text: string }[] = [];
  const fn = (async (params: { channel: string; text: string }) => {
    calls.push(params);
    return "delivered" as const;
  }) as any;
  return { calls, fn };
}

function captureEmail() {
  const calls: Record<string, unknown>[] = [];
  const fn = (async (params: Record<string, unknown>) => {
    calls.push(params);
    return { ok: true, id: "resend-1" };
  }) as any;
  return { calls, fn };
}

// ── #customer-success Slack ──────────────────────────────────────────────────

test("expiry Slack posts to #customer-success (never #ops-alerts) with an actionable personal follow-up", async () => {
  const slack = captureSlack();
  const result = await sendActivationExpirySlackNotification(details(), { sendSlack: slack.fn });
  assert.equal(result, "delivered");
  assert.equal(slack.calls.length, 1);
  assert.equal(slack.calls[0].channel, "customer-success");
  const text = slack.calls[0].text;
  assert.match(text, /Setup window ended — personal follow-up opportunity/);
  assert.match(text, /\*Buffalo Rouge Brewing Co\.\* never finished account setup/);
  assert.match(text, /Kelly Terris — kelly@example\.com/);
  assert.match(text, /250-555-0100 \(business, from submission\)/);
  assert.match(text, /\*Venue views:\* 1,234 total/);
  assert.match(text, /Reminder 1 \(.+\) · Reminder 2 \(.+\)/);
  assert.match(text, /\*Setup window ended:\*/);
  assert.match(text, /consider a personal call, email or visit/);
  assert.match(text, /neither restarts reminders or extends the window/);
  assert.match(text, /release the venue/);
  assert.match(text, /\/control-panel\/operator-submissions\/sub-1\|Open submission>/);
  assert.match(text, /\/control-panel\/venues\/venue-1\|Open venue>/);
  assert.doesNotMatch(text, /token|action_link|create-password|verify\?/i, "never a setup link or token");
});

test("expiry Slack: claim origin links to the Claims page; missing phones/views/history degrade gracefully", () => {
  const text = buildActivationExpiryFollowUpSlackText(
    details({ origin: "claim", originId: "claim-1", phones: [], totalViews: null, setupEmailHistory: [] })
  );
  assert.match(text, /\/control-panel\/claims\/claim-1\|Open claim>/);
  assert.match(text, /\*Origin:\* Claim/);
  assert.doesNotMatch(text, /\*Phone:\*/);
  assert.match(text, /\*Venue views:\* unavailable/);
  assert.match(text, /\*Setup emails:\* none recorded/);
});

test("expiry Slack escapes Slack control characters in user-supplied values", () => {
  const text = buildActivationExpiryFollowUpSlackText(details({ venueName: "Pub <North> & Co", firstName: "<!channel>" }));
  assert.match(text, /Pub &lt;North&gt; &amp; Co/);
  assert.doesNotMatch(text, /<!channel>/);
});

// ── Founder email ────────────────────────────────────────────────────────────

test("founder email: follow-up subject, deterministic idempotency key, both Control Panel links, no mutation implied", async () => {
  const email = captureEmail();
  const result = await sendActivationExpiryFounderEmail(details(), { sendEmail: email.fn });
  assert.equal(result.ok, true);
  const sent = email.calls[0];
  assert.equal(sent.subject, "Setup window ended — personal follow-up: Buffalo Rouge Brewing Co.");
  assert.equal(sent.idempotencyKey, expiryFounderEmailIdempotencyKey("lc-1"));
  assert.equal(sent.type, "activation_expiry_founder_notification");
  assert.equal(sent.record, undefined, "founder-inbox emails never carry a venue record");
  const text = sent.text as string;
  assert.match(text, /never finished account setup/);
  assert.match(text, /automatic setup reminders have stopped/);
  assert.match(text, /still claimed and linked/);
  assert.match(text, /Phone: 250-555-0100/);
  assert.match(text, /Venue views: 1,234 total/);
  assert.match(text, /\/control-panel\/operator-submissions\/sub-1/);
  assert.match(text, /\/control-panel\/venues\/venue-1/);
  assert.doesNotMatch(text, /token|action_link|create-password/i);
});

test("founder email idempotency key differs from any reminder key for the same lifecycle", () => {
  const key = expiryFounderEmailIdempotencyKey("lc-1");
  assert.notEqual(key, "hhc-activation-reminder:lc-1:1");
  assert.equal(key, "hhc-activation-expiry-founder-email:lc-1");
});

const ADVERSARIAL_VALUES = ['<script>alert("x")</script>', 'Pub <North> & "Friends"', "O'Reilly & Sons"];

test("adversarial venue/operator names never inject a live tag into the founder email's HTML body", async () => {
  for (const adversarial of ADVERSARIAL_VALUES) {
    const email = captureEmail();
    await sendActivationExpiryFounderEmail(
      details({ venueName: adversarial, firstName: adversarial, lastName: null, phones: [{ label: adversarial, value: adversarial }] }),
      { sendEmail: email.fn }
    );
    const html = email.calls[0].html as string;
    assert.doesNotMatch(html, /<script>/i, "a live <script> tag must never appear");
    assert.doesNotMatch(html, new RegExp(adversarial.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the raw unescaped value must not appear");
  }
});

test("founder email plain text is never HTML-escaped and links are untouched by escaping", async () => {
  const email = captureEmail();
  await sendActivationExpiryFounderEmail(details({ venueName: 'Pub <North> & "Friends"', firstName: "Kel", lastName: null }), {
    sendEmail: email.fn,
  });
  const text = email.calls[0].text as string;
  const html = email.calls[0].html as string;
  assert.match(text, /Pub <North> & "Friends"/);
  assert.doesNotMatch(text, /&lt;|&gt;|&amp;|&quot;/);
  assert.match(html, /never finished account setup for Pub &lt;North&gt; &amp; &quot;Friends&quot;\./);
  assert.match(html, /href="http:\/\/localhost:3000\/control-panel\/operator-submissions\/sub-1"/);
});

test("in a production-like environment, links resolve to the real domain — no localhost or dev-artifact URLs", async () => {
  const email = captureEmail();
  const slack = captureSlack();
  await withEnv("NEXT_PUBLIC_SITE_URL", "https://happyhourcompass.com", async () => {
    await sendActivationExpiryFounderEmail(details({ origin: "claim", originId: "claim-1" }), { sendEmail: email.fn });
    await sendActivationExpirySlackNotification(details({ origin: "claim", originId: "claim-1" }), { sendSlack: slack.fn });
  });
  const combined = `${email.calls[0].html}${email.calls[0].text}${slack.calls[0].text}`;
  assert.match(combined, /https:\/\/happyhourcompass\.com\/control-panel\/claims\/claim-1/);
  assert.match(combined, /https:\/\/happyhourcompass\.com\/control-panel\/venues\/venue-1/);
  assert.doesNotMatch(combined, /localhost/i);
  assert.doesNotMatch(combined, /vscode-webview/i);
});
