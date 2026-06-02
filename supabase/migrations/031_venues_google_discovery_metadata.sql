-- =============================================================================
-- Migration: 031_venues_google_discovery_metadata.sql
--
-- Adds Google discovery metadata columns to the venues table.
--
-- These fields are populated exclusively by the HHC scraper pipeline from
-- the Google Places API (New).  They are NOT operator-editable and must not
-- appear in operator-facing forms or server actions.
--
-- Column notes:
--   google_maps_uri        — Canonical Google Maps URL for the place.
--   google_business_hours  — Pipe-delimited display string produced by the
--                            scraper (e.g. "Monday: 9 AM – 5 PM | Tuesday: …").
--                            Kept as TEXT because the scraper writes a
--                            pre-formatted string; structured JSONB can be
--                            added in a later migration if needed.
--   google_primary_type    — Primary Place type returned by Places API
--                            (e.g. "bar", "restaurant").
--   google_types           — Full array of Place type strings returned by the
--                            API.  TEXT[] with empty-array default so
--                            array-containment queries work without NULL checks.
--
-- Amenity booleans sourced from Places API attributeValues / booleans:
--   serves_beer, serves_wine, serves_cocktails, outdoor_seating, live_music,
--   allows_dogs, good_for_watching_sports, good_for_groups, good_for_children,
--   serves_vegetarian_food, reservable, accepts_credit_cards, accepts_cash_only.
--
--   All default to NULL (= unknown).  FALSE means the API explicitly returned
--   false; NULL means the API did not return a value for that attribute.
--
--   price_level       — Google price level string (e.g. "PRICE_LEVEL_MODERATE").
--   editorial_summary — Short editorial blurb from the API, if available.
--
-- RLS unchanged — these columns are read-only from the app's perspective.
-- No search_tags or seeded_tags changes in this migration.
-- =============================================================================

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS google_maps_uri           TEXT,
  ADD COLUMN IF NOT EXISTS google_business_hours     TEXT,
  ADD COLUMN IF NOT EXISTS google_primary_type       TEXT,
  ADD COLUMN IF NOT EXISTS google_types              TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS serves_beer               BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_wine               BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_cocktails          BOOLEAN,
  ADD COLUMN IF NOT EXISTS outdoor_seating           BOOLEAN,
  ADD COLUMN IF NOT EXISTS live_music                BOOLEAN,
  ADD COLUMN IF NOT EXISTS allows_dogs               BOOLEAN,
  ADD COLUMN IF NOT EXISTS good_for_watching_sports  BOOLEAN,
  ADD COLUMN IF NOT EXISTS good_for_groups           BOOLEAN,
  ADD COLUMN IF NOT EXISTS good_for_children         BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_vegetarian_food    BOOLEAN,
  ADD COLUMN IF NOT EXISTS price_level               TEXT,
  ADD COLUMN IF NOT EXISTS editorial_summary         TEXT,
  ADD COLUMN IF NOT EXISTS reservable                BOOLEAN,
  ADD COLUMN IF NOT EXISTS accepts_credit_cards      BOOLEAN,
  ADD COLUMN IF NOT EXISTS accepts_cash_only         BOOLEAN;
