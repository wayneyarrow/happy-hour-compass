-- =============================================================================
-- Happy Hour Compass — Venue Claim Activation Token Schema
-- Migration: 008_venue_claims_activation.sql
--
-- PURPOSE:
--   Adds activation token columns to venue_claims so that when an admin
--   approves a claim, a secure token can be stored and emailed to the
--   claimant for use on the future /activate-account page.
--
-- COLUMNS ADDED:
--   activation_token        — cryptographically secure random hex string,
--                             generated server-side at approval time.
--                             UNIQUE to ensure tokens cannot collide.
--   activation_expires_at   — timestamp when the token expires (approval + 7d).
--                             NULL on rows that are not yet approved.
--
-- NOTES:
--   - Both columns are nullable; only set on approved claims.
--   - The UNIQUE constraint prevents token reuse/collision across rows.
--   - The index on activation_token supports fast lookups on /activate-account.
-- =============================================================================

ALTER TABLE public.venue_claims
  ADD COLUMN IF NOT EXISTS activation_token       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS activation_expires_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.venue_claims.activation_token IS
  'Secure random hex token generated at approval time. Used by the claimant to '
  'create their operator account via /activate-account?token=... '
  'NULL on unapproved rows.';

COMMENT ON COLUMN public.venue_claims.activation_expires_at IS
  'Expiry timestamp for the activation token. Set to NOW() + 7 days at approval. '
  'NULL on unapproved rows.';

-- Index for fast token lookups during account activation
CREATE INDEX IF NOT EXISTS venue_claims_activation_token_idx
  ON public.venue_claims (activation_token)
  WHERE activation_token IS NOT NULL;
