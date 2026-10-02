/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles for provider/client seams */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sendFinalSetupEmailImpl,
  generateFinalSetupLinkImpl,
  SETUP_LINK_LIFETIME_MS,
  type FinalSetupFollowUpDeps,
  type FinalFollowUpOrigin,
} from "../../../src/lib/activation/finalSetupFollowUpImpl";
import { buildFinalSetupEmail } from "../../../src/lib/activation/finalSetupEmail";
import { createFakeActivationReminderClient, makeLifecycleRow, type FakeLifecycleRow } from "./support/fakeActivationReminderClient";

/**
 * Founder post-expiry final follow-up: "Final resend setup email" and "Copy
 * setup link". Every provider (Supabase generateLink, email, Slack alert) is
 * an injected stub — no test here can reach a real service.
 */

const NOW = new Date("2026-10-03T18:00:00.000Z");
const PAST_DEADLINE = "2026-10-02T23:41:30.607Z";
const FOUNDER = { id: "founder-1", email: "wayne@happyhourcompass.com" };
const SITE = "https://staging.example.test";
const TOKEN_HASH = "pkce_hashed_token_value";

type Origin = "claim" | "submission";

function seed(opts: {
  origin?: Origin;
  lifecycle?: Partial<FakeLifecycleRow> & { verification_required?: boolean };
  activated?: boolean;
  owner?: string | null;
  onLifecycleSelect?: (callIndex: number, lifecycles: FakeLifecycleRow[]) => void;
} = {}) {
  const origin = opts.origin ?? "claim";
  const lifecycle = makeLifecycleRow({
    id: "lc-1",
    operator_id: "op-1",
    origin_type: origin,
    origin_claim_id: origin === "claim" ? "claim-1" : null,
    origin_submission_id: origin === "submission" ? "sub-1" : null,
    deadline_at: PAST_DEADLINE,
    expired_at: "2026-10-03T00:00:00.000Z",
    reminder_stage: 3,
    expiry_follow_up_required: true,
    ...opts.lifecycle,
  });
  const fake = createFakeActivationReminderClient({
    lifecycles: [lifecycle],
    operators: [{ id: "op-1", email: "kelly@venue.example", first_name: "Kelly", last_name: "Terris", account_activated_at: opts.activated ? "2026-10-03T00:00:00.000Z" : null }],
    claims: origin === "claim" ? [{ id: "claim-1", venue_id: "venue-1" }] : [],
    submissions: origin === "submission" ? [{ id: "sub-1", venue_id: "venue-1" }] : [],
    venues: [{ id: "venue-1", name: "Buffalo Rouge Brewing Co.", created_by_operator_id: opts.owner === undefined ? "op-1" : opts.owner }],
  }, opts.onLifecycleSelect ? { onLifecycleSelect: opts.onLifecycleSelect } : undefined);
  return fake;
}

function originFor(origin: Origin): FinalFollowUpOrigin {
  return origin === "claim" ? { type: "claim", claimId: "claim-1" } : { type: "submission", submissionId: "sub-1" };
}

function deps(
  fake: ReturnType<typeof seed>,
  overrides: Partial<FinalSetupFollowUpDeps> & { authorized?: boolean; emailOk?: boolean; linkFails?: boolean } = {}
) {
  const linkCalls: unknown[] = [];
  const emailCalls: { to: string; setupLink: string; record: Record<string, unknown> }[] = [];
  const alerts: unknown[] = [];
  const authorized = overrides.authorized ?? true;
  const d: FinalSetupFollowUpDeps = {
    authClient: { auth: { getUser: async () => ({ data: { user: FOUNDER } }) } } as any,
    adminClient: fake.client,
    checkAdmin: async () => authorized,
    generateLink: (async (_c: unknown, params: unknown) => {
      linkCalls.push(params);
      if (overrides.linkFails) return { data: { properties: null, user: null }, error: { message: "boom" } };
      return { data: { properties: { hashed_token: TOKEN_HASH, action_link: "https://project.supabase.co/auth/v1/verify?token=raw" }, user: null }, error: null };
    }) as any,
    sendEmail: (async (params: any) => {
      emailCalls.push(params);
      return overrides.emailOk === false ? { ok: false, error: "provider down" } : { ok: true, id: "resend-1" };
    }) as any,
    sendAlert: (async (params: unknown) => {
      alerts.push(params);
      return "delivered";
    }) as any,
    revalidate: () => {},
    now: () => NOW,
    siteUrl: SITE,
    ...overrides,
  };
  return { d, linkCalls, emailCalls, alerts };
}

