import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideMilestone,
  decideReminder,
  setupContactKindForEmail,
  SETUP_CONTACT_SPACING_MS,
  SETUP_CONTACT_CLAIM_TTL_MS,
  type OperatorContactState,
} from "../../../src/lib/activation/setupContactPolicy";
import { createSetupContactCoordinator, recordSetupContactForRecipient } from "../../../src/lib/activation/setupContactStore";
import { recordSetupContactBeforeSend } from "../../../src/lib/activation/setupContactEvidence";
import { isSetupContactCoordinationEnabled } from "../../../src/lib/activation/setupContactConfig";
import { firstBusinessSlotAtOrAfter } from "../../../src/lib/customerSuccess/deliveryScheduling";
import { createFakeOperatorsContactClient, makeOperatorContactRow } from "./support/fakeOperatorsContactClient";

/** Setup-contact / milestone coordination: policy, persistence and evidence capture. */

const NOW = new Date("2026-10-05T22:00:00.000Z"); // Mon 3:00 PM PDT
const H = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

function state(overrides: Partial<OperatorContactState> = {}): OperatorContactState {
  return {
    operatorId: "op-1",
    activated: false,
    lastSetupContactAt: null,
    lastSetupContactKind: null,
    lastSetupPauseAt: null,
    lastMilestoneContactAt: null,
    lastMilestoneContactStatus: null,
    claimedAt: null,
    claimKind: null,
    ...overrides,
  };
}

// ── Policy ───────────────────────────────────────────────────────────────────

test("flag is fail-closed: only the literal 'true' enables coordination", () => {
  assert.equal(isSetupContactCoordinationEnabled({}), false);
  assert.equal(isSetupContactCoordinationEnabled({ SETUP_CONTACT_COORDINATION_ENABLED: "TRUE" }), false);
  assert.equal(isSetupContactCoordinationEnabled({ SETUP_CONTACT_COORDINATION_ENABLED: "true" }), true);
});

test("milestone: activated → standard, never coordinated (even right after a setup email)", () => {
  assert.deepEqual(decideMilestone(state({ activated: true, lastSetupContactAt: iso(-H) }), NOW), { action: "send", variant: "standard" });
});

test("milestone: incomplete with no recent contact → incomplete-setup variant", () => {
  assert.deepEqual(decideMilestone(state(), NOW), { action: "send", variant: "incomplete_setup" });
  assert.deepEqual(decideMilestone(state({ lastSetupContactAt: iso(-SETUP_CONTACT_SPACING_MS - 1) }), NOW), { action: "send", variant: "incomplete_setup" });
});

test("milestone: 48 h boundary is exact — 1 ms short defers, exactly 48 h sends", () => {
  const short = decideMilestone(state({ lastSetupContactAt: iso(-SETUP_CONTACT_SPACING_MS + 1), lastSetupContactKind: "reminder" }), NOW);
  assert.equal(short.action, "defer");
  const exact = decideMilestone(state({ lastSetupContactAt: iso(-SETUP_CONTACT_SPACING_MS) }), NOW);
  assert.equal(exact.action, "send");
});

test("milestone: the latest of setup email, Copy pause and another venue's milestone decides the deferral", () => {
  const d = decideMilestone(
    state({ lastSetupContactAt: iso(-30 * H), lastSetupContactKind: "reminder", lastSetupPauseAt: iso(-5 * H), lastMilestoneContactAt: iso(-20 * H) }),
    NOW
  );
  assert.equal(d.action, "defer");
  if (d.action !== "defer") return;
  assert.equal(d.reason, "recent_setup_pause");
  assert.equal(d.earliest.toISOString(), iso(-5 * H + SETUP_CONTACT_SPACING_MS));
  const viaMilestone = decideMilestone(state({ lastMilestoneContactAt: iso(-H) }), NOW);
  assert.equal(viaMilestone.action === "defer" && viaMilestone.reason, "recent_milestone");
});

