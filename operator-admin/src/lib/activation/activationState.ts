/**
 * Shared operator-activation lifecycle state — Phase 1A foundation.
 *
 * Claims (venue_claims) and Add Your Venue submissions (operator_submissions)
 * share ONE operator-activation lifecycle: both provision an operator via
 * the same provisionOperatorForVenue() (src/lib/operatorActivation.ts), then
 * wait for operators.account_activated_at (migration 067) to be set. The
 * authoritative lifecycle record itself (started_at/deadline_at/
 * reminder_stage/expired_at/released_at) lives in the canonical
 * `operator_activation_lifecycles` table (migration 098) — see
 * src/lib/activation/activationLifecycle.ts for how a lifecycle is atomically
 * claimed or reused. This module holds only pure, storage-agnostic logic:
 *   - the 14-day default activation window and the 48-hour "Expiring Soon"
 *     threshold (single source of truth for both constants),
 *   - computeActivationStart() — deterministic start/deadline/reminder-stage
 *     values for a brand-new lifecycle row,
 *   - deriveActivationState() — lifecycle state for display/filtering from
 *     whatever row is passed in, WITHOUT introducing a second stored status.
 *     operators.account_activated_at remains the one authoritative signal
 *     for "did this operator actually activate" (never inferred from
 *     whether a setup email/code was sent).
 *
 * ARCHITECTURE NOTE (corrected 2026-09): an earlier version of this module
 * also exported a check-then-decide function
 * (decideActivationForProvisioning()) that read existing lifecycle state and
 * returned a decision for the caller to act on afterward, in a SEPARATE
 * write. That shape had an unavoidable race: two concurrent requests for the
 * same unactivated operator could both read "no live lifecycle" before
 * either had written one, and both then start a competing lifecycle. It has
 * been removed and replaced by activationLifecycle.ts's
 * claimOrReuseActivationLifecycle(), which collapses the check and the write
 * into a single atomic INSERT, guarded by a partial unique index in the
 * database (migration 098) — see that file for the full design. This module
 * no longer contains any check-then-act logic.
 *
 * This phase does not yet send reminders, expire, or release anything — see
 * the Phase 1A task reports for the full boundary.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Default activation window, in days, from activation_started_at. */
export const ACTIVATION_WINDOW_DAYS = 14;

/** "Expiring Soon" threshold: deadline minus now, in hours, at or below which
 *  a record is Expiring Soon rather than plain Awaiting Setup. */
export const EXPIRING_SOON_THRESHOLD_HOURS = 48;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

// ── Computing a new activation window ───────────────────────────────────────

export type ActivationStart = {
  /** ISO timestamp — the authoritative provisioning moment. */
  startedAt: string;
  /** ISO timestamp — startedAt + ACTIVATION_WINDOW_DAYS, computed once. */
  deadlineAt: string;
  /** Always 0 at the moment activation starts — no reminder has been sent yet. */
  reminderStage: 0;
};

/**
 * Computes a brand-new activation window, deterministically, from a single
 * instant. Callers (provisionOperatorForVenue()) must call this exactly once
 * per genuinely new (never-before-activated) operator and persist the result
 * on whichever claim/submission row originated the provisioning — never
 * recompute or re-derive it later from "now."
 *
 * @param now - Injectable for tests; defaults to the real current time.
 */
export function computeActivationStart(now: Date = new Date()): ActivationStart {
  const startedAt = now.toISOString();
  const deadlineAt = new Date(now.getTime() + ACTIVATION_WINDOW_DAYS * MS_PER_DAY).toISOString();
  return { startedAt, deadlineAt, reminderStage: 0 };
}

// ── Deriving lifecycle state for display/filtering ──────────────────────────

export type ActivationLifecycleState =
  /** Never entered the lifecycle at all — e.g. a returning, already-activated
   *  operator added another venue, or a historical row predating this phase. */
  | "not_tracked"
  | "awaiting_setup"
  | "expiring_soon"
  | "active"
  | "expired"
  | "released";

export type ActivationStateInput = {
  /** operators.account_activated_at — the ONE authoritative activation signal.
   *  Never derive activation from whether an email/code was sent. */
  accountActivatedAt: string | null;
  activationStartedAt: string | null;
  activationDeadlineAt: string | null;
  expiredAt: string | null;
  releasedAt: string | null;
};

/**
 * Derives the current lifecycle state from stored columns — pure, no I/O.
 * Handles every legacy-null combination safely (a row from before this
 * migration has all five fields null and correctly derives "not_tracked").
 *
 * Precedence (most authoritative/final first):
 *   1. Active — accountActivatedAt set. Overrides every other field: an
 *      operator who genuinely activated is Active regardless of whether a
 *      deadline had also passed or an expiry/release overlay was later
 *      recorded — activation is the one signal application code trusts.
 *   2. Released — releasedAt set (implies expiry already happened; released
 *      is the more final of the two overlay states).
 *   3. Expired — expiredAt set, not yet released.
 *   4. Not tracked — activationStartedAt (or activationDeadlineAt) is null:
 *      this record never entered the lifecycle at all.
 *   5. Expiring Soon — deadline minus now <= EXPIRING_SOON_THRESHOLD_HOURS.
 *   6. Awaiting Setup — everything else: tracked, not yet due, not activated.
 *
 * @param now - Injectable for tests; defaults to the real current time.
 */
export function deriveActivationState(
  input: ActivationStateInput,
  now: Date = new Date()
): ActivationLifecycleState {
  if (input.accountActivatedAt) return "active";
  if (input.releasedAt) return "released";
  if (input.expiredAt) return "expired";
  if (!input.activationStartedAt || !input.activationDeadlineAt) return "not_tracked";

  const hoursRemaining = (new Date(input.activationDeadlineAt).getTime() - now.getTime()) / MS_PER_HOUR;
  if (hoursRemaining <= EXPIRING_SOON_THRESHOLD_HOURS) return "expiring_soon";
  return "awaiting_setup";
}
