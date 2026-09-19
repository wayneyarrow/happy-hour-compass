import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { sendSlackAlert } from "@/lib/slack";
import { deriveActivationState } from "@/lib/activation/activationState";
import type { ActivationNoteOrigin } from "@/lib/activation/activationNotes";

/**
 * Implementation for releaseActivationLifecycleAction (Phase 2A-4 "manual
 * Release"), deliberately kept OUT of the "use server" activationReleaseActions.ts
 * file — same Phase 1B correction, same rationale, as
 * extendActivationDeadlineImpl.ts / legacyActivationResumeImpl.ts. This file
 * has no "use server" directive, so it is never itself a network-callable
 * Server Action; the dependency-injection seam below (ReleaseActivationLifecycleDeps)
 * exists purely for tests — the real "use server" wrapper always omits it.
 *
 * PRODUCT SEMANTICS (option B, decided in the Phase 2A-4 audit): Release
 * closes ONE stalled activation lifecycle AND returns its ONE originating
 * venue to an unclaimed state — never just the lifecycle bookkeeping row
 * alone (leaving `created_by_operator_id` set would permanently lock the
 * venue to an operator who never activated, since resolveExistingVenueMatchAction
 * already refuses to re-approve a venue whose ownership fields are set).
 *
 * EXACT MUTATIONS — nothing else, ever:
 *   Lifecycle: sets ONLY this lifecycle's released_at. Never touches
 *     expired_at (an expired lifecycle stays expired; Release does not
 *     "unexpire" it). Never creates or modifies any OTHER lifecycle row.
 *   Venue (the one resolved from this origin only): clears claimed_by,
 *     claimed_at, created_by_operator_id. Leaves is_verified and
 *     is_published exactly as they were — no verification/publish-state
 *     product decision was requested for this phase, so none is made
 *     silently here. Never touches venue content (name, hours, media, etc).
 *   Preserves, always: claim/submission status and history, the operator
 *     record, the Supabase Auth user, operator_memberships, every OTHER
 *     venue linked to the same operator, subscriptions/customer records,
 *     and every existing Internal Note.
 *
 * MULTI-ORIGIN / MULTI-VENUE BEHAVIOR: this releases exactly the ONE venue
 * resolved from THIS lifecycle's origin (via origin_claim_id/origin_submission_id
 * → its venue_id) — the venue update is scoped by venue id AND requires
 * `created_by_operator_id = lifecycle.operator_id` as an extra guard, never a
 * bulk update by operator id. An operator who owns multiple venues keeps
 * every other venue completely untouched. Because at most one LIVE lifecycle
 * can ever exist per operator (migration 098's partial unique index), a
 * second approved-but-unactivated origin for the same never-activated
 * operator has no lifecycle of its own to release through — after this
 * lifecycle is released, that second origin is a genuine "not_tracked"
 * record and may independently use the existing controlled legacy-activation-
 * resume action (legacyActivationResumeImpl.ts) to start its OWN fresh
 * lifecycle and release later, on its own timeline. Release never sweeps
 * every venue belonging to the operator — that is a deliberate, documented
 * product decision, not an oversight.
 *
 * RELEASE REMAINS A TWO-WRITE, NON-TRANSACTIONAL OPERATION — this codebase's
 * Supabase JS client has no ambient cross-table transaction, and this task
 * does not introduce a migration or RPC to add one (a small transactional
 * RPC was explicitly considered and deferred — see the Phase 2A-4 task
 * report). The two updates are separate network round trips, and NO CODE
 * PATH HERE CLAIMS FULL TRANSACTIONAL ROLLBACK — compensation, where it
 * happens at all, is explicitly BEST-EFFORT:
 *   - Lifecycle CAS fails → no venue change, no note. A clean, safe no-op.
 *   - Lifecycle CAS succeeds, venue CAS fails (0 rows or an error) → a fresh
 *     read of the ONE resolved venue decides what happens next (see
 *     reconcileVenueReleaseFailure() below):
 *       - already-cleared → proceed as success.
 *       - still owned by the SAME operator → operator activation is
 *         re-checked BOTH before and after attempting compensation (see
 *         that function's own header for the exact 4-way outcome this
 *         produces). A race detected either side of the attempt is
 *         re-closed and escalated — an activated operator is never left
 *         with a silently-live lifecycle.
 *       - owned by a DIFFERENT operator / changed linkage → never touch
 *         that venue, never reopen the lifecycle, critical alert,
 *         manual-review message.
 *     Exactly ONE alert is raised for the final outcome of the whole
 *     reconciliation attempt — never one before compensation and a second
 *     after.
 *   - Both writes succeed but the note insert fails → the release stands
 *     (never re-run the venue mutation just to recreate a note), a
 *     non-critical alert is raised for the missing audit trail, and
 *     operational success is still reported to the founder.
 *
 * CONCURRENCY — the lifecycle update is an atomic compare-and-swap pinning
 * every value read above: `id`, `released_at IS NULL`,
 * `reminder_lease_started_at IS NULL` (never steals an active reminder-
 * worker lease — same rule and same founder-facing message as
 * extendActivationDeadlineImpl.ts), `deadline_at` (exact), `expired_at`
 * (`.eq()` when non-null, `.is(null)` when null — SQL NULL = NULL is never
 * true), and `reminder_stage` (exact) — a concurrent extend, a concurrent
 * reminder-worker advance, or a second Release attempt all fail this CAS
 * cleanly rather than racing. `operators.account_activated_at` is
 * re-checked fresh immediately before the CAS attempt (not just once,
 * earlier, during eligibility resolution) so an operator who activates in
 * the seconds between page load and button click is never released out
 * from under themselves. The venue update carries its own guard
 * (`created_by_operator_id = lifecycle.operator_id`), so a venue whose
 * ownership already changed by the time this runs is never clobbered.
 */

