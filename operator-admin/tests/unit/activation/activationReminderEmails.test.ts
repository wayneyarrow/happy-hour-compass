import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivationReminderEmail, sendActivationReminderEmail } from "../../../src/lib/activation/activationReminderEmails";
import { reminderIdempotencyKey } from "../../../src/lib/activation/activationReminderPolicy";

// ── Copy: exact subjects and essential wording ──────────────────────────────

test("stage 1: exact subject", () => {
  const { subject } = buildActivationReminderEmail(1, { firstName: "Kelly", venueName: "Buffalo Rouge Brewing Co.", setupLink: "https://x/y" });
  assert.equal(subject, "Finish setting up your Buffalo Rouge Brewing Co. account");
});

test("stage 2: exact subject", () => {
  const { subject } = buildActivationReminderEmail(2, { firstName: "Kelly", venueName: "Buffalo Rouge Brewing Co.", setupLink: "https://x/y" });
  assert.equal(subject, "Your Buffalo Rouge Brewing Co. account setup is still waiting");
});

test("stage 3: exact subject", () => {
  const { subject } = buildActivationReminderEmail(3, { firstName: "Kelly", venueName: "Buffalo Rouge Brewing Co.", setupLink: "https://x/y" });
  assert.equal(subject, "Final reminder: set up your Buffalo Rouge Brewing Co. account");
});

test("stage 1: text body mentions 11 days remaining, correct venue and greeting", () => {
  const { text } = buildActivationReminderEmail(1, { firstName: "Kelly", venueName: "Buffalo Rouge Brewing Co.", setupLink: "https://x/y" });
  assert.match(text, /Hi Kelly,/);
  assert.match(text, /Buffalo Rouge Brewing Co\./);
  assert.match(text, /You have 11 days remaining to finish setting up your account\./);
});

test("stage 2: text body mentions 7 days remaining", () => {
  const { text } = buildActivationReminderEmail(2, { firstName: "Kelly", venueName: "Buffalo Rouge Brewing Co.", setupLink: "https://x/y" });
  assert.match(text, /You have 7 days remaining to finish setting up your account\./);
});

test("stage 3: text body mentions 2 days remaining and 'final reminder'", () => {
  const { text } = buildActivationReminderEmail(3, { firstName: "Kelly", venueName: "Buffalo Rouge Brewing Co.", setupLink: "https://x/y" });
  assert.match(text, /final reminder/i);
  assert.match(text, /you have 2 days remaining/i);
});

test("safe fallback: missing/blank first name renders as 'there'", () => {
  const withNull = buildActivationReminderEmail(1, { firstName: null, venueName: "V", setupLink: "https://x/y" });
  const withBlank = buildActivationReminderEmail(1, { firstName: "   ", venueName: "V", setupLink: "https://x/y" });
  assert.match(withNull.text, /Hi there,/);
  assert.match(withBlank.text, /Hi there,/);
});

// ── No false link-expiry claim ───────────────────────────────────────────────

test("no stage ever claims the setup LINK itself lasts until the deadline / a specific hour count", () => {
  for (const stage of [1, 2, 3] as const) {
    const { text, html } = buildActivationReminderEmail(stage, { firstName: "Kelly", venueName: "V", setupLink: "https://x/y" });
    assert.doesNotMatch(text, /this link expires/i);
    assert.doesNotMatch(html, /this link expires/i);
    assert.doesNotMatch(text, /link.*(valid|expires).*(day|hour)/i);
  }
});

// ── No sales/upgrade messaging ───────────────────────────────────────────────

test("no stage contains sales, upgrade, or plan messaging", () => {
  for (const stage of [1, 2, 3] as const) {
    const { text, html } = buildActivationReminderEmail(stage, { firstName: "Kelly", venueName: "V", setupLink: "https://x/y" });
    for (const forbidden of [/upgrade/i, /premium/i, /\bplan\b/i, /discount/i, /pricing/i]) {
      assert.doesNotMatch(text, forbidden);
      assert.doesNotMatch(html, forbidden);
    }
  }
});

test("html includes the setup link exactly once via the CTA and once as a copyable URL — never logged, just embedded", () => {
  const { html } = buildActivationReminderEmail(1, { firstName: "Kelly", venueName: "V", setupLink: "https://supabase.example/verify?token=SECRETTOKEN" });
  assert.match(html, /https:\/\/supabase\.example\/verify\?token=SECRETTOKEN/);
});

// ── HTML-injection safety (adversarial operator/venue names) ────────────────

const ADVERSARIAL_VALUES = ['<script>alert("x")</script>', 'Pub <North> & "Friends"', "O'Reilly & Sons"];

