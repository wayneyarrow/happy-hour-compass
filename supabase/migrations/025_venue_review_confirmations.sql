-- =============================================================================
-- Happy Hour Compass — Venue Review Confirmations
-- Migration: 025_venue_review_confirmations.sql
--
-- PURPOSE:
--   Adds explicit review-confirmation state for claimed/imported venues.
--   Tracks which imported profile items the operator has manually confirmed
--   as reviewed. Imported data is NOT the same as verified data — this column
--   bridges that gap.
--
-- WHAT THIS MIGRATION DOES:
--   Adds review_confirmations JSONB column to venues.
--   Keys are review task identifiers (e.g. "claimedReview_businessDetails").
--   Value is true when the operator has explicitly clicked "Mark reviewed".
--   Only meaningful for claimed venues; empty object for submitted/new venues.
--
-- EXAMPLE VALUE:
--   {
--     "claimedReview_businessDetails": true,
--     "claimedReview_businessHours": true,
--     "claimedReview_hhTimes": true
--   }
--
-- SECURITY:
--   Only review keys from a defined allowlist in the server action are accepted.
--   Arbitrary key injection via form data is blocked at the application layer.
-- =============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS review_confirmations JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.venues.review_confirmations IS
  'Claimed venues: tracks which imported profile items the operator has '
  'explicitly confirmed as reviewed. Keys are review task identifiers '
  '(e.g. claimedReview_businessDetails → true). Empty object by default. '
  'Only populated for claimed venues; submitted venues leave this as {}.';
