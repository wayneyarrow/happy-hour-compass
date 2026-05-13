-- =============================================================================
-- Happy Hour Compass — Venue Claims: Structured More-Info Workflow
-- Migration: 024_venue_claims_more_info.sql
--
-- PURPOSE:
--   Upgrades the venue claims "needs_more_info" path from a simple email
--   nudge into a structured, tokenised verification form — matching the
--   pattern established for operator submissions (migrations 020–021).
--
-- WHAT THIS MIGRATION DOES:
--   1. Adds info_submitted to the status CHECK constraint.
--   2. Adds secure token columns (more_info_token, _expires_at, _completed_at).
--   3. Adds structured verification columns (info_phone, info_website,
--      info_socials, info_relationship, info_preferred_contact,
--      info_additional_notes) — founder-review-only; never surfaced to
--      the operator admin or publicly.
--   4. Adds an index on more_info_token for O(1) public form token lookup.
--
-- NEW STATUS:
--   info_submitted — claimant completed the structured verification form;
--                    awaiting founder review.
--
-- TOKEN COLUMNS:
--   more_info_token       TEXT UNIQUE — 64-char hex (32 random bytes). One
--                                       active token per claim; overwritten on
--                                       re-request. Cleared to NULL after use.
--   more_info_expires_at  TIMESTAMPTZ — 72 hours after generation.
--   more_info_completed_at TIMESTAMPTZ — set when the claimant submits. Guards
--                                        against token reuse alongside clearing.
--
-- VERIFICATION COLUMNS:
--   These are founder-review-only. They MUST NOT be surfaced in Operator Admin
--   or used as authoritative venue data. Mirrors operator_submissions info_*.
-- =============================================================================


-- ── 1. Expand status CHECK constraint ────────────────────────────────────────

ALTER TABLE public.venue_claims
  DROP CONSTRAINT IF EXISTS venue_claims_status_check;

ALTER TABLE public.venue_claims
  ADD CONSTRAINT venue_claims_status_check
  CHECK (status IN (
    'pending',
    'approved',
    'needs_more_info',
    'rejected',
    -- Structured more-info form (this migration)
    'info_submitted'
  ));

COMMENT ON COLUMN public.venue_claims.status IS
  'Claim review status. '
  'pending: awaiting founder review. '
  'needs_more_info: founder sent structured verification form link to claimant. '
  'info_submitted: claimant completed the verification form; ready for review. '
  'approved: founder approved — operator account provisioned. '
  'rejected: founder rejected the claim.';


-- ── 2. Token columns ──────────────────────────────────────────────────────────

ALTER TABLE public.venue_claims
  ADD COLUMN IF NOT EXISTS more_info_token          TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS more_info_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS more_info_completed_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.venue_claims.more_info_token IS
  '64-char hex token (32 random bytes) — credential for the public more-info '
  'form URL. UNIQUE across all claims. Cleared to NULL after form submission. '
  'Overwritten on re-request. Never logged.';

COMMENT ON COLUMN public.venue_claims.more_info_expires_at IS
  'Token expiration: NOW() + 72h at generation. NULL after token is cleared.';

COMMENT ON COLUMN public.venue_claims.more_info_completed_at IS
  'Set when the claimant successfully submits the verification form. '
  'Guards against token reuse alongside token clearing.';

-- Index for fast public token lookup (O(1) for the form page server-side check)
CREATE INDEX IF NOT EXISTS venue_claims_more_info_token_idx
  ON public.venue_claims (more_info_token)
  WHERE more_info_token IS NOT NULL;


-- ── 3. Verification detail columns ───────────────────────────────────────────
--    Founder-review-only. Must not be surfaced in Operator Admin.

ALTER TABLE public.venue_claims
  ADD COLUMN IF NOT EXISTS info_phone              TEXT,
  ADD COLUMN IF NOT EXISTS info_website            TEXT,
  ADD COLUMN IF NOT EXISTS info_socials            JSONB,
  ADD COLUMN IF NOT EXISTS info_relationship       TEXT,
  ADD COLUMN IF NOT EXISTS info_additional_notes   TEXT,
  ADD COLUMN IF NOT EXISTS info_preferred_contact  TEXT;

COMMENT ON COLUMN public.venue_claims.info_phone IS
  'Business phone number from the more-info form. Founder-review-only.';

COMMENT ON COLUMN public.venue_claims.info_website IS
  'Business website or primary social URL from the more-info form. Founder-review-only.';

COMMENT ON COLUMN public.venue_claims.info_socials IS
  'JSONB map of social profiles: { instagram, facebook, tiktok } (keys optional). '
  'Founder-review-only.';

COMMENT ON COLUMN public.venue_claims.info_relationship IS
  'Claimant''s free-text description of their relationship to the venue. '
  'Founder-review-only.';

COMMENT ON COLUMN public.venue_claims.info_additional_notes IS
  'Any additional context the claimant chose to provide. Founder-review-only.';

COMMENT ON COLUMN public.venue_claims.info_preferred_contact IS
  'How the founder should follow up with the claimant. Founder-review-only.';