const UNCHANGED_COLUMNS = [
  "deadline_at",
  "expired_at",
  "released_at",
  "reminder_stage",
  "reminder_next_attempt_at",
  "reminder_attempt_count",
  "reminder_lease_stage",
  "reminder_lease_started_at",
  "setup_link_claimed_at",
] as const;

function assertLifecycleUntouched(before: FakeLifecycleRow, after: FakeLifecycleRow) {
  for (const col of UNCHANGED_COLUMNS) assert.equal(after[col], before[col], `${col} must be unchanged (lock released afterwards)`);
}

// ── Final resend setup email ────────────────────────────────────────────────

for (const origin of ["claim", "submission"] as const) {
  test(`final resend (${origin}, legacy, expired): one scanner-safe setup link, setup email, founder note — window/reminders untouched`, async () => {
    const fake = seed({ origin });
    const before = { ...fake.lifecycles[0] };
    const { d, linkCalls, emailCalls } = deps(fake);
    const result = await sendFinalSetupEmailImpl(originFor(origin), d);

    assert.equal(result.success, true, result.error);
    assert.equal(result.successAction, "Final setup email sent to kelly@venue.example");
    assert.equal(linkCalls.length, 1);
    assert.deepEqual(linkCalls[0], { type: "recovery", email: "kelly@venue.example", options: { redirectTo: `${SITE}/operator/create-password` } });

    assert.equal(emailCalls.length, 1);
    const link = emailCalls[0].setupLink;
    assert.equal(link, `${SITE}/operator/create-password?token_hash=${TOKEN_HASH}&type=recovery&intent=setup`);
    assert.doesNotMatch(link, /auth\/v1\/verify|operator\/verify/, "never the raw action_link or a closed code screen");
    assert.equal(emailCalls[0].record.lifecycleId, "lc-1");
    assert.equal(emailCalls[0].record.venueId, "venue-1");
    assert.deepEqual(emailCalls[0].record.context, { trigger: "final_follow_up" });
    assert.equal(origin === "claim" ? emailCalls[0].record.claimId : emailCalls[0].record.submissionId, origin === "claim" ? "claim-1" : "sub-1");

    const notes = origin === "claim" ? fake.venueClaimNotes : fake.operatorSubmissionNotes;
    const other = origin === "claim" ? fake.operatorSubmissionNotes : fake.venueClaimNotes;
    assert.equal(notes.length, 1);
    assert.equal(other.length, 0);
    assert.equal(notes[0].event_type, "final_setup_email_sent");
    assert.equal(notes[0].created_by, FOUNDER.id, "founder-attributed, never the system author");
    const meta = notes[0].metadata_json as Record<string, unknown>;
    assert.equal(meta.recipient, "kelly@venue.example");
    assert.equal(meta.linkExpiresAt, new Date(NOW.getTime() + SETUP_LINK_LIFETIME_MS).toISOString());
    assert.equal(meta.setupFlow, "legacy");
    assert.doesNotMatch(JSON.stringify(notes[0]), new RegExp(TOKEN_HASH), "the note never contains the link or token");

    assertLifecycleUntouched(before, fake.lifecycles[0]);
  });
}