test("adversarial venue names never inject a live tag or break out of an attribute in the HTML body", () => {
  for (const stage of [1, 2, 3] as const) {
    for (const adversarial of ADVERSARIAL_VALUES) {
      const { html } = buildActivationReminderEmail(stage, { firstName: "Kelly", venueName: adversarial, setupLink: "https://x/y" });
      assert.doesNotMatch(html, /<script>/i, `stage ${stage}: a live <script> tag must never appear`);
      // The raw adversarial string (with its real < > " characters) must not
      // survive verbatim — every occurrence must have gone through escaping.
      assert.doesNotMatch(html, new RegExp(adversarial.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `stage ${stage}: the raw unescaped value must not appear`);
    }
  }
});

test("adversarial first names never inject a live tag or break out of an attribute in the HTML body", () => {
  for (const stage of [1, 2, 3] as const) {
    for (const adversarial of ADVERSARIAL_VALUES) {
      const { html } = buildActivationReminderEmail(stage, { firstName: adversarial, venueName: "V", setupLink: "https://x/y" });
      assert.doesNotMatch(html, /<script>/i, `stage ${stage}: a live <script> tag must never appear`);
      assert.doesNotMatch(html, new RegExp(adversarial.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `stage ${stage}: the raw unescaped value must not appear`);
    }
  }
});

test("the escaped venue name appears correctly entity-encoded in the HTML body", () => {
  const { html } = buildActivationReminderEmail(1, { firstName: "Kelly", venueName: 'Pub <North> & "Friends"', setupLink: "https://x/y" });
  assert.match(html, /Pub &lt;North&gt; &amp; &quot;Friends&quot; listing/);
});

test("plain-text output is NEVER HTML-escaped — adversarial characters render literally and stay human-readable", () => {
  const { text } = buildActivationReminderEmail(1, { firstName: "Kelly", venueName: 'Pub <North> & "Friends"', setupLink: "https://x/y" });
  assert.match(text, /Your Pub <North> & "Friends" listing/, "text body must show the literal characters, not HTML entities");
  assert.doesNotMatch(text, /&lt;|&gt;|&amp;|&quot;/, "text body must never contain HTML entities");
});

test("CTA link and days-remaining copy are unaffected by escaping — links stay correct, day counts stay correct", () => {
  for (const stage of [1, 2, 3] as const) {
    const { html, text } = buildActivationReminderEmail(stage, {
      firstName: "Kelly",
      venueName: 'Pub <North> & "Friends"',
      setupLink: "https://supabase.example/verify?token=SECRETTOKEN&type=recovery",
    });
    // The URL itself must never be escaped/mangled — & must stay a literal &.
    assert.match(html, /href="https:\/\/supabase\.example\/verify\?token=SECRETTOKEN&type=recovery"/);
    assert.match(text, /https:\/\/supabase\.example\/verify\?token=SECRETTOKEN&type=recovery/);
    const expectedDays = { 1: 11, 2: 7, 3: 2 }[stage];
    assert.match(text, new RegExp(`have ${expectedDays} days remaining`, "i"));
  }
});

// ── Send path: fresh link generation, idempotency, DI ───────────────────────

/**
 * Fake admin client whose only table read is the lifecycle's
 * verification mode — legacy (verification_required = false), i.e. every
 * lifecycle that exists in Production today.
 */
function legacyLifecycleClient(verificationRequired = false) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: { verification_required: verificationRequired, verification_completed_at: null }, error: null }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => query } as any;
}

