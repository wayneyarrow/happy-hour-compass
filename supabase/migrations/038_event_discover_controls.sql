-- Migration 038: Event-level discover controls
--
-- Adds internal_boost + exclude_from_discover columns to the events table so
-- individual events can be boosted or suppressed in discover rails independently
-- of their parent venue.
--
-- Creates discover_event_overrides for event-level rail curation overrides
-- (nix / force-include a specific event from a specific rail).
-- Mirrors the pattern of discover_rail_overrides (034) which operates at the
-- venue level. The two tables are independent — venue-level overrides still
-- apply to Featured Events, and event-level overrides are checked in addition.

-- ── Event-level discover columns ───────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS internal_boost       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exclude_from_discover BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE events
  ADD CONSTRAINT events_internal_boost_range
    CHECK (internal_boost BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS idx_events_exclude_from_discover
  ON events (exclude_from_discover)
  WHERE exclude_from_discover = true;

-- ── Event-level rail override table ────────────────────────────────────────────
-- Unique constraint on (rail_key, event_id) — one override per rail per event.
-- ON DELETE CASCADE: if an event is deleted, its override rows are removed too.

CREATE TABLE IF NOT EXISTS discover_event_overrides (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rail_key    TEXT        NOT NULL,
  event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL CHECK (action IN ('include', 'exclude')),
  reason_type TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  UNIQUE (rail_key, event_id)
);

CREATE INDEX IF NOT EXISTS idx_discover_event_overrides_rail_key
  ON discover_event_overrides (rail_key);
