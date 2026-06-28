-- =============================================================================
-- 046_event_type.sql
--
-- Adds event_type classification to the events table.
--
-- Existing events are backfilled to 'other'. Operators can then update their
-- events to a more specific type in the admin event form.
--
-- Supported types (matches EVENT_TYPE_DEFS in src/lib/eventTypes.ts):
--   live_music | dj_dance | trivia | karaoke | comedy |
--   sports | food_drink | wine_tasting | community | other
-- =============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'other';

-- CHECK constraint enforces the closed set of allowed values.
-- Existing rows already satisfy this via the DEFAULT 'other' backfill.
ALTER TABLE public.events
  ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN (
    'live_music',
    'dj_dance',
    'trivia',
    'karaoke',
    'comedy',
    'sports',
    'food_drink',
    'wine_tasting',
    'community',
    'other'
  ));

COMMENT ON COLUMN public.events.event_type IS
  'Event category used for discovery filtering, homepage rails, and SEO pages. '
  'Defaults to ''other'' for unclassified events. Validated against the closed set '
  'in src/lib/eventTypes.ts.';

-- Index supports future filter queries on event_type across published events.
CREATE INDEX IF NOT EXISTS events_event_type_idx
  ON public.events (event_type)
  WHERE is_published = TRUE;
