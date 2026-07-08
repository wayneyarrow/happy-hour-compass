-- =============================================================================
-- Migration 056: Content Engine Editorial Sections
--
-- Guide Experience V2 — Card 2A (see docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md
-- and docs/website/design-reference/guide-layout-v2-reference.png).
--
-- Adds three structured editorial sections to content_guides, each with an
-- optional heading and a body. These replace the old single free-text `body`
-- column as the editor's primary authoring surface for the new premium
-- editorial layout (hero image, location, title, Introduction/Standfirst,
-- then up to three editorial sections).
--
-- All columns are nullable and additive (ADD COLUMN IF NOT EXISTS), so
-- existing guides created before this migration continue to load and save
-- without a backfill. The legacy `body` column is deliberately NOT removed —
-- existing guides may still carry content there, and the public guide page
-- still reads it until Card 2B migrates public rendering to the new
-- editorial sections. See the Card 2A task's guardrail list.
-- =============================================================================

ALTER TABLE public.content_guides
  ADD COLUMN IF NOT EXISTS editorial_section_1_heading TEXT,
  ADD COLUMN IF NOT EXISTS editorial_section_1_body    TEXT,
  ADD COLUMN IF NOT EXISTS editorial_section_2_heading TEXT,
  ADD COLUMN IF NOT EXISTS editorial_section_2_body    TEXT,
  ADD COLUMN IF NOT EXISTS editorial_section_3_heading TEXT,
  ADD COLUMN IF NOT EXISTS editorial_section_3_body    TEXT;

COMMENT ON COLUMN public.content_guides.editorial_section_1_heading IS
  'Optional heading for editorial section 1. Renders only if editorial_section_1_body is non-empty.';
COMMENT ON COLUMN public.content_guides.editorial_section_1_body IS
  'Body copy for editorial section 1. Section is omitted entirely from the guide layout when empty.';
COMMENT ON COLUMN public.content_guides.editorial_section_2_heading IS
  'Optional heading for editorial section 2. Renders only if editorial_section_2_body is non-empty.';
COMMENT ON COLUMN public.content_guides.editorial_section_2_body IS
  'Body copy for editorial section 2. Section is omitted entirely from the guide layout when empty.';
COMMENT ON COLUMN public.content_guides.editorial_section_3_heading IS
  'Optional heading for editorial section 3. Renders only if editorial_section_3_body is non-empty.';
COMMENT ON COLUMN public.content_guides.editorial_section_3_body IS
  'Body copy for editorial section 3. Section is omitted entirely from the guide layout when empty.';

-- No RLS or GRANT changes needed: content_guides already has RLS enabled
-- with no permissive policies and GRANT ALL TO service_role from migration
-- 052 — both apply at the table level and automatically cover new columns.