test("milestone: a stale reminder claim (worker died mid-send) counts as an unconfirmed setup contact; an active claim is not evidence", () => {
  const stale = decideMilestone(state({ claimedAt: iso(-SETUP_CONTACT_CLAIM_TTL_MS - 1000), claimKind: "reminder" }), NOW);
  assert.equal(stale.action, "defer");
  assert.equal(stale.action === "defer" && stale.contactKind, "unconfirmed_setup_contact");
  assert.equal(decideMilestone(state({ claimedAt: iso(-1000), claimKind: "reminder" }), NOW).action, "send");
});

test("reminder: no recent milestone → send; within 48 h → defer to milestone + 48 h; reaching the deadline → skip", () => {
  const deadline = iso(10 * 24 * H);
  assert.deepEqual(decideReminder(state({ lastSetupContactAt: iso(-H) }), deadline, NOW), { action: "send" }, "setup contacts never defer reminders");
  const defer = decideReminder(state({ lastMilestoneContactAt: iso(-10 * H) }), deadline, NOW);
  assert.equal(defer.action, "defer");
  assert.equal(defer.action === "defer" && defer.until.toISOString(), iso(38 * H));
  const atDeadline = decideReminder(state({ lastMilestoneContactAt: iso(-10 * H) }), iso(38 * H), NOW);
  assert.equal(atDeadline.action, "skip", "until == deadline → skip, never send early");
  const justBefore = decideReminder(state({ lastMilestoneContactAt: iso(-10 * H) }), iso(38 * H + 1), NOW);
  assert.equal(justBefore.action, "defer");
  assert.equal(decideReminder(state({ lastMilestoneContactAt: iso(-SETUP_CONTACT_SPACING_MS) }), deadline, NOW).action, "send");
  const staleMilestoneClaim = decideReminder(state({ claimedAt: iso(-SETUP_CONTACT_CLAIM_TTL_MS - 1), claimKind: "milestone" }), deadline, NOW);
  assert.equal(staleMilestoneClaim.action, "defer", "an interrupted milestone send is treated as possibly delivered");
});

test("email types: setup contacts are classified; everything else (including milestones) is not", () => {
  assert.equal(setupContactKindForEmail("activation_reminder"), "reminder");
  assert.equal(setupContactKindForEmail("claim_approval"), "setup_email");
  assert.equal(setupContactKindForEmail("claim_approval", "founder_resend"), "founder_resend");
  assert.equal(setupContactKindForEmail("operator_activation", "recovery_redirect"), "operator_requested");
  assert.equal(setupContactKindForEmail("activation_final_setup"), "founder_final_resend");
  assert.equal(setupContactKindForEmail("operator_verification_code"), "operator_requested");
  assert.equal(setupContactKindForEmail("password_reset"), "operator_requested");
  assert.equal(setupContactKindForEmail("operator_setup_request"), "operator_requested");
  assert.equal(setupContactKindForEmail("customer_success_milestone"), null);
  assert.equal(setupContactKindForEmail("activation_expiry_founder_notification"), null);
});

test("business slot: same-day 3 PM when still ahead, else next business day; weekends skipped; DST-correct", () => {
  const tz = "America/Vancouver";
  // Wed 2026-10-07 10:00 PDT → same day 3 PM PDT
  assert.equal(firstBusinessSlotAtOrAfter(new Date("2026-10-07T17:00:00Z"), tz).toISOString(), "2026-10-07T22:00:00.000Z");
  // Exactly 3 PM counts
  assert.equal(firstBusinessSlotAtOrAfter(new Date("2026-10-07T22:00:00Z"), tz).toISOString(), "2026-10-07T22:00:00.000Z");
  // Fri 3:01 PM PDT → Mon 3 PM PDT
  assert.equal(firstBusinessSlotAtOrAfter(new Date("2026-10-02T22:01:07Z"), tz).toISOString(), "2026-10-05T22:00:00.000Z");
  // Across the Nov 1 DST change: Sat Oct 31 → Mon Nov 2 3 PM PST (23:00Z)
  assert.equal(firstBusinessSlotAtOrAfter(new Date("2026-10-31T18:00:00Z"), tz).toISOString(), "2026-11-02T23:00:00.000Z");
});

// ── Store (real code against a fake operators table) ─────────────────────────

