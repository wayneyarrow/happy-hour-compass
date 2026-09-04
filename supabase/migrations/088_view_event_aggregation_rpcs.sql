-- =============================================================================
-- Happy Hour Compass — View Event Aggregation RPCs
-- Migration: 088_view_event_aggregation_rpcs.sql
--
-- CONTEXT (CPanel Improvements Phase 1 investigation):
--   src/lib/data/founderDashboard.ts (CPanel Analytics), src/lib/data/
--   actionCenter.ts (Action Center summary + several reports, including
--   High Demand Venues / High Demand Events), and src/lib/data/
--   venueHealth.ts (CPanel Venue Detail's event-view figure) all needed a
--   per-venue or per-event view COUNT, but the Supabase JS client has no
--   server-side GROUP BY — so each call site instead fetched raw
--   venue_view_events / event_view_events ROWS (sometimes platform-wide,
--   with no date lower bound stricter than 30 days) and counted them in
--   JavaScript.
--
--   That raw-row fetch is silently capped by PostgREST's default
--   max-rows setting (1,000 on this project, unchanged since project
--   creation) — once 30-day platform-wide view-event volume crosses that
--   cap, the fetch returns an arbitrary ~1,000-row subset (no ORDER BY was
--   specified), so every number derived from it — the platform-wide 30-day
--   total, the Top Venues/Events leaderboards, and High Demand Venue/Event
--   membership — silently becomes wrong rather than erroring. This is the
--   "Total Venue Views appears limited to 1,000" symptom from the Phase 1
--   investigation.
--
--   operator-admin's own operatorAnalyticsV2.ts already worked around this
--   for its (single-venue-scoped) event-view breakdown with an explicit
--   `.limit(10000)` — a bigger ceiling, not a real fix. This migration
--   replaces the whole raw-row-fetch pattern with proper database-side
--   aggregation instead of raising that ceiling further.
--
-- WHAT THIS ADDS:
--   Two read-only, SET-returning RPCs that GROUP BY server-side and return
--   one row per venue/event that has at least one matching view — never
--   raw pageview rows. The response size is bounded by the number of
--   distinct venues/events with any views in range, not by total
--   pageviews, so it cannot hit the platform's row-return cap at any
--   traffic volume this product will see for the foreseeable future.
--
--     venue_view_counts(p_since, p_venue_ids) → TABLE(venue_id, views)
--     event_view_counts(p_since, p_event_ids) → TABLE(event_id, views)
--
--   p_since = NULL means "all time" (no lower bound) — this is what lets
--   the same RPC serve both the existing 30-day figures and the new
--   all-time figures added in this phase, from one function.
--   p_venue_ids / p_event_ids = NULL means "no restriction" (platform-wide)
--   — a non-null array restricts to exactly those ids, for the call sites
--   that only need one venue's or one report's worth of counts.
--
-- SECURITY:
--   Both tables (venue_view_events, event_view_events — migration 042) are
--   internal-only: RLS enabled, no permissive policies, service-role
--   access only. Every call site here is createAdminClient() (service-
--   role), so these functions don't need to grant any NEW access beyond
--   what direct table access already allows that caller — SECURITY
--   DEFINER + SET search_path = public is used only for parity with this
--   codebase's established RPC pattern (075/081/085), not because a
--   privilege escalation is needed. The REVOKE-before-GRANT sequence below
--   follows that same precedent: Postgres grants EXECUTE on every new
--   function to PUBLIC by default, which would otherwise leave these
--   functions callable by anon/authenticated even though the tables they
--   read are not.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: venue_view_counts
--
-- Per-venue view counts, GROUP BY venue_id, over public.venue_view_events.
-- Returns only venues with at least one matching view — callers already
-- treat "absent from the map" as zero, matching every existing call site's
-- `map.get(id) ?? 0` pattern.
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
  GROUP BY e.venue_id;
END;
$$;

COMMENT ON FUNCTION public.venue_view_counts IS
  'Per-venue view counts (GROUP BY venue_id) over venue_view_events. '
  'p_since NULL = all time; p_venue_ids NULL = every venue (platform-wide). '
  'Returns one row per venue with >=1 matching view — replaces the raw-row '
  'fetch + JS aggregation pattern that was subject to PostgREST''s default '
  'row-return cap (see migration header).';


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: event_view_counts
--
-- Per-event view counts, GROUP BY event_id, over public.event_view_events.
-- Same shape and semantics as venue_view_counts() above.
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
  GROUP BY e.event_id;
END;
$$;

COMMENT ON FUNCTION public.event_view_counts IS
  'Per-event view counts (GROUP BY event_id) over event_view_events. '
  'p_since NULL = all time; p_event_ids NULL = every event (platform-wide). '
  'Returns one row per event with >=1 matching view — replaces the raw-row '
  'fetch + JS aggregation pattern that was subject to PostgREST''s default '
  'row-return cap (see migration header).';


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — service_role only.
--
-- See migration 085's GRANTs section for why the REVOKE-before-GRANT
-- sequence is required for a SECURITY DEFINER function (PostgreSQL grants
-- EXECUTE to PUBLIC by default on every newly created function, which
-- REVOKE closes here before the explicit service_role GRANT).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.venue_view_counts(TIMESTAMPTZ, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.venue_view_counts(TIMESTAMPTZ, UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.venue_view_counts(TIMESTAMPTZ, UUID[]) FROM authenticated;
GRANT   EXECUTE ON FUNCTION public.venue_view_counts(TIMESTAMPTZ, UUID[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.event_view_counts(TIMESTAMPTZ, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.event_view_counts(TIMESTAMPTZ, UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.event_view_counts(TIMESTAMPTZ, UUID[]) FROM authenticated;
GRANT   EXECUTE ON FUNCTION public.event_view_counts(TIMESTAMPTZ, UUID[]) TO service_role;
