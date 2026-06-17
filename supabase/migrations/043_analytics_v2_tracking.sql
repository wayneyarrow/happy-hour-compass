-- =============================================================================
-- Migration 043: Analytics V2 Tracking Tables
--
-- Adds four new event tables to support Operator Analytics V2 metrics:
--   1. venue_click_events    — intent signals: website/menu clicks, HH/hours expands
--   2. venue_save_events     — engagement: venue saves and unsaves
--   3. venue_discover_events — visibility: Discover rail impressions and clicks
--   4. search_tag_events     — search engagement: tag filter usage log
--
-- Design decisions:
--   - All tables are append-only (no updated_at, no UPDATE needed).
--   - All tables are internal-only: RLS enabled, no permissive policies.
--     All reads/writes go through createAdminClient() (service-role).
--   - click_type, action, and event_type use TEXT (not enums) so new values
--     can be added without a schema migration.
--   - GRANTs follow the pattern established in 039_security_hardening.sql.
--   - No PII stored in any table — session_id is an anonymous browser UUID.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLE: venue_click_events
--
-- Append-only log of consumer intent signals on venue detail pages.
-- Captures outbound link clicks (website, menu) and section expand actions
-- (happy hour schedule, business hours).
--
-- click_type values:
--   website               — venue website link clicked
--   menu                  — venue menu link clicked
--   hh_schedule_expand    — happy hour schedule "Show full schedule" expanded
--   business_hours_expand — business hours section expanded
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_click_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID        NOT NULL REFERENCES public.venues(id),
  click_type  TEXT        NOT NULL,
  clicked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id  TEXT        NOT NULL
);

COMMENT ON TABLE  public.venue_click_events IS
  'Append-only log of consumer intent signals on venue detail pages. '
  'Covers outbound link clicks and section expand actions. No PII stored.';

COMMENT ON COLUMN public.venue_click_events.venue_id   IS 'Venue the action was taken on.';
COMMENT ON COLUMN public.venue_click_events.click_type IS
  'Type of action: website | menu | hh_schedule_expand | business_hours_expand.';
COMMENT ON COLUMN public.venue_click_events.clicked_at IS 'Timestamp of the action. Defaults to now().';
COMMENT ON COLUMN public.venue_click_events.session_id IS
  'Anonymous client-side session identifier (UUID from sessionStorage). Not user-linked.';


-- Indexes
CREATE INDEX IF NOT EXISTS venue_click_events_venue_id_idx
  ON public.venue_click_events (venue_id);

CREATE INDEX IF NOT EXISTS venue_click_events_clicked_at_idx
  ON public.venue_click_events (clicked_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — venue_click_events
-- Internal-only: service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_click_events ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.venue_click_events TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLE: venue_save_events
--
-- Append-only log of venue bookmark (save/unsave) actions.
-- Each toggle fires one row — saves and unsaves are both recorded so
-- net saves can be derived: COUNT(action='save') - COUNT(action='unsave').
--
-- action values:
--   save   — user bookmarked the venue
--   unsave — user removed the bookmark
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_save_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID        NOT NULL REFERENCES public.venues(id),
  action      TEXT        NOT NULL,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id  TEXT        NOT NULL
);

COMMENT ON TABLE  public.venue_save_events IS
  'Append-only log of venue bookmark (save/unsave) actions. '
  'Net saves = COUNT(save) - COUNT(unsave). No PII stored.';

COMMENT ON COLUMN public.venue_save_events.venue_id   IS 'Venue that was saved or unsaved.';
COMMENT ON COLUMN public.venue_save_events.action     IS 'Bookmark action: save | unsave.';
COMMENT ON COLUMN public.venue_save_events.saved_at   IS 'Timestamp of the action. Defaults to now().';
COMMENT ON COLUMN public.venue_save_events.session_id IS
  'Anonymous client-side session identifier (UUID from sessionStorage). Not user-linked.';


-- Indexes
CREATE INDEX IF NOT EXISTS venue_save_events_venue_id_idx
  ON public.venue_save_events (venue_id);

