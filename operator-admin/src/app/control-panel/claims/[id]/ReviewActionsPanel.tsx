"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { reviewClaimAction, type ReviewState } from "./actions";

const INITIAL_STATE: ReviewState = {};

export default function ReviewActionsPanel({
  claimId,
  initialNotes,
  currentStatus,
}: {
  claimId: string;
  initialNotes: string | null;
  currentStatus: string;
}) {
  const router = useRouter();

  // Bind the claim ID so the action signature matches (prevState, formData)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (reviewClaimAction as any).bind(null, claimId);
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  // Refresh the server component once after a successful action so the
  // status badge + review metadata in the page header reflects the change.
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

  const isResolved =
    currentStatus === "approved" || currentStatus === "rejected";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
        Review actions
      </h3>

      {/* Success banner */}
      {state.success && (
        <div className="mt-3 mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span><strong>{state.successAction}</strong> — claim updated successfully.</span>
        </div>
      )}

      {/* General error */}
      {state.error && (
        <div className="mt-3 mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <form action={formAction} className="mt-3 space-y-4">
        {/* Review notes */}
        <div>
          <label htmlFor="review_notes" className="block text-xs font-medium text-gray-600 mb-1.5">
            Review notes
            <span className="text-gray-400 font-normal ml-1">(required for &quot;Request more info&quot;)</span>
          </label>
          <textarea
            id="review_notes"
            name="review_notes"
            rows={3}
            defaultValue={initialNotes ?? ""}
            placeholder="Internal notes visible only to the review team…"
            className={`w-full px-3 py-2 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-300 ${
              state.fieldErrors?.review_notes
                ? "border-red-400"
                : "border-gray-300"
            }`}
          />
          {state.fieldErrors?.review_notes && (
            <p className="mt-1 text-xs text-red-600">{state.fieldErrors.review_notes}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            name="action"
            value="approve"
            disabled={pending || isResolved}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Approve"}
          </button>

          <button
            type="submit"
            name="action"
            value="needs_more_info"
            disabled={pending}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Request more info"}
          </button>

          <button
            type="submit"
            name="action"
            value="reject"
            disabled={pending || isResolved}
            className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Reject"}
          </button>
        </div>

        {isResolved && !state.success && (
          <p className="text-xs text-gray-400">
            This claim is already resolved. Use &quot;Request more info&quot; to re-open the conversation.
          </p>
        )}
      </form>
    </div>
  );
}
