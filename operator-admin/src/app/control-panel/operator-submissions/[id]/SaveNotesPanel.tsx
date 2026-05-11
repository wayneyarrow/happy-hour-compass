"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveSubmissionNotesAction, type SaveNotesState } from "./actions";

const INITIAL_STATE: SaveNotesState = {};

export default function SaveNotesPanel({
  submissionId,
  initialNotes,
}: {
  submissionId: string;
  initialNotes: string | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (saveSubmissionNotesAction as any).bind(null, submissionId);
  const [state, formAction, pending] = useActionState<SaveNotesState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  // Auto-clear the success flash after 3 s
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state.success) {
      timerRef.current = setTimeout(() => {
        // No state reset needed — the banner just stays briefly
      }, 3000);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [state.success]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Founder notes
        </h3>
        <p className="mt-1 text-xs text-gray-400">
          Internal only — never shared with the submitter.
        </p>
      </div>

      {state.success && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Notes saved
        </div>
      )}
      {state.error && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-3">
        <textarea
          name="review_notes"
          rows={4}
          defaultValue={initialNotes ?? ""}
          placeholder="Add internal notes about this submission…"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-300"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-1.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save notes"}
        </button>
      </form>
    </div>
  );
}