test("final resend for an email-code lifecycle whose deadline passed before the expiry worker ran: same inbox-verified recovery link, never the closed code screen", async () => {
  const fake = seed({ origin: "submission", lifecycle: { expired_at: null, verification_required: true } as Partial<FakeLifecycleRow> });
  const before = { ...fake.lifecycles[0] };
  const { d, emailCalls } = deps(fake);
  const result = await sendFinalSetupEmailImpl(originFor("submission"), d);
  assert.equal(result.success, true, result.error);
  assert.match(emailCalls[0].setupLink, /\/operator\/create-password\?token_hash=.+&type=recovery&intent=setup$/);
  assert.equal((fake.operatorSubmissionNotes[0].metadata_json as Record<string, unknown>).setupFlow, "email_code");
  assert.equal(fake.lifecycles[0].expired_at, null, "the action never stamps expiry itself");
  assertLifecycleUntouched(before, fake.lifecycles[0]);
});

test("refusals happen before any link is generated: unauthorized, window still open, activated, released, ownership changed", async () => {
  const cases: { name: string; fake: ReturnType<typeof seed>; authorized?: boolean; error: RegExp }[] = [
    { name: "unauthorized", fake: seed(), authorized: false, error: /^Unauthorized\.$/ },
    { name: "window open", fake: seed({ lifecycle: { deadline_at: "2026-10-20T00:00:00.000Z", expired_at: null } }), error: /still open — use Resend setup email/ },
    { name: "activated", fake: seed({ activated: true }), error: /already finished account setup/ },
    { name: "released", fake: seed({ lifecycle: { released_at: "2026-10-03T12:00:00.000Z" } }), error: /has been released/ },
    { name: "ownership changed", fake: seed({ owner: "op-other" }), error: /no longer owns this venue/ },
    { name: "ownership cleared", fake: seed({ owner: null }), error: /no longer owns this venue/ },
  ];
  for (const c of cases) {
    const { d, linkCalls, emailCalls } = deps(c.fake, { authorized: c.authorized });
    const send = await sendFinalSetupEmailImpl(originFor("claim"), d);
    assert.match(send.error ?? "", c.error, c.name);
    const copy = await generateFinalSetupLinkImpl(originFor("claim"), d);
    assert.equal(copy.ok, false, c.name);
    assert.equal(linkCalls.length, 0, `${c.name}: no link generated`);
    assert.equal(emailCalls.length, 0, `${c.name}: nothing sent`);
    assert.equal(c.fake.venueClaimNotes.length, 0, `${c.name}: no note`);
  }
});

test("no tracked lifecycle for this origin → refused (untracked legacy records keep using Start activation tracking)", async () => {
  const fake = seed();
  fake.lifecycles.splice(0, 1);
  const { d, linkCalls } = deps(fake);
  const result = await sendFinalSetupEmailImpl(originFor("claim"), d);
  assert.match(result.error ?? "", /No activation is tracked/);
  assert.equal(linkCalls.length, 0);
});

test("a setup-link claim within its 6-minute lifetime blocks a second request; a stale one (crashed request) does not", async () => {
  const busy = seed({ lifecycle: { setup_link_claimed_at: new Date(NOW.getTime() - 5_000).toISOString() } });
  const b = deps(busy);
  const blocked = await sendFinalSetupEmailImpl(originFor("claim"), b.d);
  assert.match(blocked.error ?? "", /just requested/);
  assert.equal(b.linkCalls.length, 0);

  const stale = seed({ lifecycle: { setup_link_claimed_at: new Date(NOW.getTime() - 7 * 60_000).toISOString() } });
  const s = deps(stale);
  const ok = await sendFinalSetupEmailImpl(originFor("claim"), s.d);
  assert.equal(ok.success, true, ok.error);
  assert.equal(stale.lifecycles[0].setup_link_claimed_at, null, "our own claim is released afterwards");
});

