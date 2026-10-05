/* eslint-disable @typescript-eslint/no-explicit-any -- injected test doubles */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadSetupFollowUps,
  resolveVenueSetupSource,
  summarizeSetupFollowUp,
  type SetupLifecycleFacts,
  type SetupNoteFact,
  type SourceResolution,
} from "../../../src/lib/data/venueFunnelSetupFollowUp";
import { computeStageDue } from "../../../src/lib/activation/activationReminderPolicy";
import { formatDate, formatDateTime } from "../../../src/lib/controlPanelDateTime";

const NOW = new Date("2026-10-05T18:00:00.000Z");
const DEADLINE = "2026-10-12T20:00:00.000Z"; // stage 1 due Oct 1, 2 due Oct 5, 3 due Oct 10
const LC = "11111111-1111-4111-8111-111111111111";

function lifecycle(over: Partial<SetupLifecycleFacts> = {}): SetupLifecycleFacts {
  return {
    id: LC,
    operatorId: "op-1",
    originType: "claim",
    originClaimId: "claim-1",
    originSubmissionId: null,
    startedAt: "2026-09-28T20:00:00.000Z",
    deadlineAt: DEADLINE,
    expiredAt: null,
    releasedAt: null,
    reminderStage: 0,
    nextAttemptAt: computeStageDue(1, DEADLINE),
    attemptCount: 0,
    lastError: null,
    leaseStartedAt: null,
    ...over,
  };
}

const sent = (stage: number, lifecycleId: string | null = LC): SetupNoteFact => ({ eventType: "reminder_sent", createdAt: "2026-10-01T20:00:00.000Z", lifecycleId, stage, deferredUntil: null, linkExpiresAt: null });
const note = (eventType: string, over: Partial<SetupNoteFact> = {}): SetupNoteFact => ({ eventType, createdAt: "2026-10-03T20:00:00.000Z", lifecycleId: LC, stage: null, deferredUntil: null, linkExpiresAt: null, ...over });
const res = (l: SetupLifecycleFacts): SourceResolution => ({ kind: "lifecycle", lifecycle: l, source: { kind: "claim", id: "claim-1", url: "/control-panel/claims/claim-1" } });
const summarize = (l: SetupLifecycleFacts, notes: SetupNoteFact[] = []) => summarizeSetupFollowUp({ resolution: res(l), notes, accountActivatedAt: null }, NOW);

// ── Reminder progress ─────────────────────────────────────────────────────────

test("normal progress: counts only reminder_sent notes and names the next scheduled stage with its date", () => {
  const next = computeStageDue(3, DEADLINE);
  const s = summarize(lifecycle({ reminderStage: 2, nextAttemptAt: next }), [sent(1), sent(2)]);
  assert.equal(s.headline, "2 of 3 reminders sent");
  assert.deepEqual(s.lines, [`Final reminder due ${formatDate(next)}`, `Setup deadline ${formatDate(DEADLINE)}`]);
  assert.equal(s.tone, "info");
  assert.equal(s.source?.url, "/control-panel/claims/claim-1");
});

test("reminder_stage is never read as a sent count: a catch-up that resolved stages 1–2 with one email shows 1 sent", () => {
  const s = summarize(lifecycle({ reminderStage: 2, nextAttemptAt: computeStageDue(3, DEADLINE) }), [sent(2)]);
  assert.equal(s.headline, "1 of 3 reminders sent");
});

test("attempted/pre-send contact never counts as sent: failed attempts and notes without a reminder_sent produce 0 sent", () => {
  const s = summarize(lifecycle({ reminderStage: 0, nextAttemptAt: "2026-10-05T19:00:00.000Z", attemptCount: 1, lastError: "provider 503" }), [note("reminder_delivery_failed", { stage: 1 })]);
  assert.equal(s.headline, "0 of 3 reminders sent");
  assert.match(s.lines[0], /^Reminder 1 attempt unsuccessful or unconfirmed · retry /, "never 'failed' or 'not delivered' (stage 1 is the one overdue at the retry time)");
  assert.ok(s.lines[0].endsWith(formatDateTime("2026-10-05T19:00:00.000Z")));
});

