import { createAdminClient } from "@/lib/supabase/server";
import { deriveActivationState, type ActivationLifecycleState } from "@/lib/activation/activationState";

/**
 * N+1-safe query layer for the Founder Control Panel Action Center's
 * "Operator activation reviews" card (Phase 2A-4).
 *
 * Deliberately queries `operator_activation_lifecycles` DIRECTLY as the
 * starting point — never every Claim and Submission in the system — since
 * the vast majority of claims/submissions have no lifecycle at all, or a
 * fully resolved one (`active`), and are never actionable here. This is the
 * opposite direction from activationPresentation.ts's
 * getActivationPresentationsForClaims/ForSubmissions (which start FROM a
 * known set of claim/submission ids and look up lifecycles); this module
 * starts FROM the lifecycles that could plausibly need founder attention and
 * only then resolves their origins/venues/operators, in a small, fixed
 * number of additional batched `.in(...)` queries — never one query per row.
 *
 * "ACTIONABLE" — deliberately narrower than every non-active,
 * non-released lifecycle. Never counts ordinary awaiting_setup/
 * expiring_soon records: those still have a live, working window and
 * nothing for the founder to review yet.
 *   - release_required: deadline passed, expired_at still null.
 *   - expired: expired_at set (implies deadline passed too).
 *   - reminder_exhausted: the reminder worker gave up on a stage before
 *     stage 3 was ever resolved (no further automatic reminder is
 *     scheduled) while the deadline is still in the future — the ONE gap
 *     where an operator would otherwise get zero further nudges before
 *     expiry with no founder visibility at all. See computeReasons() below
 *     for the exact, corrected predicate (including the attempt-count
 *     nuance: the worker resets reminder_attempt_count to 0 on exhaustion,
 *     so this can never rely on a literal ">= 3" reading alone) —
 *     reminder_last_attempted_at/reminder_last_error are ONLY ever set by
 *     processActivationReminders.ts's handleReminderFailure(), so this can
 *     never false-positive on an ordinary lifecycle that simply hasn't been
 *     lazily initialized yet.
 *   - notification_incomplete: expired_at set AND (expiry_slack_notified_at
 *     OR expiry_founder_email_sent_at) is still null — a subset of
 *     "expired," surfaced separately because it may be the founder's ONLY
 *     signal if both automated notifications failed.
 * A lifecycle can carry more than one reason at once (e.g. release_required
 * AND reminder_exhausted); the primary count de-duplicates by lifecycle id,
 * never double-counting.
 *
 * Already-activated operators and already-released lifecycles are excluded
 * before any reason is even evaluated — `active`/`released` never appear
 * here, matching the Claims/Submissions list pages' own "never make active
 * or released rows attention items" rule.
 */

export type ActivationReviewReason =
  | "release_required"
  | "expired"
  | "reminder_exhausted"
  | "notification_incomplete";

export type ActivationReviewRow = {
  lifecycleId: string;
  originType: "claim" | "submission";
  originId: string;
  venueId: string | null;
  venueName: string | null;
  operatorId: string;
  operatorName: string | null;
  operatorEmail: string | null;
  state: ActivationLifecycleState;
  reasons: ActivationReviewReason[];
  deadlineAt: string;
  reminderStage: number;
  reminderNextAttemptAt: string | null;
  reminderAttemptCount: number;
  reminderLastAttemptedAt: string | null;
  reminderLastError: string | null;
  expiredAt: string | null;
  expirySlackNotifiedAt: string | null;
  expiryFounderEmailSentAt: string | null;
};

export type ActivationReviewSummary = {
  total: number;
  releaseRequired: number;
  expiredAwaitingReview: number;
  reminderExhausted: number;
  notificationIncomplete: number;
};

type RawRow = {
  id: string;
  operator_id: string;
  origin_type: "claim" | "submission";
  origin_claim_id: string | null;
  origin_submission_id: string | null;
  deadline_at: string;
  expired_at: string | null;
  reminder_stage: number;
  reminder_next_attempt_at: string | null;
  reminder_attempt_count: number;
  reminder_last_attempted_at: string | null;
  reminder_last_error: string | null;
  expiry_slack_notified_at: string | null;
  expiry_founder_email_sent_at: string | null;
};