test("concurrent resend + copy: exactly one setup link is generated, so neither invalidates the other's", async () => {
  const fake = seed();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { d, linkCalls } = deps(fake);
  const slowGenerate = d.generateLink!;
  d.generateLink = (async (...args: any[]) => {
    await gate;
    return (slowGenerate as any)(...args);
  }) as typeof d.generateLink;

  const sendP = sendFinalSetupEmailImpl(originFor("claim"), d);
  const copyP = generateFinalSetupLinkImpl(originFor("claim"), d);
  await new Promise((r) => setTimeout(r, 10));
  release();
  const [send, copy] = await Promise.all([sendP, copyP]);

  assert.equal(linkCalls.length, 1, "only one request may generate a link");
  const winners = [send.success === true, copy.ok === true].filter(Boolean).length;
  assert.equal(winners, 1);
  const loserError = send.success ? (copy as { error?: string }).error : send.error;
  assert.match(loserError ?? "", /just requested/);
});

test("provider failure: clear error that says earlier links no longer work, no note, lock released", async () => {
  const fake = seed();
  const { d, emailCalls } = deps(fake, { emailOk: false });
  const result = await sendFinalSetupEmailImpl(originFor("claim"), d);
  assert.equal(emailCalls.length, 1);
  assert.match(result.error ?? "", /may not have been sent \(provider down\)/);
  assert.match(result.error ?? "", /earlier setup link no longer works/);
  assert.equal(fake.venueClaimNotes.length, 0);
  assert.equal(fake.lifecycles[0].setup_link_claimed_at, null);
});

test("link generation failure: nothing sent, no note, lock released", async () => {
  const fake = seed();
  const { d, emailCalls } = deps(fake, { linkFails: true });
  const result = await sendFinalSetupEmailImpl(originFor("claim"), d);
  assert.match(result.error ?? "", /could not be generated\. Nothing was sent/);
  assert.equal(emailCalls.length, 0);
  assert.equal(fake.venueClaimNotes.length, 0);
  assert.equal(fake.lifecycles[0].setup_link_claimed_at, null);
});

function failingNotes(fake: ReturnType<typeof seed>) {
  const realFrom = fake.client.from.bind(fake.client);
  fake.client.from = (table: string): any => {
    const real = realFrom(table);
    if (table === "venue_claim_notes") return { ...real, insert: async () => ({ data: null, error: { code: "XX000", message: "notes down" } }) };
    return real;
  };
}

test("note failure after the provider accepted the email: success with a warning, an ops alert, and no second send", async () => {
  const fake = seed();
  failingNotes(fake);
  const { d, emailCalls, alerts } = deps(fake);
  const result = await sendFinalSetupEmailImpl(originFor("claim"), d);
  assert.equal(result.success, true);
  assert.match(result.warning ?? "", /timeline entry could not be saved.*no need to resend/);
  assert.equal(emailCalls.length, 1);
  assert.equal(alerts.length, 1);
  assert.doesNotMatch(JSON.stringify(alerts), new RegExp(TOKEN_HASH));
});

// ── Copy setup link ─────────────────────────────────────────────────────────

test("copy setup link: returns the same scanner-safe setup link with a 24 h expiry, sends no email, and notes 'generated', not 'sent'", async () => {
  const fake = seed({ origin: "submission" });
  const before = { ...fake.lifecycles[0] };
  const { d, emailCalls } = deps(fake);
  const result = await generateFinalSetupLinkImpl(originFor("submission"), d);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.link, `${SITE}/operator/create-password?token_hash=${TOKEN_HASH}&type=recovery&intent=setup`);
  assert.equal(result.expiresAt, new Date(NOW.getTime() + SETUP_LINK_LIFETIME_MS).toISOString());
  assert.equal(result.recipient, "kelly@venue.example");
  assert.equal(emailCalls.length, 0, "copying never sends an email");

  const note = fake.operatorSubmissionNotes[0];
  assert.equal(note.event_type, "final_setup_link_generated");
  assert.match(note.note as string, /Not emailed by Happy Hour Compass/);
  const meta = note.metadata_json as Record<string, unknown>;
  assert.equal(meta.recipient, undefined, "never recorded as 'sent to' anyone");
  assert.equal(meta.operatorEmail, "kelly@venue.example");
  assert.doesNotMatch(JSON.stringify(note), new RegExp(TOKEN_HASH));
  assertLifecycleUntouched(before, fake.lifecycles[0]);
});

