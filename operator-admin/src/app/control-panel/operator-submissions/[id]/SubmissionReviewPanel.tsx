"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { reviewSubmissionAction, type SubmissionReviewState } from "./actions";

const INITIAL_STATE: SubmissionReviewState = {};

export default function SubmissionReviewPanel({
  submissionId,
  currentStatus,
}: {
  submissionId: string;
  currentStatus: string;
}) {
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (reviewSubmissionAction as any).bind(null, submissionId);
  const [state, formAction, pending] = useActionState<SubmissionReviewState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  const didRefresh = useRef(false);
  useEffect(() => {
    if (state.success && !didRefresh.current) {
      didRefresh.current = true;
      router.refresh();
    }
    if (!state.success) {
      didRefresh.current = false;
    }
  }, [state.success, router]);

  const isClosed = currentStatus === "closed";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        Review actions
      </h3>

      {/* Success banner */}
      {state.success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span><strong>{state.successAction}</strong></span>
        </div>
      )}

      {/* Error banner */}
      {state.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-3">
        <button
          type="submit"
          name="action"
          value="needs_more_info"
          disabled={pending || isClosed}
          className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Request more info"}
        </button>

        <button
          type="submit"
          name="action"
          value="close"
          disabled={pending || isClosed}
          className="w-full px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Reject / Close"}
        </button>

        {isClosed && !state.success && (
          <p className="text-xs text-gray-400 pt-1">
            This submission has been closed. No further actions are available.
          </p>
        )}
      </form>
    </div>
  );
}