/**
 * Reminder-exhaustion predicate (Phase 2A-4 correction).
 *
 * A lifecycle is "reminder delivery exhausted before expiry" only when ALL
 * of the following hold (the caller has already excluded activated
 * operators; `released_at IS NULL` is already enforced by the query):
 *   - not expired, not released (checked by the caller)
 *   - deadline is still in the future (never overlaps with release_required)
 *   - reminder_stage < 3 (a resolved stage 3 is never "exhausted")
 *   - reminder_next_attempt_at IS NULL (no further automatic attempt is
 *     scheduled — the one gap where the operator gets zero further nudges)
 *   - a real failed-attempt signal exists: reminder_last_attempted_at
 *     and/or reminder_last_error is non-null
 *   - an attempt-count signal consistent with genuine exhaustion (see below)
 *
 * ATTEMPT-COUNT NUANCE: processActivationReminders.ts's handleReminderFailure()
 * RESETS reminder_attempt_count to 0 the moment a stage is exhausted (see
 * that function's own comment — "a fresh stage always gets a fresh budget")
 * — it never leaves the counter sitting at 3. So the real, persisted state
 * of a genuinely exhausted lifecycle has reminder_attempt_count === 0, not
 * >= 3. This predicate therefore accepts EITHER signal: `attempt_count >= 3`
 * (satisfies the literal exhaustion-threshold reading, and covers any
 * future/hypothetical code path that leaves the counter at its threshold
 * value) OR `attempt_count === 0` combined with the failure signal above
 * (the actual shape the worker persists today). Critically, a brand-new,
 * never-touched lifecycle ALSO has attempt_count === 0 — what excludes it
 * is the separate, mandatory failure-signal requirement: an uninitialized
 * row has null reminder_last_attempted_at AND null reminder_last_error,
 * which only ever become non-null via an actual worker attempt.
 */
function computeReasons(row: RawRow, now: Date): ActivationReviewReason[] {
  const reasons: ActivationReviewReason[] = [];
  const deadlineMs = new Date(row.deadline_at).getTime();
  const nowMs = now.getTime();

  if (row.expired_at) {
    reasons.push("expired");
    if (!row.expiry_slack_notified_at || !row.expiry_founder_email_sent_at) {
      reasons.push("notification_incomplete");
    }
  } else if (deadlineMs <= nowMs) {
    reasons.push("release_required");
  }

  const hasFailureSignal = row.reminder_last_attempted_at !== null || row.reminder_last_error !== null;
  const attemptCountConsistentWithExhaustion = row.reminder_attempt_count >= 3 || row.reminder_attempt_count === 0;

  if (
    !row.expired_at &&
    deadlineMs > nowMs &&
    row.reminder_stage < 3 &&
    row.reminder_next_attempt_at === null &&
    hasFailureSignal &&
    attemptCountConsistentWithExhaustion
  ) {
    reasons.push("reminder_exhausted");
  }

  return reasons;
}

/**
 * The full, batched query. Fixed at 4-6 queries total regardless of how many
 * lifecycles/venues/operators exist:
 *   1. operator_activation_lifecycles WHERE released_at IS NULL
 *   2. operators, batched by distinct operator_id (excludes activated)
 *   3. venue_claims, batched by distinct origin_claim_id (claim origins only)
 *   4. operator_submissions, batched by distinct origin_submission_id
 *   5. venues, batched by the union of resolved venue ids
 */
