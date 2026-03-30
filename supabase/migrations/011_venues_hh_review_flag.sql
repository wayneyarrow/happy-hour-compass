-- migration: 011_venues_hh_review_flag
--
-- Adds a durable flag to mark venues whose hh_times value could not be
-- automatically normalized during the bulk normalization pass (Step 2) and
-- require a human to supply correct day/time data before publishing.
--
-- Backfill is applied separately via:
--   npm run backfill:hh-review -- --write

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS hh_times_needs_review BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — only indexes rows that actually need review so the
-- index stays tiny and lookups stay fast.
CREATE INDEX IF NOT EXISTS venues_hh_times_needs_review_idx
  ON venues (hh_times_needs_review)
  WHERE hh_times_needs_review = TRUE;
