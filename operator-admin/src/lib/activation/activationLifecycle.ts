import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";
import { reportOperationalError } from "@/lib/observability/reportOperationalError";
import { computeActivationStart } from "@/lib/activation/activationState";
import type { ActivationNoteOrigin } from "@/lib/activation/activationNotes";

/**
 * Atomic single-lifecycle guarantee for the shared operator-activation
 * lifecycle (migration 098's `operator_activation_lifecycles` table).
 *
 * THE RACE THIS REPLACES: an earlier version of this system read "does a
 * live lifecycle already exist for this operator" and, only if not, wrote a
 * new one — as two separate database round trips, with no lock or
 * constraint serializing them. Two concurrent provisioning requests for the
 * same still-unactivated operator (two different venues; one Claim and one
 * Submission; two Submissions; or one request creating the Auth user while
 * the other discovers it already exists) could both perform the "no live
 * lifecycle" read before either had performed the write, and both then
 * create a competing lifecycle — see the Phase 1A final-correction report's
 * "Confirmed race condition" section for the exact sequence per scenario.
 *
 * THE FIX: there is no read-then-decide-then-write here at all. This
 * function makes exactly ONE attempt to INSERT a new lifecycle row. Whether
 * that succeeds or fails IS the answer — the database's own partial unique
 * index (`operator_activation_lifecycles_one_live_per_operator_uidx`, on
 * `operator_id` WHERE `expired_at IS NULL AND released_at IS NULL`) is what
 * actually enforces "at most one live lifecycle per operator," not
 * application logic. Two concurrent calls both attempting to INSERT a live
 * lifecycle for the same operator_id are serialized by Postgres itself:
 * exactly one INSERT can succeed; the other fails with a unique_violation
 * (23505), which this function catches and turns into a `reused` result by
 * reading back whichever row actually won. This is the same
 * insert-and-handle-23505 idiom already used throughout this codebase
 * (operators.email uniqueness, venue_claims' one-pending-per-venue index,
 * customer_success_events' one-active-per-venue-and-type index) — no new
 * database function, trigger, or advisory lock is needed.
 *
 * ORDERING REQUIREMENT: this must only be called once the origin row
 * (venue_claims or operator_submissions) already exists — origin_claim_id/
 * origin_submission_id are real foreign keys. For a confirmed_auto
 * submission, the submission row is inserted AFTER provisioning succeeds
 * (see saveOperatorSubmissionAction), so this is called after that insert,
 * not from inside provisionOperatorForVenue() itself — see that function's
 * own comment for why the activation-lifecycle concern was deliberately
 * moved out of it entirely in this correction.
 */

export type ActivationLifecycleRow = {
  id: string;
  operatorId: string;
  originType: "claim" | "submission";
  originClaimId: string | null;
  originSubmissionId: string | null;
  startedAt: string;
  deadlineAt: string;
  reminderStage: number;
  expiredAt: string | null;
  releasedAt: string | null;
};

export type ClaimActivationLifecycleResult =
  /** operators.account_activated_at was already set — no lifecycle for this
   *  call, ever. Checked BEFORE attempting any insert. */
  | { decision: "already_activated" }
  /** This call's INSERT won the race (or there was no race) — a fresh
   *  14-day window now authoritatively belongs to THIS origin. */
  | { decision: "started"; lifecycle: ActivationLifecycleRow }
  /** A live lifecycle already existed for this operator — either this
   *  origin's own prior attempt (a retry) or a different origin's (this one
   *  must not compete). Either way, the EXISTING row is authoritative;
   *  nothing new was written. */
  | { decision: "reused"; lifecycle: ActivationLifecycleRow }
  /** An unexpected error occurred (not a uniqueness conflict) — logged
   *  internally (Sentry + #ops-critical) before returning. The operator's
   *  auth/operator/venue/email provisioning has ALREADY fully succeeded by
   *  the time this is ever called (see ordering note above) — this failure
   *  means only that activation tracking did not start for this row; it
   *  must never be treated as a reason to undo the already-successful
   *  provisioning. */
  | { decision: "claim_failed"; error: string };

function mapRow(row: Record<string, unknown>): ActivationLifecycleRow {
  return {
    id: row.id as string,
    operatorId: row.operator_id as string,
    originType: row.origin_type as "claim" | "submission",
    originClaimId: (row.origin_claim_id as string | null) ?? null,
    originSubmissionId: (row.origin_submission_id as string | null) ?? null,
    startedAt: row.started_at as string,
    deadlineAt: row.deadline_at as string,
    reminderStage: row.reminder_stage as number,
    expiredAt: (row.expired_at as string | null) ?? null,
    releasedAt: (row.released_at as string | null) ?? null,
  };
}

const ACTIVATION_LIFECYCLE_FLOW = "operator-activation-lifecycle";

/**
 * Atomically claims a new 14-day activation lifecycle for `operatorId`, or
 * reuses the one that already exists — never both, and never a competing
 * second one, regardless of concurrent callers. See module header for the
 * full design.
 */
