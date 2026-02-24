-- Migration: add business_hours JSONB column to venues.
--
-- Shape stored:
--   {
--     "monday":    { "open": "HH:MM", "close": "HH:MM" } | null,
--     "tuesday":   { "open": "HH:MM", "close": "HH:MM" } | null,
--     ...
--     "sunday":    { "open": "HH:MM", "close": "HH:MM" } | null
--   }
--
-- null value for a day key  → venue is closed that day.
-- Missing day key           → treated as not-yet-set (equivalent to closed).
-- open > close              → overnight window (valid).
-- open == close             → invalid (rejected at application layer).
-- Times are stored as 24-hour "HH:MM"; the UI converts to/from 12-hour AM/PM.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS business_hours JSONB;

COMMENT ON COLUMN public.venues.business_hours IS
  'Per-day opening hours keyed by lowercase English day name. '
  'Value is {"open":"HH:MM","close":"HH:MM"} in 24-hour format, '
  'or null when the venue is closed on that day.';