for (const postgrestTimestamps of [false, true]) {
  test(`store (${postgrestTimestamps ? "PostgREST" : "ISO"} timestamps): only one of two concurrent claims wins; release clears only its own claim`, async () => {
    const fake = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-1" })], { postgrestTimestamps });
    const c = createSetupContactCoordinator(fake.client);
    const [a, b] = await Promise.all([c.claim("op-1", "milestone", NOW), c.claim("op-1", "reminder", NOW)]);
    assert.equal([a, b].filter(Boolean).length, 1);
    const winner = (a ?? b) as string;
    await c.release("op-1", "2020-01-01T00:00:00.000Z");
    assert.notEqual(fake.rows[0].setup_contact_claimed_at, null, "a different token never releases the claim");
    await c.release("op-1", winner);
    assert.equal(fake.rows[0].setup_contact_claimed_at, null);
  });
}

test("store: a stale claim is folded into evidence (conservatively) before a new claim replaces it", async () => {
  const stale = new Date(NOW.getTime() - SETUP_CONTACT_CLAIM_TTL_MS - 1000).toISOString();
  const fake = createFakeOperatorsContactClient([
    makeOperatorContactRow({ id: "op-m", setup_contact_claimed_at: stale, setup_contact_claim_kind: "milestone" }),
    makeOperatorContactRow({ id: "op-r", setup_contact_claimed_at: stale, setup_contact_claim_kind: "reminder" }),
  ]);
  const c = createSetupContactCoordinator(fake.client);
  assert.ok(await c.claim("op-m", "reminder", NOW));
  assert.equal(fake.rows[0].last_milestone_contact_at, stale);
  assert.ok(await c.claim("op-r", "milestone", NOW));
  assert.equal(fake.rows[1].last_setup_contact_at, stale);
  assert.equal(fake.rows[1].last_setup_contact_kind, "unconfirmed_setup_contact");
  assert.equal(fake.rows[0].last_milestone_contact_status, "unconfirmed", "a folded milestone claim is never labelled accepted");
});

test("store: evidence only moves forward and only for unactivated operators", async () => {
  const fake = createFakeOperatorsContactClient([
    makeOperatorContactRow({ id: "op-1", email: "owner@venue.example", last_setup_contact_at: iso(-H), last_setup_contact_kind: "reminder" }),
    makeOperatorContactRow({ id: "op-act", email: "active@venue.example", account_activated_at: iso(-100 * H) }),
  ]);
  assert.equal(await recordSetupContactForRecipient(fake.client, { recipientEmail: "Owner@Venue.example", kind: "operator_requested", at: new Date(NOW.getTime() - 2 * H) }), "not_newer");
  assert.equal(await recordSetupContactForRecipient(fake.client, { recipientEmail: "owner@venue.example", kind: "founder_resend", at: NOW }), "written");
  assert.equal(fake.rows[0].last_setup_contact_kind, "founder_resend");
  assert.equal(await recordSetupContactForRecipient(fake.client, { recipientEmail: "active@venue.example", kind: "operator_requested", at: NOW }), "no_match");
  assert.equal(await recordSetupContactForRecipient(fake.client, { recipientEmail: "consumer@example.com", kind: "operator_requested", at: NOW }), "no_match");
  assert.equal(await createSetupContactCoordinator(fake.client).recordPause("op-1", NOW), true);
  assert.equal(fake.rows[0].last_setup_pause_at, NOW.toISOString());
  assert.equal(fake.rows[0].last_setup_contact_at, NOW.toISOString(), "a pause never overwrites email evidence");
  await createSetupContactCoordinator(fake.client).recordMilestone("op-act", NOW, "accepted");
  assert.equal(fake.rows[1].last_milestone_contact_at, null, "activated operators get no milestone evidence");
});

test("store: recorders never throw on database errors", async () => {
  const fake = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-1" })], { failReads: true });
  assert.equal(await recordSetupContactForRecipient(fake.client, { recipientEmail: "x@y.z", kind: "reminder", at: NOW }), "error");
  const c = createSetupContactCoordinator(fake.client);
  assert.equal(await c.recordPause("op-1", NOW), false, "write failure is reported so the caller keeps its claim");
  assert.equal(await c.recordMilestone("op-1", NOW, "accepted"), false);
  assert.equal(await c.recordSetupContact("op-1", "reminder", NOW), false);
});

