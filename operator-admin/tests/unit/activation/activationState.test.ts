import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVATION_WINDOW_DAYS,
  EXPIRING_SOON_THRESHOLD_HOURS,
  DEADLINE_EXTENSION_DAYS,
  computeActivationStart,
  computeExtendedDeadline,
  deriveActivationState,
  formatDeadlineCountdown,
  type ActivationStateInput,
} from "../../../src/lib/activation/activationState";

// ── computeActivationStart() ─────────────────────────────────────────────────

test("computeActivationStart: deadline is exactly ACTIVATION_WINDOW_DAYS (14) after startedAt", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { startedAt, deadlineAt, reminderStage } = computeActivationStart(now);

  assert.equal(ACTIVATION_WINDOW_DAYS, 14);
  assert.equal(startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(deadlineAt, "2026-01-15T00:00:00.000Z");
  assert.equal(reminderStage, 0);
});

test("computeActivationStart: exact 14-day math across a month boundary", () => {
  const now = new Date("2026-02-20T12:34:56.000Z");
  const { deadlineAt } = computeActivationStart(now);
  assert.equal(deadlineAt, "2026-03-06T12:34:56.000Z");
});

test("computeActivationStart: defaults to the real current time when no argument is given", () => {
  const before = Date.now();
  const { startedAt } = computeActivationStart();
  const after = Date.now();
  const startedMs = new Date(startedAt).getTime();
  assert.ok(startedMs >= before && startedMs <= after);
});

// ── deriveActivationState() ──────────────────────────────────────────────────

const NOW = new Date("2026-06-15T12:00:00.000Z");

function baseInput(overrides: Partial<ActivationStateInput> = {}): ActivationStateInput {
  return {
    accountActivatedAt: null,
    activationStartedAt: null,
    activationDeadlineAt: null,
    expiredAt: null,
    releasedAt: null,
    ...overrides,
  };
}

test("deriveActivationState: null legacy fields (never entered the lifecycle) → not_tracked", () => {
  assert.equal(deriveActivationState(baseInput(), NOW), "not_tracked");
});

test("deriveActivationState: activation_started_at set but no deadline (defensive null-safety) → not_tracked", () => {
  assert.equal(
    deriveActivationState(baseInput({ activationStartedAt: "2026-06-01T00:00:00.000Z" }), NOW),
    "not_tracked"
  );
});

test("deriveActivationState: tracked, deadline far in the future → awaiting_setup", () => {
  const state = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: "2026-06-15T13:00:00.000Z", // 1 hour from NOW... see next test for boundary
    }),
    NOW
  );
  // 1 hour remaining is within the 48h threshold — expiring_soon, not awaiting_setup.
  assert.equal(state, "expiring_soon");
});

test("deriveActivationState: comfortably before the 48h threshold → awaiting_setup", () => {
  const state = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: "2026-06-20T12:00:00.000Z", // 5 days from NOW
    }),
    NOW
  );
  assert.equal(state, "awaiting_setup");
});

test("deriveActivationState: EXPIRING_SOON_THRESHOLD_HOURS is 48, boundary is inclusive", () => {
  assert.equal(EXPIRING_SOON_THRESHOLD_HOURS, 48);
  const exactlyAtThreshold = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    }),
    NOW
  );
  assert.equal(exactlyAtThreshold, "expiring_soon");

  const justOverThreshold = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000 + 1000).toISOString(),
    }),
    NOW
  );
  assert.equal(justOverThreshold, "awaiting_setup");
});

test("deriveActivationState: deadline already passed but not yet marked expired → release_required (Phase 1B)", () => {
  const state = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: "2026-06-10T00:00:00.000Z", // 5 days before NOW
    }),
    NOW
  );
  // Only an explicit expired_at overlay produces "expired" — this phase never
  // sets it, so a merely-overdue row surfaces as release_required (the
  // founder-attention bucket) until a later phase's expiry job acts on it.
  assert.equal(state, "release_required");
});

test("deriveActivationState: deadline boundary at exactly 0 hours remaining → release_required, not expiring_soon", () => {
  const exactlyAtDeadline = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: NOW.toISOString(),
    }),
    NOW
  );
  assert.equal(exactlyAtDeadline, "release_required");

  const oneSecondBeforeDeadline = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: new Date(NOW.getTime() + 1000).toISOString(),
    }),
    NOW
  );
  assert.equal(oneSecondBeforeDeadline, "expiring_soon");
});

test("deriveActivationState: release_required and expired never overlap — expiredAt set always wins over a passed deadline", () => {
  const state = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: "2026-06-10T00:00:00.000Z", // passed
      expiredAt: "2026-06-11T00:00:00.000Z", // formally marked expired
    }),
    NOW
  );
  assert.equal(state, "expired");
});

test("deriveActivationState: expired_at set → expired", () => {
  const state = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: "2026-06-10T00:00:00.000Z",
      expiredAt: "2026-06-11T00:00:00.000Z",
    }),
    NOW
  );
  assert.equal(state, "expired");
});

test("deriveActivationState: released_at set → released, even though expired_at is also set", () => {
  const state = deriveActivationState(
    baseInput({
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: "2026-06-10T00:00:00.000Z",
      expiredAt: "2026-06-11T00:00:00.000Z",
      releasedAt: "2026-06-12T00:00:00.000Z",
    }),
    NOW
  );
  assert.equal(state, "released");
});

