/**
 * Milestone progress and status presentation for the Scout report — pure.
 *
 * Thresholds come from the existing Customer Success list
 * (VENUE_VIEW_MILESTONES); nothing here changes them, eligibility, or how
 * milestones are detected or delivered.
 *
 * APPROACHING (approved rule): the next threshold exists, the views
 * remaining to it are positive, and they are no more than 10% of that
 * threshold — e.g. ≤5 views to 50, ≤10 to 100, ≤25 to 250.
 *   - Exactly at a threshold (e.g. 100 views): that milestone is reached;
 *     the next one is 250, 150 views away, so not approaching.
 *   - At or beyond the highest threshold: no next milestone, never approaching.
 * Already-earned milestones are reported separately by their recorded
 * communication status, never as "approaching".
 */

import { VENUE_VIEW_MILESTONES } from "@/lib/customerSuccess/venueViewMilestones";

export const APPROACHING_FRACTION = 0.1;

export type MilestoneProgress = {
  highestReached: number | null;
  next: number | null;
  remaining: number | null;
  approaching: boolean;
  beyondMaximum: boolean;
};

export function milestoneProgress(views: number, thresholds: readonly number[] = VENUE_VIEW_MILESTONES): MilestoneProgress {
  const sorted = [...thresholds].sort((a, b) => a - b);
  const reached = sorted.filter((m) => views >= m);
  const next = sorted.find((m) => m > views) ?? null;
  const remaining = next === null ? null : next - views;
  // Integer comparison (remaining × 10 ≤ next) avoids floating-point edge cases.
  const approaching = next !== null && remaining !== null && remaining > 0 && remaining * 10 <= next;
  return {
    highestReached: reached.length ? reached[reached.length - 1] : null,
    next,
    remaining,
    approaching,
    beyondMaximum: next === null,
  };
}

/** A customer_success_events row, as read (recipient address deliberately never selected). */
export type MilestoneEventRow = {
  venue_id: string;
  milestone_value: number | null;
  communication_status: string;
  achieved_at: string | null;
  sent_at: string | null;
  next_attempt_at: string | null;
  attempt_count: number | null;
  processing_started_at: string | null;
  recipient_blocked_reason: string | null;
};

export type MilestoneCommunication = {
  milestone: number;
  status: string;
  /** Plain-English state, derived only from the recorded columns. */
  state: string;
  achievedAt: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
  attemptCount: number;
  recipientBlocked: boolean;
};

export function describeCommunication(r: MilestoneEventRow): MilestoneCommunication {
  const recipientBlocked = r.recipient_blocked_reason !== null;
  let state: string;
  switch (r.communication_status) {
    case "sent":
      state = "Sent";
      break;
    case "superseded":
      state = "Not sent — recorded as history (first observation) or overtaken by a higher milestone";
      break;
    case "skipped":
      state = "Not sent — skipped by the delivery worker";
      break;
    case "failed":
      state = "Delivery failed";
      break;
    case "pending":
      state = r.processing_started_at
        ? "Pending — delivery in progress"
        : recipientBlocked
          ? "Pending — recipient blocked"
          : r.next_attempt_at
            ? "Pending — scheduled"
            : "Pending — not yet scheduled";
      break;
    default:
      state = `Unrecognized status (${r.communication_status})`;
  }
  return {
    milestone: r.milestone_value ?? 0,
    status: r.communication_status,
    state,
    achievedAt: r.achieved_at,
    sentAt: r.sent_at,
    nextAttemptAt: r.next_attempt_at,
    attemptCount: r.attempt_count ?? 0,
    recipientBlocked,
  };
}

/** Earned milestones whose communication is not finished: pending or failed. */
export function isEarnedNotSent(status: string): boolean {
  return status === "pending" || status === "failed";
}

/**
 * Guards against the milestone reader's view-count query having failed
 * silently. The reader (computeVenueViewMilestoneDecisions) uses
 * getVenueViewCounts(), which returns an empty map on error — every venue
 * would then read 0 views. A direct, error-propagating count of the same
 * RPC is taken immediately afterwards; since view rows are only appended,
 * it can never be lower than the reader's, and it cannot be positive where
 * the reader saw 0 unless views arrived in between (treated as a failed
 * read, never guessed).
 */
export function verifyReaderCounts(readerCounts: { venueId: string; currentViews: number }[], direct: Map<string, number>): void {
  for (const { venueId, currentViews } of readerCounts) {
    const d = direct.get(venueId) ?? 0;
    if (currentViews === 0 && d > 0) {
      throw new Error(
        `Milestone reader returned 0 all-time views for a venue whose direct count is ${d}; its view-count query appears to have failed. Not reporting milestone figures.`
      );
    }
    if (d < currentViews) {
      throw new Error(`Direct all-time view count (${d}) is lower than the milestone reader's (${currentViews}) — inconsistent read.`);
    }
  }
}