export async function claimOrReuseActivationLifecycle(
  {
    operatorId,
    origin,
    logTag,
  }: {
    operatorId: string;
    origin: ActivationNoteOrigin;
    /** Prefix for log lines, e.g. "[reviewClaimAction]" — matches the
     *  convention already used throughout operatorActivation.ts. */
    logTag: string;
  },
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<ClaimActivationLifecycleResult> {
  const supabase = client;

  // ── Already activated? Check first — no insert attempt at all. ───────────
  //
  // KNOWN NARROW RACE (low severity, accepted for Phase 1A — do not "fix"
  // with another database function/trigger/lock; see the module header for
  // why a plain unique index is deliberately the only mechanism here):
  // this read and the INSERT below are two separate statements, not one
  // transaction. If this same operator's account_activated_at flips from
  // null to set (via a completely different, already-provisioned venue's
  // completeOperatorAccountActivation() call) in the narrow window between
  // this check and the INSERT, a lifecycle row could still be inserted for
  // an operator who has, by that point, already activated. This does NOT
  // violate the one-live-lifecycle-per-operator guarantee (the partial
  // unique index still holds) and does NOT create a duplicate Auth
  // user/operator/venue — the only consequence is one extra, functionally
  // moot lifecycle row.
  //
  // THE INVARIANT THIS IMPOSES ON EVERY FUTURE READER OF THIS TABLE:
  // operators.account_activated_at remains the one authoritative signal for
  // "did this operator actually activate" — never the mere existence of a
  // live operator_activation_lifecycles row. Concretely: a future reminder
  // cron's "what's due" query must always explicitly join/filter out
  // operators whose account_activated_at is already set — it must never
  // send a reminder based solely on operator_activation_lifecycles_due_idx
  // matching. deriveActivationState() (activationState.ts) already follows
  // this rule (accountActivatedAt is checked first, before any lifecycle
  // field) — any new code reading this table must do the same.
  const { data: operatorRow, error: operatorLookupError } = await supabase
    .from("operators")
    .select("account_activated_at")
    .eq("id", operatorId)
    .maybeSingle();

  if (operatorLookupError) {
    return reportClaimFailure(logTag, operatorId, origin, operatorLookupError.message);
  }
  if (operatorRow?.account_activated_at) {
    return { decision: "already_activated" };
  }

  // ── Attempt the atomic claim ───────────────────────────────────────────────
  const { startedAt, deadlineAt, reminderStage } = computeActivationStart();
  const insertPayload = {
    operator_id: operatorId,
    origin_type: origin.type,
    origin_claim_id: origin.type === "claim" ? origin.claimId : null,
    origin_submission_id: origin.type === "submission" ? origin.submissionId : null,
    started_at: startedAt,
    deadline_at: deadlineAt,
    reminder_stage: reminderStage,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("operator_activation_lifecycles")
    .insert(insertPayload)
    .select()
    .single();

  if (!insertError && inserted) {
    return { decision: "started", lifecycle: mapRow(inserted) };
  }

  if (insertError?.code === "23505") {
    // Lost the race (or this is a retry of our own prior success) — the
    // partial unique index means exactly one live row exists for this
    // operator; read it back rather than guessing which call created it.
    const { data: existing, error: reReadError } = await supabase
      .from("operator_activation_lifecycles")
      .select()
      .eq("operator_id", operatorId)
      .is("expired_at", null)
      .is("released_at", null)
      .maybeSingle();

    if (reReadError) {
      return reportClaimFailure(logTag, operatorId, origin, reReadError.message);
    }
    if (existing) {
      return { decision: "reused", lifecycle: mapRow(existing) };
    }
    // Conflict was detected, but the live row is gone on immediate re-read —
    // e.g. released between the two statements. Do not guess; report and
    // let the caller proceed without activation tracking for this call.
    return reportClaimFailure(
      logTag,
      operatorId,
      origin,
      "unique_violation on insert, but no live lifecycle found on re-read"
    );
  }

  return reportClaimFailure(logTag, operatorId, origin, insertError?.message ?? "unknown error");
}

async function reportClaimFailure(
  logTag: string,
  operatorId: string,
  origin: ActivationNoteOrigin,
  message: string
): Promise<{ decision: "claim_failed"; error: string }> {
  const originId = origin.type === "claim" ? origin.claimId : origin.submissionId;
  console.error(`${logTag} Activation lifecycle claim failed.`, { operatorId, origin, error: message });
  const report = reportOperationalError({
    error: new Error(message),
    flow: ACTIVATION_LIFECYCLE_FLOW,
    stage: "claim",
    severity: "critical",
    context: { operatorId, originType: origin.type, originId, callerFlow: logTag },
  });
  await sendSlackAlert({
    channel: "ops-critical",
    severity: "critical",
    title: "Activation Lifecycle Claim Failed — Operator Provisioned but Untracked",
    message:
      "Operator provisioning already succeeded (auth user, operator row, venue link, setup email all " +
      "sent) — only activation-lifecycle tracking failed. The operator can still sign in normally once " +
      "they complete setup; this only means no deadline/reminder tracking exists for them. Manual " +
      "investigation recommended.",
    metadata: {
      "Operator ID": operatorId,
      "Origin type": origin.type,
      "Origin ID": originId,
      Flow: logTag,
      Error: message,
      "HHC Error": report.hhcErrorId,
      "Sentry Event": report.sentryEventId ?? "unavailable",
    },
  });
  return { decision: "claim_failed", error: report.customerMessage };
}
