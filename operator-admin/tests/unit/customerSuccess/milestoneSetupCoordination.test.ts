/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeDeliveryClient, makeFakeCsEventRow, type FakeVenueRow } from "./support/fakeDeliveryClient";
import { processCustomerSuccessDeliveries } from "../../../src/lib/customerSuccess/processCustomerSuccessDeliveries";
import { createSetupContactCoordinator } from "../../../src/lib/activation/setupContactStore";
import { SETUP_CONTACT_CLAIM_TTL_MS } from "../../../src/lib/activation/setupContactPolicy";
import { formatCustomerSuccessMilestoneNote } from "../../../src/lib/customerSuccess/customerSuccessMilestoneNotes";
import { createFakeOperatorsContactClient, makeOperatorContactRow, type FakeOperatorContactRow } from "../activation/support/fakeOperatorsContactClient";

/**
 * Milestone worker × setup-contact coordination (migration 104). The real
 * coordination store runs against a fake operators table; every email goes
 * to an injected spy.
 */

const NOW = new Date("2026-10-05T22:00:00.000Z"); // Mon 3:00 PM PDT
const H = 3600_000;
const MARKET = { id: "market-1", slug: "central-okanagan" };
const OWNER = { id: "m-1", operator_id: "op-1", role: "owner" as const, email: "gm@venue.example", full_name: "Jeremy GM", status: "active" as const };

function venue(id: string, overrides: Partial<FakeVenueRow> = {}): FakeVenueRow {
  return { id, is_published: true, is_verified: true, created_by_operator_id: "op-1", market_id: MARKET.id, name: `Venue ${id}`, ...overrides };
}

function world(opts: { operator?: Partial<FakeOperatorContactRow>; venues?: FakeVenueRow[]; events?: Parameters<typeof makeFakeCsEventRow>[0][] } = {}) {
  const venues = opts.venues ?? [venue("v-1")];
  const delivery = createFakeDeliveryClient({
    venues,
    markets: [MARKET],
    memberships: [OWNER],
    csBaselines: venues.map((v) => ({ id: `b-${v.id}`, venue_id: v.id, event_type: "venue_view_milestone", metric_value_at_baseline: 0 })),
    viewCounts: new Map(venues.map((v) => [v.id, 50])),
    csEvents: (opts.events ?? [{ id: "ev-1", venue_id: "v-1" }]).map((e) =>
      makeFakeCsEventRow({ operator_id: "op-1", milestone_value: 50, communication_status: "pending", next_attempt_at: new Date(NOW.getTime() - 60_000).toISOString(), ...e })
    ),
  });
  const ops = createFakeOperatorsContactClient([makeOperatorContactRow({ id: "op-1", email: "gm@venue.example", ...opts.operator })]);
  return { delivery, ops, coordinator: createSetupContactCoordinator(ops.client) };
}

function spy(results: { ok: boolean; id?: string; error?: string }[] = [{ ok: true, id: "re-1" }]) {
  const calls: any[] = [];
  let i = 0;
  const fn = async (p: any) => {
    calls.push(p);
    return results[Math.min(i++, results.length - 1)];
  };
  return { fn: fn as any, calls };
}

function withEnabledDelivery<T>(fn: () => Promise<T>): Promise<T> {
  const prior = process.env.CUSTOMER_SUCCESS_EMAILS_ENABLED;
  process.env.CUSTOMER_SUCCESS_EMAILS_ENABLED = "true";
  return fn().finally(() => {
    if (prior === undefined) delete process.env.CUSTOMER_SUCCESS_EMAILS_ENABLED;
    else process.env.CUSTOMER_SUCCESS_EMAILS_ENABLED = prior;
  });
}

async function run(w: ReturnType<typeof world>, s: ReturnType<typeof spy>, now = NOW, coordinationEnabled = true) {
  return withEnabledDelivery(() =>
    processCustomerSuccessDeliveries(w.delivery.client as never, now, s.fn, { coordinator: w.coordinator, coordinationEnabled })
  );
}

test("activated operator: standard celebration, no coordination even right after a setup email, no evidence written", async () => {
  const w = world({ operator: { account_activated_at: "2026-09-01T00:00:00Z", last_setup_contact_at: new Date(NOW.getTime() - H).toISOString() } });
  const s = spy();
  const result = await run(w, s);
  assert.equal(result.sent, 1);
  assert.doesNotMatch(s.calls[0].html, /finish-setup|Finish your setup/);
  assert.equal(w.ops.rows[0].last_milestone_contact_at, null);
  assert.equal(w.ops.rows[0].setup_contact_claimed_at, null);
});

