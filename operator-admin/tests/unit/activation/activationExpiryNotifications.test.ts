import { test } from "node:test";
import assert from "node:assert/strict";
import { sendActivationExpirySlackNotification, sendActivationExpiryFounderEmail } from "../../../src/lib/activation/activationExpiryNotifications";
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

test("expiry Slack: posts to #ops-alerts with the exact required fields, no secrets", async () => {
  let captured: { channel?: string; severity?: string; title?: string; metadata?: Record<string, unknown> } = {};
  const sendSlack = async (params: typeof captured) => {
    captured = params;
    return "delivered" as const;
  };

  const result = await sendActivationExpirySlackNotification(
    {
      venueName: "Buffalo Rouge Brewing Co.",
      firstName: "Kelly",
      lastName: "Terris",
      email: "kelly@example.com",
      origin: "submission",
      originId: "sub-1",
      startedAt: "2026-09-18T23:41:30.607Z",
      deadlineAt: "2026-10-02T23:41:30.607Z",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { sendSlack: sendSlack as any }
  );

  assert.equal(result, "delivered");
  assert.equal(captured.channel, "ops-alerts");
  assert.equal(captured.title, "Operator activation expired — review required");
  const metadata = captured.metadata as Record<string, unknown>;
  assert.equal(metadata.Venue, "Buffalo Rouge Brewing Co.");
  assert.match(metadata.Operator as string, /Kelly Terris — kelly@example\.com/);
  assert.equal(metadata.Origin, "Add Your Venue submission");
  assert.ok(String(metadata.Review).includes("/control-panel/operator-submissions/sub-1"));
  assert.doesNotMatch(JSON.stringify(captured), /token|setupLink|action_link/i);
});

test("expiry Slack: Claim origin renders 'Claim' and the Claims Control Panel path", async () => {
  let captured: { metadata?: Record<string, unknown> } = {};
  const sendSlack = async (params: typeof captured) => {
    captured = params;
    return "delivered" as const;
  };
  await sendActivationExpirySlackNotification(
    {
      venueName: "V",
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      origin: "claim",
      originId: "claim-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      deadlineAt: "2026-01-15T00:00:00.000Z",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { sendSlack: sendSlack as any }
  );
  const metadata = captured.metadata as Record<string, unknown>;
  assert.equal(metadata.Origin, "Claim");
  assert.ok(String(metadata.Review).includes("/control-panel/claims/claim-1"));
});

test("expiry founder email: correct subject, deterministic idempotency key, no venue/operator mutation implied", async () => {
  let captured: { to?: string; subject?: string; idempotencyKey?: string; text?: string } = {};
  const sendEmail = async (params: typeof captured) => {
    captured = params;
    return { ok: true, id: "resend-1" };
  };

  const result = await sendActivationExpiryFounderEmail(
    {
      lifecycleId: "lc-1",
      venueName: "Buffalo Rouge Brewing Co.",
      firstName: "Kelly",
      lastName: "Terris",
      email: "kelly@example.com",
      origin: "submission",
      originId: "sub-1",
      deadlineAt: "2026-10-02T23:41:30.607Z",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { sendEmail: sendEmail as any }
  );

  assert.equal(result.ok, true);
  assert.equal(captured.subject, "Operator activation expired — Buffalo Rouge Brewing Co.");
  assert.equal(captured.idempotencyKey, expiryFounderEmailIdempotencyKey("lc-1"));
  assert.match(captured.text ?? "", /never completed account setup/);
  assert.match(captured.text ?? "", /remains claimed and linked/);
  assert.doesNotMatch(captured.text ?? "", /unclaim|unverif|release the venue/i);
});

test("founder email idempotency key differs from any reminder key for the same lifecycle", () => {
  const key = expiryFounderEmailIdempotencyKey("lc-1");
  assert.notEqual(key, "hhc-activation-reminder:lc-1:1");
  assert.equal(key, "hhc-activation-expiry-founder-email:lc-1");
});

// ── HTML-injection safety (adversarial operator/venue names) ────────────────

const ADVERSARIAL_VALUES = ['<script>alert("x")</script>', 'Pub <North> & "Friends"', "O'Reilly & Sons"];

test("adversarial venue/operator names never inject a live tag into the founder email's HTML body", async () => {
  for (const adversarial of ADVERSARIAL_VALUES) {
    let captured: { html?: string } = {};
    const sendEmail = async (params: typeof captured) => {
      captured = params;
      return { ok: true, id: "resend-1" };
    };
    await sendActivationExpiryFounderEmail(
      {
        lifecycleId: "lc-1",
        venueName: adversarial,
        firstName: adversarial,
        lastName: null,
        email: "kelly@example.com",
        origin: "submission",
        originId: "sub-1",
        deadlineAt: "2026-10-02T23:41:30.607Z",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sendEmail: sendEmail as any }
    );
    const html = captured.html ?? "";
    assert.doesNotMatch(html, /<script>/i, "a live <script> tag must never appear");
    assert.doesNotMatch(html, new RegExp(adversarial.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the raw unescaped value must not appear");
  }
});

test("the escaped venue/operator name appears correctly entity-encoded in the founder email's HTML body", async () => {
  let captured: { html?: string } = {};
  const sendEmail = async (params: typeof captured) => {
    captured = params;
    return { ok: true, id: "resend-1" };
  };
  await sendActivationExpiryFounderEmail(
    {
      lifecycleId: "lc-1",
      venueName: 'Pub <North> & "Friends"',
      firstName: "Kel",
      lastName: null,
      email: "kelly@example.com",
      origin: "submission",
      originId: "sub-1",
      deadlineAt: "2026-10-02T23:41:30.607Z",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { sendEmail: sendEmail as any }
  );
  assert.match(captured.html ?? "", /never completed account setup for Pub &lt;North&gt; &amp; &quot;Friends&quot;\./);
});

test("founder email plain-text output is NEVER HTML-escaped — stays human-readable, and the review URL/CTA link are unaffected", async () => {
  let captured: { html?: string; text?: string } = {};
  const sendEmail = async (params: typeof captured) => {
    captured = params;
    return { ok: true, id: "resend-1" };
  };
  await sendActivationExpiryFounderEmail(
    {
      lifecycleId: "lc-1",
      venueName: 'Pub <North> & "Friends"',
      firstName: "Kel",
      lastName: null,
      email: "kelly@example.com",
      origin: "submission",
      originId: "sub-1",
      deadlineAt: "2026-10-02T23:41:30.607Z",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { sendEmail: sendEmail as any }
  );
  assert.match(captured.text ?? "", /Pub <North> & "Friends"/, "text body must show the literal characters, not HTML entities");
  assert.doesNotMatch(captured.text ?? "", /&lt;|&gt;|&amp;|&quot;/, "text body must never contain HTML entities");
  assert.match(captured.html ?? "", /href="http:\/\/localhost:3000\/control-panel\/operator-submissions\/sub-1"/, "CTA link must remain correct and untouched by escaping");
});

test("in a production-like environment, the review URL resolves to the real domain — no localhost, vscode-webview, or dev-artifact URL leaks in", async () => {
  let captured: { html?: string; text?: string } = {};
  const sendEmail = async (params: typeof captured) => {
    captured = params;
    return { ok: true, id: "resend-1" };
  };
  await withEnv("NEXT_PUBLIC_SITE_URL", "https://happyhourcompass.com", () =>
    sendActivationExpiryFounderEmail(
      {
        lifecycleId: "lc-1",
        venueName: "Buffalo Rouge Brewing Co.",
        firstName: "Kelly",
        lastName: "Terris",
        email: "kelly@example.com",
        origin: "claim",
        originId: "claim-1",
        deadlineAt: "2026-10-02T23:41:30.607Z",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sendEmail: sendEmail as any }
    )
  );
  const combined = `${captured.html ?? ""}${captured.text ?? ""}`;
  assert.match(combined, /https:\/\/happyhourcompass\.com\/control-panel\/claims\/claim-1/);
  assert.doesNotMatch(combined, /localhost/i);
  assert.doesNotMatch(combined, /vscode-webview/i);
});
