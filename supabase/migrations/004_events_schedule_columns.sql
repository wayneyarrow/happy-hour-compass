-- Migration: add normalized schedule columns to events.
--
-- New columns:
--   first_date  DATE NULL        — the calendar date of the first (or next) occurrence
--   start_time  TEXT NULL        — start time as a plain string, e.g. "6:30 PM"
--   end_time    TEXT NULL        — end time as a plain string, e.g. "9:00 PM"
--   recurrence  TEXT NOT NULL    — recurrence rule, defaults to 'none'
--                                  future values: 'weekly', 'biweekly', 'monthly', etc.
--
-- Existing columns event_time and event_frequency are intentionally left untouched.
-- RLS policies are not modified.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS first_date  DATE,
  ADD COLUMN IF NOT EXISTS start_time  TEXT,
  ADD COLUMN IF NOT EXISTS end_time    TEXT,
  ADD COLUMN IF NOT EXISTS recurrence  TEXT NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.events.first_date IS
  'Calendar date of the first (or next) occurrence. NULL means not yet set.';

COMMENT ON COLUMN public.events.start_time IS
  'Human-readable start time, e.g. "6:30 PM". Stored as plain text in v1.';

COMMENT ON COLUMN public.events.end_time IS
  'Human-readable end time, e.g. "9:00 PM". Stored as plain text in v1.';

COMMENT ON COLUMN public.events.recurrence IS
  'Recurrence rule for the event. Defaults to ''none'' (one-off). '
  'Future values: ''weekly'', ''biweekly'', ''monthly''.';