test("incomplete operator, no recent contact: celebration + durable Finish-your-setup CTA, no token, variant locked, evidence recorded, claim released", async () => {
  const w = world();
  const s = spy();
  const result = await run(w, s);
  assert.equal(result.sent, 1);
  const { html, text, subject } = s.calls[0];
  assert.match(subject, /50 views/, "same celebratory subject");
  assert.match(html, /href="http:\/\/localhost:3000\/operator\/finish-setup"/);
  assert.match(html, /Finish your setup/);
  assert.match(text, /Finish your setup: http:\/\/localhost:3000\/operator\/finish-setup/);
  assert.doesNotMatch(html + text, /token_hash|type=recovery|\/auth\/v1\/verify/, "never a setup token");
  const ev = w.delivery.csEvents[0];
  assert.equal((ev.metadata_json as any).deliverySnapshot.variant, "incomplete_setup");
  assert.equal(w.ops.rows[0].last_milestone_contact_at, NOW.toISOString());
  assert.equal(w.ops.rows[0].setup_contact_claimed_at, null);
  const note = formatCustomerSuccessMilestoneNote(ev as any);
  assert.match(note?.note ?? "", /with a Finish your setup link/);
});

test("recent reminder (10 h ago): deferred to the first business-day 3 PM slot ≥ 48 h later — not an attempt, nothing locked, visible in the timeline", async () => {
  const contact = new Date(NOW.getTime() - 10 * H).toISOString(); // Mon 5 AM PDT
  const w = world({ operator: { last_setup_contact_at: contact, last_setup_contact_kind: "reminder" } });
  const s = spy();
  const result = await run(w, s);
  assert.equal(s.calls.length, 0);
  assert.equal(result.deferredForSetupContact, 1);
  assert.equal(result.attempted, 0);
  const ev = w.delivery.csEvents[0];
  assert.equal(ev.communication_status, "pending");
  assert.equal(ev.attempt_count, 0);
  assert.equal(ev.recipient_email, null, "no snapshot locked by a deferral");
  assert.equal(ev.next_attempt_at, "2026-10-07T22:00:00.000Z", "Wed 3 PM PDT (contact + 48 h = Wed 5 AM)");
  assert.equal((ev.metadata_json as any).coordination.lastDeferral.reason, "recent_setup_contact");
  assert.match(formatCustomerSuccessMilestoneNote(ev as any)?.note ?? "", /deferred to .* a setup email went to this operator .* Not a send attempt/);
  assert.equal(w.ops.rows[0].setup_contact_claimed_at, null);
});

test("recent Copy setup link pause defers too (reason: setup link copied)", async () => {
  const w = world({ operator: { last_setup_pause_at: new Date(NOW.getTime() - 2 * H).toISOString() } });
  const s = spy();
  await run(w, s);
  assert.equal(s.calls.length, 0);
  assert.equal((w.delivery.csEvents[0].metadata_json as any).coordination.lastDeferral.reason, "recent_setup_pause");
});

test("activation during deferral: the deferred milestone later sends the standard celebration", async () => {
  const w = world({ operator: { last_setup_contact_at: new Date(NOW.getTime() - 10 * H).toISOString(), last_setup_contact_kind: "reminder" } });
  await run(w, spy());
  w.ops.rows[0].account_activated_at = new Date(NOW.getTime() + H).toISOString();
  const s = spy();
  const later = new Date("2026-10-07T22:00:30.000Z");
  const result = await run(w, s, later);
  assert.equal(result.sent, 1);
  assert.doesNotMatch(s.calls[0].html, /finish-setup/);
});

test("ownership released during deferral: the milestone is skipped, never sent to the former owner", async () => {
  const w = world({ operator: { last_setup_contact_at: new Date(NOW.getTime() - 10 * H).toISOString() } });
  await run(w, spy());
  w.delivery.venues[0].created_by_operator_id = null;
  w.delivery.venues[0].is_verified = false;
  const s = spy();
  const result = await run(w, s, new Date("2026-10-07T22:00:30.000Z"));
  assert.equal(s.calls.length, 0);
  assert.equal(result.skippedOwnershipChanged, 1);
  assert.equal(w.delivery.csEvents[0].communication_status, "skipped");
});

test("deadline passing during deferral doesn't matter: an expired-but-owned operator still gets the incomplete-setup variant", async () => {
  const w = world({ operator: { last_setup_contact_at: "2026-10-01T22:01:07.000Z", last_setup_contact_kind: "reminder" } });
  const s = spy();
  await run(w, s);
  assert.match(s.calls[0].html, /finish-setup/);
});

test("reminder worker holds the operator claim: milestone waits for the next pass (no send, no attempt, no write)", async () => {
  const w = world({ operator: { setup_contact_claimed_at: new Date(NOW.getTime() - 5_000).toISOString(), setup_contact_claim_kind: "reminder" } });
  const s = spy();
  const result = await run(w, s);
  assert.equal(s.calls.length, 0);
  assert.equal(result.deferredForSetupContact, 1);
  const ev = w.delivery.csEvents[0];
  assert.equal(ev.attempt_count, 0);
  assert.equal(ev.next_attempt_at, new Date(NOW.getTime() - 60_000).toISOString(), "still due — picked up next pass");
});