test("copy setup link: a note failure still returns the link (it already replaced earlier ones) with a warning", async () => {
  const fake = seed();
  failingNotes(fake);
  const { d, alerts } = deps(fake);
  const result = await generateFinalSetupLinkImpl(originFor("claim"), d);
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.warning ?? "", /timeline entry could not be saved/);
  assert.equal(alerts.length, 1);
});

// ── Operator email copy ─────────────────────────────────────────────────────

test("final setup email: setup wording (never 'reset'), 24-hour and replacement notice, escaped HTML", () => {
  const { subject, html, text } = buildFinalSetupEmail({ firstName: "<b>Kelly</b>", venueName: "Pub & <Co>", setupLink: "https://x.test/link" });
  assert.equal(subject, "Finish setting up your Pub & <Co> account on Happy Hour Compass");
  assert.match(html, /Finish setting up your account/);
  assert.match(html, /Finish your setup &rarr;/);
  assert.match(text, /expires in 24 hours and replaces any earlier setup link/);
  assert.doesNotMatch(`${subject}${html}${text}`, /reset/i);
  assert.match(html, /Hi &lt;b&gt;Kelly&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Kelly<\/b>/);
  assert.match(text, /Hi <b>Kelly<\/b>/, "plain text is never HTML-escaped");
});

// ── Concurrency hardening (validation pass) ─────────────────────────────────

test("a request that outlives its claim (another request took over) sends nothing, writes no note, and never clears the other request's claim", async () => {
  const fake = seed();
  const { d, emailCalls } = deps(fake);
  const realGenerate = d.generateLink!;
  const takeover = new Date(NOW.getTime() + 61_000).toISOString();
  d.generateLink = (async (...args: any[]) => {
    const result = await (realGenerate as any)(...args);
    fake.lifecycles[0].setup_link_claimed_at = takeover; // a later request claimed it while we were slow
    return result;
  }) as typeof d.generateLink;
  const send = await sendFinalSetupEmailImpl(originFor("claim"), d);
  assert.match(send.error ?? "", /took too long.*nothing was sent/);
  assert.equal(emailCalls.length, 0);
  assert.equal(fake.venueClaimNotes.length, 0);
  assert.equal(fake.lifecycles[0].setup_link_claimed_at, takeover, "the other request's claim is left intact");

  const fake2 = seed();
  const c = deps(fake2);
  const realGenerate2 = c.d.generateLink!;
  c.d.generateLink = (async (...args: any[]) => {
    const result = await (realGenerate2 as any)(...args);
    fake2.lifecycles[0].setup_link_claimed_at = takeover;
    return result;
  }) as typeof c.d.generateLink;
  const copy = await generateFinalSetupLinkImpl(originFor("claim"), c.d);
  assert.equal(copy.ok, false, "a superseded link is never handed to Wayne");
  assert.equal(fake2.venueClaimNotes.length, 0);
});

test("an active reminder lease (a reminder pass that started before the deadline) blocks both actions before any link is generated; a stale lease does not", async () => {
  const active = seed({ lifecycle: { reminder_lease_stage: 3, reminder_lease_started_at: new Date(NOW.getTime() - 30_000).toISOString() } });
  const a = deps(active);
  assert.match((await sendFinalSetupEmailImpl(originFor("claim"), a.d)).error ?? "", /automatic reminder is being processed/);
  const copy = await generateFinalSetupLinkImpl(originFor("claim"), a.d);
  assert.equal(copy.ok, false);
  assert.equal(a.linkCalls.length, 0);
  assert.equal(active.lifecycles[0].setup_link_claimed_at, null);

  const stale = seed({ lifecycle: { reminder_lease_stage: 3, reminder_lease_started_at: new Date(NOW.getTime() - 16 * 60_000).toISOString() } });
  const s = deps(stale);
  assert.equal((await sendFinalSetupEmailImpl(originFor("claim"), s.d)).success, true);
});

