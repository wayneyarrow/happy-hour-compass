-- =============================================================================
-- Happy Hour Compass — Daily Special Click Events
-- Migration: 101_daily_special_click_events.sql
--
-- STATUS: not yet applied. Apply before (or together with) the deploy that
-- ships /api/track/daily-special-click — until it is applied, that route's
-- insert fails silently (tracking failures never affect consumers) and no
-- clicks are recorded.
--
-- CONTEXT:
--   Control Panel Analytics → "D — Consumer Demand" needs Daily Specials
--   engagement. Investigation found NO existing event captures a click on a
--   Daily Special result:
--     - venue_click_events (043) only records venue-detail-page actions
--       (website/menu links, HH/hours expands) and feeds operator analytics —
--       adding a Daily Special click type there would inflate those metrics.
--     - venue_view_events records the venue page view that FOLLOWS a click,
--       but cannot tell whether that view came from a Daily Special result.
--     - GA4 has no Daily Special click event.
--   So there is no historical click data to backfill. Tracking begins when
--   this table exists AND the instrumented card is deployed.
--
-- WHAT A ROW MEANS:
--   A consumer clicked a Daily Special card in the Daily Specials search
--   results (/website-daily-specials), which opens that Special's VENUE page
--   anchored to the Special (#daily-special-<id>) — there is no standalone
--   Daily Special page. One row per click; impressions are never recorded.
--
-- DESIGN (mirrors 042/043's append-only tracking tables):
--   - Append-only, internal-only: RLS enabled, no permissive policies,
--     service-role access only (all writes via createAdminClient()).
--   - daily_special_id is ON DELETE SET NULL, not CASCADE, so click history
--     survives a Special being deleted (reporting preserves history).
--   - venue_id is ON DELETE CASCADE, matching every venue-scoped child table.
--   - source is TEXT + CHECK (closed set, same convention as daily_specials'
--     own offer_type/schedule_type) — only 'search_results' today.
--   - No PII: session_id is the same anonymous sessionStorage UUID used by
--     every other tracking table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_special_click_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_special_id  UUID        REFERENCES public.daily_specials(id) ON DELETE SET NULL,
  venue_id          UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  source            TEXT        NOT NULL,
  clicked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id        TEXT        NOT NULL,

  CONSTRAINT daily_special_click_events_source_check
    CHECK (source IN ('search_results'))
);

COMMENT ON TABLE public.daily_special_click_events IS
  'Append-only log of consumer clicks on Daily Special result cards. Each click '
  'opens the Special''s venue page at the Special''s anchor. No impressions, no PII. '
  'History starts when migration 101 + the instrumented card were deployed.';

COMMENT ON COLUMN public.daily_special_click_events.daily_special_id IS
  'The Special clicked. SET NULL if the Special is later deleted, so the click survives.';
COMMENT ON COLUMN public.daily_special_click_events.source IS
  'Where the click happened: search_results (/website-daily-specials).';
COMMENT ON COLUMN public.daily_special_click_events.session_id IS
  'Anonymous client-side session identifier (UUID from sessionStorage). Not user-linked.';

CREATE INDEX IF NOT EXISTS daily_special_click_events_clicked_at_idx
  ON public.daily_special_click_events (clicked_at DESC);

CREATE INDEX IF NOT EXISTS daily_special_click_events_venue_id_idx
  ON public.daily_special_click_events (venue_id);

CREATE INDEX IF NOT EXISTS daily_special_click_events_daily_special_id_idx
  ON public.daily_special_click_events (daily_special_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — internal-only, service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.daily_special_click_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — required for every new public-schema table (see _template.sql).
-- No anon/authenticated access: the public tracking route writes through the
-- service-role admin client, exactly like /api/track/event-view.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.daily_special_click_events TO service_role;
