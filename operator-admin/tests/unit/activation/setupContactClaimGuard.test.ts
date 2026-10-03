import { test } from "node:test";
import assert from "node:assert/strict";
import { Resend } from "resend";
import { sendTransactionalEmail } from "../../../src/lib/email";
import { contactClaimSendGuard, holdsContactClaim, runHoldingContactClaim } from "../../../src/lib/activation/setupContactClaimGuard";
import { SETUP_CONTACT_SEND_START_WINDOW_MS } from "../../../src/lib/activation/setupContactPolicy";

/**
 * Sends made while holding an operator contact claim must start inside the claim's send window, through
 * the REAL sendTransactionalEmail() with only the Resend SDK call replaced.
 * No database is reached (Supabase URL blanked: the evidence hook no-ops).
 */

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_OPEN_TRACKING_ENABLED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"] as const;

async function withFakeResend(provider: () => Promise<unknown>, fn: (calls: () => number) => Promise<void>) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const proto = Object.getPrototypeOf(new Resend("re_test_only").emails);
  const original = proto.send;
  let calls = 0;
  proto.send = function () {
    calls++;
    return provider();
  };
  process.env.RESEND_API_KEY = "re_test_only";
  delete process.env.EMAIL_OPEN_TRACKING_ENABLED;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  const realLog = console.log;
  const realError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    await fn(() => calls);
  } finally {
    console.log = realLog;
    console.error = realError;
    proto.send = original;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const setupEmail = { type: "operator_activation", to: "gm@venue.example", subject: "s", html: "<p>h</p>", text: "t", criticality: "standard" as const };
const T0 = Date.parse("2026-10-05T22:00:00.000Z");
const TOKEN = new Date(T0).toISOString();

test("under a held claim, a setup email inside the send window goes to the provider normally", async () => {
  await withFakeResend(async () => ({ data: { id: "re_1" }, error: null }), async (calls) => {
    const r = await runHoldingContactClaim("op-1", TOKEN, () => sendTransactionalEmail(setupEmail), { clock: () => T0 + 5000 });
    assert.deepEqual(r, { ok: true, id: "re_1" });
    assert.equal(calls(), 1);
  });
});

test("past the claim's send window: nothing reaches the provider, and the failure is definite (not uncertain)", async () => {
  await withFakeResend(async () => ({ data: { id: "re_1" }, error: null }), async (calls) => {
    let now = T0;
    const r = await runHoldingContactClaim(
      "op-1",
      TOKEN,
      async () => {
        now = T0 + SETUP_CONTACT_SEND_START_WINDOW_MS + 1000; // e.g. a slow link generation before sending
        return sendTransactionalEmail(setupEmail);
      },
      { clock: () => now }
    );
    assert.equal(r.ok, false);
    assert.equal(r.deliveryUncertain, false, "nothing was sent, so it can never be folded as a possible contact");
    assert.match(r.error ?? "", /send window/);
    assert.equal(calls(), 0);
  });
});

test("a started provider request is never abandoned under a claim: the send resolves only when the provider does (an abandoned request could still be accepted)", async () => {
  let accept!: (v: unknown) => void;
  await withFakeResend(() => new Promise((r) => { accept = r; }), async (calls) => {
    let settled = false;
    const p = runHoldingContactClaim("op-1", new Date().toISOString(), () => sendTransactionalEmail(setupEmail)).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls(), 1);
    assert.equal(settled, false, "still waiting on the provider — the holder can't release yet");
    accept({ data: { id: "re_late" }, error: null });
    assert.deepEqual(await p, { ok: true, id: "re_late" });
  });
});

test("milestone emails get the send-window check too; other emails (and any email outside a claim) are never limited", async () => {
  await runHoldingContactClaim("op-1", TOKEN, async () => {
    assert.equal(contactClaimSendGuard("customer_success_milestone")?.allowed, true);
    assert.equal(contactClaimSendGuard("activation_reminder")?.allowed, true);
    assert.equal(contactClaimSendGuard("founder_claim_notification"), null, "a founder notification sent from inside a claim is unaffected");
  }, { clock: () => T0 + 1000 });
  assert.equal(contactClaimSendGuard("operator_activation"), null, "no claim held → no limit");
});

test("the claim start is the token's wall-clock time; a token in the future falls back to 'now'", async () => {
  await runHoldingContactClaim("op-1", TOKEN, async () => {
    assert.equal(contactClaimSendGuard("operator_activation")?.allowed, false, "window measured from the token, not from entering");
  }, { clock: () => T0 + SETUP_CONTACT_SEND_START_WINDOW_MS + 1 });
  await runHoldingContactClaim("op-1", new Date(T0 + 3_600_000).toISOString(), async () => {
    assert.equal(contactClaimSendGuard("operator_activation")?.allowed, true);
  }, { clock: () => T0 });
});

test("re-entrancy is per claim kind: a milestone holder's context never counts as an initial-setup claim", async () => {
  await runHoldingContactClaim("op-1", TOKEN, async () => {
    assert.equal(holdsContactClaim("op-1", "initial_setup"), false);
    await runHoldingContactClaim("op-1", TOKEN, async () => {
      assert.equal(holdsContactClaim("op-1", "initial_setup"), true);
      assert.equal(holdsContactClaim("op-2", "initial_setup"), false);
    }, { kind: "initial_setup" });
  }, { kind: "milestone" });
});
