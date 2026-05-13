"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { addClaimNoteAction, type AddClaimNoteState } from "./actions";
import type { ClaimNote } from "@/lib/data/claims";

const INITIAL_STATE: AddClaimNoteState = {};

function fmtNote(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month:  "short",
    day:    "numeric",
    year:   "numeric",
    hour:   "numeric",
    minute: "2-digit",
  });
}

function NoteEntry({ note }: { note: ClaimNote }) {
  const author =
    note.created_by_email ??
    (note.created_by ? `uid:${note.created_by.slice(0, 8)}` : "Unknown");
  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed mb-1.5">
        {note.note}
      </p>
      <p className="text-[11px] text-gray-400">
        {fmtNote(note.created_at)} · {author}
      </p>
    </div>
  );
}

export default function ClaimNotesSection({
  claimId,
  initialNotes,
  legacyNote,
}: {
  claimId: string;
  initialNotes: ClaimNote[];
  /** Legacy review_notes value from the claim row — shown read-only at bottom. */
  legacyNote: string | null;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (addClaimNoteAction as any).bind(null, claimId);
  const [state, formAction, pending] = useActionState<AddClaimNoteState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  // Refresh server data so the new note appears, then clear the textarea.
  const didRefresh = useRef(false);
  useEffect(() => {
    if (state.success && !didRefresh.current) {
      didRefresh.current = true;
      if (textareaRef.current) textareaRef.current.value = "";
      router.refresh();
    }
    if (!state.success) didRefresh.current = false;
  }, [state.success, router]);

  const hasNotes = initialNotes.length > 0 || !!legacyNote;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Internal Notes
        </h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Internal only — never shared with the claimant.
        </p>
      </div>

      {/* Add note form */}
      <form action={formAction} className="mb-5">
        <textarea
          ref={textareaRef}
          name="note"
          rows={3}
          placeholder="Add an internal note…"
          className={`w-full px-3 py-2 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-300 ${
            state.fieldError ? "border-red-400" : "border-gray-300"
          }`}
        />
        {state.fieldError && (
          <p className="mt-1 text-xs text-red-600">{state.fieldError}</p>
        )}
        {state.error && (
          <p className="mt-1 text-xs text-red-600">{state.error}</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Add note"}
          </button>
          {state.success && (
            <span className="text-xs text-green-600 font-medium">Note saved</span>
          )}
        </div>
      </form>

      {/* Note history */}
      {hasNotes ? (
        <div className="-mb-1">
          {/* New notes — newest first (order from query) */}
          {initialNotes.map((n) => (
            <NoteEntry key={n.id} note={n} />
          ))}

          {/* Legacy review_notes shown as a read-only historical entry */}
          {legacyNote && (
            <div className="py-3 border-b border-gray-100 last:border-0">
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed mb-1.5">
                {legacyNote}
              </p>
              <p className="text-[11px] text-gray-400 italic">
                Legacy note (from review_notes)
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No notes yet.</p>
      )}
    </div>
  );
}
