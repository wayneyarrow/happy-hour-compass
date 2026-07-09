-- =============================================================================
-- Migration 057: FAQ Library & Content Engine Architecture
--
-- Guide Experience V2 — Card 2C (see docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md).
--
-- Builds the reusable FAQ CMS foundation only. No public rendering yet —
-- that is a later card (see the Card 2C task's guardrail list: no FAQ
-- accordion, no FAQPage schema, no Discover Management integration here).
--
-- Two tables, matching the architecture principle "Questions belong to the
-- library. Answers belong to individual guides. Optional related guides
-- belong to individual guide answers":
--
--   faq_library         — the reusable question library. A question is
--                          authored once (category, applies_to, active,
--                          sort_order) and can be answered differently by
--                          many guides.
--   content_guide_faqs  — one row per (guide, question) pairing actually
--                          used on a guide, with that guide's own answer
--                          text and an optional related-guide reference.
--
-- Both tables are additive and internal-only (admin-managed via the Control
-- Panel, service-role only) — no existing content_guides data is touched.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: faq_library
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.faq_library (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  question    TEXT        NOT NULL,
  category    TEXT,
  applies_to  TEXT        NOT NULL DEFAULT 'both',
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  active      BOOLEAN     NOT NULL DEFAULT true,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT faq_library_applies_to_check
    CHECK (applies_to IN ('venue', 'event', 'both'))
);

COMMENT ON TABLE public.faq_library IS
  'Reusable FAQ question library for the Content Engine (Card 2C). A question '
  'is authored once here; each guide that uses it supplies its own answer via '
  'content_guide_faqs. No public rendering yet — CMS foundation only.';
COMMENT ON COLUMN public.faq_library.category IS
  'Free-text grouping label for the Control Panel list (e.g. "Patios", "Parking"). Not shown publicly yet.';
COMMENT ON COLUMN public.faq_library.applies_to IS
  'venue | event | both — which guide type(s) this question is offered for in the guide editor''s picker.';
COMMENT ON COLUMN public.faq_library.sort_order IS
  'Default ordering in the FAQ Library list and picker; each guide''s own FAQ order is independent (content_guide_faqs.display_order).';
COMMENT ON COLUMN public.faq_library.active IS
  'Inactive questions are hidden from the guide editor''s picker but are not deleted, so guides already using them are unaffected.';

CREATE TRIGGER faq_library_updated_at
  BEFORE UPDATE ON public.faq_library
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS faq_library_active_applies_to_idx
  ON public.faq_library (active, applies_to);

ALTER TABLE public.faq_library ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service-role bypasses RLS and is the only caller.

GRANT ALL ON public.faq_library TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: content_guide_faqs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_guide_faqs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  guide_id          UUID        NOT NULL REFERENCES public.content_guides(id) ON DELETE CASCADE,
  faq_id            UUID        NOT NULL REFERENCES public.faq_library(id) ON DELETE RESTRICT,
  answer            TEXT        NOT NULL,
  related_guide_id  UUID        REFERENCES public.content_guides(id) ON DELETE SET NULL,

  display_order     INTEGER     NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT content_guide_faqs_guide_faq_unique UNIQUE (guide_id, faq_id)
);

COMMENT ON TABLE public.content_guide_faqs IS
  'Per-guide FAQ answers (Card 2C). One row per (guide, library question) in '
  'use on that guide, with the guide''s own answer text and an optional '
  'related-guide reference. Rendering on the public guide page is a later card.';
COMMENT ON COLUMN public.content_guide_faqs.faq_id IS
  'ON DELETE RESTRICT: a library question in use by any guide cannot be '
  'deleted from faq_library — enforced at the DB level as a backstop for the '
  'Control Panel''s own "delete only if unused" check.';
COMMENT ON COLUMN public.content_guide_faqs.related_guide_id IS
  'Optional pointer to another content_guides row for this answer (e.g. '
  '"see our full patio guide"). Stores only the reference — rendering as a '
  'link is a later card.';
COMMENT ON COLUMN public.content_guide_faqs.display_order IS
  'This guide''s own FAQ ordering — independent of faq_library.sort_order.';

CREATE TRIGGER content_guide_faqs_updated_at
  BEFORE UPDATE ON public.content_guide_faqs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS content_guide_faqs_guide_id_idx
  ON public.content_guide_faqs (guide_id, display_order);

CREATE INDEX IF NOT EXISTS content_guide_faqs_faq_id_idx
  ON public.content_guide_faqs (faq_id);

CREATE INDEX IF NOT EXISTS content_guide_faqs_related_guide_id_idx
  ON public.content_guide_faqs (related_guide_id);

ALTER TABLE public.content_guide_faqs ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service-role bypasses RLS and is the only caller.

GRANT ALL ON public.content_guide_faqs TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- SEED DATA: ~10 high-value starter questions
-- Idempotent — safe to re-run (WHERE NOT EXISTS guards each insert).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.faq_library (question, category, applies_to, sort_order)
SELECT v.question, v.category, v.applies_to, v.sort_order
FROM (VALUES
  ('What time do happy hours usually start?',            'General',      'both',  0),
  ('What time do happy hours usually end?',               'General',      'both',  1),
  ('Are happy hours available on weekends?',              'Weekends',     'both',  2),
  ('Which patios offer happy hour?',                      'Patios',       'venue', 3),
  ('Do I have to order food with happy hour drinks?',     'Drinks',       'venue', 4),
  ('Do I need a reservation?',                             'Reservations', 'both',  5),
  ('Is parking available nearby?',                        'Parking',      'both',  6),
  ('Are happy hours family friendly?',                    'Families',     'both',  7),
  ('Do breweries and wineries offer happy hour?',         'Breweries',    'venue', 8),
  ('Are there late-night happy hours?',                   'Late Night',   'both',  9)
) AS v(question, category, applies_to, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.faq_library existing WHERE existing.question = v.question
);