export type ReleaseActivationState = {
  success?: true;
  successAction?: string;
  error?: string;
};

/**
 * Test-only DI — real callers (the "use server" wrapper) always omit every
 * field here and get every real implementation. `sendAlert` exists
 * specifically so no behavioral test ever depends on Slack webhook
 * environment variables being absent — every test that can reach an alert
 * path injects a stub/spy instead, regardless of the developer/CI
 * environment's own configuration.
 */
export type ReleaseActivationLifecycleDeps = {
  authClient?: Awaited<ReturnType<typeof createClient>>;
  adminClient?: ReturnType<typeof createAdminClient>;
  checkAdmin?: (email: string | undefined) => Promise<boolean>;
  revalidate?: (path: string) => void;
  /** Injectable for tests; defaults to the real current time. */
  now?: Date;
  sendAlert?: typeof sendSlackAlert;
};

const LEASE_HELD_MESSAGE = "A reminder is currently being processed. Please refresh and try again shortly.";

type VenueReleaseReconciliation =
  | { outcome: "already_cleared" }
  | { outcome: "compensated"; founderMessage: string }
  | { outcome: "compensation_failed"; founderMessage: string }
  | { outcome: "activated_before_compensation"; founderMessage: string }
  | { outcome: "activated_after_compensation"; founderMessage: string }
  | { outcome: "ownership_changed"; founderMessage: string };

/**
 * Reconciles a failed venue-release write AFTER the lifecycle has already
 * been released — best-effort, never a full transactional rollback claim,
 * always one fresh venue read followed by exactly one of these branches:
 *
 *   1. The venue's three ownership fields are ALL already null — this
 *      write (or an earlier retried one) actually landed; treat it as
 *      complete and let the caller proceed to the note step exactly as if
 *      the original CAS had matched. No alert — not a genuine anomaly.
 *
 *   2. The venue is still owned by the SAME operator this lifecycle
 *      belongs to — the failure was something other than a genuine
 *      ownership race (a transient error, 0-row anomaly, etc). ACTIVATION
 *      IS CHECKED BOTH BEFORE AND AFTER attempting compensation, because an
 *      operator could activate in the narrow window between this action's
 *      earlier eligibility check and this recovery attempt — silently
 *      clearing `released_at` in that case would recreate a live lifecycle
 *      for an already-activated operator:
 *        a. Re-read `operators.account_activated_at` BEFORE compensation.
 *           If activated → do NOT reopen; `released_at` stays exactly as
 *           this action left it. One critical alert, manual-review message.
 *        b. Still unactivated → attempt exactly ONE guarded compensating
 *           lifecycle rollback (`released_at → null`), CAS-pinned on the
 *           lifecycle id, the exact `released_at` value THIS call itself
 *           wrote, the exact prior `deadline_at`/`expired_at`/`reminder_stage`,
 *           and `reminder_lease_started_at IS NULL` — this can only ever
 *           undo this action's own write, never another action's
 *           legitimate state. If the CAS itself fails (0 rows/error) → one
 *           critical alert, manual-intervention message.
 *        c. Compensation succeeds → re-read `operators.account_activated_at`
 *           AGAIN. Still unactivated → safe, retryable; one critical alert.
 *           Activated during the compensation gap → NEVER leave an
 *           activated operator with a live lifecycle: immediately re-close
 *           it with a guarded CAS (lifecycle id, `released_at IS NULL`,
 *           same deadline/expired/reminder-stage/lease snapshot), then one
 *           critical alert stating whether the re-close itself succeeded.
 *      Exactly ONE alert covers the ENTIRE outcome of this branch, however
 *      many of the above steps it takes — never one alert before
 *      compensation and a second one after.
 *
 *   3. The venue is now owned by a DIFFERENT operator, or its ownership
 *      linkage otherwise no longer matches — a genuine race with some
 *      other legitimate flow. That venue is never touched, and the
 *      lifecycle is never blindly reopened (either would risk corrupting
 *      the other flow's state). One critical alert, manual review required.
 *
 * The venue itself is NEVER mutated anywhere in this recovery sequence —
 * only the lifecycle row (compensate / re-close) and, in branch 3, nothing
 * at all.
 */
