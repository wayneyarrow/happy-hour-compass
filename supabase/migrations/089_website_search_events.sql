-- =============================================================================
-- Migration 089: Website Search Events
--
-- Phase 4B — first-party tracking of consumer free-text searches performed
-- on the public website (app/(website)/), so the Founder Control Panel can
-- later report most-common searches, search volume, zero-result searches,
-- search activity by surface, and recent searches.
--
-- Two instrumented surfaces (see /api/track/website-search):
--   homepage_hero — HeroVenueSearch.tsx (homepage venue autocomplete)
--   listing_page  — HappyHoursSearchClient.tsx (main venue listing search)
--
-- Design decisions (mirrors 043_analytics_v2_tracking.sql):
--   - Append-only (no updated_at, no UPDATE needed).
--   - Internal-only: RLS enabled, no permissive policies. All reads/writes
--     go through createAdminClient() (service-role) — the client never talks
--     to this table directly, only to the /api/track/website-search endpoint.
--   - surface uses TEXT (not an enum) so new surfaces can be added without a
--     schema migration; the endpoint itself restricts to a known allow-list.
--   - market_id is a bare TEXT slug (matches markets.slug / MARKETS[].id in
--     src/lib/markets.ts), not a foreign key — same "not enforced" pattern as
--     venue_discover_events.rail_name, since MARKETS[] is still the live
--     source of truth and not yet fully wired to the DB markets table.
--   - No PII stored — session_id is an anonymous browser UUID, and the
--     search term itself is the consumer's own free-text query (no email,
--     name, IP address, or operator information is ever captured here).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: website_search_events
--
-- Append-only log of meaningful (debounce-settled, non-empty) free-text
-- searches on the public website. One row per settled query, not per
-- keystroke — see /api/track/website-search and the two client call sites
-- for the exact debounce/dedupe semantics.
--
-- result_count is the number of venues the search produced at the surface
-- that ran it (0 is an expected, important value — it flags unmet consumer
-- demand and must never be treated as "no data").
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.website_search_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  search_term   TEXT        NOT NULL,
  surface       TEXT        NOT NULL,
  result_count  INT         NOT NULL,
  market_id     TEXT,
  searched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id    TEXT        NOT NULL
);

COMMENT ON TABLE  public.website_search_events IS
  'Append-only log of meaningful free-text searches on the public website '
  '(homepage hero + happy hours listing search). No PII stored.';

COMMENT ON COLUMN public.website_search_events.search_term  IS
  'Trimmed, whitespace-collapsed search query as typed by the consumer. Casing is preserved; group case-insensitively (lower(search_term)) at query/report time.';
COMMENT ON COLUMN public.website_search_events.surface      IS
  'Search surface: homepage_hero | listing_page.';
COMMENT ON COLUMN public.website_search_events.result_count IS
  'Number of venues the search produced at that surface. 0 is a valid, important value (zero-result / unmet-demand search).';
COMMENT ON COLUMN public.website_search_events.market_id    IS
  'Market slug (matches markets.slug / MARKETS[].id) active when the search was performed, where reliably available. Not a foreign key — see header note.';
COMMENT ON COLUMN public.website_search_events.searched_at  IS 'Timestamp of the search. Defaults to now().';
COMMENT ON COLUMN public.website_search_events.session_id   IS
  'Anonymous client-side session identifier (UUID from sessionStorage). Not user-linked.';


-- Indexes
CREATE INDEX IF NOT EXISTS website_search_events_searched_at_idx
  ON public.website_search_events (searched_at DESC);

CREATE INDEX IF NOT EXISTS website_search_events_surface_idx
  ON public.website_search_events (surface);

-- Functional index for case-insensitive grouping ("most common searches").
CREATE INDEX IF NOT EXISTS website_search_events_search_term_lower_idx
  ON public.website_search_events (lower(search_term));

-- Zero-result searches are the one signal we expect to filter on directly
-- ("unmet consumer demand" reporting).
CREATE INDEX IF NOT EXISTS website_search_events_zero_result_idx
  ON public.website_search_events (searched_at DESC)
  WHERE result_count = 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — website_search_events
-- Internal-only: service-role only, same as every other analytics event
-- table in this file's lineage (043_analytics_v2_tracking.sql).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.website_search_events ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.website_search_events TO service_role;
