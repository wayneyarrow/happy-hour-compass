"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { reviewSubmissionAction, type SubmissionReviewState } from "./actions";

const INITIAL_STATE: SubmissionReviewState = {};

export default function SubmissionReviewPanel({
  submissionId,
  initialNotes,
  currentStatus,
}: {
  submissionId: string;
  initialNotes: string | null;
  currentStatus: string;
}) {
  const router = useRouter();

  // Bind submissionId so the action signature matches (prevState, formData)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (reviewSubmissionAction as any).bind(null, submissionId);
  const [state, formAction, pending] = useActionState<SubmissionReviewState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  // Refresh the server component once after a successful action so status
  // badges and review metadata in the page header reflect the change.
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
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
        Review actions
      </h3>
      <p className="text-xs text-gray-400 mb-3">
        Notes are required for both actions.
        For &ldquo;Request more info&rdquo;, they are sent verbatim to the submitter.
      </p>

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

      <form action={formAction} className="space-y-4">
        {/* Review notes */}
        <div>
          <label
            htmlFor="review_notes"
            className="block text-xs font-medium text-gray-600 mb-1.5"
          >
            Review notes <span className="text-red-500">*</span>
          </label>
          <textarea
            id="review_notes"
            name="review_notes"
            rows={3}
            defaultValue={initialNotes ?? ""}
            placeholder="For 'Request more info': describe what you need — this text goes in the email. For 'Reject / Close': internal reason only."
            className={`w-full px-3 py-2 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-300 ${
              state.fieldErrors?.review_notes ? "border-red-400" : "border-gray-300"
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
            value="needs_more_info"
            disabled={pending || isClosed}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Request more info"}
          </button>

          <button
            type="submit"
            name="action"
            value="close"
            disabled={pending || isClosed}
            className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Reject / Close"}
          </button>
        </div>

        {isClosed && !state.success && (
          <p className="text-xs text-gray-400">
            This submission has been closed. No further actions are available.
          </p>
        )}
      </form>
    </div>
  );
}
