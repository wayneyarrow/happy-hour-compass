-- migration: 012_venues_google_rating
--
-- Adds Google rating and review count to venues.
--
-- NOTE: venues already has a place_id TEXT column (the canonical Google Places
-- identifier).  This migration does NOT add a duplicate place-id field.
-- The existing place_id is used directly by the backfill script for API lookups.
--
-- google_rating       — Decimal rating (e.g. 4.3). NUMERIC(3,1) supports 0.0–5.0.
-- google_review_count — Total review count (integer, non-negative).
--
-- Both default to NULL.  Missing values are valid and must not block publishing
-- or claim logic.
--
-- Backfill existing venues via:
--   npm run backfill:google-rating           ← dry-run
--   npm run backfill:google-rating -- --write ← apply
--
-- Requires GOOGLE_PLACES_API_KEY in operator-admin/.env.local

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS google_rating NUMERIC(3,1)
    CHECK (google_rating IS NULL OR (google_rating >= 0 AND google_rating <= 5)),
  ADD COLUMN IF NOT EXISTS google_review_count INTEGER
    CHECK (google_review_count IS NULL OR google_review_count >= 0);
