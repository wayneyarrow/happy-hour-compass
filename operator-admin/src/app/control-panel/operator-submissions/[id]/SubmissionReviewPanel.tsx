"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  reviewSubmissionAction,
  approveAndCreateVenueAction,
  type SubmissionReviewState,
  type ApproveVenueState,
} from "./actions";

const INITIAL_REVIEW_STATE: SubmissionReviewState = {};
const INITIAL_APPROVE_STATE: ApproveVenueState = {};

// Statuses that show the "Approve & Create Venue" button
const APPROVE_ELIGIBLE = new Set([
  "info_submitted",
  "no_match",
  "needs_more_info",
  "rejected_by_user",
]);

export default function SubmissionReviewPanel({
  submissionId,
  currentStatus,
}: {
  submissionId: string;
  currentStatus: string;
}) {
  const router = useRouter();

  // ── Review actions (more info / close) ────────────────────────────────────
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

  // ── Approve & Create Venue ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundApprove = (approveAndCreateVenueAction as any).bind(null, submissionId);
  const [approveState, approveFormAction, approvePending] =
    useActionState<ApproveVenueState, FormData>(boundApprove, INITIAL_APPROVE_STATE);

  const didRefreshApprove = useRef(false);
  useEffect(() => {
    if (approveState.success && !didRefreshApprove.current) {
      didRefreshApprove.current = true;
      router.refresh();
    }
    if (!approveState.success) didRefreshApprove.current = false;
  }, [approveState.success, router]);

  const isClosed          = currentStatus === "closed";
  const isApproveEligible = APPROVE_ELIGIBLE.has(currentStatus);
  const isAnyPending      = reviewPending || approvePending;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        Review actions
      </h3>

      {/* Review success banner */}
      {reviewState.success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span><strong>{reviewState.successAction}</strong></span>
        </div>
      )}

      {/* Review error banner */}
      {reviewState.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {reviewState.error}
        </div>
      )}

      <form action={reviewFormAction} className="space-y-3">
        <button
          type="submit"
          name="action"
          value="needs_more_info"
          disabled={isAnyPending || isClosed}
          className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {reviewPending ? "Saving…" : "Request more info"}
        </button>

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
          <p className="text-xs text-gray-400 pt-1">
            This submission has been closed. No further actions are available.
          </p>
        )}
      </form>

      {/* ── Approve & Create Venue ─────────────────────────────────────────── */}
      {isApproveEligible && (
        <>
          <hr className="my-4 border-gray-100" />

          {/* Approve success banner */}
          {approveState.success && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span><strong>{approveState.successAction}</strong></span>
            </div>
          )}

          {/* Approve error banner */}
          {approveState.error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {approveState.error}
            </div>
          )}

          <form action={approveFormAction}>
            <button
              type="submit"
              disabled={isAnyPending}
              className="w-full px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {approvePending ? "Creating venue…" : "Approve & Create Venue"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
