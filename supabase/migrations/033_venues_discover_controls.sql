-- Migration 033: Venue Discover Engine Controls
--
-- Adds three internal-use fields used by the Discover Engine (Phase 2B):
--
--   internal_boost       — ranking lift applied across all discovery rails.
--                          0 = no lift, 100 = maximum lift.
--                          Does not bypass eligibility; ineligible venues stay hidden.
--
--   spotlight_eligible   — when true, the venue is in the primary Spotlight pool.
--                          When false (default), the venue may still appear via the
--                          isVerified fallback until enough eligible venues exist.
--
--   exclude_from_discover — when true, the venue is hidden from all Consumer Home
--                           rails and browse collections. Events from an excluded
--                           venue also do not appear in Featured Events.
--
-- Safe defaults:
--   • No existing venue is excluded (exclude_from_discover defaults to false).
--   • No existing venue gets Spotlight priority (spotlight_eligible defaults to false).
--   • No existing venue receives a boost (internal_boost defaults to 0).
--
-- These fields are managed by the internal team only.
-- No operator-facing UI is exposed for any of these columns.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS internal_boost       INTEGER NOT NULL DEFAULT 0
    CONSTRAINT venues_internal_boost_range CHECK (internal_boost >= 0 AND internal_boost <= 100),
  ADD COLUMN IF NOT EXISTS spotlight_eligible   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclude_from_discover BOOLEAN NOT NULL DEFAULT false;

-- Index for fast discover queries — the Discover Engine filters on
-- exclude_from_discover on every page load, so an index pays off quickly.
CREATE INDEX IF NOT EXISTS venues_exclude_from_discover_idx
  ON venues (exclude_from_discover)
  WHERE exclude_from_discover = true;

-- Index for Spotlight pool queries.
CREATE INDEX IF NOT EXISTS venues_spotlight_eligible_idx
  ON venues (spotlight_eligible)
  WHERE spotlight_eligible = true;