test("all three sent and nothing left: 'All 3 reminders sent · Awaiting setup'", () => {
  const s = summarize(lifecycle({ reminderStage: 3, nextAttemptAt: null }), [sent(1), sent(2), sent(3)]);
  assert.equal(s.headline, "All 3 reminders sent · Awaiting setup");
  assert.deepEqual(s.lines, [`Setup deadline ${formatDate(DEADLINE)}`]);
});

test("a skipped stage is shown as skipped (recorded), never counted as sent", () => {
  const s = summarize(lifecycle({ reminderStage: 3, nextAttemptAt: null }), [sent(1), sent(2), note("reminder_skipped", { stage: 3 })]);
  assert.equal(s.headline, "2 of 3 reminders sent · none left · Awaiting setup");
  assert.ok(s.lines.includes("Final reminder skipped (milestone spacing)"));
});

test("a deferral is shown only when a reminder_deferred note matches the scheduled attempt — never inferred", () => {
  const until = "2026-10-10T22:00:00.000Z";
  const deferred = summarize(lifecycle({ reminderStage: 2, nextAttemptAt: until }), [sent(1), sent(2), note("reminder_deferred", { stage: 3, deferredUntil: until })]);
  assert.equal(deferred.lines[0], `Final reminder deferred to ${formatDateTime(until)} (milestone spacing)`);

  const stale = summarize(lifecycle({ reminderStage: 2, nextAttemptAt: computeStageDue(3, DEADLINE) }), [sent(1), sent(2), note("reminder_deferred", { stage: 3, deferredUntil: until })]);
  assert.match(stale.lines[0], /^Final reminder due /, "an old deferral that no longer matches the schedule isn't shown");
});

test("a reminder being sent right now, an unscheduled lifecycle, and an exhausted final stage each say so", () => {
  assert.equal(summarize(lifecycle({ reminderStage: 1, nextAttemptAt: computeStageDue(2, DEADLINE), leaseStartedAt: "2026-10-05T17:59:00.000Z" }), [sent(1)]).lines[0], "Reminder 2 sending now");
  assert.equal(summarize(lifecycle({ reminderStage: 0, nextAttemptAt: null })).lines[0], "Reminders not scheduled yet");
  assert.equal(summarize(lifecycle({ reminderStage: 2, nextAttemptAt: null, lastError: "rejected" }), [sent(1), sent(2)]).lines[0], "Final reminder attempt unsuccessful or unconfirmed · no retry scheduled");
});

test("attempt wording: always 'unsuccessful or unconfirmed' (the evidence can't separate rejection from uncertainty); a retry date only when a retry is scheduled", () => {
  const failedNote = (stage: number) => note("reminder_delivery_failed", { stage });
  // Retry scheduled → dated.
  const retry = summarize(lifecycle({ reminderStage: 1, nextAttemptAt: "2026-10-05T19:00:00.000Z", attemptCount: 2, lastError: "timeout" }), [sent(1), failedNote(2)]);
  assert.equal(retry.lines[0], `Reminder 2 attempt unsuccessful or unconfirmed · retry ${formatDateTime("2026-10-05T19:00:00.000Z")}`);

  // A deferral owns the schedule after an unsuccessful attempt → no retry date for it.
  const until = "2026-10-10T22:00:00.000Z";
  const deferredAfterFailure = summarize(
    lifecycle({ reminderStage: 2, nextAttemptAt: until, attemptCount: 1, lastError: "timeout" }),
    [sent(1), sent(2), failedNote(3), note("reminder_deferred", { stage: 3, deferredUntil: until })]
  );
  assert.equal(deferredAfterFailure.lines[0], `Final reminder deferred to ${formatDateTime(until)} (milestone spacing)`);
  assert.equal(deferredAfterFailure.lines[1], "Final reminder attempt unsuccessful or unconfirmed");
  assert.doesNotMatch(deferredAfterFailure.lines.join(" "), /retry/);

  // Stage 2 ran out of attempts and the schedule moved on to stage 3 → "not retried", no date.
  const exhausted = summarize(lifecycle({ reminderStage: 1, nextAttemptAt: computeStageDue(3, DEADLINE), attemptCount: 0, lastError: "rejected" }), [sent(1), failedNote(2), failedNote(2)]);
  assert.equal(exhausted.lines[0], `Final reminder due ${formatDate(computeStageDue(3, DEADLINE))}`);
  assert.equal(exhausted.lines[1], "Reminder 2 attempt unsuccessful or unconfirmed · not retried");

  // A later successful send of that stage clears it.
  assert.equal(summarize(lifecycle({ reminderStage: 2, nextAttemptAt: computeStageDue(3, DEADLINE) }), [sent(1), failedNote(2), sent(2)]).lines.length, 2);

  // Nothing anywhere says "failed".
  for (const x of [retry, deferredAfterFailure, exhausted]) assert.doesNotMatch(`${x.headline} ${x.lines.join(" ")}`, /\bfailed\b/i);
});

