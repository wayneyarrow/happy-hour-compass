/**
 * Pure venue-view-milestone resolution logic — no Supabase, no I/O.
 *
 * Given a venue's current all-time view count, which milestones it has
 * already recorded (any communication_status), which of those are still
 * 'pending' (unsent), and whether it has an existing
 * customer_success_baselines row, decides:
 *   - whether this run needs to write a baseline row (first time this venue
 *     is observed for this event type — see "initialization" below)
 *   - which newly-crossed milestone (if any) becomes the meaningful
 *     'pending' event this run (INSERT)
 *   - which newly-crossed milestones become 'superseded' this run (INSERT)
 *   - which EXISTING 'pending' row(s), left over from an earlier run, must
 *     be demoted to 'superseded' now that a higher milestone is the
 *     meaningful one (UPDATE)
 *
 * BEHAVIOUR
 *
 * A) Never duplicate a milestone
 *    Any threshold already present in `alreadyRecordedMilestones` (any
 *    status — pending, superseded, sent, skipped, failed all count) is
 *    never re-proposed. The database also enforces this independently via
 *    customer_success_events' partial unique indexes (migration 093) — this
 *    function's job is to compute the *right* outcome, not to be the only
 *    thing preventing a duplicate.
 *
 * B) Skipped milestones, mid-flight — within ONE run
 *    Example: a venue goes from 43 views (no milestone crossed, already
 *    baselined from an earlier run) to 112 views by the next run. Both 50
 *    and 100 are newly crossed in that single run. Only the highest (100)
 *    becomes 'pending' — 50 becomes 'superseded'. A venue is never queued
 *    for more than one milestone communication per detection run.
 *
 * B') Skipped milestones, ACROSS runs (cross-run supersession)
 *    Example: run 1 (52 views) records 50 as 'pending'. Before it's sent,
 *    run 2 observes 103 views and crosses 100. 100 becomes the new
 *    'pending' milestone, and the STILL-PENDING 50 from run 1 — passed in
 *    via `pendingMilestones` — is demoted to 'superseded' (an UPDATE, not
 *    a new row). At most one 'pending' venue-view milestone ever exists
 *    per venue once a run completes. A milestone already 'sent' is never
 *    touched — `pendingMilestones` must only ever contain values whose
 *    current communication_status is 'pending' (the caller guarantees
 *    this by construction, and the actual UPDATE this decision drives is
 *    itself additionally guarded with `WHERE communication_status =
 *    'pending'` — see detectVenueViewMilestones.ts — so even a stale
 *    decision can never demote a milestone the meantime turned 'sent').
 *
 * C) + D) Existing-venue initialization
 *    The FIRST time a venue is evaluated for this event type (no
 *    customer_success_baselines row yet — `hasBaseline: false`), every
 *    currently-crossed milestone is recorded as 'superseded', including the
 *    highest one — none become 'pending'. This is what stops a venue that
 *    already had, say, 183 views when Phase 1A first runs from generating
 *    a 50 *and* 100 milestone communication once Phase 1B is enabled: both
 *    are backfilled as history, not queued as new communications. A
 *    baseline row is written this same run (baselineNeeded: true) so every
 *    later run for that venue is treated as ongoing growth (rule B/B'
 *    above), not initialization — e.g. that same venue crossing 250 later
 *    becomes a normal 'pending' event.
 *
 *    Note this baseline row is written even when zero milestones are
 *    crossed on the first run (e.g. a venue at 43 views) — the baseline
 *    marks "this venue has been observed", not "this venue crossed
 *    something". Without it, a venue whose first-ever observed count sits
 *    below every milestone would still look un-baselined on its next run,
 *    and (incorrectly) have its first real crossing treated as
 *    initialization instead of organic growth.
 *
 *    A venue is only ever passed into this function once it is eligible
 *    (see eligibility.ts) — an ineligible venue (seeded/unclaimed,
 *    unverified, unpublished) is never evaluated at all, so it accumulates
 *    no baseline and no events while ineligible. When it later becomes
 *    eligible, that first evaluation is its "first-ever observation" here,
 *    using its view count AT THAT TIME — so pre-eligibility history is
 *    baselined/superseded exactly like any other first observation, never
 *    retroactively counted from when the venue first existed.
 */

