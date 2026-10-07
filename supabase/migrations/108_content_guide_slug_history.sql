-- =============================================================================
-- Migration 108: Content Guide Slug History
--
-- Guide URLs are /{market-slug}/guides/{guide-slug}, unique per market
-- (content_guides_market_slug_unique, migration 052). Until now a guide's
-- slug (or market) could be changed in the Content Engine editor with no
-- record of the old URL, so the old public URL simply 404'd — e.g. the
-- Sports Bars guide's original kelownas-best-sports-bars-to-catch-the-game.
--
-- This migration:
--   1. Creates public.content_guide_slug_history — retired (market, slug)
--      pairs → guide_id. Mirrors venue_slug_history (065) /
--      event_slug_history (069), but scoped per market like guide slugs.
--   2. Adds a BEFORE INSERT OR UPDATE trigger on content_guides that keeps
--      the history correct ATOMICALLY with the guide write itself:
--        - UPDATE that changes slug or market_id → the OLD (market, slug)
--          is recorded for this guide (no duplicate if already recorded;
--          abort if it is recorded for a DIFFERENT guide).
--        - INSERT, or UPDATE that changes slug/market → the NEW
--          (market, slug) must not be a retired URL of ANOTHER guide
--          (abort, ERRCODE 23505). If it is this guide's own retired URL
--          (renaming back), that history row is removed so the URL is
--          simply current again.
--      A trigger (not application code) because the Supabase JS client has
--      no multi-statement transactions — this way history can never be
--      missing, duplicated or orphaned relative to the guide row, whatever
--      code path writes content_guides.
--   3. Seeds exactly one row: the Sports Bars guide's old slug, guarded.
--
-- The public guide route ((website)/[market]/guides/[slug]/page.tsx) falls
-- back to this table when no current guide matches, and 308-redirects to
-- the guide's CURRENT /{market}/guides/{slug} if the guide is public.
--
-- Access: service_role only (all reads/writes are server-side via
-- createAdminClient()), RLS enabled with no policies — same as 065/069.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: content_guide_slug_history
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_guide_slug_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id    UUID        NOT NULL REFERENCES public.content_guides(id) ON DELETE CASCADE,
  market_id   UUID        NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  old_slug    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_guide_slug_history_market_slug_unique UNIQUE (market_id, old_slug)
);

COMMENT ON TABLE public.content_guide_slug_history IS
  'Retired public guide URLs: (market_id, old_slug) → guide_id. Resolves to '
  'guide_id only — the guide''s CURRENT market/slug is read live at redirect '
  'time, so there are never redirect chains. Maintained by the '
  'content_guides_slug_history trigger (migration 108).';
COMMENT ON COLUMN public.content_guide_slug_history.guide_id IS
  'ON DELETE CASCADE: a deleted guide has no current URL to redirect to — '
  'same rationale as venue_slug_history.venue_id.';
COMMENT ON COLUMN public.content_guide_slug_history.market_id IS
  'The market the old URL lived under. ON DELETE RESTRICT matches '
  'content_guides.market_id.';

CREATE INDEX IF NOT EXISTS content_guide_slug_history_guide_id_idx
  ON public.content_guide_slug_history (guide_id);

ALTER TABLE public.content_guide_slug_history ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service_role bypasses RLS and is the only caller.