test("the window ending in < 48 h raises the tone to attention", () => {
  const soon = "2026-10-06T12:00:00.000Z";
  assert.equal(summarize(lifecycle({ deadlineAt: soon, reminderStage: 3, nextAttemptAt: null }), [sent(3)]).tone, "attention");
});

// ── Expired windows and founder follow-up ─────────────────────────────────────

test("expired window: founder follow-up headline; the setup deadline and a later recovery-link expiry are separate facts", () => {
  const expired = lifecycle({ deadlineAt: "2026-10-02T23:41:30.607Z", expiredAt: "2026-10-03T00:00:40.764Z", reminderStage: 3, nextAttemptAt: null });
  const none = summarize(expired, [sent(1), sent(2), sent(3)]);
  assert.equal(none.headline, "Setup window expired · Founder follow-up");
  assert.deepEqual(none.lines, [`3 of 3 reminders sent · deadline passed ${formatDate("2026-10-02T23:41:30.607Z")}`, "No founder follow-up recorded yet"]);
  assert.equal(none.tone, "attention");

  const linkExpires = "2026-10-06T16:00:00.000Z";
  const followed = summarize(expired, [sent(1), sent(2), sent(3), note("final_setup_email_sent", { createdAt: "2026-10-05T16:00:00.000Z", linkExpiresAt: linkExpires })]);
  assert.equal(followed.lines[1], `Final setup email sent ${formatDate("2026-10-05T16:00:00.000Z")} · link expires ${formatDateTime(linkExpires)}`);

  const lapsed = summarize(expired, [note("final_setup_link_generated", { createdAt: "2026-10-03T16:00:00.000Z", linkExpiresAt: "2026-10-04T16:00:00.000Z" })]);
  assert.match(lapsed.lines[1], /^Setup link copied .* · link expired /);
});

test("deadline passed but not yet stamped expired (release required) reads the same as expired", () => {
  const s = summarize(lifecycle({ deadlineAt: "2026-10-04T00:00:00.000Z", reminderStage: 3, nextAttemptAt: null }), [sent(3)]);
  assert.equal(s.headline, "Setup window expired · Founder follow-up");
});

test("notes from another lifecycle on the same record are ignored", () => {
  const s = summarize(lifecycle({ reminderStage: 1, nextAttemptAt: computeStageDue(2, DEADLINE) }), [sent(1), sent(2, "22222222-2222-4222-8222-222222222222"), sent(3, "22222222-2222-4222-8222-222222222222")]);
  assert.equal(s.headline, "1 of 3 reminders sent");
});

// ── Missing / unclear lifecycle data ──────────────────────────────────────────

test("missing lifecycle data is explicit — no invented progress; an unclear source shows no link", () => {
  const none = summarizeSetupFollowUp({ resolution: { kind: "none" }, notes: [], accountActivatedAt: null }, NOW);
  assert.deepEqual(none, { headline: "Setup reminders not tracked", lines: ["No activation window recorded for this setup"], tone: "muted", source: null });

  const record = summarizeSetupFollowUp({ resolution: { kind: "record", source: { kind: "submission", id: "sub-1", url: "/control-panel/operator-submissions/sub-1" } }, notes: [sent(1)], accountActivatedAt: null }, NOW);
  assert.equal(record.headline, "Setup reminders not tracked", "a record without a lifecycle never shows reminder progress");
  assert.equal(record.source?.url, "/control-panel/operator-submissions/sub-1");

  const unclear = summarizeSetupFollowUp({ resolution: { kind: "ambiguous" }, notes: [], accountActivatedAt: null }, NOW);
  assert.equal(unclear.headline, "Setup record unclear");
  assert.equal(unclear.source, null);
});