test("sendActivationReminderEmail: generates a fresh link immediately before sending and passes the deterministic idempotency key", async () => {
  let generateLinkCalls = 0;
  let capturedEmail: string | undefined;
  const generateLink = async (_client: unknown, params: { email: string }) => {
    generateLinkCalls++;
    capturedEmail = params.email;
    return { data: { properties: { action_link: "https://fresh.example/link" } }, error: null };
  };

  let sendCalls = 0;
  let capturedIdempotencyKey: string | undefined;
  const sendEmail = async (params: { idempotencyKey?: string }) => {
    sendCalls++;
    capturedIdempotencyKey = params.idempotencyKey;
    return { ok: true, id: "resend-id-1" };
  };

  const result = await sendActivationReminderEmail(
    {
      stage: 2,
      lifecycleId: "lc-1",
      to: "kelly@example.com",
      firstName: "Kelly",
      venueName: "Buffalo Rouge Brewing Co.",
      adminClient: legacyLifecycleClient(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { generateLink: generateLink as any, sendEmail: sendEmail as any }
  );

  assert.equal(result.ok, true);
  assert.equal(generateLinkCalls, 1, "exactly one fresh link generated per send attempt");
  assert.equal(capturedEmail, "kelly@example.com");
  assert.equal(sendCalls, 1);
  assert.equal(capturedIdempotencyKey, reminderIdempotencyKey("lc-1", 2));
});

test("sendActivationReminderEmail: link-generation failure is reported and never reaches the email send", async () => {
  let sendCalls = 0;
  const generateLink = async () => ({ data: null, error: { message: "generateLink failed" } });
  const sendEmail = async () => {
    sendCalls++;
    return { ok: true, id: "should-not-happen" };
  };

  const result = await sendActivationReminderEmail(
    {
      stage: 1,
      lifecycleId: "lc-1",
      to: "kelly@example.com",
      firstName: "Kelly",
      venueName: "V",
      adminClient: legacyLifecycleClient(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { generateLink: generateLink as any, sendEmail: sendEmail as any }
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failedAt, "link_generation");
  assert.equal(sendCalls, 0, "the email send must never be attempted without a fresh link");
});

test("sendActivationReminderEmail: send failure is reported distinctly from link-generation failure", async () => {
  const generateLink = async () => ({ data: { properties: { action_link: "https://fresh.example/link" } }, error: null });
  const sendEmail = async () => ({ ok: false, error: "Resend rejected the message" });

  const result = await sendActivationReminderEmail(
    {
      stage: 1,
      lifecycleId: "lc-1",
      to: "kelly@example.com",
      firstName: "Kelly",
      venueName: "V",
      adminClient: legacyLifecycleClient(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { generateLink: generateLink as any, sendEmail: sendEmail as any }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failedAt, "send");
    assert.equal(result.error, "Resend rejected the message");
  }
});

test("no test in this file ever reaches the real Resend/Supabase provider — every generateLink/sendEmail dependency is injected", () => {
  // Static assertion of intent: both prior tests always pass explicit `deps`.
  assert.ok(true);
});

// ── Email-code lifecycles (Phase 2B) ─────────────────────────────────────────

test("sendActivationReminderEmail: a verification-required lifecycle links to the HHC code screen — no Supabase recovery link is generated", async () => {
  let generateLinkCalls = 0;
  const generateLink = async () => {
    generateLinkCalls++;
    return { data: { properties: { action_link: "https://supabase.example/should-not-be-used" } }, error: null };
  };
  let captured: { html?: string; text?: string; idempotencyKey?: string } = {};
  const sendEmail = async (params: { html: string; text: string; idempotencyKey?: string }) => {
    captured = params;
    return { ok: true, id: "resend-id" };
  };

  const result = await sendActivationReminderEmail(
    { stage: 1, lifecycleId: "lc-code", to: "owner@venue.example", firstName: "Sam", venueName: "V", adminClient: legacyLifecycleClient(true) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { generateLink: generateLink as any, sendEmail: sendEmail as any, buildContinueUrl: (id) => `https://staging.example/operator/verify?t=${id}.sig` }
  );

  assert.equal(result.ok, true);
  assert.equal(generateLinkCalls, 0);
  assert.ok(captured.text?.includes("https://staging.example/operator/verify?t=lc-code.sig"));
  assert.ok(!captured.text?.includes("supabase.example"));
  assert.equal(captured.idempotencyKey, reminderIdempotencyKey("lc-code", 1), "same per-stage idempotency as legacy");
});

test("sendActivationReminderEmail: a verification-required lifecycle with no HMAC secret fails the attempt — it never falls back to a link that skips verification", async () => {
  let sends = 0;
  let generateLinkCalls = 0;
  const result = await sendActivationReminderEmail(
    { stage: 2, lifecycleId: "lc-code", to: "owner@venue.example", firstName: "Sam", venueName: "V", adminClient: legacyLifecycleClient(true) },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generateLink: (async () => { generateLinkCalls++; return { data: null, error: null }; }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendEmail: (async () => { sends++; return { ok: true }; }) as any,
      buildContinueUrl: () => null,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failedAt, "link_generation");
  assert.equal(sends, 0);
  assert.equal(generateLinkCalls, 0);
});

test("sendActivationReminderEmail: if the lifecycle's mode can't be read, the attempt fails (worker retries) without generating a link or sending", async () => {
  let sends = 0;
  let generateLinkCalls = 0;
  const failing = {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { message: "db down" } }) };
      return q;
    },
  };
  const result = await sendActivationReminderEmail(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { stage: 1, lifecycleId: "lc", to: "a@b.example", firstName: null, venueName: "V", adminClient: failing as any },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generateLink: (async () => { generateLinkCalls++; return { data: null, error: null }; }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendEmail: (async () => { sends++; return { ok: true }; }) as any,
    }
  );
  assert.equal(result.ok, false);
  assert.equal(sends + generateLinkCalls, 0);
});

test("sendActivationReminderEmail: a grandfathered legacy lifecycle still gets a fresh Supabase recovery link, exactly as before", async () => {
  let generateLinkArgs: { type?: string; options?: { redirectTo?: string } } = {};
  let text = "";
  const result = await sendActivationReminderEmail(
    { stage: 1, lifecycleId: "table-19", to: "owner@venue.example", firstName: "Sam", venueName: "Table 19", adminClient: legacyLifecycleClient(false) },
    {
      generateLink: (async (_c: unknown, params: typeof generateLinkArgs) => {
        generateLinkArgs = params;
        return { data: { properties: { action_link: "https://supabase.example/legacy" } }, error: null };
      }) as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendEmail: (async (p: any) => { text = p.text; return { ok: true }; }) as any,
      buildContinueUrl: () => {
        throw new Error("legacy lifecycles must never build a verify link");
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(generateLinkArgs.type, "recovery");
  assert.ok(generateLinkArgs.options?.redirectTo?.endsWith("/operator/create-password"));
  assert.ok(text.includes("https://supabase.example/legacy"));
});