test("a reminder lease taken between our first read and our claim makes us back off and release our own claim", async () => {
  const fake = seed({
    onLifecycleSelect: (callIndex, lifecycles) => {
      // 1 = first resolve, 2 = re-resolve after our claim: the worker leased in between.
      if (callIndex === 2) {
        lifecycles[0].reminder_lease_stage = 3;
        lifecycles[0].reminder_lease_started_at = NOW.toISOString();
      }
    },
  });
  const { d, linkCalls } = deps(fake);
  const result = await sendFinalSetupEmailImpl(originFor("claim"), d);
  assert.match(result.error ?? "", /automatic reminder is being processed/);
  assert.equal(linkCalls.length, 0);
  assert.equal(fake.lifecycles[0].setup_link_claimed_at, null, "our claim is released");
});

test("deadline boundary: refused 1 ms before the deadline, allowed at the deadline instant (reminders stop at the same instant)", async () => {
  const before = seed({ lifecycle: { expired_at: null, deadline_at: new Date(NOW.getTime() + 1).toISOString() } });
  assert.match((await sendFinalSetupEmailImpl(originFor("claim"), deps(before).d)).error ?? "", /still open/);
  const at = seed({ lifecycle: { expired_at: null, deadline_at: NOW.toISOString() } });
  assert.equal((await sendFinalSetupEmailImpl(originFor("claim"), deps(at).d)).success, true);
});

// ── Slow provider (final concurrency review) ────────────────────────────────

function deferredSend(fake: ReturnType<typeof seed>, d: FinalSetupFollowUpDeps, emailCalls: unknown[]) {
  let resolve!: (v: { ok: boolean; id?: string; error?: string }) => void;
  const pending = new Promise<{ ok: boolean; id?: string; error?: string }>((r) => (resolve = r));
  let started!: () => void;
  const sendStarted = new Promise<void>((r) => (started = r));
  d.sendEmail = (async (params: any) => {
    emailCalls.push(params);
    started();
    return pending;
  }) as any;
  return { resolve, sendStarted };
}

test("slow provider: a resend/copy arriving 61 s into the first email's provider call cannot generate a replacement link", async () => {
  const fake = seed();
  let clock = NOW;
  const first = deps(fake, { now: () => clock });
  const { resolve, sendStarted } = deferredSend(fake, first.d, first.emailCalls);
  const firstP = sendFinalSetupEmailImpl(originFor("claim"), first.d);
  await sendStarted;

  clock = new Date(NOW.getTime() + 61_000);
  const second = deps(fake, { now: () => clock });
  const copy = await generateFinalSetupLinkImpl(originFor("claim"), second.d);
  const resend = await sendFinalSetupEmailImpl(originFor("claim"), second.d);

  resolve({ ok: true, id: "resend-1" });
  const firstResult = await firstP;

  assert.equal(copy.ok, false, "copy must not replace an in-flight email's link");
  assert.match(resend.error ?? "", /just requested/);
  assert.equal(second.linkCalls.length, 0, "no second link generated");
  assert.equal(first.linkCalls.length, 1);
  assert.equal(firstResult.success, true);
  assert.equal(firstResult.warning, undefined, "the first email's link is still the live one");
});

