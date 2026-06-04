"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { addVenueNoteAction, type VenueNoteState } from "./actions";
import type { VenueNote } from "@/lib/data/venueNotes";

const INITIAL_STATE: VenueNoteState = {};

function fmtNote(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month:  "short",
    day:    "numeric",
    year:   "numeric",
    hour:   "numeric",
    minute: "2-digit",
  });
}

function NoteEntry({ note }: { note: VenueNote }) {
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

export default function VenueNotesSection({
  venueId,
  initialNotes,
}: {
  venueId: string;
  initialNotes: VenueNote[];
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (addVenueNoteAction as any).bind(null, venueId);
  const [state, formAction, pending] = useActionState<VenueNoteState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  const didRefresh = useRef(false);
  useEffect(() => {
    if (state.success && !didRefresh.current) {
      didRefresh.current = true;
      if (textareaRef.current) textareaRef.current.value = "";
      router.refresh();
    }
    if (!state.success) {
      didRefresh.current = false;
    }
  }, [state.success, router]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Internal Notes
        </h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Internal only — never shared with the venue operator.
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
      {initialNotes.length > 0 ? (
        <div className="-mb-1">
          {initialNotes.map((n) => (
            <NoteEntry key={n.id} note={n} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No notes yet.</p>
      )}
    </div>
  );
}
