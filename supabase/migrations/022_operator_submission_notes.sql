-- =============================================================================
-- Happy Hour Compass — Operator Submission Notes
-- Migration: 022_operator_submission_notes.sql
--
-- PURPOSE:
--   Replaces the single-value review_notes column on operator_submissions with
--   a proper append-only internal notes log. Each note is a separate row,
--   creating a chronological audit trail of founder/admin observations.
--
-- DESIGN NOTES:
--   - review_notes on operator_submissions is NOT dropped — existing rows that
--     have a non-null review_notes are preserved and surfaced in the UI as a
--     read-only "legacy note". No data is lost.
--   - New notes go into operator_submission_notes. review_notes is no longer
--     written by the application (saveSubmissionNotesAction is replaced by
--     addSubmissionNoteAction which inserts here instead).
--   - created_by stores auth.uid() (UUID) so notes can be attributed even if
--     email changes.
--   - created_by_email is a snapshot at write time — denormalised for display
--     without needing a join to auth.users.
--   - RLS is enabled; no permissive policies are added. The Control Panel uses
--     the service-role client (createAdminClient) which bypasses RLS entirely.
--     This prevents any accidental reads by authenticated non-admin users.
--   - The index covers the most common access pattern: fetch all notes for a
--     single submission, newest first.
-- =============================================================================


-- ── 1. Create table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.operator_submission_notes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID        NOT NULL
                              REFERENCES public.operator_submissions(id)
                              ON DELETE CASCADE,
  note            TEXT        NOT NULL,
  created_by      UUID,
  created_by_email TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operator_submission_notes IS
  'Append-only internal notes log for operator submissions. '
  'Each row is one note added by a founder/admin. '
  'Notes are internal only — never sent to submitters.';

COMMENT ON COLUMN public.operator_submission_notes.submission_id IS
  'Foreign key to operator_submissions(id). Cascades on delete.';

COMMENT ON COLUMN public.operator_submission_notes.note IS
  'Free-text internal note. Non-empty enforced at application level.';

COMMENT ON COLUMN public.operator_submission_notes.created_by IS
  'auth.uid() of the admin who added the note. Nullable for audit resilience.';

COMMENT ON COLUMN public.operator_submission_notes.created_by_email IS
  'Email snapshot of the author at write time (denormalised for display). '
  'Nullable for audit resilience.';


-- ── 2. Index ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS operator_submission_notes_submission_created_idx
  ON public.operator_submission_notes (submission_id, created_at DESC);


-- ── 3. RLS — enabled, no permissive policies ──────────────────────────────────
-- The Control Panel uses the service-role client which bypasses RLS.
-- Enabling RLS here prevents accidental authenticated-user reads.

ALTER TABLE public.operator_submission_notes ENABLE ROW LEVEL SECURITY;
