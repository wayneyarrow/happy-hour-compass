/**
 * Pure, client-safe presentation types/helpers for venue Internal Notes.
 *
 * BOUNDARY RULE — this module must NEVER import anything server-only (no
 * createAdminClient, no "@/lib/supabase/server", no "next/headers", no
 * Supabase client of any kind) and must have no side effects. It is
 * imported directly by VenueNotesSection.tsx, a "use client" component.
 *
 * This split exists because of a real build failure: VenueNotesSection.tsx
 * originally took only a `import type { VenueNote }` from
 * src/lib/data/venueNotes.ts, which is erased at compile time and never
 * touched the client bundle. Adding a runtime import of
 * resolveNoteAuthor() from that same server-only module pulled
 * createAdminClient()/next/headers into the client bundle and broke
 * `next build` ("You're importing a component that needs 'next/headers'").
 * Moving VenueNote + resolveNoteAuthor here — a module with no server
 * imports at all — makes that class of mistake structurally impossible
 * rather than relying on every future edit remembering to keep the
 * VenueNote import type-only. src/lib/data/venueNotes.ts (server-only data
 * fetching) re-exports VenueNote's type from here for backward
 * compatibility with its existing consumers; it must not import this
 * module's resolveNoteAuthor() as a value re-export target for
 * VenueNotesSection.tsx to consume — that component imports straight from
 * here instead.
 */

export type VenueNote = {
  id: string;
  venue_id: string;
  note: string;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  /**
   * Optional presentational override for the author line (see
   * resolveNoteAuthor below). Left unset for every real venue_notes /
   * operator_submission_notes / venue_claim_notes row — those keep their
   * existing "email, then uid:########, then Unknown" behavior unchanged.
   * Set only for computed system activity (currently: Customer Success
   * milestone entries — see getCustomerSuccessNotesForVenue in
   * venueNotes.ts) that has no real author to attribute and shouldn't
   * render as "Unknown".
   */
  author_label?: string | null;
};

/**
 * Resolves the author line shown under a note (see NoteEntry in
 * VenueNotesSection.tsx). Pure and exported so this exact behavior —
 * including "must not change for existing notes" — is unit-testable
 * without rendering React.
 *
 * Precedence: an explicit author_label (system activity with no real
 * author — e.g. Customer Success) wins first; otherwise falls back to the
 * original behavior, unchanged: created_by_email, then a truncated
 * created_by uid, then "Unknown" for a genuinely authorless real note.
 */
export function resolveNoteAuthor(
  note: Pick<VenueNote, "author_label" | "created_by_email" | "created_by">
): string {
  return (
    note.author_label ??
    note.created_by_email ??
    (note.created_by ? `uid:${note.created_by.slice(0, 8)}` : "Unknown")
  );
}
