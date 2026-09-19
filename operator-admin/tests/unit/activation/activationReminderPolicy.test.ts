import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStageDue,
  computeInitialNextAttempt,
  computeExtensionResolution,
  selectCatchUpStage,
  reminderIdempotencyKey,
  reminderEventKey,
  expiryEventKey,
  expiryFounderEmailIdempotencyKey,
  REMINDER_STAGE_MIN,
  REMINDER_STAGE_MAX,
} from "../../../src/lib/activation/activationReminderPolicy";

/**
 * Pure-function behavioral tests for the Phase 2A-2 reminder/expiry policy
 * layer. No I/O anywhere in this file — every function under test is
 * deterministic given its inputs, matching the module's own header
 * guarantee ("no Supabase, no email, no Slack").
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEADLINE = "2026-10-02T23:41:30.607Z"; // Kelly's real deadline_at

// ── computeStageDue: exact deadline-relative math ───────────────────────────

test("computeStageDue: stage 1 = deadline - 11 days", () => {
  assert.equal(computeStageDue(1, DEADLINE), "2026-09-21T23:41:30.607Z");
});

test("computeStageDue: stage 2 = deadline - 7 days", () => {
  assert.equal(computeStageDue(2, DEADLINE), "2026-09-25T23:41:30.607Z");
});

test("computeStageDue: stage 3 = deadline - 2 days", () => {
  assert.equal(computeStageDue(3, DEADLINE), "2026-09-30T23:41:30.607Z");
});

test("computeStageDue: rejects an invalid stage number", () => {
  // @ts-expect-error -- deliberately invalid input to exercise the defensive runtime check
  assert.throws(() => computeStageDue(0, DEADLINE), /invalid stage/);
  // @ts-expect-error -- deliberately invalid input to exercise the defensive runtime check
  assert.throws(() => computeStageDue(4, DEADLINE), /invalid stage/);
});

// ── computeInitialNextAttempt: lazy-init, no obsolete-skip walk ─────────────

test("computeInitialNextAttempt: stage 0 → stage 1's raw due time, even if in the past (no skip walk here)", () => {
  const farPastDeadline = "2020-01-15T00:00:00.000Z";
  assert.equal(computeInitialNextAttempt(0, farPastDeadline), computeStageDue(1, farPastDeadline));
});

test("computeInitialNextAttempt: stage 2 → stage 3's due time", () => {
  assert.equal(computeInitialNextAttempt(2, DEADLINE), computeStageDue(3, DEADLINE));
});

test("computeInitialNextAttempt: stage 3 → null, no further automatic reminders", () => {
  assert.equal(computeInitialNextAttempt(3, DEADLINE), null);
});

test("computeInitialNextAttempt: Kelly's real row today — future stage-1 due time, not yet due", () => {
  const next = computeInitialNextAttempt(0, DEADLINE);
  assert.equal(next, "2026-09-21T23:41:30.607Z");
  assert.ok(new Date(next!).getTime() > Date.parse("2026-09-19T00:00:00.000Z"));
});

test("computeInitialNextAttempt: rejects an invalid reminder stage", () => {
  assert.throws(() => computeInitialNextAttempt(-1, DEADLINE), /invalid reminder stage/);
  assert.throws(() => computeInitialNextAttempt(4, DEADLINE), /invalid reminder stage/);
});

// ── computeExtensionResolution: obsolete-stage skip walk ────────────────────

test("computeExtensionResolution: stage 0, new deadline far future — nothing obsolete, stage stays 0", () => {
  const newDeadline = new Date(Date.now() + 30 * MS_PER_DAY).toISOString();
  const now = new Date().toISOString();
  const result = computeExtensionResolution(0, newDeadline, now);
  assert.equal(result.resolvedStage, 0);
  assert.equal(result.nextAttemptAt, computeStageDue(1, newDeadline));
});

test("computeExtensionResolution: stage 1 preserved, never re-resolved", () => {
  const newDeadline = new Date(Date.now() + 12 * MS_PER_DAY).toISOString();
  const now = new Date().toISOString();
  const result = computeExtensionResolution(1, newDeadline, now);
  assert.equal(result.resolvedStage, 1);
  assert.equal(result.nextAttemptAt, computeStageDue(2, newDeadline));
});

test("computeExtensionResolution: stage 3 already resolved — stays 3, next attempt is null regardless of new deadline", () => {
  const newDeadline = new Date(Date.now() + 100 * MS_PER_DAY).toISOString();
  const result = computeExtensionResolution(3, newDeadline, new Date().toISOString());
  assert.equal(result.resolvedStage, 3);
  assert.equal(result.nextAttemptAt, null);
});

test("computeExtensionResolution: overdue stage-0 reopened 7 days — resolves to stage 2, schedules stage 3 five days later", () => {
  const tx = Date.now();
  const newDeadline = new Date(tx + 7 * MS_PER_DAY).toISOString();
  const result = computeExtensionResolution(0, newDeadline, new Date(tx).toISOString());
  // stage1 due = newDeadline-11d = tx-4d (past, obsolete)
  // stage2 due = newDeadline-7d  = tx (boundary, inclusive <=, obsolete)
  // stage3 due = newDeadline-2d  = tx+5d (future, scheduled)
  assert.equal(result.resolvedStage, 2);
  assert.equal(result.nextAttemptAt, computeStageDue(3, newDeadline));
  assert.equal(result.nextAttemptAt, new Date(tx + 5 * MS_PER_DAY).toISOString());
});

test("computeExtensionResolution: expired stage-3 lifecycle reopened — stays 3, no automatic reminder", () => {
  const tx = Date.now();
  const newDeadline = new Date(tx + 7 * MS_PER_DAY).toISOString();
  const result = computeExtensionResolution(3, newDeadline, new Date(tx).toISOString());
  assert.equal(result.resolvedStage, 3);
  assert.equal(result.nextAttemptAt, null);
});

test("computeExtensionResolution: rejects an invalid reminder stage", () => {
  assert.throws(() => computeExtensionResolution(5, DEADLINE, new Date().toISOString()), /invalid reminder stage/);
});

// ── selectCatchUpStage: single-send-only catch-up selection ─────────────────

test("selectCatchUpStage: expiry takes precedence — deadline already passed, no reminder is selected", () => {
  const pastDeadline = new Date(Date.now() - MS_PER_DAY).toISOString();
  assert.equal(selectCatchUpStage(0, pastDeadline, new Date().toISOString()), null);
});

test("selectCatchUpStage: deadline exactly now (inclusive boundary) — expiry takes precedence", () => {
  const now = new Date().toISOString();
  assert.equal(selectCatchUpStage(0, now, now), null, "deadline <= now must be treated as due for expiry, not eligible for a reminder");
});

test("selectCatchUpStage: no stage due yet — returns null", () => {
  const futureDeadline = new Date(Date.now() + 30 * MS_PER_DAY).toISOString();
  assert.equal(selectCatchUpStage(0, futureDeadline, new Date().toISOString()), null);
});

test("selectCatchUpStage: exactly one stage overdue — selects it", () => {
  const now = Date.now();
  // deadline chosen so stage 1 is due (deadline-11d <= now) but stage 2 is not.
  const deadline = new Date(now + 11 * MS_PER_DAY - 1000).toISOString();
  assert.equal(selectCatchUpStage(0, deadline, new Date(now).toISOString()), 1);
});

test("selectCatchUpStage: a stage's own due instant is inclusive (<=), not exclusive", () => {
  const now = Date.now();
  const deadline = new Date(now + 11 * MS_PER_DAY).toISOString(); // stage1 due === now exactly
  assert.equal(selectCatchUpStage(0, deadline, new Date(now).toISOString()), 1);
});

test("selectCatchUpStage: multiple stages overdue — selects only the LATEST, never a burst", () => {
  const now = Date.now();
  // deadline chosen so stages 1 AND 2 are both overdue relative to now.
  const deadline = new Date(now + 6 * MS_PER_DAY).toISOString();
  const selected = selectCatchUpStage(0, deadline, new Date(now).toISOString());
  assert.equal(selected, 2, "must pick the highest overdue stage, not stage 1");
});

test("selectCatchUpStage: all three stages overdue — selects stage 3 only", () => {
  const now = Date.now();
  const deadline = new Date(now + 1 * MS_PER_DAY).toISOString();
  assert.equal(selectCatchUpStage(0, deadline, new Date(now).toISOString()), 3);
});

test("selectCatchUpStage: already-resolved stages are never re-selected", () => {
  const now = Date.now();
  const deadline = new Date(now + 1 * MS_PER_DAY).toISOString(); // everything overdue
  assert.equal(selectCatchUpStage(2, deadline, new Date(now).toISOString()), 3, "only stage 3 remains unresolved");
  assert.equal(selectCatchUpStage(3, deadline, new Date(now).toISOString()), null, "nothing left to resolve");
});

test("selectCatchUpStage: rejects an invalid reminder stage", () => {
  assert.throws(() => selectCatchUpStage(4, DEADLINE, new Date().toISOString()), /invalid reminder stage/);
});

test("REMINDER_STAGE_MIN/MAX are 0 and 3", () => {
  assert.equal(REMINDER_STAGE_MIN, 0);
  assert.equal(REMINDER_STAGE_MAX, 3);
});

// ── Deterministic, distinct keys ─────────────────────────────────────────────

test("reminderIdempotencyKey and reminderEventKey are identical by design, for the same lifecycle+stage", () => {
  assert.equal(reminderIdempotencyKey("lc-1", 2), reminderEventKey("lc-1", 2));
  assert.equal(reminderIdempotencyKey("lc-1", 2), "hhc-activation-reminder:lc-1:2");
});

test("reminder keys are deterministic — same inputs always produce the same key", () => {
  assert.equal(reminderIdempotencyKey("lc-1", 1), reminderIdempotencyKey("lc-1", 1));
});

test("reminder keys are distinct across stages and lifecycles", () => {
  const keys = [
    reminderIdempotencyKey("lc-1", 1),
    reminderIdempotencyKey("lc-1", 2),
    reminderIdempotencyKey("lc-1", 3),
    reminderIdempotencyKey("lc-2", 1),
  ];
  assert.equal(new Set(keys).size, keys.length, "every key must be unique");
});

test("reminder key builders reject an invalid stage", () => {
  assert.throws(() => reminderIdempotencyKey("lc-1", 0), /invalid stage/);
  assert.throws(() => reminderEventKey("lc-1", 4), /invalid stage/);
});

test("expiry event key and expiry founder-email idempotency key are distinct from each other and from reminder keys", () => {
  const noteKey = expiryEventKey("lc-1");
  const emailKey = expiryFounderEmailIdempotencyKey("lc-1");
  assert.equal(noteKey, "hhc-activation-expiry:lc-1");
  assert.equal(emailKey, "hhc-activation-expiry-founder-email:lc-1");
  assert.notEqual(noteKey, emailKey);
  assert.notEqual(noteKey, reminderIdempotencyKey("lc-1", 1));
  assert.notEqual(emailKey, reminderIdempotencyKey("lc-1", 1));
});

test("expiry keys are deterministic per lifecycle and distinct across lifecycles", () => {
  assert.equal(expiryEventKey("lc-1"), expiryEventKey("lc-1"));
  assert.notEqual(expiryEventKey("lc-1"), expiryEventKey("lc-2"));
});

// ── No secrets/PII in any key ────────────────────────────────────────────────

test("no key builder ever accepts or embeds an email address, token, or setup link", () => {
  const allKeys = [
    reminderIdempotencyKey("8b573190-6cf5-4537-82f7-07c10a3f49c9", 1),
    reminderEventKey("8b573190-6cf5-4537-82f7-07c10a3f49c9", 2),
    expiryEventKey("8b573190-6cf5-4537-82f7-07c10a3f49c9"),
    expiryFounderEmailIdempotencyKey("8b573190-6cf5-4537-82f7-07c10a3f49c9"),
  ];
  for (const key of allKeys) {
    assert.doesNotMatch(key, /@/, "no key may contain an email address");
    assert.doesNotMatch(key, /https?:\/\//i, "no key may contain a link");
    assert.doesNotMatch(key, /token|password|secret/i, "no key may reference credential material");
  }
});