// ── Claim / submission association ────────────────────────────────────────────

const claim = (id: string, venueId: string, status = "approved", email = "gm@venue.example") => ({ id, venueId, email, status });
const submission = (id: string, venueId: string | null, operatorId: string | null, status = "confirmed_auto") => ({ id, venueId, operatorId, status });
const base = { venueId: "v-1", operatorId: "op-1", operatorEmail: "GM@venue.example" };

test("source = the origin of the operator's lifecycle for THIS venue (claim or submission)", () => {
  const viaClaim = resolveVenueSetupSource({ ...base, lifecycles: [lifecycle()], claims: [claim("claim-1", "v-1")], submissions: [] });
  assert.equal(viaClaim.kind, "lifecycle");
  assert.deepEqual(viaClaim.kind === "lifecycle" && viaClaim.source, { kind: "claim", id: "claim-1", url: "/control-panel/claims/claim-1" });

  const viaSubmission = resolveVenueSetupSource({
    ...base,
    lifecycles: [lifecycle({ originType: "submission", originClaimId: null, originSubmissionId: "sub-1" })],
    claims: [],
    submissions: [submission("sub-1", "v-1", "op-1")],
  });
  assert.deepEqual(viaSubmission.kind === "lifecycle" && viaSubmission.source, { kind: "submission", id: "sub-1", url: "/control-panel/operator-submissions/sub-1" });
});

test("a lifecycle for another venue or another operator is never used", () => {
  const otherVenue = resolveVenueSetupSource({ ...base, lifecycles: [lifecycle({ originClaimId: "claim-x" })], claims: [claim("claim-1", "v-1", "rejected")], submissions: [] });
  assert.equal(otherVenue.kind, "none");
  const otherOperator = resolveVenueSetupSource({ ...base, lifecycles: [lifecycle({ operatorId: "op-2" })], claims: [claim("claim-1", "v-1", "approved", "someone@else.example")], submissions: [] });
  assert.equal(otherOperator.kind, "none");
});

test("several lifecycles for this venue: the single unreleased one wins; otherwise unclear — never 'the newest'", () => {
  const released = lifecycle({ id: "lc-old", originClaimId: "claim-old", releasedAt: "2026-09-20T00:00:00.000Z", startedAt: "2026-09-25T00:00:00.000Z" });
  const current = lifecycle({ id: "lc-new", originClaimId: "claim-1", startedAt: "2026-09-01T00:00:00.000Z" });
  const r = resolveVenueSetupSource({ ...base, lifecycles: [released, current], claims: [claim("claim-old", "v-1"), claim("claim-1", "v-1")], submissions: [] });
  assert.equal(r.kind === "lifecycle" && r.lifecycle.id, "lc-new");

  const two = resolveVenueSetupSource({ ...base, lifecycles: [current, lifecycle({ id: "lc-2", originClaimId: "claim-2" })], claims: [claim("claim-1", "v-1"), claim("claim-2", "v-1")], submissions: [] });
  assert.equal(two.kind, "ambiguous");
});

test("no lifecycle: exactly one approved claim/submission tying this operator to this venue; both or neither are handled honestly", () => {
  assert.equal(resolveVenueSetupSource({ ...base, lifecycles: [], claims: [claim("claim-1", "v-1")], submissions: [] }).kind, "record");
  assert.equal(resolveVenueSetupSource({ ...base, lifecycles: [], claims: [claim("claim-1", "v-1", "pending")], submissions: [] }).kind, "none", "an unapproved claim isn't the setup source");
  assert.equal(resolveVenueSetupSource({ ...base, lifecycles: [], claims: [claim("claim-1", "v-1", "approved", "other@x.example")], submissions: [] }).kind, "none", "someone else's claim isn't this operator's setup");
  assert.equal(resolveVenueSetupSource({ ...base, lifecycles: [], claims: [claim("claim-1", "v-1")], submissions: [submission("sub-1", "v-1", "op-1")] }).kind, "ambiguous");
  assert.equal(resolveVenueSetupSource({ ...base, lifecycles: [], claims: [], submissions: [] }).kind, "none");
});

