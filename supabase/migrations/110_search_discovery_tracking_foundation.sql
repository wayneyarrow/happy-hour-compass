-- =============================================================================
-- Happy Hour Compass — Search & Discovery Tracking Foundation
-- Migration: 110_search_discovery_tracking_foundation.sql
--
-- STATUS: not yet applied. Apply BEFORE the deploy that ships the matching
-- code (/api/track/discovery and the environment-aware /api/track/* routes).
-- The new routes write columns/tables created here; until this is applied
-- their inserts fail silently (tracking failures never affect consumers).
-- Old code keeps working after this is applied: every change below is an
-- additive, nullable column or a brand-new table.
--
-- CONTEXT:
--   The September 2026 investigation of website search/discovery analytics
--   found that (a) staging and production traffic share these tables with no
--   way to tell them apart, (b) website_search_events logs partial words and
--   ?q= landings as if they were typed searches, and has no mode, and
--   (c) venue_discover_events "impressions" are counted when a section
--   LOADS, not when it is seen, and only venues are tracked.
--
-- WHAT THIS MIGRATION DOES:
--   1. environment column (nullable, no default, no backfill) on
--      website_search_events, venue_discover_events, venue_view_events,
--      event_view_events and daily_special_click_events. Written server-side
--      by each /api/track/* route (src/lib/analyticsEnvironment.ts):
--        production  — Vercel Production (main: happyhourcompass.com)
--        staging     — Vercel Preview built from the `website` branch
--                      (staging.happyhourcompass.com)
--        preview     — any other Vercel Preview deployment
--        development — not running on Vercel (local dev, scripts, tests)
--      NULL = legacy/unknown: every row written before this code deployed,
--      AND any row written by still-running old code between this migration
--      and that deploy. Historical rows are never inferred or backfilled.
--   2. Search-quality columns on website_search_events (all nullable; NULL on
--      every pre-existing row): mode, origin, capture_trigger,
--      result_count_capped, other_filters_active, search_id.
--   3. New table website_discovery_events — generic, visibility-based
--      discovery tracking for venue/guide/event/daily-special items on the
--      homepage and in guides, plus section exposures, "View all", hero
--      Browse and hero suggestion selections. Replaces the website's use of
--      venue_discover_events (the consumer app still writes that table).
--
-- WHAT IT DOES NOT DO:
--   - No UPDATE/DELETE of any existing row. venue_discover_events' historical
--     load-based impressions stay exactly as they are — they are simply no
--     longer written by the website and must never be summed with
--     website_discovery_events visible impressions.
--   - No CHECK on existing columns' existing values.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. environment on existing tracking tables
--
-- Added NOT VALID then VALIDATEd separately so the validation scan holds only
-- a SHARE UPDATE EXCLUSIVE lock. Every existing row is NULL, which passes.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.website_search_events      ADD COLUMN IF NOT EXISTS environment TEXT;
ALTER TABLE public.venue_discover_events      ADD COLUMN IF NOT EXISTS environment TEXT;
ALTER TABLE public.venue_view_events          ADD COLUMN IF NOT EXISTS environment TEXT;
ALTER TABLE public.event_view_events          ADD COLUMN IF NOT EXISTS environment TEXT;
ALTER TABLE public.daily_special_click_events ADD COLUMN IF NOT EXISTS environment TEXT;

ALTER TABLE public.website_search_events
  ADD CONSTRAINT website_search_events_environment_check
  CHECK (environment IS NULL OR environment IN ('production', 'staging', 'preview', 'development')) NOT VALID;
ALTER TABLE public.venue_discover_events
  ADD CONSTRAINT venue_discover_events_environment_check
  CHECK (environment IS NULL OR environment IN ('production', 'staging', 'preview', 'development')) NOT VALID;
ALTER TABLE public.venue_view_events
  ADD CONSTRAINT venue_view_events_environment_check
  CHECK (environment IS NULL OR environment IN ('production', 'staging', 'preview', 'development')) NOT VALID;
ALTER TABLE public.event_view_events
  ADD CONSTRAINT event_view_events_environment_check
  CHECK (environment IS NULL OR environment IN ('production', 'staging', 'preview', 'development')) NOT VALID;
ALTER TABLE public.daily_special_click_events
  ADD CONSTRAINT daily_special_click_events_environment_check
  CHECK (environment IS NULL OR environment IN ('production', 'staging', 'preview', 'development')) NOT VALID;

ALTER TABLE public.website_search_events      VALIDATE CONSTRAINT website_search_events_environment_check;
ALTER TABLE public.venue_discover_events      VALIDATE CONSTRAINT venue_discover_events_environment_check;
ALTER TABLE public.venue_view_events          VALIDATE CONSTRAINT venue_view_events_environment_check;
ALTER TABLE public.event_view_events          VALIDATE CONSTRAINT event_view_events_environment_check;
ALTER TABLE public.daily_special_click_events VALIDATE CONSTRAINT daily_special_click_events_environment_check;

COMMENT ON COLUMN public.website_search_events.environment IS
  'Deployment that recorded the row: production | staging | preview | development. NULL = legacy/unknown (written before migration 110 code deployed). Never backfilled.';
COMMENT ON COLUMN public.venue_discover_events.environment IS
  'Deployment that recorded the row: production | staging | preview | development. NULL = legacy/unknown (written before migration 110 code deployed). Never backfilled.';
COMMENT ON COLUMN public.venue_view_events.environment IS
  'Deployment that recorded the row: production | staging | preview | development. NULL = legacy/unknown (written before migration 110 code deployed). Never backfilled.';
COMMENT ON COLUMN public.event_view_events.environment IS
  'Deployment that recorded the row: production | staging | preview | development. NULL = legacy/unknown (written before migration 110 code deployed). Never backfilled.';
COMMENT ON COLUMN public.daily_special_click_events.environment IS
  'Deployment that recorded the row: production | staging | preview | development. NULL = legacy/unknown (written before migration 110 code deployed). Never backfilled.';

COMMENT ON TABLE public.venue_discover_events IS
  'Append-only log of Discover rail impressions and clicks. event_type: impression | click. No PII stored. '
  'IMPRESSIONS ARE LOAD-BASED: a row is written when the rail renders, not when it is seen. '
  'Website rows (rail_name homepage_rail:/homepage_feature:/guide:) stopped with migration 110 — '
  'website discovery is now recorded in website_discovery_events. Never sum the two tables.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. website_search_events — search quality columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.website_search_events
  ADD COLUMN IF NOT EXISTS mode                 TEXT,
  ADD COLUMN IF NOT EXISTS origin               TEXT,
  ADD COLUMN IF NOT EXISTS capture_trigger      TEXT,
  ADD COLUMN IF NOT EXISTS result_count_capped  BOOLEAN,
  ADD COLUMN IF NOT EXISTS other_filters_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS search_id            UUID;

ALTER TABLE public.website_search_events
  ADD CONSTRAINT website_search_events_mode_check
  CHECK (mode IS NULL OR mode IN ('happy_hours', 'daily_specials', 'events')) NOT VALID;
ALTER TABLE public.website_search_events
  ADD CONSTRAINT website_search_events_origin_check
  CHECK (origin IS NULL OR origin IN ('typed', 'url', 'history', 'hero_see_all')) NOT VALID;
ALTER TABLE public.website_search_events
  ADD CONSTRAINT website_search_events_capture_trigger_check
  CHECK (capture_trigger IS NULL OR capture_trigger IN ('pause', 'enter', 'selection', 'see_all')) NOT VALID;

ALTER TABLE public.website_search_events VALIDATE CONSTRAINT website_search_events_mode_check;
ALTER TABLE public.website_search_events VALIDATE CONSTRAINT website_search_events_origin_check;
ALTER TABLE public.website_search_events VALIDATE CONSTRAINT website_search_events_capture_trigger_check;

-- One row per client-generated search id: a retried POST can never create a
-- second row for the same captured search. NULLs (every legacy row) never
-- conflict.
CREATE UNIQUE INDEX IF NOT EXISTS website_search_events_search_id_key
  ON public.website_search_events (search_id);

CREATE INDEX IF NOT EXISTS website_search_events_environment_searched_at_idx
  ON public.website_search_events (environment, searched_at DESC);

COMMENT ON COLUMN public.website_search_events.surface IS
  'Search surface: homepage_hero | listing_page. Which listing page is given by mode (legacy NULL-mode listing_page rows are the Happy Hours listing — the only listing page that logged before migration 110).';
COMMENT ON COLUMN public.website_search_events.mode IS
  'Entity searched: happy_hours (venues) | daily_specials | events. NULL = legacy row (mode was not recorded).';
COMMENT ON COLUMN public.website_search_events.origin IS
  'How the query got into the field: typed (visitor typed it) | url (page opened with ?q=, e.g. an external or pasted link) | '
  'history (browser Back/Forward restored it) | hero_see_all (homepage hero "See all … matching" handed the query to the listing page; '
  'the hero search itself is its own typed row). NULL = legacy row.';
COMMENT ON COLUMN public.website_search_events.capture_trigger IS
  'What captured the row: pause (≈1s with no typing) | enter (Enter key) | selection (a hero suggestion was chosen) | see_all (hero "See all" chosen). '
  'Non-typed origins are captured once on arrival with trigger pause. NULL = legacy row (captured after a 200ms pause, which also logged partial words).';
COMMENT ON COLUMN public.website_search_events.result_count IS
  'Number of matching results at that surface. 0 is a valid, important value. Since migration 110 the hero records the full match total '
  '(not the 8-item display cap) and result_count_capped = false; legacy hero rows (result_count_capped NULL) are capped at 8. '
  'Listing pages count results after all active filters (see other_filters_active).';
COMMENT ON COLUMN public.website_search_events.result_count_capped IS
  'TRUE when result_count is a display-capped number rather than the full total. FALSE = full total. NULL = legacy row.';
COMMENT ON COLUMN public.website_search_events.other_filters_active IS
  'Listing pages only: TRUE when non-text filters (day, type, time, near me, etc.) also narrowed result_count. NULL for the hero and legacy rows.';
COMMENT ON COLUMN public.website_search_events.search_id IS
  'Client-generated id of this captured search; referenced by website_discovery_events.search_id for hero suggestion selections. NULL = legacy row.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TABLE: website_discovery_events
--
-- Append-only log of discovery interactions on the public website.
--
-- event_type:
--   item_impression   — a card was at least 50% visible for at least one
--                       continuous second while the browser tab was visible.
--                       Once per page view per placement + item.
--   section_exposure  — the section's heading marker met the same threshold.
--                       Once per page view per section/guide block.
--   item_click        — the card's link was activated (repeat clicks on the
--                       same card within 1s are ignored as double-clicks).
--   view_all_click    — a homepage section's "View all" link.
--   browse_click      — the homepage hero's Browse button (mode recorded).
--   suggestion_select — a hero search suggestion was chosen (search_id links
--                       to the website_search_events row it came from).
--
-- surface:
--   homepage_section  — a Homepage Section (section_id = homepage_sections.id)
--   homepage_hero     — the homepage hero (Browse, search suggestions)
--   guide             — a guide page (guide_id = content_guides.id, guide_block)
--
-- position: 0-based index of the item within its placement as rendered when
-- the event occurred.
--
-- page_view_id: one per mounted page instance (homepage or guide). A client
-- navigation away and back is a new page view.
--
-- dedupe_key: set by the server for item_impression / section_exposure only
-- (page view + placement + item), NULL otherwise; the unique index makes a
-- re-sent impression a no-op (ON CONFLICT DO NOTHING).
--
-- No foreign keys on the polymorphic ids (item_id, section_id, guide_id,
-- homepage_id): a deleted section or item must not delete or block history,
-- and a single bad id must never fail a whole batch. Reports resolve names
-- by joining at read time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.website_discovery_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT        NOT NULL
                CHECK (event_type IN ('item_impression', 'section_exposure', 'item_click',
                                      'view_all_click', 'browse_click', 'suggestion_select')),
  surface       TEXT        NOT NULL
                CHECK (surface IN ('homepage_section', 'homepage_hero', 'guide')),
  page_view_id  UUID        NOT NULL,
  session_id    TEXT        NOT NULL CHECK (char_length(session_id) BETWEEN 1 AND 128),
  environment   TEXT
                CHECK (environment IS NULL OR environment IN ('production', 'staging', 'preview', 'development')),
  market_id     TEXT        CHECK (market_id IS NULL OR char_length(market_id) <= 100),
  homepage_id   UUID,
  section_id    UUID,
  section_kind  TEXT
                CHECK (section_kind IS NULL OR section_kind IN (
                  'venue_collection', 'event_collection', 'guide_collection', 'daily_special_collection',
                  'venue_feature', 'event_feature', 'guide_feature')),
  guide_id      UUID,
  guide_block   TEXT
                CHECK (guide_block IS NULL OR guide_block IN ('venues', 'events', 'related_guides')),
  item_type     TEXT
                CHECK (item_type IS NULL OR item_type IN ('venue', 'guide', 'event', 'daily_special')),
  item_id       UUID,
  position      INT         CHECK (position IS NULL OR position >= 0),
  mode          TEXT
                CHECK (mode IS NULL OR mode IN ('happy_hours', 'daily_specials', 'events')),
  search_id     UUID,
  target_path   TEXT        CHECK (target_path IS NULL OR char_length(target_path) <= 500),
  dedupe_key    TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Item events always identify their item and position; non-item events never do.
  CONSTRAINT website_discovery_events_item_shape_check CHECK (
    (event_type IN ('item_impression', 'item_click', 'suggestion_select'))
      = (item_type IS NOT NULL AND item_id IS NOT NULL AND position IS NOT NULL)
  ),
  -- Placement identity per surface.
  CONSTRAINT website_discovery_events_surface_shape_check CHECK (
    (surface = 'homepage_section' AND section_id IS NOT NULL AND section_kind IS NOT NULL AND guide_id IS NULL)
    OR (surface = 'guide' AND guide_id IS NOT NULL AND guide_block IS NOT NULL AND section_id IS NULL)
    OR (surface = 'homepage_hero' AND section_id IS NULL AND guide_id IS NULL)
  )
);

COMMENT ON TABLE public.website_discovery_events IS
  'Append-only, visibility-based discovery tracking for the public website (homepage sections, homepage hero, guides). '
  'item_impression/section_exposure = at least 50% visible for 1 continuous second in a visible tab, once per page view. '
  'Supersedes the website''s use of venue_discover_events (load-based) from migration 110; never sum the two. No PII stored.';
COMMENT ON COLUMN public.website_discovery_events.environment IS
  'Deployment that recorded the row: production | staging | preview | development (server-side, src/lib/analyticsEnvironment.ts).';
COMMENT ON COLUMN public.website_discovery_events.page_view_id IS
  'Client-generated id of one mounted homepage/guide page instance — the denominator unit for exposures and impressions.';
COMMENT ON COLUMN public.website_discovery_events.session_id IS
  'Anonymous sessionStorage id (one browser tab until it closes). Not a person.';
COMMENT ON COLUMN public.website_discovery_events.position IS
  '0-based index of the item within its placement as rendered when the event occurred.';
COMMENT ON COLUMN public.website_discovery_events.target_path IS
  'Destination path for view_all_click / browse_click (path only, no origin).';
COMMENT ON COLUMN public.website_discovery_events.dedupe_key IS
  'Server-built once-per-page-view key for item_impression/section_exposure; NULL for every other event type.';

CREATE UNIQUE INDEX IF NOT EXISTS website_discovery_events_dedupe_key_key
  ON public.website_discovery_events (dedupe_key);

CREATE INDEX IF NOT EXISTS website_discovery_events_occurred_at_idx
  ON public.website_discovery_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS website_discovery_events_section_idx
  ON public.website_discovery_events (section_id, event_type, occurred_at DESC)
  WHERE section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS website_discovery_events_guide_idx
  ON public.website_discovery_events (guide_id, event_type, occurred_at DESC)
  WHERE guide_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS website_discovery_events_item_idx
  ON public.website_discovery_events (item_type, item_id, event_type, occurred_at DESC)
  WHERE item_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — internal-only, service-role access (same as 043/089).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.website_discovery_events ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — service_role only. Written by /api/track/discovery and read by
-- Control Panel / Operator Admin data helpers, all via createAdminClient().
-- No anon/authenticated access: the browser never touches this table.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.website_discovery_events TO service_role;
