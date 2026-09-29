import { test } from "node:test";
import assert from "node:assert/strict";
import { Resend } from "resend";
import { sendTransactionalEmail } from "../../../src/lib/email";

/**
 * Realistic retry scenarios through the REAL sendTransactionalEmail(), with
 * only the Resend SDK's network call replaced by a simulator that follows
 * Resend's documented idempotency rules
 * (https://resend.com/docs/dashboard/emails/idempotency-keys):
 *   - a key is remembered for 24h once a request with it is ACCEPTED;
 *   - same key + identical payload ⇒ the original response is replayed, no new email;
 *   - same key + different payload ⇒ 409 invalid_idempotent_request, nothing sent.
 * The simulator also models the failure that makes a retry necessary in the
 * first place: Resend accepts (and sends) the email, but the response never
 * reaches us (timeout) — so the caller records a failure and retries later.
 *
 * No real email is sent and no database is reached: the Supabase URL is
 * blanked, so registry writes fail exactly as in a database outage (which
 * also proves the send path never depends on the database).
 */

type Payload = { from: string; to: string | string[]; subject: string; html?: string; text?: string; replyTo?: string; tags?: { name: string; value: string }[] };

function createResendSimulator(opts: { verifiedDomains: string[] }) {
  const store = new Map<string, { payloadJson: string; id: string }>();
  const delivered: Payload[] = [];
  let loseNextResponse = false;
  let n = 0;

  async function send(payload: Payload, options?: { idempotencyKey?: string }) {
    const key = options?.idempotencyKey;
    const payloadJson = JSON.stringify({ ...payload, tags: payload.tags ?? null, replyTo: payload.replyTo ?? null });
    if (key && store.has(key)) {
      const prior = store.get(key)!;
      if (prior.payloadJson !== payloadJson) {
        return { data: null, error: { name: "invalid_idempotent_request", message: "This idempotency key has already been used on a request that had a different payload." } };
      }
      return { data: { id: prior.id }, error: null }; // replay — no new email
    }
    const domain = (payload.from.match(/@([^>\s]+)/)?.[1] ?? "").toLowerCase();
    if (!opts.verifiedDomains.includes(domain)) {
      return { data: null, error: { name: "validation_error", message: `The ${domain} domain is not verified.` } };
    }
    const id = `re_sim_${++n}`;
    delivered.push(payload);
    if (key) store.set(key, { payloadJson, id });
    if (loseNextResponse) {
      loseNextResponse = false;
      throw new Error("fetch failed: socket hang up (response lost after Resend accepted the email)");
    }
    return { data: { id }, error: null };
  }

  return {
    send,
    delivered,
    loseNextResponse: () => {
      loseNextResponse = true;
    },
  };
}

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_OPEN_TRACKING_ENABLED", "EMAIL_TRACKED_SENDER_DOMAIN", "VERCEL_ENV", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"] as const;

