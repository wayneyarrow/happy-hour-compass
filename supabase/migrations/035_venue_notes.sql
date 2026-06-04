-- =============================================================================
-- Happy Hour Compass — Venue Internal Notes
-- Migration: 035_venue_notes.sql
--
-- PURPOSE:
--   Append-only internal notes log for venues, scoped to the Control Panel.
--   Mirrors the pattern of venue_claim_notes (023) and
--   operator_submission_notes (022). Used by the Control Panel venue detail
--   page for founder/admin annotations, and auto-populated by discover
--   management actions (boost changes, exclude toggles, rail overrides).
--
-- DESIGN NOTES:
--   - Append-only: application only INSERTs; never UPDATEs or DELETEs notes.
--   - created_by stores auth.uid() (UUID) for attribution even if email changes.
--   - created_by_email is a snapshot at write time (denormalised for display).
--   - RLS is enabled; no permissive policies are added. The Control Panel uses
--     the service-role client (createAdminClient) which bypasses RLS entirely.
-- =============================================================================


-- ── 1. Create table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_notes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         UUID        NOT NULL
                               REFERENCES public.venues(id)
                               ON DELETE CASCADE,
  note             TEXT        NOT NULL,
  created_by       UUID,
  created_by_email TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.venue_notes IS
  'Append-only internal notes log for venues. '
  'Each row is one note added by a founder/admin. '
  'Notes are internal only — never shown to venue operators.';

COMMENT ON COLUMN public.venue_notes.venue_id IS
  'Foreign key to venues(id). Cascades on delete.';

COMMENT ON COLUMN public.venue_notes.note IS
  'Free-text internal note. Non-empty enforced at application level.';

COMMENT ON COLUMN public.venue_notes.created_by IS
  'auth.uid() of the admin who added the note. Nullable for audit resilience.';

COMMENT ON COLUMN public.venue_notes.created_by_email IS
  'Email snapshot of the author at write time (denormalised for display). '
  'Nullable for audit resilience.';


-- ── 2. Index ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS venue_notes_venue_created_idx
  ON public.venue_notes (venue_id, created_at DESC);


-- ── 3. RLS — enabled, no permissive policies ──────────────────────────────────
-- The Control Panel uses the service-role client which bypasses RLS.
-- Enabling RLS prevents accidental authenticated-user reads.

ALTER TABLE public.venue_notes ENABLE ROW LEVEL SECURITY;
