-- Migration 034: Discover Rail Overrides
--
-- Adds the discover_rail_overrides table, which powers the internal curation
-- layer of the Discover Engine.
--
-- The curation model:
--   System Recommendations (algorithm)
--   + Internal Curation (this table)
--   = Final rail candidate pool
--
-- action = 'include'  — adds a venue to a specific rail even if the algorithm
--                       would not normally select it.  Geography and global
--                       eligibility (exclude_from_discover) still apply; a
--                       Toronto venue cannot be included in the Central Okanagan
--                       Spotlight rail.
--
-- action = 'exclude'  — removes a venue from a specific rail regardless of
--                       algorithm output.  This is rail-scoped: the venue can
--                       still appear in other rails.
--                       For a venue-wide hard suppression, use
--                       venues.exclude_from_discover instead.
--
-- One row per (rail_key, venue_id) pair — UNIQUE constraint enforces this.
-- Upserting on conflict updates action + reason + note + timestamps.
--
-- rail_key values must match the RAIL_KEYS constant in discoverOverrides.ts:
--   spotlight | patio-picks | featured-nearby | new-this-week | featured-events

CREATE TABLE IF NOT EXISTS discover_rail_overrides (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rail_key     TEXT        NOT NULL,
  venue_id     UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  action       TEXT        NOT NULL CHECK (action IN ('include', 'exclude')),
  reason_type  TEXT        CHECK (reason_type IN (
                              'strong_local_fit',
                              'missing_from_algorithm',
                              'premium_priority',
                              'seasonal',
                              'weak_fit',
                              'data_tag_issue',
                              'poor_listing_quality',
                              'temporary_removal',
                              'other'
                            )),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT,

  CONSTRAINT discover_rail_overrides_unique_rail_venue
    UNIQUE (rail_key, venue_id)
);

-- Index for fast per-rail queries on the consumer home page.
CREATE INDEX IF NOT EXISTS discover_rail_overrides_rail_key_idx
  ON discover_rail_overrides (rail_key);