CREATE INDEX IF NOT EXISTS venue_save_events_saved_at_idx
  ON public.venue_save_events (saved_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — venue_save_events
-- Internal-only: service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_save_events ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.venue_save_events TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TABLE: venue_discover_events
--
-- Append-only log of Discover rail impressions and clicks.
-- Records both when a venue card is presented (impression) and when it
-- is tapped/clicked (click), with rail context so per-rail performance
-- can be measured independently.
--
-- event_type values:
--   impression — venue card was presented in a Discover rail
--   click      — user tapped/clicked a venue card in a Discover rail
--
-- rail_name examples (not enforced — TEXT for flexibility):
--   spotlight | patio_picks | highly_rated | featured_nearby | new_this_week
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_discover_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID        NOT NULL REFERENCES public.venues(id),
  event_type  TEXT        NOT NULL,
  rail_name   TEXT        NOT NULL,
  position    INT         NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id  TEXT        NOT NULL
);

COMMENT ON TABLE  public.venue_discover_events IS
  'Append-only log of Discover rail impressions and clicks. '
  'event_type: impression | click. No PII stored.';

COMMENT ON COLUMN public.venue_discover_events.venue_id    IS 'Venue presented or clicked in the Discover rail.';
COMMENT ON COLUMN public.venue_discover_events.event_type  IS 'interaction type: impression | click.';
COMMENT ON COLUMN public.venue_discover_events.rail_name   IS
  'Discover rail identifier: spotlight | patio_picks | highly_rated | featured_nearby | new_this_week.';
COMMENT ON COLUMN public.venue_discover_events.position    IS '0-based position of the venue card within the rail.';
COMMENT ON COLUMN public.venue_discover_events.occurred_at IS 'Timestamp of the event. Defaults to now().';
COMMENT ON COLUMN public.venue_discover_events.session_id  IS
  'Anonymous client-side session identifier (UUID from sessionStorage). Not user-linked.';


-- Indexes
CREATE INDEX IF NOT EXISTS venue_discover_events_venue_id_idx
  ON public.venue_discover_events (venue_id);

CREATE INDEX IF NOT EXISTS venue_discover_events_rail_name_idx
  ON public.venue_discover_events (rail_name);

CREATE INDEX IF NOT EXISTS venue_discover_events_occurred_at_idx
  ON public.venue_discover_events (occurred_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — venue_discover_events
-- Internal-only: service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_discover_events ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.venue_discover_events TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TABLE: search_tag_events
--
-- Append-only log of tag filter activations on the Explore page.
-- Used to derive "Top Search Tag" per operator by intersecting the
-- global tag frequency against a venue's own searchTags array.
--
-- result_count captures how many venues matched when the tag was applied,
-- providing a signal for tag result quality over time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.search_tag_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tag          TEXT        NOT NULL,
  result_count INT         NOT NULL,
  searched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id   TEXT        NOT NULL
);

COMMENT ON TABLE  public.search_tag_events IS
  'Append-only log of tag filter activations on the Explore page. '
  'Used to derive Top Search Tag per venue. No PII stored.';

COMMENT ON COLUMN public.search_tag_events.tag          IS 'The search tag that was activated (e.g. "Patio", "Wings").';
COMMENT ON COLUMN public.search_tag_events.result_count IS 'Number of venues in the filtered result set when the tag was applied.';
COMMENT ON COLUMN public.search_tag_events.searched_at  IS 'Timestamp of the tag activation. Defaults to now().';
COMMENT ON COLUMN public.search_tag_events.session_id   IS
  'Anonymous client-side session identifier (UUID from sessionStorage). Not user-linked.';


-- Indexes
CREATE INDEX IF NOT EXISTS search_tag_events_tag_idx
  ON public.search_tag_events (tag);

CREATE INDEX IF NOT EXISTS search_tag_events_searched_at_idx
  ON public.search_tag_events (searched_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — search_tag_events
-- Internal-only: service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.search_tag_events ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.search_tag_events TO service_role;