// ── Evidence hook used by sendTransactionalEmail ─────────────────────────────

test("evidence hook: records setup emails before sending, ignores other types, and no-ops without credentials", async () => {
  const fake = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-1", email: "owner@venue.example" })]);
  assert.equal(await recordSetupContactBeforeSend({ emailType: "activation_reminder", to: "owner@venue.example" }, { admin: fake.client, now: () => NOW }), "recorded");
  assert.equal(fake.rows[0].last_setup_contact_kind, "reminder");
  assert.equal(await recordSetupContactBeforeSend({ emailType: "customer_success_milestone", to: "owner@venue.example" }, { admin: fake.client, now: () => NOW }), "skipped");
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    assert.equal(await recordSetupContactBeforeSend({ emailType: "activation_reminder", to: "owner@venue.example" }), "skipped");
  } finally {
    if (saved.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key !== undefined) process.env.SUPABASE_SECRET_KEY = saved.key;
  }
});

test("evidence hook is bounded: a hung database never delays the send beyond the timeout", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hung: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) };
  const started = Date.now();
  assert.equal(await recordSetupContactBeforeSend({ emailType: "activation_reminder", to: "a@b.c" }, { admin: hung, timeoutMs: 30 }), "skipped");
  assert.ok(Date.now() - started < 1000);
});

test("store: founder claims fold by kind — a stale resend claim becomes an unconfirmed setup contact, a stale copy claim a pause", async () => {
  const stale = new Date(NOW.getTime() - SETUP_CONTACT_CLAIM_TTL_MS - 1000).toISOString();
  const fake = createFakeOperatorsContactClient([
    makeOperatorContactRow({ id: "op-r", setup_contact_claimed_at: stale, setup_contact_claim_kind: "founder_resend" }),
    makeOperatorContactRow({ id: "op-c", setup_contact_claimed_at: stale, setup_contact_claim_kind: "founder_copy" }),
  ]);
  const c = createSetupContactCoordinator(fake.client);
  assert.ok(await c.claim("op-r", "milestone", NOW));
  assert.equal(fake.rows[0].last_setup_contact_kind, "unconfirmed_setup_contact");
  assert.ok(await c.claim("op-c", "milestone", NOW));
  assert.equal(fake.rows[1].last_setup_pause_at, stale);
  assert.equal(fake.rows[1].last_setup_contact_at, null, "a copied link is never recorded as an email");
});

test("store: an old request never clears a newer claim — after a stale takeover the old holder's release is a no-op", async () => {
  const fake = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-1" })], { postgrestTimestamps: true });
  const c = createSetupContactCoordinator(fake.client);
  const oldToken = await c.claim("op-1", "milestone", NOW);
  assert.ok(oldToken);
  const later = new Date(NOW.getTime() + SETUP_CONTACT_CLAIM_TTL_MS + 1000);
  const newToken = await c.claim("op-1", "reminder", later);
  assert.ok(newToken, "stale claim taken over");
  await c.release("op-1", oldToken!);
  assert.equal(new Date(fake.rows[0].setup_contact_claimed_at!).getTime(), later.getTime(), "newer claim intact");
  assert.equal(fake.rows[0].setup_contact_claim_kind, "reminder");
  assert.equal(fake.rows[0].last_milestone_contact_status, "unconfirmed", "the old holder's possible send was folded in");
});

test("send failures: only definite provider rejections are 'nothing was sent'; network errors, 5xx, unknown errors and idempotency mismatches are uncertain", async () => {
  const { isDeliveryUncertain } = await import("../../../src/lib/emailTracking/trackedSend");
  for (const name of ["validation_error", "invalid_from_address", "rate_limit_exceeded", "daily_quota_exceeded", "invalid_api_key"]) {
    assert.equal(isDeliveryUncertain(name), false, name);
  }
  for (const name of [undefined, "", "application_error", "internal_server_error", "invalid_idempotent_request", "something_new"]) {
    assert.equal(isDeliveryUncertain(name), true, String(name));
  }
});
