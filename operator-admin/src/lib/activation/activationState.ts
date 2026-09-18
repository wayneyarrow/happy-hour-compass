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

/** Founder-triggered "extend deadline" duration — the only extension amount
 *  Phase 1B implements (a fixed 7 days, never a custom amount). */
export const DEADLINE_EXTENSION_DAYS = 7;

/**
 * Computes the new deadline for a founder-triggered "Extend deadline by 7
 * days" action — pure date math, no I/O, no knowledge of claim vs.
 * submission origin (the canonical lifecycle row is origin-agnostic).
 *
 * Rule (exactly as specified for this phase, deliberately NOT "always +7
 * days from now" or "always +7 days from the stored deadline" — either of
 * those alone would produce a surprising result in one of the two cases):
 *   - If the current deadline is still in the future: add 7 days to the
 *     CURRENT deadline (a straightforward extension of a window still running).
 *   - If the current deadline has already passed: the operator gets a
 *     genuine fresh 7-day window measured from THIS action's own timestamp —
 *     adding 7 days to an already-past deadline would often still land in
 *     the past (or leave less than 7 real days), which defeats the purpose
 *     of "extend."
 *
 * @param now - Injectable for tests; defaults to the real current time.
 */
export function computeExtendedDeadline(
  currentDeadlineAt: string,
  now: Date = new Date()
): string {
  const currentDeadline = new Date(currentDeadlineAt);
  const base = currentDeadline.getTime() > now.getTime() ? currentDeadline : now;
  return new Date(base.getTime() + DEADLINE_EXTENSION_DAYS * MS_PER_DAY).toISOString();
}

// ── Deriving lifecycle state for display/filtering ──────────────────────────

export type ActivationLifecycleState =
  /** Never entered the lifecycle at all — e.g. a returning, already-activated
   *  operator added another venue, or a historical row predating this phase. */
  | "not_tracked"
  | "awaiting_setup"
  | "expiring_soon"
  /** Deadline has elapsed but nothing has formally marked the lifecycle
   *  expired or released yet — see the "release_required vs expired"
   *  precedence note below for exactly when this applies instead of
   *  "expired". This is the Phase 1B founder-attention bucket: today it is
   *  the ONLY way an overdue lifecycle is ever surfaced, since nothing in
   *  the codebase sets expired_at yet (see "expired" below). */
  | "release_required"
  | "active"
  | "expired"
  | "released"
  /** Reserved for a future phase with an authoritative, persisted
   *  setup/delivery-failure signal (e.g. a lifecycle column recording the
   *  last resend's outcome). No such column exists yet — deriveActivationState()
   *  never returns this value today. It is included in the type now so
   *  presentation code (badges, filters) can handle it exhaustively ahead of
   *  that future phase, per Phase 1B's explicit "if authoritative failure
   *  data exists" condition, which is not yet met. */
  | "setup_delivery_error";

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
 *   5. Release Required — deadline minus now <= 0 (the deadline has already
 *      passed) but expiredAt is still null.
 *   6. Expiring Soon — deadline minus now <= EXPIRING_SOON_THRESHOLD_HOURS.
 *   7. Awaiting Setup — everything else: tracked, not yet due, not activated.
 *
 * RELEASE REQUIRED vs. EXPIRED — the one deterministic rule Phase 1B asked
 * for to resolve their apparent overlap: "the deadline has passed" and
 * "expiredAt is set" are NOT the same fact, and are handled as two distinct,
 * non-overlapping states rather than merged into one:
 *   - "Expired" means a (future) automated process has already formally
 *     recorded that this lifecycle expired, by setting expired_at. No code
 *     in this codebase does that yet — expired_at is written by nothing
 *     today — so this branch is reachable only once a later phase adds that
 *     process (a "notification-only expiry" job is the one Phase 1B
 *     anticipates). Until then this branch is effectively dormant.
 *   - "Release Required" means the deadline has simply elapsed in wall-clock
 *     time, with no formal expiry marker recorded — which, given the above,
 *     is what EVERY currently-overdue lifecycle looks like today. This is
 *     deliberately the founder-facing "needs attention" bucket for the
 *     entire current phase.
 *   Because expiredAt is checked first (step 3) and release_required is only
 *   reached when expiredAt is null (step 5), a lifecycle can never be in
 *   both states at once — the moment a future phase starts setting
 *   expired_at, that same record moves from "Release Required" to "Expired"
 *   and stays there (still needing the founder to click release) rather than
 *   ever showing both badges or flapping between them.
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
  if (hoursRemaining <= 0) return "release_required";
  if (hoursRemaining <= EXPIRING_SOON_THRESHOLD_HOURS) return "expiring_soon";
  return "awaiting_setup";
}

// ── Presentation helpers (labels, deadline/countdown text) ─────────────────
//
// No relative/countdown time helper existed anywhere in the codebase before
// Phase 1B (multiple ad hoc elapsed-time-only `formatRelativeTime` copies
// exist across the app, none handling a future deadline) — this is the one
// shared, pure implementation for activation deadlines specifically, used by
// both the Claims and Submissions list/detail UI.

export const ACTIVATION_STATE_LABELS: Record<ActivationLifecycleState, string> = {
  not_tracked: "Not tracked",
  awaiting_setup: "Awaiting setup",
  expiring_soon: "Expiring soon",
  release_required: "Release required",
  active: "Active",
  expired: "Expired",
  released: "Released",
  setup_delivery_error: "Setup/delivery error",
};

/**
 * "3d 4h remaining" / "2h remaining" / "Overdue by 1d 2h" — pure, no I/O.
 * Returns null when there is no deadline to describe (not_tracked has no
 * meaningful countdown).
 *
 * BOUNDARY: at or after the deadline (diffMs <= 0 — matching
 * deriveActivationState()'s own `hoursRemaining <= 0` release_required
 * threshold exactly, so the countdown and the badge always flip at the same
 * instant), this never renders a bare "0m remaining"/"Overdue by 0m" — once
 * the overdue magnitude itself would round down to zero (anywhere in the
 * first minute past the deadline), it instead reads "Release required",
 * matching the badge language the record is already showing. Genuinely
 * overdue records past that first minute still get an informative "Overdue
 * by Xd Yh"/"Overdue by Xm".
 *
 * @param now - Injectable for tests; defaults to the real current time.
 */
export function formatDeadlineCountdown(
  deadlineAt: string | null,
  now: Date = new Date()
): string | null {
  if (!deadlineAt) return null;
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime())) return null;

  const diffMs = deadline.getTime() - now.getTime();
  const overdue = diffMs <= 0;
  const absMs = Math.abs(diffMs);

  const days = Math.floor(absMs / MS_PER_DAY);
  const hours = Math.floor((absMs % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.max(0, Math.floor((absMs % MS_PER_HOUR) / (60 * 1000)));

  if (overdue && days === 0 && hours === 0 && minutes === 0) {
    return "Release required";
  }

  let magnitude: string;
  if (days > 0) {
    magnitude = `${days}d ${hours}h`;
  } else if (hours > 0) {
    magnitude = `${hours}h`;
  } else {
    magnitude = `${minutes}m`;
  }

  return overdue ? `Overdue by ${magnitude}` : `${magnitude} remaining`;
}