REVOKE ALL ON public.content_guide_slug_history FROM anon, authenticated;
GRANT ALL ON public.content_guide_slug_history TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: keep history atomic with content_guides writes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.content_guides_slug_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_owner UUID;
BEGIN
  -- 1. Retire the OLD URL when slug or market changes.
  IF TG_OP = 'UPDATE'
     AND (NEW.slug IS DISTINCT FROM OLD.slug OR NEW.market_id IS DISTINCT FROM OLD.market_id) THEN
    SELECT guide_id INTO v_owner
      FROM public.content_guide_slug_history
      WHERE market_id = OLD.market_id AND old_slug = OLD.slug;

    IF FOUND AND v_owner <> OLD.id THEN
      RAISE EXCEPTION 'content_guide_slug_history: retired slug % is already recorded for a different guide %', OLD.slug, v_owner
        USING ERRCODE = '23505';
    ELSIF NOT FOUND THEN
      INSERT INTO public.content_guide_slug_history (guide_id, market_id, old_slug)
      VALUES (OLD.id, OLD.market_id, OLD.slug);
    END IF;
  END IF;

  -- 2. The NEW URL must not be another guide's retired URL.
  IF TG_OP = 'INSERT'
     OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    SELECT guide_id INTO v_owner
      FROM public.content_guide_slug_history
      WHERE market_id = NEW.market_id AND old_slug = NEW.slug;

    IF FOUND THEN
      IF TG_OP = 'UPDATE' AND v_owner = NEW.id THEN
        -- Renaming back to this guide's own former URL: it is current again.
        DELETE FROM public.content_guide_slug_history
          WHERE market_id = NEW.market_id AND old_slug = NEW.slug;
      ELSE
        RAISE EXCEPTION 'content_guide_slug_history: slug % is a retired URL of another guide in this market', NEW.slug
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_guides_slug_history ON public.content_guides;
CREATE TRIGGER content_guides_slug_history
  BEFORE INSERT OR UPDATE OF slug, market_id ON public.content_guides
  FOR EACH ROW EXECUTE FUNCTION public.content_guides_slug_history();


-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Sports Bars guide's original (manually entered) slug
--   guide 24694fdc-cc9f-4bb7-abdf-181ade801dc7 (central-okanagan)
--   retired: kelownas-best-sports-bars-to-catch-the-game
--   current: kelowna-s-best-sports-bars-to-catch-the-game  (unchanged)
-- Guarded: any unexpected state aborts the whole migration. Re-run: an
-- already-correct row is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c_guide_id    CONSTANT UUID := '24694fdc-cc9f-4bb7-abdf-181ade801dc7';
  c_market_slug CONSTANT TEXT := 'central-okanagan';
  c_current     CONSTANT TEXT := 'kelowna-s-best-sports-bars-to-catch-the-game';
  c_old         CONSTANT TEXT := 'kelownas-best-sports-bars-to-catch-the-game';
  v_market_id   UUID;
  v_slug        TEXT;
  v_guide_mkt   UUID;
  v_owner       UUID;
BEGIN
  SELECT id INTO v_market_id FROM public.markets WHERE slug = c_market_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'guide_slug_history seed: market % not found', c_market_slug;
  END IF;

  SELECT slug, market_id INTO v_slug, v_guide_mkt FROM public.content_guides WHERE id = c_guide_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'guide_slug_history seed: guide % not found', c_guide_id;
  END IF;
  IF v_guide_mkt <> v_market_id THEN
    RAISE EXCEPTION 'guide_slug_history seed: guide % is not in market %', c_guide_id, c_market_slug;
  END IF;
  IF v_slug <> c_current THEN
    RAISE EXCEPTION 'guide_slug_history seed: guide % has slug % (expected %)', c_guide_id, v_slug, c_current;
  END IF;

  IF EXISTS (SELECT 1 FROM public.content_guides WHERE market_id = v_market_id AND slug = c_old) THEN
    RAISE EXCEPTION 'guide_slug_history seed: % is a CURRENT slug of a guide in %', c_old, c_market_slug;
  END IF;

  SELECT guide_id INTO v_owner FROM public.content_guide_slug_history
    WHERE market_id = v_market_id AND old_slug = c_old;
  IF FOUND THEN
    IF v_owner <> c_guide_id THEN
      RAISE EXCEPTION 'guide_slug_history seed: % already retired for a different guide %', c_old, v_owner;
    END IF;
    RETURN;  -- already seeded correctly
  END IF;

  INSERT INTO public.content_guide_slug_history (guide_id, market_id, old_slug)
  VALUES (c_guide_id, v_market_id, c_old);
END $$;
