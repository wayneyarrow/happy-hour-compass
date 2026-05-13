-- =============================================================================
-- Happy Hour Compass — Venue Claim Notes
-- Migration: 023_venue_claim_notes.sql
--
-- PURPOSE:
--   Adds an append-only internal notes log for venue claims, matching the
--   pattern established by operator_submission_notes (migration 022).
--
--   Claim review actions already store a single overwritable review_notes
--   field on venue_claims. This table adds a proper chronological audit trail
--   without touching that column — existing review_notes values are preserved
--   and displayed as a legacy note in the UI.
--
-- DESIGN NOTES:
--   - Append-only: application code only INSERTs; no UPDATE/DELETE.
--   - RLS enabled, no permissive policies. The Control Panel uses the
--     service-role client (createAdminClient) which bypasses RLS entirely.
--     This prevents accidental reads by authenticated non-admin users.
--   - created_by stores auth.uid() at write time for attribution.
--   - created_by_email is a snapshot (denormalised) for display without a join.
--   - The index covers the primary access pattern: all notes for one claim,
--     newest first.
--   - venue_claims.review_notes is NOT dropped — legacy data is preserved.
-- =============================================================================


-- ── 1. Create table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_claim_notes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         UUID        NOT NULL
                               REFERENCES public.venue_claims(id)
                               ON DELETE CASCADE,
  note             TEXT        NOT NULL,
  created_by       UUID,
  created_by_email TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.venue_claim_notes IS
  'Append-only internal notes log for venue claims. '
  'Each row is one note added by a founder/admin. '
  'Notes are internal only — never shared with claimants.';

COMMENT ON COLUMN public.venue_claim_notes.claim_id IS
  'Foreign key to venue_claims(id). Cascades on delete.';

COMMENT ON COLUMN public.venue_claim_notes.note IS
  'Free-text internal note. Non-empty enforced at application level.';

COMMENT ON COLUMN public.venue_claim_notes.created_by IS
  'auth.uid() of the admin who added the note. Nullable for audit resilience.';

COMMENT ON COLUMN public.venue_claim_notes.created_by_email IS
  'Email snapshot of the author at write time (denormalised for display). '
  'Nullable for audit resilience.';


-- ── 2. Index ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS venue_claim_notes_claim_created_idx
  ON public.venue_claim_notes (claim_id, created_at DESC);


-- ── 3. RLS — enabled, no permissive policies ──────────────────────────────────
-- The Control Panel uses the service-role client which bypasses RLS.
-- Enabling RLS here prevents accidental authenticated-user reads.

ALTER TABLE public.venue_claim_notes ENABLE ROW LEVEL SECURITY;
