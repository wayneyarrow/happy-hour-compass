"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  reviewSubmissionAction,
  resolveExistingVenueMatchAction,
  type SubmissionReviewState,
  type ResolveExistingVenueMatchState,
} from "./actions";

const INITIAL_REVIEW_STATE: SubmissionReviewState = {};
const INITIAL_RESOLVE_STATE: ResolveExistingVenueMatchState = {};

/**
 * Founder review panel for submissions that matched an existing venue
 * (status: pending_review or double_claim) instead of requiring a new one.
 *
 * Deliberately distinct from SubmissionReviewPanel:
 *   - No "Request more info" action here. This flow's ambiguity is about
 *     venue ownership, not missing business details, and routing these
 *     statuses through the generic needs_more_info → info_submitted
 *     lifecycle would make them eligible for "Approve & Create Venue"
 *     (the new-venue path) even though venue_id is already set — that
 *     action already guards against it, but presenting it at all would be
 *     misleading, so this panel never opens that path.
 *   - "Reject / Close" reuses reviewSubmissionAction's existing "close"
 *     branch as-is — it never touches the venue row, matching the
 *     requirement to close without modifying the matched venue.
 *   - "Approve — Link to Existing Venue" is a new action. Its availability
 *     here reflects the venue's claim state at page load; the server
 *     re-checks it fresh regardless before acting.
 */
export default function ExistingVenueMatchPanel({
  submissionId,
  currentStatus,
  venueName,
  venueClaimed,
}: {
  submissionId: string;
  currentStatus: string;
  venueName: string;
  /** Whether the matched venue currently has an owner (claimed_by or created_by_operator_id set). */
  venueClaimed: boolean;
}) {
  const router = useRouter();

  // ── Reject / Close (reused from the standard review action) ──────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundReview = (reviewSubmissionAction as any).bind(null, submissionId);
  const [reviewState, reviewFormAction, reviewPending] =
    useActionState<SubmissionReviewState, FormData>(boundReview, INITIAL_REVIEW_STATE);

  const didRefreshReview = useRef(false);
  useEffect(() => {
    if (reviewState.success && !didRefreshReview.current) {
      didRefreshReview.current = true;
      router.refresh();
    }
    if (!reviewState.success) didRefreshReview.current = false;
  }, [reviewState.success, router]);

  // ── Approve — Link to Existing Venue ──────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundResolve = (resolveExistingVenueMatchAction as any).bind(null, submissionId);
  const [resolveState, resolveFormAction, resolvePending] =
    useActionState<ResolveExistingVenueMatchState, FormData>(boundResolve, INITIAL_RESOLVE_STATE);

  const didRefreshResolve = useRef(false);
  useEffect(() => {
    if (resolveState.success && !didRefreshResolve.current) {
      didRefreshResolve.current = true;
      router.refresh();
    }
    if (!resolveState.success) didRefreshResolve.current = false;
  }, [resolveState.success, router]);

  const isClosed     = currentStatus === "closed";
  const isAnyPending = reviewPending || resolvePending;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
        Existing venue match
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        This submission matched <strong className="text-gray-600">{venueName}</strong>, an
        existing venue — no new venue will be created by resolving it.
      </p>

      {/* Approve success/error banners */}
      {resolveState.success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span><strong>{resolveState.successAction}</strong></span>
        </div>
      )}
      {resolveState.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {resolveState.error}
        </div>
      )}

      {/* Review success/error banners */}
      {reviewState.success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span><strong>{reviewState.successAction}</strong></span>
        </div>
      )}
      {reviewState.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {reviewState.error}
        </div>
      )}

      {venueClaimed ? (
        <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          This venue is currently claimed by another operator — approving is blocked to
          prevent reassigning an active listing. Reject / close this submission, or resolve
          ownership manually if this is a genuine dispute.
        </p>
      ) : (
        <form action={resolveFormAction} className="mb-3">
          <button
            type="submit"
            disabled={isAnyPending || isClosed}
            className="w-full px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resolvePending ? "Approving…" : "Approve — Link to Existing Venue"}
          </button>
        </form>
      )}

      <form action={reviewFormAction}>
        <button
          type="submit"
          name="action"
          value="close"
          disabled={isAnyPending || isClosed}
          className="w-full px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {reviewPending ? "Saving…" : "Reject / Close"}
        </button>

        {isClosed && !reviewState.success && (
          <p className="text-xs text-gray-400 pt-2">
            This submission has been closed. No further actions are available.
          </p>
        )}
      </form>
    </div>
  );
}