test("deriveActivationState: account_activated_at set → active, overriding awaiting/expiring", () => {
  const activeButWouldOtherwiseBeExpiringSoon = deriveActivationState(
    baseInput({
      accountActivatedAt: "2026-06-15T11:00:00.000Z",
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: new Date(NOW.getTime() + 1000).toISOString(), // 1 second from expiring
    }),
    NOW
  );
  assert.equal(activeButWouldOtherwiseBeExpiringSoon, "active");
});

test("deriveActivationState: account_activated_at set → active, overriding an already-recorded expired/released overlay", () => {
  // Defensive: this combination should never occur once a later phase
  // implements expiry (activating should be checked before expiring), but
  // the derivation function itself must not crash or return an inconsistent
  // state if it ever does.
  const state = deriveActivationState(
    baseInput({
      accountActivatedAt: "2026-06-15T11:00:00.000Z",
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: "2026-06-10T00:00:00.000Z",
      expiredAt: "2026-06-11T00:00:00.000Z",
      releasedAt: "2026-06-12T00:00:00.000Z",
    }),
    NOW
  );
  assert.equal(state, "active");
});

test("deriveActivationState: account_activated_at set → active, overriding an otherwise release_required deadline", () => {
  const state = deriveActivationState(
    baseInput({
      accountActivatedAt: "2026-06-15T11:00:00.000Z",
      activationStartedAt: "2026-06-01T00:00:00.000Z",
      activationDeadlineAt: "2026-06-10T00:00:00.000Z", // passed
    }),
    NOW
  );
  assert.equal(state, "active");
});

test("deriveActivationState: fully null input (a row from before migration 098) never throws and returns not_tracked", () => {
  assert.doesNotThrow(() => deriveActivationState(baseInput(), NOW));
  assert.equal(deriveActivationState(baseInput(), NOW), "not_tracked");
});

// ── computeExtendedDeadline() ─────────────────────────────────────────────────

test("computeExtendedDeadline: future deadline → +7 days from the CURRENT deadline, not from now", () => {
  assert.equal(DEADLINE_EXTENSION_DAYS, 7);
  const now = new Date("2026-06-15T12:00:00.000Z");
  const currentDeadline = "2026-06-20T00:00:00.000Z"; // 5 days from now — still future
  const extended = computeExtendedDeadline(currentDeadline, now);
  assert.equal(extended, "2026-06-27T00:00:00.000Z");
});

test("computeExtendedDeadline: passed deadline → +7 days from NOW (a genuine fresh window), not from the stale deadline", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const currentDeadline = "2026-06-01T00:00:00.000Z"; // 14 days in the past
  const extended = computeExtendedDeadline(currentDeadline, now);
  assert.equal(extended, "2026-06-22T12:00:00.000Z");
});

test("computeExtendedDeadline: deadline exactly at now counts as passed (uses now, not the stale value)", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const extended = computeExtendedDeadline(now.toISOString(), now);
  assert.equal(extended, "2026-06-22T12:00:00.000Z");
});

// ── formatDeadlineCountdown() ─────────────────────────────────────────────────

test("formatDeadlineCountdown: future deadline in days+hours", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const deadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000).toISOString();
  assert.equal(formatDeadlineCountdown(deadline, now), "3d 4h remaining");
});

test("formatDeadlineCountdown: future deadline under a day shows hours only", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const deadline = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
  assert.equal(formatDeadlineCountdown(deadline, now), "5h remaining");
});

test("formatDeadlineCountdown: overdue deadline is prefixed 'Overdue by'", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const deadline = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)).toISOString();
  assert.equal(formatDeadlineCountdown(deadline, now), "Overdue by 2d 3h");
});

test("formatDeadlineCountdown: null deadline (not_tracked) returns null, not a crash", () => {
  assert.equal(formatDeadlineCountdown(null), null);
});

// ── formatDeadlineCountdown() boundary cleanup (Phase 1B correction) ─────────

test("formatDeadlineCountdown: exactly at the deadline reads 'Release required', never '0m remaining'", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  assert.equal(formatDeadlineCountdown(now.toISOString(), now), "Release required");
});

test("formatDeadlineCountdown: a few seconds past the deadline still reads 'Release required', never 'Overdue by 0m'", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const deadline = new Date(now.getTime() - 30 * 1000).toISOString(); // 30s overdue
  assert.equal(formatDeadlineCountdown(deadline, now), "Release required");
});

test("formatDeadlineCountdown: one second before the deadline is still a normal future countdown, not 'Release required'", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const deadline = new Date(now.getTime() + 1000).toISOString();
  assert.equal(formatDeadlineCountdown(deadline, now), "0m remaining");
});

test("formatDeadlineCountdown: overdue by a full minute or more still shows the informative 'Overdue by Xm' form, not 'Release required'", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const deadline = new Date(now.getTime() - 90 * 1000).toISOString(); // 1m30s overdue
  assert.equal(formatDeadlineCountdown(deadline, now), "Overdue by 1m");
});

test("formatDeadlineCountdown: clearly overdue by days/hours is unaffected by the boundary fix", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const deadline = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)).toISOString();
  assert.equal(formatDeadlineCountdown(deadline, now), "Overdue by 2d 3h");
});

test("formatDeadlineCountdown: normal future countdown formatting (days+hours, hours-only) is unaffected by the boundary fix", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const daysDeadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000).toISOString();
  assert.equal(formatDeadlineCountdown(daysDeadline, now), "3d 4h remaining");
  const hoursDeadline = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
  assert.equal(formatDeadlineCountdown(hoursDeadline, now), "5h remaining");
});
