-- =============================================================================
-- Migration 090: Help Center View Events
--
-- Phase 4C — first-party tracking of Operator Admin Help Center usage
-- (/admin/help and its article routes), closing the current analytics blind
-- spot: today there is no signal at all for whether the Help Center is used,
-- which articles get viewed, or which operators/venues are engaging with it.
--
-- Design decisions (mirrors 043_analytics_v2_tracking.sql's lineage):
--   - Append-only (no updated_at, no UPDATE needed).
--   - Internal-only: RLS enabled, no permissive policies. All reads/writes
--     go through createAdminClient() (service-role) — no client (browser)
--     ever talks to this table directly, only the recordHelpCenterView()
--     Server Action does, and only after resolving operator/venue identity
--     itself, server-side (see src/lib/helpCenter/trackHelpCenterView.ts).
--   - No PII beyond what the app already treats as first-party identifiers:
--     operator_id and venue_id are the same authoritative identifiers used
--     throughout Operator Admin (public.operators.id / public.venues.id) —
--     no operator email, operator name, or venue name is duplicated here;
--     those are resolved through joins later, same as every other report in
--     this project.
--   - ON DELETE CASCADE on both FKs from the start (rather than NO ACTION,
--     the gap 072_event_view_events_cascade_delete.sql had to fix after the
--     fact for a sibling event table) — deleting an operator or venue must
--     never be blocked by its own historical Help Center view log.
--   - article_slug is TEXT (not an enum/FK) so new How-To articles never
--     require a schema migration — same rationale as venue_discover_events
--     .rail_name. The literal sentinel value '__index__' (see
--     HELP_CENTER_INDEX_SLUG in src/lib/helpCenter/trackHelpCenterView.ts)
--     represents a view of the Help Center landing page itself
--     (/admin/help) rather than a real article — chosen specifically
--     because it can never collide with a real article slug (every real
--     slug in src/lib/helpCenter/articles.ts is a plain kebab-case content
--     identifier; leading/trailing underscores are never used there).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: help_center_view_events
--
-- Append-only log of Operator Admin Help Center page views. One row per
-- view — see the tracking action's doc comment for the exact "what counts
-- as a view" semantics (one settled page load by an authenticated,
-- non-impersonated operator).
--
-- venue_id is nullable: an operator with zero venues yet (or, in the rare
-- case a multi-venue operator has no active venue selected) can still
-- browse the Help Center — the view is still real and still worth
-- attributing to the operator, just not to any specific venue.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.help_center_view_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_slug  TEXT        NOT NULL,
  operator_id   UUID        NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  venue_id      UUID        REFERENCES public.venues(id) ON DELETE CASCADE,
  viewed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.help_center_view_events IS
  'Append-only log of Operator Admin Help Center page views (landing page + '
  'How-To articles + Getting Started). No PII beyond the same operator_id/'
  'venue_id identifiers used throughout Operator Admin.';

COMMENT ON COLUMN public.help_center_view_events.article_slug IS
  'Content identifier: a real How-To article slug (src/lib/helpCenter/articles.ts), '
  '"getting-started" for the Getting Started guide, or the sentinel "__index__" '
  'for the Help Center landing page (/admin/help) itself — never a real article slug.';
COMMENT ON COLUMN public.help_center_view_events.operator_id IS
  'Authoritative operator identifier (public.operators.id), resolved server-side '
  'from the authenticated session — never trusted from client input.';
COMMENT ON COLUMN public.help_center_view_events.venue_id IS
  'The operator''s active venue at the time of the view (public.venues.id), same '
  'resolution every other Operator Admin page/action uses (resolveOperatorContext() '
  '.activeVenueId). Null when the operator has no active venue.';
COMMENT ON COLUMN public.help_center_view_events.viewed_at IS 'Timestamp of the view. Defaults to now().';


-- Indexes
CREATE INDEX IF NOT EXISTS help_center_view_events_operator_id_idx
  ON public.help_center_view_events (operator_id);

CREATE INDEX IF NOT EXISTS help_center_view_events_venue_id_idx
  ON public.help_center_view_events (venue_id);

CREATE INDEX IF NOT EXISTS help_center_view_events_article_slug_idx
  ON public.help_center_view_events (article_slug);

CREATE INDEX IF NOT EXISTS help_center_view_events_viewed_at_idx
  ON public.help_center_view_events (viewed_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — help_center_view_events
-- Internal-only: service-role only, same as every other analytics event
-- table in this file's lineage (043_analytics_v2_tracking.sql,
-- 089_website_search_events.sql). No anon or authenticated grant — Operator
-- Admin never reads or writes this table directly from a browser-facing
-- RLS-scoped client, only via the service-role client inside the Server
-- Action.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.help_center_view_events ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.help_center_view_events TO service_role;