export async function getOperatorActivationReviews(
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
  now: Date = new Date()
): Promise<ActivationReviewRow[]> {
  const { data: lifecycleRows, error: lifecycleError } = await client
    .from("operator_activation_lifecycles")
    .select(
      "id, operator_id, origin_type, origin_claim_id, origin_submission_id, deadline_at, expired_at, reminder_stage, reminder_next_attempt_at, reminder_attempt_count, reminder_last_attempted_at, reminder_last_error, expiry_slack_notified_at, expiry_founder_email_sent_at"
    )
    .is("released_at", null);

  if (lifecycleError) {
    console.error("[getOperatorActivationReviews] Lifecycle lookup failed:", lifecycleError.message);
    return [];
  }
  if (!lifecycleRows || lifecycleRows.length === 0) return [];

  const operatorIds = [...new Set(lifecycleRows.map((r) => r.operator_id as string))];
  const { data: operatorRows, error: operatorError } = await client
    .from("operators")
    .select("id, account_activated_at, first_name, last_name, email")
    .in("id", operatorIds);

  if (operatorError) {
    console.error("[getOperatorActivationReviews] Operator lookup failed:", operatorError.message);
    return [];
  }
  const operatorById = new Map(
    (operatorRows ?? []).map((r) => [
      r.id as string,
      r as { id: string; account_activated_at: string | null; first_name: string | null; last_name: string | null; email: string | null },
    ])
  );

  // Exclude activated operators before ANY reason is evaluated.
  const candidates = (lifecycleRows as RawRow[]).filter((row) => !operatorById.get(row.operator_id)?.account_activated_at);

  const actionable = candidates
    .map((row) => ({ row, reasons: computeReasons(row, now) }))
    .filter((c) => c.reasons.length > 0);

  if (actionable.length === 0) return [];

  const claimIds = [...new Set(actionable.filter((c) => c.row.origin_type === "claim").map((c) => c.row.origin_claim_id as string))];
  const submissionIds = [...new Set(actionable.filter((c) => c.row.origin_type === "submission").map((c) => c.row.origin_submission_id as string))];

  const [claimsResult, submissionsResult] = await Promise.all([
    claimIds.length > 0
      ? client.from("venue_claims").select("id, venue_id").in("id", claimIds)
      : Promise.resolve({ data: [] as { id: string; venue_id: string | null }[], error: null }),
    submissionIds.length > 0
      ? client.from("operator_submissions").select("id, venue_id").in("id", submissionIds)
      : Promise.resolve({ data: [] as { id: string; venue_id: string | null }[], error: null }),
  ]);

  if (claimsResult.error) console.error("[getOperatorActivationReviews] Claim batch lookup failed:", claimsResult.error.message);
  if (submissionsResult.error) console.error("[getOperatorActivationReviews] Submission batch lookup failed:", submissionsResult.error.message);

  const venueIdByClaimId = new Map((claimsResult.data ?? []).map((r) => [r.id as string, r.venue_id as string | null]));
  const venueIdBySubmissionId = new Map((submissionsResult.data ?? []).map((r) => [r.id as string, r.venue_id as string | null]));

  const venueIds = [
    ...new Set(
      actionable
        .map((c) => (c.row.origin_type === "claim" ? venueIdByClaimId.get(c.row.origin_claim_id as string) : venueIdBySubmissionId.get(c.row.origin_submission_id as string)))
        .filter((v): v is string => !!v)
    ),
  ];

  let venueById = new Map<string, { id: string; name: string }>();
  if (venueIds.length > 0) {
    const { data: venueRows, error: venueError } = await client.from("venues").select("id, name").in("id", venueIds);
    if (venueError) {
      console.error("[getOperatorActivationReviews] Venue batch lookup failed:", venueError.message);
    } else {
      venueById = new Map((venueRows ?? []).map((v) => [v.id as string, v as { id: string; name: string }]));
    }
  }

  return actionable.map(({ row, reasons }) => {
    const originId = row.origin_type === "claim" ? (row.origin_claim_id as string) : (row.origin_submission_id as string);
    const venueId = row.origin_type === "claim" ? venueIdByClaimId.get(originId) ?? null : venueIdBySubmissionId.get(originId) ?? null;
    const venue = venueId ? venueById.get(venueId) ?? null : null;
    const operator = operatorById.get(row.operator_id) ?? null;

    const state = deriveActivationState(
      {
        accountActivatedAt: null,
        activationStartedAt: row.deadline_at, // any non-null value; state only depends on deadline/expired past this point
        activationDeadlineAt: row.deadline_at,
        expiredAt: row.expired_at,
        releasedAt: null,
      },
      now
    );

    return {
      lifecycleId: row.id,
      originType: row.origin_type,
      originId,
      venueId,
      venueName: venue?.name ?? null,
      operatorId: row.operator_id,
      operatorName: operator ? [operator.first_name, operator.last_name].filter(Boolean).join(" ") || null : null,
      operatorEmail: operator?.email ?? null,
      state,
      reasons,
      deadlineAt: row.deadline_at,
      reminderStage: row.reminder_stage,
      reminderNextAttemptAt: row.reminder_next_attempt_at,
      reminderAttemptCount: row.reminder_attempt_count,
      reminderLastAttemptedAt: row.reminder_last_attempted_at,
      reminderLastError: row.reminder_last_error,
      expiredAt: row.expired_at,
      expirySlackNotifiedAt: row.expiry_slack_notified_at,
      expiryFounderEmailSentAt: row.expiry_founder_email_sent_at,
    };
  });
}

/**
 * Summary counts for the Action Center card — reuses getOperatorActivationReviews()
 * rather than a parallel count computation, matching this codebase's own
 * established "reuse the report to compute the summary" convention
 * (src/lib/data/actionCenter.ts's upgradeOpportunities/unusedSearchTagCapacity)
 * so the card's number and the drill-down report can never drift apart.
 */
export async function getOperatorActivationReviewSummary(
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
  now: Date = new Date()
): Promise<ActivationReviewSummary> {
  const rows = await getOperatorActivationReviews(client, now);
  return {
    total: rows.length,
    releaseRequired: rows.filter((r) => r.reasons.includes("release_required")).length,
    expiredAwaitingReview: rows.filter((r) => r.reasons.includes("expired")).length,
    reminderExhausted: rows.filter((r) => r.reasons.includes("reminder_exhausted")).length,
    notificationIncomplete: rows.filter((r) => r.reasons.includes("notification_incomplete")).length,
  };
}
