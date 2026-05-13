"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { reviewClaimAction, type ReviewState } from "./actions";

const INITIAL_STATE: ReviewState = {};

export default function ReviewActionsPanel({
  claimId,
  currentStatus,
}: {
  claimId: string;
  currentStatus: string;
}) {
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (reviewClaimAction as any).bind(null, claimId);
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  const didRefresh = useRef(false);
  useEffect(() => {
    if (state.success && !didRefresh.current) {
      didRefresh.current = true;
      router.refresh();
    }
    if (!state.success) didRefresh.current = false;
  }, [state.success, router]);

  const isResolved      = currentStatus === "approved" || currentStatus === "rejected";
  const isInfoSubmitted = currentStatus === "info_submitted";

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

      {/* Info callout when claimant has submitted verification details */}
      {isInfoSubmitted && !state.success && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-purple-50 border border-purple-200 px-4 py-3 text-sm text-purple-700">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          <span>Claimant has submitted verification details — review above before approving or rejecting.</span>
        </div>
      )}

      <form action={formAction} className="space-y-3">
        {/* Request more info — hidden once claimant has responded */}
        {!isInfoSubmitted && (
          <button
            type="submit"
            name="action"
            value="needs_more_info"
            disabled={pending || isResolved}
            className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Request more info"}
          </button>
        )}

        <button
          type="submit"
          name="action"
          value="reject"
          disabled={pending || isResolved}
          className="w-full px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Reject"}
        </button>

        <hr className="border-gray-100" />

        <button
          type="submit"
          name="action"
          value="approve"
          disabled={pending || isResolved}
          className="w-full px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Approve Claim"}
        </button>
      </form>
    </div>
  );
}
