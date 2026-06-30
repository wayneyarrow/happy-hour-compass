-- =============================================================================
-- 050_event_premium_landing_fields.sql
--
-- Adds premium event landing page fields to public.events to support a
-- best-in-class consumer event landing page and help venues increase
-- food and beverage revenue through informed consumer decisions.
--
-- New columns:
--   price_display              TEXT — human-readable price label for consumers
--   age_restriction            TEXT — consumer age guidance (e.g. "All Ages", "19+")
--   reservation_recommendation TEXT — reservation guidance (e.g. "Reservations Required")
--   parking_notes              TEXT — short free-text parking guidance
--   accessibility_notes        TEXT — short free-text accessibility information
--
-- All columns are nullable with no enum enforcement at the database level.
-- Suggested values are enforced in the Operator Admin UI only, allowing
-- operators to enter free-form text when needed.
--
-- No backfill required — all columns default to NULL, preserving existing
-- event rows without modification.
-- =============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS price_display              TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS age_restriction            TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reservation_recommendation TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS parking_notes              TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS accessibility_notes        TEXT;

-- ── Column documentation ──────────────────────────────────────────────────────

COMMENT ON COLUMN public.events.price_display IS
  'Human-readable price label shown on the event landing page. '
  'Examples: "Free", "$10", "$25", "$20–35", "By Donation". '
  'No format enforcement — operators enter free-form text.';

COMMENT ON COLUMN public.events.age_restriction IS
  'Age restriction for the event. Suggested values (Operator Admin UI only): '
  '"All Ages", "18+", "19+", "21+", "Other". Not enforced at the DB level.';

COMMENT ON COLUMN public.events.reservation_recommendation IS
  'Reservation guidance shown on the event landing page. Suggested values (UI only): '
  '"No Reservation Needed", "Reservations Recommended", "Reservations Required". '
  'Not enforced at the DB level.';

COMMENT ON COLUMN public.events.parking_notes IS
  'Short free-text parking guidance shown on the event landing page. '
  'Examples: "Free parking after 6 PM", "Underground parking available", '
  '"Street parking only".';

COMMENT ON COLUMN public.events.accessibility_notes IS
  'Short free-text accessibility information shown on the event landing page. '
  'Examples: "Wheelchair accessible", "Elevator available", '
  '"Accessible washroom".';