test("backstop: if a request does take over after the claim expired (> 6 min), the slower email reports that its link was replaced — never a clean success — and never clears the newer claim", async () => {
  const fake = seed();
  let clock = NOW;
  const first = deps(fake, { now: () => clock, timeoutsMs: { send: 60 * 60_000 } });
  const { resolve, sendStarted } = deferredSend(fake, first.d, first.emailCalls);
  const firstP = sendFinalSetupEmailImpl(originFor("claim"), first.d);
  await sendStarted;

  clock = new Date(NOW.getTime() + 7 * 60_000);
  const second = deps(fake, { now: () => clock });
  // Hold the second request's provider call open so its claim is visible when the first resolves.
  const secondSend = deferredSend(fake, second.d, second.emailCalls);
  const secondP = sendFinalSetupEmailImpl(originFor("claim"), second.d);
  await secondSend.sendStarted;
  const secondClaim = fake.lifecycles[0].setup_link_claimed_at;
  assert.equal(secondClaim, clock.toISOString(), "the second request took over the stale claim");

  resolve({ ok: true, id: "resend-1" });
  const firstResult = await firstP;
  assert.equal(firstResult.success, true);
  assert.match(firstResult.warning ?? "", /newer setup link was generated while this email was sending/);
  assert.equal(fake.lifecycles[0].setup_link_claimed_at, secondClaim, "the older request never clears the newer claim");
  const firstNote = fake.venueClaimNotes.find((n) => (n.metadata_json as Record<string, unknown>).supersededDuringSend === true);
  assert.ok(firstNote, "the timeline records that the first email's link was superseded");

  secondSend.resolve({ ok: true, id: "resend-2" });
  const secondResult = await secondP;
  assert.equal(secondResult.success, true);
  assert.equal(secondResult.warning, undefined);
  assert.equal(fake.lifecycles[0].setup_link_claimed_at, null);
});

test("provider timeout (accepted-or-not unknown): reports delivery unknown, records 'unconfirmed' (not 'sent'), keeps the claim so no replacement link can be generated, never retries", async () => {
  const fake = seed();
  let clock = NOW;
  const first = deps(fake, { now: () => clock, timeoutsMs: { send: 20 } });
  const neverResolves = deferredSend(fake, first.d, first.emailCalls);
  const result = await sendFinalSetupEmailImpl(originFor("claim"), first.d);

  assert.match(result.error ?? "", /didn't respond in time, so we can't tell whether the email to kelly@venue\.example was sent/);
  assert.equal(result.success, undefined);
  assert.equal(first.emailCalls.length, 1, "no automatic resend");
  assert.equal(first.linkCalls.length, 1);
  assert.notEqual(fake.lifecycles[0].setup_link_claimed_at, null, "claim kept while the provider call may still complete");
  assert.deepEqual(fake.venueClaimNotes.map((n) => n.event_type), ["final_setup_email_unconfirmed"]);
  assert.doesNotMatch(JSON.stringify(fake.venueClaimNotes), new RegExp(TOKEN_HASH));

  clock = new Date(NOW.getTime() + 2 * 60_000);
  const second = deps(fake, { now: () => clock });
  assert.equal((await generateFinalSetupLinkImpl(originFor("claim"), second.d)).ok, false, "copy refused while the first email may still land");
  assert.equal(second.linkCalls.length, 0);

  clock = new Date(NOW.getTime() + 7 * 60_000);
  const third = deps(fake, { now: () => clock });
  const later = await generateFinalSetupLinkImpl(originFor("claim"), third.d);
  assert.equal(later.ok, true, "after the claim lifetime, a deliberate new link is allowed");
  neverResolves.resolve({ ok: true });
});

test("generateLink timeout: nothing sent, accurate message, claim kept (a link may still be issued in the background)", async () => {
  const fake = seed();
  const { d, emailCalls } = deps(fake, { timeoutsMs: { generateLink: 20 } });
  d.generateLink = (() => new Promise(() => {})) as typeof d.generateLink;
  const result = await sendFinalSetupEmailImpl(originFor("claim"), d);
  assert.match(result.error ?? "", /Supabase didn't respond in time, so nothing was sent/);
  assert.equal(emailCalls.length, 0);
  assert.equal(fake.venueClaimNotes.length, 0);
  assert.notEqual(fake.lifecycles[0].setup_link_claimed_at, null);
});

test("a returned provider failure is not ambiguous-in-flight: the claim is released so a deliberate retry (which warns about replacing earlier links) is possible", async () => {
  const fake = seed();
  const { d } = deps(fake, { emailOk: false });
  const result = await sendFinalSetupEmailImpl(originFor("claim"), d);
  assert.match(result.error ?? "", /may not have been sent/);
  assert.equal(fake.lifecycles[0].setup_link_claimed_at, null);
});
