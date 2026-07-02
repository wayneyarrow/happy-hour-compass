-- =============================================================================
-- Migration 053: Content Engine Attachments
--
-- Adds venue/event attachment tables for Content Engine guides (Card 3 — see
-- docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md section 10 "Live Platform
-- Data" and section 7 "Related Venues / Events").
--
-- Guides reference live venue/event records — they do NOT copy venue/event
-- details (name, address, times, prices, ratings, images) into these tables.
-- Only the relationship (which venue/event, in what order) is stored here.
-- Names, cities, etc. are always read live via a join at query time.
--
-- Two tables, mirroring the guide_type split:
--   content_guide_venues — attached to venue_guide guides
--   content_guide_events — attached to event_guide guides
--
-- A guide should only ever have rows in one of these two tables at a time
-- (venue_guide → content_guide_venues only, event_guide → content_guide_events
-- only). This is enforced at the application layer (Control Panel server
-- actions), not via a DB constraint, consistent with how guide_type itself
-- is validated in the guide form actions rather than a cross-table CHECK.
--
-- Internal-only tables — same admin-only pattern as content_guides
-- (migration 052): RLS enabled, no permissive policies, service-role only,
-- reached exclusively through createAdminClient() from the Control Panel.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: content_guide_venues
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_guide_venues (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  guide_id    UUID        NOT NULL REFERENCES public.content_guides(id) ON DELETE CASCADE,
  venue_id    UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,

  sort_order  INTEGER     NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT content_guide_venues_guide_venue_unique UNIQUE (guide_id, venue_id)
);

COMMENT ON TABLE public.content_guide_venues IS
  'Ordered venue attachments for venue_guide content_guides rows. Stores only '
  'the relationship (guide_id, venue_id, sort_order) — venue details are '
  'always read live via a join. Admin-managed via the Control Panel.';

CREATE INDEX IF NOT EXISTS content_guide_venues_guide_id_idx
  ON public.content_guide_venues (guide_id, sort_order);

CREATE INDEX IF NOT EXISTS content_guide_venues_venue_id_idx
  ON public.content_guide_venues (venue_id);

ALTER TABLE public.content_guide_venues ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service-role bypasses RLS and is the only caller.

GRANT ALL ON public.content_guide_venues TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: content_guide_events
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_guide_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  guide_id    UUID        NOT NULL REFERENCES public.content_guides(id) ON DELETE CASCADE,
  event_id    UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  sort_order  INTEGER     NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT content_guide_events_guide_event_unique UNIQUE (guide_id, event_id)
);

COMMENT ON TABLE public.content_guide_events IS
  'Ordered event attachments for event_guide content_guides rows. Stores only '
  'the relationship (guide_id, event_id, sort_order) — event details are '
  'always read live via a join. Admin-managed via the Control Panel.';

CREATE INDEX IF NOT EXISTS content_guide_events_guide_id_idx
  ON public.content_guide_events (guide_id, sort_order);

CREATE INDEX IF NOT EXISTS content_guide_events_event_id_idx
  ON public.content_guide_events (event_id);

ALTER TABLE public.content_guide_events ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service-role bypasses RLS and is the only caller.

GRANT ALL ON public.content_guide_events TO service_role;