// ── Batched loader ────────────────────────────────────────────────────────────

function fakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  const calls: string[] = [];
  const client: any = {
    from(table: string) {
      calls.push(table);
      const filters: [string, unknown[]][] = [];
      const b: any = {
        select: () => b,
        in: (col: string, vals: unknown[]) => {
          filters.push([col, vals]);
          return b;
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: (tables[table] ?? []).filter((r) => filters.every(([c, v]) => v.includes(r[c]))), error: null }).then(resolve),
      };
      return b;
    },
  };
  return { client, calls };
}

test("loader: a fixed number of batched reads for any number of cards, notes only for resolved sources", async () => {
  const venues = Array.from({ length: 12 }, (_, i) => ({ venueId: `v-${i}`, operatorId: `op-${i}`, operatorEmail: `gm${i}@x.example`, accountActivatedAt: null }));
  const lifecycles = venues.map((v, i) => ({
    id: `lc-${i}`, operator_id: v.operatorId, origin_type: "claim", origin_claim_id: `claim-${i}`, origin_submission_id: null,
    started_at: "2026-09-28T20:00:00.000Z", deadline_at: DEADLINE, expired_at: null, released_at: null,
    reminder_stage: 1, reminder_next_attempt_at: computeStageDue(2, DEADLINE), reminder_attempt_count: 0, reminder_last_error: null, reminder_lease_started_at: null,
  }));
  const { client, calls } = fakeSupabase({
    operator_activation_lifecycles: lifecycles,
    venue_claims: venues.map((v, i) => ({ id: `claim-${i}`, venue_id: v.venueId, email: v.operatorEmail, status: "approved" })),
    operator_submissions: [],
    venue_claim_notes: venues.map((_, i) => ({ claim_id: `claim-${i}`, event_type: "reminder_sent", created_at: "2026-10-01T20:00:00.000Z", metadata_json: { lifecycleId: `lc-${i}`, stage: 1 } })),
  });
  const out = await loadSetupFollowUps(client, venues, NOW);
  assert.equal(out.size, 12);
  assert.equal(out.get("v-7")?.headline, "1 of 3 reminders sent");
  assert.equal(out.get("v-7")?.source?.url, "/control-panel/claims/claim-7");
  assert.equal(calls.length, 4, `batched, not per card: ${calls.join(", ")}`);
  assert.deepEqual([...new Set(calls)].sort(), ["operator_activation_lifecycles", "operator_submissions", "venue_claim_notes", "venue_claims"]);
});

test("loader: no cards → no reads; a read error → no summaries (never a guess)", async () => {
  const { client, calls } = fakeSupabase({});
  assert.equal((await loadSetupFollowUps(client, [], NOW)).size, 0);
  assert.equal(calls.length, 0);
  const broken: any = { from: () => { const b: any = { select: () => b, in: () => b, then: (r: any) => Promise.resolve({ data: null, error: { message: "down" } }).then(r) }; return b; } };
  const err = console.error;
  console.error = () => {};
  try {
    assert.equal((await loadSetupFollowUps(broken, [{ venueId: "v", operatorId: "o", operatorEmail: null, accountActivatedAt: null }], NOW)).size, 0);
  } finally {
    console.error = err;
  }
});

// ── Wiring: only the Stalled lane, no setup links/tokens ──────────────────────

test("only Setup Stalled / No Response cards get a follow-up; the summary never carries a setup link or token", () => {
  const root = join(__dirname, "../../..");
  const funnel = readFileSync(join(root, "src/lib/data/venueFunnel.ts"), "utf8");
  assert.match(funnel, /\.filter\(\(c\) => c\.laneKey === "setup_stalled"\)/);
  assert.equal((funnel.match(/setupFollowUp: null,/g) ?? []).length, 3, "claim, submission and venue cards default to none");
  const mod = readFileSync(join(root, "src/lib/data/venueFunnelSetupFollowUp.ts"), "utf8");
  assert.doesNotMatch(mod, /generateLink|token_hash|action_link|create-password/);
  const board = readFileSync(join(root, "src/app/control-panel/venue-funnel/VenueFunnelBoard.tsx"), "utf8");
  assert.match(board, /\{card\.setupFollowUp && <SetupFollowUpBlock/);
});