async function reconcileVenueReleaseFailure({
  supabase,
  sendAlert,
  lifecycleId,
  venueId,
  operatorId,
  origin,
  releasedAtIso,
  deadlineAt,
  expiredAt,
  reminderStage,
  writeErrorMessage,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  sendAlert: typeof sendSlackAlert;
  lifecycleId: string;
  venueId: string;
  operatorId: string;
  origin: ActivationNoteOrigin;
  releasedAtIso: string;
  deadlineAt: string;
  expiredAt: string | null;
  reminderStage: number;
  writeErrorMessage: string;
}): Promise<VenueReleaseReconciliation> {
  const originLabel = origin.type === "claim" ? `Claim ${origin.claimId}` : `Submission ${origin.submissionId}`;
  const { data: freshVenue, error: freshVenueError } = await supabase
    .from("venues")
    .select("id, created_by_operator_id, claimed_by, claimed_at")
    .eq("id", venueId)
    .maybeSingle();

  if (freshVenueError || !freshVenue) {
    console.error("[reconcileVenueReleaseFailure] Could not re-read venue state.", {
      lifecycleId,
      venueId,
      error: freshVenueError?.message,
    });
    await sendAlert({
      channel: "ops-critical",
      severity: "critical",
      title: "Manual Release — Venue Could Not Be Released, And Its Current State Could Not Be Verified",
      message:
        "A founder released this activation lifecycle successfully, but the originating venue's " +
        "ownership fields could not be cleared, and a follow-up read to reconcile the failure also " +
        "failed. The lifecycle is left released — never blindly reopened. Manual investigation is " +
        "required; verify the venue's current ownership fields directly.",
      metadata: {
        "Lifecycle ID": lifecycleId,
        Origin: originLabel,
        "Venue ID": venueId,
        "Operator ID": operatorId,
        "Compensation attempted": "No",
        "Compensation succeeded": "N/A",
        "Activation detected": "Unknown — venue state unverifiable",
        "Re-close succeeded": "N/A",
        "Original error": writeErrorMessage,
        "Re-read error": freshVenueError?.message ?? "venue not found",
      },
    });
    return {
      outcome: "ownership_changed",
      founderMessage:
        "The activation was closed, but the venue's current state could not be verified — this requires " +
        "manual review. No further action was taken automatically.",
    };
  }

  const alreadyCleared = freshVenue.claimed_by === null && freshVenue.claimed_at === null && freshVenue.created_by_operator_id === null;
  if (alreadyCleared) {
    return { outcome: "already_cleared" };
  }

  if (freshVenue.created_by_operator_id === operatorId) {
    // Still owned by the SAME operator — the write failed for some reason
    // other than a genuine ownership race. Activation is re-checked BOTH
    // before and after the compensation attempt (see this function's
    // header) — exactly ONE alert covers the whole outcome, built up here
    // and sent exactly once before returning, however many of the steps
    // below this particular call needs.
    const baseMetadata = {
      "Lifecycle ID": lifecycleId,
      Origin: originLabel,
      "Venue ID": venueId,
      "Operator ID": operatorId,
      "Original error": writeErrorMessage,
    };

    // ── Step a: re-check activation BEFORE attempting compensation. ────────
    const { data: preOperator, error: preOperatorError } = await supabase
      .from("operators")
      .select("account_activated_at")
      .eq("id", operatorId)
      .maybeSingle();

    if (preOperatorError) {
      console.error("[reconcileVenueReleaseFailure] Pre-compensation operator re-check failed.", { lifecycleId, error: preOperatorError.message });
      await sendAlert({
        channel: "ops-critical",
        severity: "critical",
        title: "Manual Release — Venue Could Not Be Released; Operator Status Could Not Be Verified",
        message:
          "The venue's ownership fields could not be cleared, and this operator's activation status " +
          "could not be re-verified before attempting compensation. No compensation was attempted. " +
          "Manual investigation is required.",
        metadata: { ...baseMetadata, "Compensation attempted": "No", "Compensation succeeded": "N/A", "Activation detected": "Unknown — operator status unverifiable", "Re-close succeeded": "N/A" },
      });
      return {
        outcome: "compensation_failed",
        founderMessage: "The activation could not be released, and the operator's status could not be verified — this requires manual review before retrying.",
      };
    }

    if (preOperator?.account_activated_at) {
      // Activated BEFORE compensation was ever attempted — never reopen.
      console.error("[reconcileVenueReleaseFailure] Operator activated before compensation could be attempted — lifecycle left released.", { lifecycleId, venueId, operatorId });
      await sendAlert({
        channel: "ops-critical",
        severity: "critical",
        title: "Manual Release — Venue Could Not Be Released; Operator Activated Before Compensation",
        message:
          "The venue's ownership fields could not be cleared, and by the time this was noticed, the " +
          "operator had already activated their account. The lifecycle was NOT reopened — doing so would " +
          "recreate a live activation window for an already-activated operator. Manual review is required.",
        metadata: { ...baseMetadata, "Compensation attempted": "No", "Compensation succeeded": "N/A", "Activation detected": "Before compensation", "Re-close succeeded": "N/A" },
      });
      return {
        outcome: "activated_before_compensation",
        founderMessage:
          "The activation could not be closed cleanly — the operator activated their account before this could be resolved. This requires manual review.",
      };
    }

    // ── Step b: still unactivated — attempt ONE guarded compensating
    // rollback, pinning every value this action itself read. ──────────────
    const baseCompUpdate = supabase
      .from("operator_activation_lifecycles")
      .update({ released_at: null })
      .eq("id", lifecycleId)
      .eq("released_at", releasedAtIso)
      .eq("deadline_at", deadlineAt)
      .eq("reminder_stage", reminderStage)
      .is("reminder_lease_started_at", null);
    const compCasQuery = expiredAt ? baseCompUpdate.eq("expired_at", expiredAt) : baseCompUpdate.is("expired_at", null);

    const { data: rolledBack, error: rollbackError } = await compCasQuery.select("id").maybeSingle();
    const compensationSucceeded = !rollbackError && !!rolledBack;

    if (!compensationSucceeded) {
      console.error("[reconcileVenueReleaseFailure] Compensating rollback failed.", { lifecycleId, venueId, operatorId, rollbackError: rollbackError?.message });
      await sendAlert({
        channel: "ops-critical",
        severity: "critical",
        title: "Manual Release — Venue Could Not Be Released; Lifecycle Compensation FAILED",
        message:
          "The venue's ownership fields could not be cleared, AND the compensating lifecycle rollback also " +
          "failed. The lifecycle may now be released with the venue still claimed by a never-activated " +
          "operator. Manual intervention is required before retrying.",
        metadata: { ...baseMetadata, "Compensation attempted": "Yes", "Compensation succeeded": "No", "Activation detected": "No (unactivated at pre-check)", "Re-close succeeded": "N/A" },
      });
      return {
        outcome: "compensation_failed",
        founderMessage:
          "The activation could not be cleanly released or safely undone — this requires manual review before retrying. Please contact engineering.",
      };
    }

    // ── Step c: compensation succeeded — re-check activation AGAIN, since
    // the operator could have activated during the compensation attempt
    // itself. Never leave an activated operator with a live lifecycle. ─────
    const { data: postOperator, error: postOperatorError } = await supabase
      .from("operators")
      .select("account_activated_at")
      .eq("id", operatorId)
      .maybeSingle();

    if (postOperatorError) {
      // Compensation itself succeeded, but we can no longer confirm it's
      // safe to leave the lifecycle unreleased — err toward manual review
      // rather than claiming a retryable success we can't verify.
      console.error("[reconcileVenueReleaseFailure] Post-compensation operator re-check failed.", { lifecycleId, error: postOperatorError.message });
      await sendAlert({
        channel: "ops-critical",
        severity: "critical",
        title: "Manual Release — Compensation Succeeded But Post-Compensation Operator Status Could Not Be Verified",
        message:
          "The compensating lifecycle rollback succeeded, but this operator's activation status could not " +
          "be re-verified afterward. The lifecycle is currently unreleased; manual review is required " +
          "before assuming it is safe to retry.",
        metadata: { ...baseMetadata, "Compensation attempted": "Yes", "Compensation succeeded": "Yes", "Activation detected": "Unknown — post-compensation check failed", "Re-close succeeded": "N/A" },
      });
      return {
        outcome: "compensation_failed",
        founderMessage: "The action was undone, but the operator's current status could not be verified — please verify manually before retrying.",
      };
    }

    if (!postOperator?.account_activated_at) {
      // Still unactivated after compensation — safe, retryable.
      console.error("[reconcileVenueReleaseFailure] Compensation succeeded; operator remains unactivated — safe to retry.", { lifecycleId, venueId, operatorId });
      await sendAlert({
        channel: "ops-critical",
        severity: "critical",
        title: "Manual Release — Venue Could Not Be Released; Lifecycle Compensation Succeeded",
        message:
          "The venue's ownership fields could not be cleared, so this action's own lifecycle release was " +
          "undone (released_at cleared). The operator remains unactivated — the activation is safe to " +
          "retry from scratch.",
        metadata: { ...baseMetadata, "Compensation attempted": "Yes", "Compensation succeeded": "Yes", "Activation detected": "No", "Re-close succeeded": "N/A" },
      });
      return {
        outcome: "compensated",
        founderMessage: "The venue could not be released, so this action was undone. Please try Release again.",
      };
    }

    // Activated during the compensation gap itself — re-close immediately,
    // pinning the same snapshot compensation itself was pinned on.
    const baseRecloseUpdate = supabase
      .from("operator_activation_lifecycles")
      .update({ released_at: releasedAtIso })
      .eq("id", lifecycleId)
      .is("released_at", null)
      .eq("deadline_at", deadlineAt)
      .eq("reminder_stage", reminderStage)
      .is("reminder_lease_started_at", null);
    const recloseCasQuery = expiredAt ? baseRecloseUpdate.eq("expired_at", expiredAt) : baseRecloseUpdate.is("expired_at", null);
    const { data: reClosed, error: recloseError } = await recloseCasQuery.select("id").maybeSingle();
    const recloseSucceeded = !recloseError && !!reClosed;

    console.error("[reconcileVenueReleaseFailure] Operator activated during the compensation gap — re-closing.", {
      lifecycleId, venueId, operatorId, recloseSucceeded, recloseError: recloseError?.message,
    });

    await sendAlert({
      channel: "ops-critical",
      severity: "critical",
      title: recloseSucceeded
        ? "Manual Release — Operator Activated During Compensation Gap; Lifecycle Re-Closed"
        : "Manual Release — Operator Activated During Compensation Gap; RE-CLOSE FAILED",
      message: recloseSucceeded
        ? "The operator activated their account in the narrow window during compensation. The lifecycle " +
          "has been immediately re-closed (released_at set again) so it is never left live for an " +
          "activated operator. Manual review is still required."
        : "The operator activated their account in the narrow window during compensation, and the " +
          "attempt to immediately re-close the lifecycle FAILED. The lifecycle may currently be " +
          "unreleased for an already-activated operator. Manual intervention is required immediately.",
      metadata: { ...baseMetadata, "Compensation attempted": "Yes", "Compensation succeeded": "Yes", "Activation detected": "After compensation", "Re-close succeeded": recloseSucceeded ? "Yes" : "No" },
    });

    return {
      outcome: "activated_after_compensation",
      founderMessage: recloseSucceeded
        ? "The activation could not be closed cleanly — the operator activated their account during recovery, and the record has been re-closed. This requires manual review."
        : "The activation could not be closed cleanly, and an automatic recovery attempt also failed — this requires immediate manual intervention.",
    };
  }

  // Owned by a DIFFERENT operator now, or the linkage otherwise changed —
  // never touch that venue, never blindly reopen the lifecycle.
  console.error("[reconcileVenueReleaseFailure] Venue ownership changed to a different operator (or linkage drifted) — leaving both as-is.", {
    lifecycleId,
    venueId,
    expectedOperatorId: operatorId,
    actualOperatorId: freshVenue.created_by_operator_id,
  });

  await sendAlert({
    channel: "ops-critical",
    severity: "critical",
    title: "Manual Release — Venue Ownership Changed During Release; Lifecycle Left Released",
    message:
      "The originating venue's ownership no longer matches the operator this activation belonged to — it " +
      "may have been legitimately re-claimed by someone else. This venue was NOT modified, and the " +
      "lifecycle was NOT reopened (doing either could corrupt a different, legitimate flow). Manual " +
      "review is required.",
    metadata: {
      "Lifecycle ID": lifecycleId,
      Origin: originLabel,
      "Venue ID": venueId,
      "Expected operator ID": operatorId,
      "Actual operator ID": freshVenue.created_by_operator_id ?? "null",
      "Compensation attempted": "No",
      "Compensation succeeded": "N/A",
      "Activation detected": "N/A — different operator now owns the venue",
      "Re-close succeeded": "N/A",
    },
  });

  return {
    outcome: "ownership_changed",
    founderMessage:
      "The activation was closed, but the venue's ownership has changed since — this requires manual " +
      "review. No further action was taken automatically.",
  };
}

