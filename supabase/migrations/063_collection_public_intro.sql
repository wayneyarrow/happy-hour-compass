-- =============================================================================
-- 063_collection_public_intro.sql
--
-- Adds an optional `public_intro` TEXT column to public.collections.
--
-- Purpose: Collection Landing Pages are the next website roadmap item (see
-- docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md, "Collection Landing
-- Pages" / Future Considerations). Those pages will need a polished,
-- visitor-facing introduction distinct from `description`, which is — and
-- remains — internal/editorial management context only (shown in the
-- Control Panel, never on the public website). `public_intro` is the
-- separate field Collection Landing Pages will read from once built.
--
-- This migration is schema-only — no query layer, no admin UI, no public
-- rendering, no Homepage Preview, no Homepage rendering, and no Collection
-- Landing Pages. See the Add Collection Public Intro Field task for the
-- data-layer/editor wiring that consumes this column.
--
-- Design decisions (mirrors 061_teaser_fields.sql's reasoning exactly):
--   - Nullable TEXT; existing rows are valid with NULL — no backfill.
--   - No max-length constraint or CHECK in the DB, consistent with
--     collections.description and other unconstrained editorial text
--     columns — any length guidance belongs to the admin form, not the
--     schema.
--   - No default value, no automatic fallback to `description`, and no
--     placeholder text generated anywhere. NULL/blank means "no Public
--     Intro yet"; a future Collection Landing Page must collapse that
--     introductory area naturally rather than substitute generated or
--     fallback copy.
--   - No GRANT changes: public.collections already has its full GRANT
--     block from migration 058 (service_role only, internal editorial
--     asset) — adding a column to an existing table does not require
--     re-granting.
-- =============================================================================

ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS public_intro TEXT;

COMMENT ON COLUMN public.collections.public_intro IS
  'Optional, polished visitor-facing introduction for future Collection '
  'Landing Pages — entirely separate from `description` (internal/editorial '
  'management context only, never shown publicly). NULL/blank means no '
  'Public Intro; no fallback to `description` and no placeholder text is '
  'ever generated. Not used by Homepage rendering, Homepage Preview, or any '
  'Collection card — Collection Landing Pages are a future task.';
