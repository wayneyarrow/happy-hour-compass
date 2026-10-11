-- =============================================================================
-- Happy Hour Compass — View counts: exclude explicitly non-production rows
-- Migration: 111_view_counts_exclude_non_production.sql
--
-- STATUS: not yet applied.
--
-- CONTEXT:
--   Migration 110 added a server-set `environment` column to venue_view_events
--   and event_view_events: 'production' | 'staging' | 'preview' |
--   'development', with NULL = legacy/unknown (every row written before the
--   migration-110 code deployed). Staging and local dev write to this same
--   shared project, and every view-count consumer still counted their rows.
--   Those consumers are:
--     Customer Success venue-view milestones (real operator emails),
--     Control Panel Platform Analytics and Action Center reports,
--     the specials-adoption report,
--     the public homepage's Today's Specials ranking, and
--     the activation-expiry founder follow-up.
--
-- WHAT THIS MIGRATION DOES:
--   Redefines venue_view_counts() and event_view_counts() (migration 088) to
--   count only rows where environment IS NULL OR environment = 'production':
--     - legacy NULL history stays counted, exactly as before;
--     - production rows are counted;
--     - rows explicitly labelled staging / preview / development are excluded.
--   Everything else is identical to 088: same signatures and defaults, same
--   RETURNS TABLE, LANGUAGE plpgsql, STABLE, SECURITY DEFINER,
--   SET search_path = public, same date (p_since) and id filters, same
--   GROUP BY, same comments plus one sentence.
--
-- WHAT IT DOES NOT DO:
--   No table, column or row changes. No backfill: legacy NULL rows are never
--   relabelled (some of them came from staging before migration 110, and can't
--   be told apart — that history stays as it was).
--
-- PERMISSIONS:
--   CREATE OR REPLACE on an existing function keeps its owner and ACL
--   (currently EXECUTE for service_role and postgres only). The REVOKE/GRANT
--   block below is migration 088's own, repeated so this file is
--   self-describing and leaves the same end state even if run where 088's
--   grants had drifted.
--
-- PAIRED APPLICATION CHANGE (same release):
--   operatorAnalyticsV2.ts and venueHealth.ts count venue/event views
--   directly (not through these functions) and apply the same rule via
--   COUNTED_VIEW_ENVIRONMENT_FILTER (src/lib/analyticsEnvironment.ts).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: venue_view_counts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_view_counts(
  p_since     TIMESTAMPTZ DEFAULT NULL,
  p_venue_ids UUID[]      DEFAULT NULL
)
RETURNS TABLE (venue_id UUID, views BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT e.venue_id, COUNT(*)::BIGINT AS views
  FROM public.venue_view_events e
  WHERE (p_since IS NULL OR e.viewed_at >= p_since)
    AND (p_venue_ids IS NULL OR e.venue_id = ANY (p_venue_ids))
    AND (e.environment IS NULL OR e.environment = 'production')
  GROUP BY e.venue_id;
END;
$$;

COMMENT ON FUNCTION public.venue_view_counts IS
  'Per-venue view counts (GROUP BY venue_id) over venue_view_events. '
  'p_since NULL = all time; p_venue_ids NULL = every venue (platform-wide). '
  'Returns one row per venue with >=1 matching view — replaces the raw-row '
  'fetch + JS aggregation pattern that was subject to PostgREST''s default '
  'row-return cap (see migration 088 header). '
  'Since migration 111: counts only legacy (environment NULL) and production rows.';


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: event_view_counts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.event_view_counts(
  p_since     TIMESTAMPTZ DEFAULT NULL,
  p_event_ids UUID[]      DEFAULT NULL
)
RETURNS TABLE (event_id UUID, views BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT e.event_id, COUNT(*)::BIGINT AS views
  FROM public.event_view_events e
  WHERE (p_since IS NULL OR e.viewed_at >= p_since)
    AND (p_event_ids IS NULL OR e.event_id = ANY (p_event_ids))
    AND (e.environment IS NULL OR e.environment = 'production')
  GROUP BY e.event_id;
END;
$$;

COMMENT ON FUNCTION public.event_view_counts IS
  'Per-event view counts (GROUP BY event_id) over event_view_events. '
  'p_since NULL = all time; p_event_ids NULL = every event (platform-wide). '
  'Returns one row per event with >=1 matching view — replaces the raw-row '
  'fetch + JS aggregation pattern that was subject to PostgREST''s default '
  'row-return cap (see migration 088 header). '
  'Since migration 111: counts only legacy (environment NULL) and production rows.';


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — service_role only (unchanged from migration 088).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.venue_view_counts(TIMESTAMPTZ, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.venue_view_counts(TIMESTAMPTZ, UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.venue_view_counts(TIMESTAMPTZ, UUID[]) FROM authenticated;
GRANT   EXECUTE ON FUNCTION public.venue_view_counts(TIMESTAMPTZ, UUID[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.event_view_counts(TIMESTAMPTZ, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.event_view_counts(TIMESTAMPTZ, UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.event_view_counts(TIMESTAMPTZ, UUID[]) FROM authenticated;
GRANT   EXECUTE ON FUNCTION public.event_view_counts(TIMESTAMPTZ, UUID[]) TO service_role;
