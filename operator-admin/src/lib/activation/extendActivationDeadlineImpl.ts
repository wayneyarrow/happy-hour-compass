import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { computeExtendedDeadline, DEADLINE_EXTENSION_DAYS } from "@/lib/activation/activationState";
import type { ActivationNoteOrigin } from "@/lib/activation/activationNotes";

/**
 * Implementation for extendActivationDeadlineAction, deliberately kept OUT of
 * the "use server" activationLifecycleActions.ts file (Phase 1B correction).
 *
 * WHY: Next.js treats every exported async function in a "use server" file
 * as a real, network-callable Server Action — including one exported only
 * "for testing." A prior version of this fix put a `deps` override
 * parameter directly on the exported action so tests could inject a fake
 * Supabase client / admin-check; a code review flagged that as a defect
 * regardless of whether today's Next.js transport happens to make it hard
 * to exploit — an exported action's signature should contain nothing but
 * legitimate client inputs. This file has no "use server" directive at all,
 * so it is never treated as an action and is never network-reachable: it's
 * an ordinary module, importable only from other server-side code (or
 * tests) within this app. activationLifecycleActions.ts's exported
 * `extendActivationDeadlineAction` is now a thin, fixed-signature wrapper
 * that calls this with no `deps` — a browser request can only ever reach
 * the fixed `(lifecycleId, prevState, formData)` signature and has no path
 * to influence anything inside this function, including `revalidate`
 * (which stays injectable here purely for tests, since revalidatePath()
 * throws outside a real Next.js request context — "static generation store
 * missing" — and this module is never invoked as a request in the first
 * place, so there is nothing insecure about that seam existing here).
 */

export type ExtendDeadlineState = {
  success?: true;
  successAction?: string;
  error?: string;
};

/** Test-only DI — real callers (the "use server" wrapper) always omit this. */
export type ExtendActivationDeadlineDeps = {
  authClient?: Awaited<ReturnType<typeof createClient>>;
  adminClient?: ReturnType<typeof createAdminClient>;
  checkAdmin?: (email: string | undefined) => Promise<boolean>;
  revalidate?: (path: string) => void;
};

/**
 * Extends an activation lifecycle's deadline by DEADLINE_EXTENSION_DAYS (7).
 *
 * Handles four distinct states explicitly:
 *   A. Live, future deadline → new deadline = CURRENT deadline + 7d.
 *   B. Deadline passed, expired_at IS NULL, not released → new deadline =
 *      now (this action's own timestamp) + 7d — a genuine fresh window.
 *   C. expired_at IS NOT NULL, released_at IS NULL → an explicit REOPEN:
 *      new deadline = now + 7d (computeExtendedDeadline() already takes this
 *      branch, since expired_at is only ever meaningful once the deadline
 *      has passed), expired_at is cleared, released_at is left untouched,
 *      and the prior expired_at value is preserved in the structured note's
 *      metadata (previousExpiredAt) rather than silently discarded.
 *   D. released_at IS NOT NULL → blocked outright; released_at is NEVER
 *      written by this function, in any state.
 *
 * PRESENTATION PRECEDENCE AFTER A REOPEN (case C): deriveActivationState()
 * checks accountActivatedAt, then releasedAt, then expiredAt, before ever
 * looking at the deadline — so clearing expired_at here and setting a
 * genuinely future deadline means the record immediately re-derives as
 * Awaiting Setup or Expiring Soon (never stays stuck on Expired) the next
 * time it's read. No separate "recompute state" step is needed; this falls
 * out of deriveActivationState()'s existing precedence once the stored
 * columns are correct.
 *
 * reminder_stage is (re)set to 0 — always factually accurate today since
 * nothing yet increments it; documents the intended future behavior (a
 * fresh window means no reminder has been sent against it) without
 * inventing a stage number that doesn't yet mean anything. No email is ever
 * sent by this action.
 *
 * CONCURRENCY: the update is an atomic compare-and-swap pinning EVERY
 * relevant prior value read above — `deadline_at`, `expired_at` (via `.eq()`
 * when non-null, `.is(..., null)` when null — SQL `NULL = NULL` is never
 * true, so a plain `.eq()` would silently fail to match a null expired_at),
 * and `released_at IS NULL`. Two simultaneous extends/reopens against the
 * same starting state can never both succeed: exactly one UPDATE matches a
 * row; the loser matches zero rows and is told to refresh and retry rather
 * than silently double-extending or clobbering the winner.
 *
 * Writes exactly one structured `deadline_extended` note, only after a
 * successful update, attributed to the real founder.
 */
