-- =============================================================================
-- Migration 054: Content Engine SEO Fields
--
-- Adds SEO metadata columns to content_guides (Card 4 — see
-- docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md section 11 "SEO Automation").
--
-- These columns hold admin-reviewed SEO values. The Control Panel guide
-- editor generates sensible defaults from guide inputs (title, keywords,
-- intro/body, market/city/neighbourhood, slug) via
-- src/lib/seo/contentGuideSeo.ts, and the admin may override any of them
-- before saving. Nothing here is computed by the database — these are
-- plain nullable text columns, filled in by the application layer.
--
-- All columns are nullable and additive (ADD COLUMN IF NOT EXISTS), so
-- existing draft guides created before this migration continue to load and
-- save without a backfill; the editor generates live suggestions for
-- whichever fields are empty.
--
-- Card 4 scope is the editor + generation only. Public rendering of these
-- fields (an actual guide page's <title>/<meta> tags) is a later card —
-- see the Card 4 task's guardrail list. canonical_url is deliberately
-- stored as a root-relative path (e.g. "/greater-vancouver/guides/best-
-- patios"), matching the `path` param already used by buildPageMetadata()
-- in src/lib/seo/metadata.ts, so wiring it into real metadata later is a
-- straight pass-through rather than a reformat.
-- =============================================================================

ALTER TABLE public.content_guides
  ADD COLUMN IF NOT EXISTS page_title        TEXT,
  ADD COLUMN IF NOT EXISTS meta_title        TEXT,
  ADD COLUMN IF NOT EXISTS meta_description  TEXT,
  ADD COLUMN IF NOT EXISTS og_title          TEXT,
  ADD COLUMN IF NOT EXISTS og_description    TEXT,
  ADD COLUMN IF NOT EXISTS canonical_url     TEXT;

COMMENT ON COLUMN public.content_guides.page_title IS
  'Generated (or admin-overridden) page/tab title. See src/lib/seo/contentGuideSeo.ts.';
COMMENT ON COLUMN public.content_guides.meta_title IS
  'Generated (or admin-overridden) meta title — kept distinct from page_title so it can stay '
  'shorter and keyword-forward per SEO conventions.';
COMMENT ON COLUMN public.content_guides.meta_description IS
  'Generated (or admin-overridden) meta description.';
COMMENT ON COLUMN public.content_guides.og_title IS
  'Generated (or admin-overridden) Open Graph title, used for social sharing cards.';
COMMENT ON COLUMN public.content_guides.og_description IS
  'Generated (or admin-overridden) Open Graph description.';
COMMENT ON COLUMN public.content_guides.canonical_url IS
  'Generated (or admin-overridden) canonical path, root-relative, e.g. '
  '"/greater-vancouver/guides/best-happy-hour-patios". Locked structure: '
  '/{market-slug}/guides/{guide-slug}.';

-- No RLS or GRANT changes needed: content_guides already has RLS enabled
-- with no permissive policies and GRANT ALL TO service_role from migration
-- 052 — both apply at the table level and automatically cover new columns.