async function withSimulatedResend(
  sim: ReturnType<typeof createResendSimulator>,
  fn: (setEnv: (env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) => void) => Promise<void>
) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const emailsProto = Object.getPrototypeOf(new Resend("re_test_only").emails);
  const originalSend = emailsProto.send;
  emailsProto.send = function (payload: Payload, options?: { idempotencyKey?: string }) {
    return sim.send(payload, options);
  };
  const setEnv = (env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  // Never a real key, never a reachable database.
  setEnv({ RESEND_API_KEY: "re_test_only", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", VERCEL_ENV: "preview" });
  try {
    await fn(setEnv);
  } finally {
    emailsProto.send = originalSend;
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const TRACKING_ON = { EMAIL_OPEN_TRACKING_ENABLED: "true", EMAIL_TRACKED_SENDER_DOMAIN: "updates.happyhourcompass.com" };
const TRACKING_OFF = { EMAIL_OPEN_TRACKING_ENABLED: undefined, EMAIL_TRACKED_SENDER_DOMAIN: undefined };

function milestone() {
  return sendTransactionalEmail({
    type: "customer_success_milestone",
    to: "sam@venue.com",
    subject: "🎉 Packing House Pub just hit 100 views",
    html: "<p>Same locked snapshot on every attempt</p>",
    text: "Same locked snapshot on every attempt",
    criticality: "standard",
    from: "Wayne <wayne@happyhourcompass.com>",
    replyTo: "wayne@happyhourcompass.com",
    idempotencyKey: "hhc-customer-success:event-1",
    record: { venueId: "v1", customerSuccessEventId: "event-1", context: { milestone: 100 } },
  });
}

test("tracking OFF (tomorrow's milestone as things stand): the request is the legacy one — root sender, no tags, one email", async () => {
  const sim = createResendSimulator({ verifiedDomains: ["happyhourcompass.com"] });
  await withSimulatedResend(sim, async (setEnv) => {
    setEnv(TRACKING_OFF);
    const r = await milestone();
    assert.equal(r.ok, true);
    assert.equal(sim.delivered.length, 1);
    assert.equal(sim.delivered[0].from, "Wayne <wayne@happyhourcompass.com>");
    assert.equal(sim.delivered[0].replyTo, "wayne@happyhourcompass.com");
    assert.equal(sim.delivered[0].tags, undefined);
  });
});

test("FLAG TURNED ON MID-RETRY: attempt 1 (off) was delivered but its response lost; attempt 2 (on) gets 409, replays the original — one email, reported as success", async () => {
  const sim = createResendSimulator({ verifiedDomains: ["happyhourcompass.com", "updates.happyhourcompass.com"] });
  await withSimulatedResend(sim, async (setEnv) => {
    setEnv(TRACKING_OFF);
    sim.loseNextResponse();
    const first = await milestone();
    assert.equal(first.ok, false, "caller saw a failure and will retry");
    assert.equal(sim.delivered.length, 1, "…but Resend had accepted and sent it");

    setEnv(TRACKING_ON);
    const retry = await milestone();
    assert.equal(retry.ok, true, "a delivered original is never reported as a failure");
    assert.equal(retry.id, "re_sim_1", "the ORIGINAL message id is replayed");
    assert.equal(sim.delivered.length, 1, "no second email");
  });
});

test("FLAG TURNED OFF MID-RETRY (rollback): attempt 1 (on, tracked subdomain) delivered with lost response; attempt 2 (off) replays it — one email, success", async () => {
  const sim = createResendSimulator({ verifiedDomains: ["happyhourcompass.com", "updates.happyhourcompass.com"] });
  await withSimulatedResend(sim, async (setEnv) => {
    setEnv(TRACKING_ON);
    sim.loseNextResponse();
    assert.equal((await milestone()).ok, false);
    assert.equal(sim.delivered[0].from, "Wayne <wayne@updates.happyhourcompass.com>");

    setEnv({ EMAIL_OPEN_TRACKING_ENABLED: undefined }); // subdomain setting still present
    const retry = await milestone();
    assert.equal(retry.ok, true);
    assert.equal(retry.id, "re_sim_1");
    assert.equal(sim.delivered.length, 1);
  });
});

test("TRACKED ORIGINAL + DATABASE DOWN ON RETRY: the retry rebuilds the identical tracked request from the key alone — replay, one email, success", async () => {
  const sim = createResendSimulator({ verifiedDomains: ["happyhourcompass.com", "updates.happyhourcompass.com"] });
  await withSimulatedResend(sim, async (setEnv) => {
    setEnv(TRACKING_ON); // registry unreachable throughout (blank Supabase URL)
    sim.loseNextResponse();
    assert.equal((await milestone()).ok, false);
    const retry = await milestone();
    assert.equal(retry.ok, true);
    assert.equal(retry.id, "re_sim_1");
    assert.equal(sim.delivered.length, 1);
    assert.deepEqual(
      sim.delivered[0].tags?.map((t) => t.name),
      ["hhc_send_ref", "hhc_email_type", "hhc_env"],
      "tags carried even with the registry down"
    );
  });
});

test("SUBDOMAIN NOT VERIFIED: the tracked request is refused, the milestone goes out untracked from the root domain — exactly one email", async () => {
  const sim = createResendSimulator({ verifiedDomains: ["happyhourcompass.com"] });
  await withSimulatedResend(sim, async (setEnv) => {
    setEnv(TRACKING_ON);
    const r = await milestone();
    assert.equal(r.ok, true);
    assert.equal(sim.delivered.length, 1);
    assert.equal(sim.delivered[0].from, "Wayne <wayne@happyhourcompass.com>");
    assert.equal(sim.delivered[0].tags, undefined);
  });
});

test("NORMAL RETRY, nothing changed: identical request each time — Resend replays, one email", async () => {
  const sim = createResendSimulator({ verifiedDomains: ["happyhourcompass.com", "updates.happyhourcompass.com"] });
  await withSimulatedResend(sim, async (setEnv) => {
    setEnv(TRACKING_ON);
    sim.loseNextResponse();
    await milestone();
    await milestone();
    await milestone();
    assert.equal(sim.delivered.length, 1);
  });
});

test("SUBDOMAIN RENAMED within 24h (the one unreproducible case): no second email; reported as a failure with an explicit 'already accepted' message", async () => {
  const sim = createResendSimulator({ verifiedDomains: ["happyhourcompass.com", "updates.happyhourcompass.com", "mail.happyhourcompass.com"] });
  await withSimulatedResend(sim, async (setEnv) => {
    setEnv(TRACKING_ON);
    sim.loseNextResponse();
    await milestone();
    setEnv({ EMAIL_TRACKED_SENDER_DOMAIN: "mail.happyhourcompass.com" });
    const retry = await milestone();
    assert.equal(retry.ok, false);
    assert.match(retry.error ?? "", /already accepted by Resend/);
    assert.equal(sim.delivered.length, 1, "never a second email");
  });
});

test("operator setup email with tracking ON stays on the root domain (tags only)", async () => {
  const sim = createResendSimulator({ verifiedDomains: ["happyhourcompass.com", "updates.happyhourcompass.com"] });
  await withSimulatedResend(sim, async (setEnv) => {
    setEnv(TRACKING_ON);
    await sendTransactionalEmail({
      type: "claim_approval",
      to: "op@venue.com",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      criticality: "standard",
      record: { venueId: "v1" },
    });
    assert.equal(sim.delivered[0].from, "Happy Hour Compass <hello@happyhourcompass.com>");
    assert.equal(sim.delivered[0].replyTo, undefined);
  });
});