test("a stale reminder claim (worker died mid-send) is treated as a possible setup email → milestone deferred", async () => {
  const w = world({ operator: { setup_contact_claimed_at: new Date(NOW.getTime() - SETUP_CONTACT_CLAIM_TTL_MS - 1000).toISOString(), setup_contact_claim_kind: "reminder" } });
  const s = spy();
  await run(w, s);
  assert.equal(s.calls.length, 0);
  assert.equal(w.delivery.csEvents[0].next_attempt_at, "2026-10-07T22:00:00.000Z");
});

test("definite provider rejection: no milestone evidence (a rejected milestone never defers or skips a reminder), claim released, retried with identical content", async () => {
  const w = world();
  const s = spy([{ ok: false, error: "The from address is not valid", deliveryUncertain: false } as any, { ok: true, id: "re-2" }]);
  const first = await run(w, s);
  assert.equal(first.retried, 1);
  assert.equal(w.ops.rows[0].last_milestone_contact_at, null);
  assert.equal(w.ops.rows[0].setup_contact_claimed_at, null);
  // The operator activates before the retry; a previous attempt might have
  // been accepted, so the retry keeps the locked template and idempotency key.
  w.ops.rows[0].account_activated_at = new Date(NOW.getTime() + 10 * 60_000).toISOString();
  const retryAt = new Date(w.delivery.csEvents[0].next_attempt_at!);
  await run(w, s, new Date(retryAt.getTime() + 1000));
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].html, s.calls[0].html, "identical content");
  assert.equal(s.calls[1].idempotencyKey, s.calls[0].idempotencyKey);
});

test("two venues of one incomplete operator in the same pass: one milestone sends, the other waits 48 h", async () => {
  const w = world({ venues: [venue("v-1"), venue("v-2")], events: [{ id: "ev-1", venue_id: "v-1" }, { id: "ev-2", venue_id: "v-2" }] });
  const s = spy();
  const result = await run(w, s);
  assert.equal(result.sent, 1);
  assert.equal(result.deferredForSetupContact, 1);
  const deferred = w.delivery.csEvents.find((e) => e.communication_status === "pending")!;
  assert.equal((deferred.metadata_json as any).coordination.lastDeferral.reason, "recent_milestone");
});

test("two venues of an ACTIVATED operator: both send — no restriction added for activated operators", async () => {
  const w = world({
    operator: { account_activated_at: "2026-09-01T00:00:00Z" },
    venues: [venue("v-1"), venue("v-2")],
    events: [{ id: "ev-1", venue_id: "v-1" }, { id: "ev-2", venue_id: "v-2" }],
  });
  const s = spy();
  const result = await run(w, s);
  assert.equal(result.sent, 2);
});

test("flag off: today's behaviour — standard template, no deferral despite a recent reminder — but milestone evidence is still collected", async () => {
  const w = world({ operator: { last_setup_contact_at: new Date(NOW.getTime() - H).toISOString() } });
  const s = spy();
  const result = await run(w, s, NOW, false);
  assert.equal(result.sent, 1);
  assert.doesNotMatch(s.calls[0].html, /finish-setup/);
  assert.equal((w.delivery.csEvents[0].metadata_json as any).deliverySnapshot.variant, undefined, "snapshot unchanged from today's shape");
  assert.equal(w.ops.rows[0].last_milestone_contact_at, NOW.toISOString());
});

test("uncertain provider failure (network error / 5xx): recorded as an UNCONFIRMED milestone — never 'sent' — and the claim is released only after that write", async () => {
  const w = world();
  const s = spy([{ ok: false, error: "fetch failed: socket hang up", deliveryUncertain: true } as any]);
  const result = await run(w, s);
  assert.equal(result.retried, 1);
  assert.equal(w.ops.rows[0].last_milestone_contact_at, NOW.toISOString());
  assert.equal(w.ops.rows[0].last_milestone_contact_status, "unconfirmed");
  assert.equal(w.ops.rows[0].setup_contact_claimed_at, null, "evidence safely written → claim released");
  assert.equal(w.delivery.csEvents[0].communication_status, "pending", "not marked sent");
  assert.notEqual(formatCustomerSuccessMilestoneNote(w.delivery.csEvents[0] as any)?.note, undefined);
  assert.doesNotMatch(formatCustomerSuccessMilestoneNote(w.delivery.csEvents[0] as any)?.note ?? "", /email sent/);
});

test("a failure with no classification is treated as uncertain (conservative)", async () => {
  const w = world();
  await run(w, spy([{ ok: false, error: "unknown" }]));
  assert.equal(w.ops.rows[0].last_milestone_contact_status, "unconfirmed");
});

test("if the evidence write fails after acceptance, the claim is NOT released — it goes stale and is folded in as a possible send", async () => {
  const w = world();
  const realRecord = w.coordinator.recordMilestone;
  w.coordinator.recordMilestone = async () => false;
  const s = spy();
  await run(w, s);
  assert.equal(s.calls.length, 1);
  assert.notEqual(w.ops.rows[0].setup_contact_claimed_at, null, "claim kept");
  assert.equal(w.ops.rows[0].setup_contact_claim_kind, "milestone");
  w.coordinator.recordMilestone = realRecord;
});