export async function releaseActivationLifecycleImpl(
  lifecycleId: string,
  deps: ReleaseActivationLifecycleDeps = {}
): Promise<ReleaseActivationState> {
  // ── Authorize founder — before ANY lifecycle/operator/origin/venue detail
  // is fetched or could be returned. Generic denial, matching every other
  // founder-only action in this codebase. ───────────────────────────────────
  const authClient = deps.authClient ?? (await createClient());
  const { data: { user } } = await authClient.auth.getUser();
  const checkAdmin = deps.checkAdmin ?? isControlPanelAdmin;
  if (!user || !(await checkAdmin(user.email))) {
    return { error: "Unauthorized." };
  }

  const supabase = deps.adminClient ?? createAdminClient();
  const revalidate = deps.revalidate ?? revalidatePath;
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const sendAlert = deps.sendAlert ?? sendSlackAlert;

  // ── Fetch the lifecycle fresh — nothing trusted from a prior page render. ─
  const { data: lifecycleRow, error: fetchError } = await supabase
    .from("operator_activation_lifecycles")
    .select(
      "id, operator_id, origin_type, origin_claim_id, origin_submission_id, started_at, deadline_at, expired_at, released_at, reminder_stage, reminder_lease_started_at"
    )
    .eq("id", lifecycleId)
    .maybeSingle();

  if (fetchError || !lifecycleRow) {
    console.error("[releaseActivationLifecycleImpl] Lifecycle fetch failed:", fetchError?.message);
    return { error: "Activation lifecycle not found. Please refresh and try again." };
  }

  if (lifecycleRow.released_at) {
    return { error: "This activation has already been released." };
  }

  if (lifecycleRow.reminder_lease_started_at) {
    return { error: LEASE_HELD_MESSAGE };
  }

  // ── Operator must still be unactivated, and the lifecycle must genuinely
  // be overdue (release_required or expired) — never a still-live window. ──
  const { data: operatorRow, error: operatorError } = await supabase
    .from("operators")
    .select("account_activated_at")
    .eq("id", lifecycleRow.operator_id as string)
    .maybeSingle();

  if (operatorError) {
    console.error("[releaseActivationLifecycleImpl] Operator lookup failed:", operatorError.message);
    return { error: "Could not verify operator status. Please try again." };
  }
  if (operatorRow?.account_activated_at) {
    return { error: "This operator has already activated their account. There is nothing to release." };
  }

  const currentDeadlineAt = lifecycleRow.deadline_at as string;
  const currentExpiredAt = (lifecycleRow.expired_at as string | null) ?? null;
  const currentReminderStage = lifecycleRow.reminder_stage as number;

  const state = deriveActivationState(
    {
      accountActivatedAt: null,
      activationStartedAt: lifecycleRow.started_at as string,
      activationDeadlineAt: currentDeadlineAt,
      expiredAt: currentExpiredAt,
      releasedAt: null,
    },
    now
  );
  if (state !== "release_required" && state !== "expired") {
    return {
      error:
        "This activation has not yet reached its deadline — release is only available once it is " +
        "Release Required or Expired.",
    };
  }

  // ── Resolve the ONE originating venue — must resolve unambiguously. ──────
  const origin: ActivationNoteOrigin =
    lifecycleRow.origin_type === "claim"
      ? { type: "claim", claimId: lifecycleRow.origin_claim_id as string }
      : { type: "submission", submissionId: lifecycleRow.origin_submission_id as string };

  let venueId: string | null = null;
  if (origin.type === "claim") {
    const { data: claimRow, error: claimError } = await supabase
      .from("venue_claims")
      .select("venue_id")
      .eq("id", origin.claimId)
      .maybeSingle();
    if (claimError || !claimRow?.venue_id) {
      console.error("[releaseActivationLifecycleImpl] Claim origin did not resolve to a venue.", { lifecycleId, error: claimError?.message });
      return { error: "Could not resolve the originating venue for this activation. Please refresh and try again." };
    }
    venueId = claimRow.venue_id as string;
  } else {
    const { data: subRow, error: subError } = await supabase
      .from("operator_submissions")
      .select("venue_id")
      .eq("id", origin.submissionId)
      .maybeSingle();
    if (subError || !subRow?.venue_id) {
      console.error("[releaseActivationLifecycleImpl] Submission origin did not resolve to a venue.", { lifecycleId, error: subError?.message });
      return { error: "Could not resolve the originating venue for this activation. Please refresh and try again." };
    }
    venueId = subRow.venue_id as string;
  }

  const { data: venueRow, error: venueFetchError } = await supabase
    .from("venues")
    .select("id, created_by_operator_id, claimed_by, claimed_at")
    .eq("id", venueId)
    .maybeSingle();

  if (venueFetchError || !venueRow) {
    console.error("[releaseActivationLifecycleImpl] Venue lookup failed.", { lifecycleId, venueId, error: venueFetchError?.message });
    return { error: "Could not resolve the originating venue for this activation. Please refresh and try again." };
  }
  if (venueRow.created_by_operator_id !== lifecycleRow.operator_id) {
    return {
      error: "This venue's ownership has changed since this record was loaded. Please refresh to see the current state.",
    };
  }

  // ── Immediately before the lifecycle CAS: re-check operator activation one
  // final time (belt-and-suspenders against activating in the last instant
  // between the read above and this write). ────────────────────────────────
  const { data: freshOperatorRow, error: freshOperatorError } = await supabase
    .from("operators")
    .select("account_activated_at")
    .eq("id", lifecycleRow.operator_id as string)
    .maybeSingle();
  if (freshOperatorError) {
    console.error("[releaseActivationLifecycleImpl] Fresh operator re-check failed:", freshOperatorError.message);
    return { error: "Could not verify operator status. Please try again." };
  }
  if (freshOperatorRow?.account_activated_at) {
    return { error: "This operator has already activated their account. There is nothing to release." };
  }

  // ── Lifecycle CAS — pins every value read above. Never touches expired_at,
  // never creates or modifies any other lifecycle row. ──────────────────────
  const baseUpdate = supabase
    .from("operator_activation_lifecycles")
    .update({ released_at: nowIso })
    .eq("id", lifecycleId)
    .is("released_at", null)
    .is("reminder_lease_started_at", null)
    .eq("deadline_at", currentDeadlineAt)
    .eq("reminder_stage", currentReminderStage);

  const lifecycleCasQuery = currentExpiredAt
    ? baseUpdate.eq("expired_at", currentExpiredAt)
    : baseUpdate.is("expired_at", null);

  const { data: lifecycleUpdated, error: lifecycleUpdateError } = await lifecycleCasQuery.select("id").maybeSingle();

  if (lifecycleUpdateError) {
    console.error("[releaseActivationLifecycleImpl] Lifecycle CAS failed:", lifecycleUpdateError.message);
    return { error: "Failed to release this activation. Please try again." };
  }

  if (!lifecycleUpdated) {
    // No venue change, no note — a clean, safe no-op on any conflict.
    const { data: leaseCheckRow } = await supabase
      .from("operator_activation_lifecycles")
      .select("reminder_lease_started_at")
      .eq("id", lifecycleId)
      .maybeSingle();
    if (leaseCheckRow?.reminder_lease_started_at) {
      return { error: LEASE_HELD_MESSAGE };
    }
    return {
      error:
        "This activation was changed by another action just now (extended, released, or activated). " +
        "Please refresh the page to see the current state before trying again.",
    };
  }

  // ── Venue CAS — scoped to the ONE resolved venue id, requiring ownership
  // still matches this exact operator. Never a bulk update by operator id;
  // never touches is_verified/is_published/venue content. ──────────────────
  const { data: venueUpdated, error: venueUpdateError } = await supabase
    .from("venues")
    .update({ claimed_by: null, claimed_at: null, created_by_operator_id: null })
    .eq("id", venueId)
    .eq("created_by_operator_id", lifecycleRow.operator_id as string)
    .select("id")
    .maybeSingle();

  if (venueUpdateError || !venueUpdated) {
    console.error("[releaseActivationLifecycleImpl] Lifecycle released but venue release failed — reconciling.", {
      lifecycleId,
      venueId,
      error: venueUpdateError?.message,
    });

    const reconciliation = await reconcileVenueReleaseFailure({
      supabase,
      sendAlert,
      lifecycleId,
      venueId,
      operatorId: lifecycleRow.operator_id as string,
      origin,
      releasedAtIso: nowIso,
      deadlineAt: currentDeadlineAt,
      expiredAt: currentExpiredAt,
      reminderStage: currentReminderStage,
      writeErrorMessage: venueUpdateError?.message ?? "0 rows matched",
    });

    if (reconciliation.outcome !== "already_cleared") {
      return { error: reconciliation.founderMessage };
    }
    // "already_cleared" — the venue turns out to already be in the correct
    // released state (e.g. a retried request whose first attempt's venue
    // write actually landed). Fall through exactly as if the CAS above had
    // matched, and proceed to the note step below.
  }

  // ── Structured note — founder-attributed (never the system author), only
  // after BOTH writes succeed. Direct insert (writeActivationNote() always
  // attributes to the system author, so it cannot be reused for a
  // founder-triggered event) with a deterministic event_key — a duplicate
  // insert on retry is treated as success, matching writeActivationNote()'s
  // own 23505-tolerance. ─────────────────────────────────────────────────────
  const notePayload = {
    note: "Venue released by founder — activation window closed without setup; venue ownership cleared.",
    event_type: "founder_manual_release",
    event_key: `hhc-activation-release:${lifecycleId}`,
    metadata_json: {
      lifecycleId,
      venueId,
      previousDeadline: currentDeadlineAt,
      releasedAt: nowIso,
      flow: origin.type,
    },
    created_by: user.id,
    created_by_email: user.email ?? null,
  };

  const { error: noteError } =
    origin.type === "claim"
      ? await supabase.from("venue_claim_notes").insert({ claim_id: origin.claimId, ...notePayload })
      : await supabase.from("operator_submission_notes").insert({ submission_id: origin.submissionId, ...notePayload });

  if (noteError && noteError.code !== "23505") {
    // Both writes genuinely succeeded — never reverse the release, never
    // re-run the venue mutation merely to recreate this note. Report
    // operational success; alert on the missing audit trail only.
    console.error("[releaseActivationLifecycleImpl] Structured note failed after successful release.", {
      lifecycleId,
      venueId,
      error: noteError.message,
    });
    await sendAlert({
      channel: "ops-alerts",
      severity: "warning",
      title: "Manual Release — Note Not Recorded",
      message:
        "The activation lifecycle and venue were both released successfully, but the structured " +
        "Internal Note could not be recorded. No retry is needed — this only means the audit trail is " +
        "missing this one entry.",
      metadata: { "Lifecycle ID": lifecycleId, "Venue ID": venueId, Error: noteError.message },
    });
  }

  console.log("[releaseActivationLifecycleImpl] Complete.", { lifecycleId, venueId });

  if (origin.type === "claim") {
    revalidate("/control-panel/claims");
    revalidate(`/control-panel/claims/${origin.claimId}`);
  } else {
    revalidate("/control-panel/operator-submissions");
    revalidate(`/control-panel/operator-submissions/${origin.submissionId}`);
  }

  return { success: true, successAction: "Venue released — activation closed and ownership cleared" };
}