/** Ascending view-count thresholds. Phase 1A implements exactly this list. */
export const VENUE_VIEW_MILESTONES: readonly number[] = [50, 100, 250, 500, 1000, 2500, 5000];

export type VenueViewMilestoneDecisionInput = {
  /** All-time view count from the same source of truth as Founder Control Panel reporting (venue_view_counts() RPC). */
  currentViews: number;
  /** Every milestone this venue already has a customer_success_events row for, any communication_status. */
  alreadyRecordedMilestones: readonly number[];
  /**
   * The subset of `alreadyRecordedMilestones` whose communication_status is
   * currently 'pending' (unsent). In normal operation this holds at most
   * one value — but the function tolerates more defensively (e.g. it can
   * self-heal a pre-existing inconsistent state down to one).
   */
  pendingMilestones: readonly number[];
  /** Whether a customer_success_baselines row already exists for this venue + venue_view_milestone. */
  hasBaseline: boolean;
};

export type VenueViewMilestoneDecision = {
  /** True if this run must insert a customer_success_baselines row (first observation of this venue). */
  baselineNeeded: boolean;
  /** The one NEW milestone row to insert as 'pending' this run, or null if none. */
  newlyPending: number | null;
  /** NEW milestone rows to insert directly as 'superseded' this run (ascending order). */
  newlySuperseded: number[];
  /**
   * EXISTING 'pending' rows (from an earlier run) to UPDATE to 'superseded'
   * this run, because a higher milestone is now the meaningful one
   * (ascending order). Never includes a value not already in
   * `pendingMilestones` — this function only ever demotes, never
   * resurrects or invents a value to update.
   */
  pendingToSupersede: number[];
};

/**
 * Resolves what a single detection run should do for one venue. Pure
 * function — safe to unit test directly and to call repeatedly/idempotently
 * (calling it again with the same inputs, or with inputs unchanged since
 * the last successful write, always proposes the same outcome — an empty
 * decision once nothing is left to insert or demote).
 */
export function resolveVenueViewMilestoneDecision(
  input: VenueViewMilestoneDecisionInput
): VenueViewMilestoneDecision {
  const { currentViews, hasBaseline } = input;
  const alreadyRecorded = new Set(input.alreadyRecordedMilestones);

  const crossed = VENUE_VIEW_MILESTONES.filter(
    (threshold) => threshold <= currentViews && !alreadyRecorded.has(threshold)
  );

  if (!hasBaseline) {
    // First-ever observation of this venue for this event type: backfill
    // every currently-crossed milestone as history, promote none. There is
    // structurally no pre-existing 'pending' row to demote here — a
    // baseline is always written on (and only on) a venue's first
    // observation, before any milestone row can exist.
    return { baselineNeeded: true, newlyPending: null, newlySuperseded: crossed, pendingToSupersede: [] };
  }

  const existingPending = [...input.pendingMilestones];
  const candidatePending = [...existingPending, ...crossed];

  if (candidatePending.length === 0) {
    return { baselineNeeded: false, newlyPending: null, newlySuperseded: [], pendingToSupersede: [] };
  }

  // The highest value among "still-pending from before" and "newly crossed
  // this run" is the one meaningful current milestone. Everything else in
  // that combined set is no longer meaningful — freshly-crossed ones are
  // inserted straight as 'superseded'; a pre-existing 'pending' one is
  // demoted via UPDATE instead of re-inserted.
  const topValue = Math.max(...candidatePending);

  const newlyPending = crossed.includes(topValue) ? topValue : null;
  const newlySuperseded = crossed.filter((v) => v !== topValue).sort((a, b) => a - b);
  const pendingToSupersede = existingPending.filter((v) => v !== topValue).sort((a, b) => a - b);

  return { baselineNeeded: false, newlyPending, newlySuperseded, pendingToSupersede };
}