export async function extendActivationDeadlineImpl(
  lifecycleId: string,
  deps: ExtendActivationDeadlineDeps = {}
): Promise<ExtendDeadlineState> {
  // ── Authorization — founder-only ─────────────────────────────────────────
  const authClient = deps.authClient ?? (await createClient());
  const { data: { user } } = await authClient.auth.getUser();
  const checkAdmin = deps.checkAdmin ?? isControlPanelAdmin;
  if (!user || !(await checkAdmin(user.email))) {
    return { error: "Unauthorized." };
  }

  const supabase = deps.adminClient ?? createAdminClient();
  const revalidate = deps.revalidate ?? revalidatePath;

  // ── Fetch the lifecycle fresh ─────────────────────────────────────────────
  const { data: lifecycleRow, error: fetchError } = await supabase
    .from("operator_activation_lifecycles")
    .select("id, operator_id, origin_type, origin_claim_id, origin_submission_id, deadline_at, expired_at, released_at")
    .eq("id", lifecycleId)
    .maybeSingle();

  if (fetchError || !lifecycleRow) {
    console.error("[extendActivationDeadlineImpl] Lifecycle fetch failed:", fetchError?.message);
    return { error: "Activation lifecycle not found. Please refresh and try again." };
  }

  if (lifecycleRow.released_at) {
    return { error: "This activation has already been released. The deadline cannot be extended." };
  }

  // ── Operator must still be unactivated ────────────────────────────────────
  const { data: operatorRow, error: operatorError } = await supabase
    .from("operators")
    .select("account_activated_at")
    .eq("id", lifecycleRow.operator_id as string)
    .maybeSingle();

  if (operatorError) {
    console.error("[extendActivationDeadlineImpl] Operator lookup failed:", operatorError.message);
    return { error: "Could not verify operator status. Please try again." };
  }
  if (operatorRow?.account_activated_at) {
    return { error: "This operator has already activated their account. The deadline cannot be extended." };
  }

  const currentDeadlineAt = lifecycleRow.deadline_at as string;
  const currentExpiredAt = (lifecycleRow.expired_at as string | null) ?? null;
  const newDeadlineAt = computeExtendedDeadline(currentDeadlineAt);

  // ── Atomic compare-and-swap update — pins deadline_at, expired_at, AND
  // released_at IS NULL, all to the values just read above. ─────────────────
  const baseUpdate = supabase
    .from("operator_activation_lifecycles")
    .update({
      deadline_at: newDeadlineAt,
      expired_at: null,
      reminder_stage: 0,
    })
    .eq("id", lifecycleId)
    .eq("deadline_at", currentDeadlineAt)
    .is("released_at", null);

  const casQuery = currentExpiredAt
    ? baseUpdate.eq("expired_at", currentExpiredAt)
    : baseUpdate.is("expired_at", null);

  const { data: updated, error: updateError } = await casQuery.select("id").maybeSingle();

  if (updateError) {
    console.error("[extendActivationDeadlineImpl] Update failed:", updateError.message);
    return { error: "Failed to extend the deadline. Please try again." };
  }

  if (!updated) {
    return {
      error:
        "This activation was changed by another action just now (extended, released, or " +
        "activated). Please refresh the page to see the current state before trying again.",
    };
  }

  // ── Structured note — a founder-triggered action, so this is attributed to
  // the REAL signed-in founder (created_by/created_by_email), NOT to the
  // "Happy Hour Compass" system-author string writeActivationNote() uses for
  // genuinely automated events. Only event_type/metadata_json are shared
  // with that helper's shape — see ClaimNotesSection/InternalNotesSection's
  // NoteEntry rendering, which shows the real author for any note with a
  // non-null created_by_email that isn't the literal system string. ─────────
  const origin: ActivationNoteOrigin =
    lifecycleRow.origin_type === "claim"
      ? { type: "claim", claimId: lifecycleRow.origin_claim_id as string }
      : { type: "submission", submissionId: lifecycleRow.origin_submission_id as string };

  const notePayload = {
    note: currentExpiredAt
      ? `Activation reopened and deadline extended by ${DEADLINE_EXTENSION_DAYS} days — new deadline ${newDeadlineAt}.`
      : `Activation deadline extended by ${DEADLINE_EXTENSION_DAYS} days — new deadline ${newDeadlineAt}.`,
    event_type: "deadline_extended",
    metadata_json: {
      lifecycleId,
      previousDeadline: currentDeadlineAt,
      newDeadline: newDeadlineAt,
      previousExpiredAt: currentExpiredAt,
      extensionDays: DEADLINE_EXTENSION_DAYS,
      extendedByEmail: user.email ?? null,
    },
    created_by: user.id,
    created_by_email: user.email ?? null,
  };

  const { error: noteError } =
    origin.type === "claim"
      ? await supabase.from("venue_claim_notes").insert({ claim_id: origin.claimId, ...notePayload })
      : await supabase.from("operator_submission_notes").insert({ submission_id: origin.submissionId, ...notePayload });

  if (noteError) {
    console.error("[extendActivationDeadlineImpl] Structured note failed.", {
      lifecycleId,
      error: noteError.message,
    });
  }

  console.log("[extendActivationDeadlineImpl] Complete.", {
    lifecycleId,
    previousDeadline: currentDeadlineAt,
    newDeadline: newDeadlineAt,
  });

  if (origin.type === "claim") {
    revalidate("/control-panel/claims");
    revalidate(`/control-panel/claims/${origin.claimId}`);
  } else {
    revalidate("/control-panel/operator-submissions");
    revalidate(`/control-panel/operator-submissions/${origin.submissionId}`);
  }

  return { success: true, successAction: `Deadline extended by ${DEADLINE_EXTENSION_DAYS} days` };
}
