-- =============================================================================
-- Migration 052: Content Engine Foundation
--
-- Adds the content_guides table — the foundational data model for the Happy
-- Hour Compass Content Engine (see docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md).
--
-- This is a Card 1 / foundation migration only. It creates the table, its
-- constraints, RLS, and grants. It does NOT add public read access — the
-- public website guide pages, SEO automation, and Discover Management
-- integration are later cards. Until then this table is admin-only, reached
-- exclusively through createAdminClient() (service-role) from the Control
-- Panel.
--
-- Guide types (V1 scope — see spec section 5):
--   venue_guide | event_guide
--
-- Status lifecycle (see spec section 16):
--   draft | scheduled | published | expired
--
-- Geography:
--   Guides reference the Geography Data Foundation (migration
--   048_geography_foundation_v1.sql) rather than duplicating market/city
--   text. market_id and city_id are required — spec section 8 lists Market
--   and City as required Guide Details fields, with Neighbourhood optional.
--
-- Slug scoping:
--   Canonical guide URLs are /{market}/guides/{guide-slug} (market only —
--   guides are not nested under city in the URL). Slugs are therefore scoped
--   to market, not globally unique and not scoped to city, matching the
--   cities_market_slug_unique pattern already used for cities in migration
--   048 (unique per parent, not globally).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: content_guides
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_guides (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  guide_type          TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'draft',

  market_id           UUID        NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  city_id             UUID        NOT NULL REFERENCES public.cities(id) ON DELETE RESTRICT,
  neighbourhood_id    UUID        REFERENCES public.neighbourhoods(id) ON DELETE SET NULL,

  title               TEXT        NOT NULL,
  slug                TEXT        NOT NULL,

  primary_keyword     TEXT,
  secondary_keywords  TEXT[]      NOT NULL DEFAULT '{}',

  intro               TEXT,
  body                TEXT,

  hero_image_url      TEXT,

  publish_at          TIMESTAMPTZ,
  expire_at           TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT content_guides_guide_type_check
    CHECK (guide_type IN ('venue_guide', 'event_guide')),
  CONSTRAINT content_guides_status_check
    CHECK (status IN ('draft', 'scheduled', 'published', 'expired')),
  CONSTRAINT content_guides_market_slug_unique
    UNIQUE (market_id, slug)
);

COMMENT ON TABLE public.content_guides IS
  'Content Engine guides (Venue Guides, Event Guides). Foundation table only — '
  'see docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md. Admin-managed via the '
  'Control Panel; no public read access yet.';

COMMENT ON COLUMN public.content_guides.guide_type IS
  'venue_guide | event_guide (V1 scope — see spec section 5).';
COMMENT ON COLUMN public.content_guides.status IS
  'draft | scheduled | published | expired (see spec section 16).';
COMMENT ON COLUMN public.content_guides.market_id IS
  'Required. FK to public.markets. Guide URLs are scoped to market: /{market}/guides/{slug}.';
COMMENT ON COLUMN public.content_guides.city_id IS
  'Required. FK to public.cities. City is a required Guide Details field (spec section 8).';
COMMENT ON COLUMN public.content_guides.neighbourhood_id IS
  'Optional. FK to public.neighbourhoods (spec section 8: "Neighbourhood (optional)").';
COMMENT ON COLUMN public.content_guides.slug IS
  'Unique within market_id (not globally unique) — matches the /{market}/guides/{slug} URL structure.';
COMMENT ON COLUMN public.content_guides.secondary_keywords IS
  'Editor-provided secondary SEO keywords (spec section 8/11).';
COMMENT ON COLUMN public.content_guides.hero_image_url IS
  'Single hero image, reused for card/social/thumbnail per spec section 12.';
COMMENT ON COLUMN public.content_guides.publish_at IS
  'Scheduled or actual publish timestamp (spec section 16).';
COMMENT ON COLUMN public.content_guides.expire_at IS
  'Optional expiry timestamp (spec section 16).';


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER content_guides_updated_at
  BEFORE UPDATE ON public.content_guides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS content_guides_market_id_idx
  ON public.content_guides (market_id);

CREATE INDEX IF NOT EXISTS content_guides_city_id_idx
  ON public.content_guides (city_id);

CREATE INDEX IF NOT EXISTS content_guides_status_idx
  ON public.content_guides (status);

CREATE INDEX IF NOT EXISTS content_guides_guide_type_idx
  ON public.content_guides (guide_type);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Internal-only table: no anon or authenticated direct access.
-- Only platform admins (via the Control Panel, using createAdminClient() /
-- service-role) may create, update, delete, or manage guide records.
-- Public guide rendering is a later card — a public-read policy scoped to
-- status = 'published' will be added then, not here.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.content_guides ENABLE ROW LEVEL SECURITY;

-- No permissive policies — service-role bypasses RLS and is the only caller.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs (required — see migration 039 + CLAUDE.md)
-- Internal-only: service_role only.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.content_guides TO service_role;
