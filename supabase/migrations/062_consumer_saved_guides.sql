-- =============================================================================
-- 062_consumer_saved_guides.sql
--
-- Extends the Saved Items architecture (migration 051) to support Guides.
--
-- Adds public.consumer_saved_guides, following the exact same structure and
-- security pattern as consumer_saved_venues / consumer_saved_events:
--   - one row per consumer+guide save
--   - UNIQUE (consumer_id, guide_id) so re-saving never creates duplicates
--   - FK to content_guides(id) ON DELETE CASCADE
--   - RLS enabled, every policy scoped to auth.uid() = consumer_id
--   - no anon access — login-gated, same as the other two saved tables
--
-- This migration is purely additive. It does not modify consumer_saved_venues,
-- consumer_saved_events, or content_guides.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: consumer_saved_guides
-- Guides a consumer has saved to their account.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consumer_saved_guides (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id  UUID        NOT NULL REFERENCES public.consumer_profiles(id) ON DELETE CASCADE,
  guide_id     UUID        NOT NULL REFERENCES public.content_guides(id) ON DELETE CASCADE,
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, guide_id)
);

COMMENT ON TABLE public.consumer_saved_guides IS 'Guides saved by a consumer to their account. Populated when local saves are synced on login.';


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- RLS enabled. Every policy scopes to the authenticated user's own rows only.
-- No anon access is permitted — login-gated, matching consumer_saved_venues
-- and consumer_saved_events.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.consumer_saved_guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consumer_saved_guides: select own"
  ON public.consumer_saved_guides FOR SELECT TO authenticated
  USING (consumer_id = auth.uid());

CREATE POLICY "consumer_saved_guides: insert own"
  ON public.consumer_saved_guides FOR INSERT TO authenticated
  WITH CHECK (consumer_id = auth.uid());

CREATE POLICY "consumer_saved_guides: delete own"
  ON public.consumer_saved_guides FOR DELETE TO authenticated
  USING (consumer_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs
-- anon is excluded — login-gated, same as consumer_saved_venues/events.
-- authenticated gets the minimum operations the saved-guides feature needs.
-- service_role gets ALL (bypasses RLS; required for createAdminClient()).
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, DELETE ON public.consumer_saved_guides TO authenticated;
GRANT ALL                    ON public.consumer_saved_guides TO service_role;
