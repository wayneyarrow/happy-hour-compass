-- =============================================================================
-- 061_teaser_fields.sql
--
-- Adds an optional `teaser` TEXT column to venues, events, and content_guides.
--
-- Purpose: Homepage Feature sections (Venue Feature / Event Feature / Guide
-- Feature — see docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md and the
-- Homepage Sections editor) will highlight one piece of content using a
-- full-width editorial layout. That layout needs a short, compelling,
-- click-encouraging sentence distinct from the content's existing long-form
-- description/intro/standfirst/body — the Teaser. Teasers are reusable
-- anywhere content is featured throughout Happy Hour Compass; they are not
-- used by Collections or Collection cards.
--
-- This migration is schema-only — no query layer, no admin UI, no public
-- rendering, no Homepage Preview. See the Add Teaser Content Fields task for
-- the data-layer/form wiring that consumes these columns.
--
-- Design decisions:
--   - Nullable TEXT on all three tables; existing rows are valid with NULL —
--     no backfill.
--   - No max-length constraint or CHECK in the DB, consistent with how
--     venues.about_your_venue (047) and content_guides.intro (054) are also
--     unconstrained at the schema level — any length guidance belongs to the
--     admin form, not the schema.
--   - No default fallback text and no placeholder value — NULL/blank means
--     "no Teaser", and any future Feature layout must collapse naturally
--     rather than substitute generated text.
--   - No GRANT changes: venues, events, and content_guides already have
--     their full GRANT blocks from earlier migrations — adding a column to
--     an existing table does not require re-granting.
-- =============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS teaser TEXT;

COMMENT ON COLUMN public.venues.teaser IS
  'Optional, short (~one sentence) editorial teaser for Homepage Feature '
  'sections (Venue Feature) — distinct from about_your_venue''s longer '
  'description. NULL/blank means no Teaser; no fallback text is generated. '
  'Not used by Collections or Collection cards.';

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS teaser TEXT;

COMMENT ON COLUMN public.events.teaser IS
  'Optional, short (~one sentence) editorial teaser for Homepage Feature '
  'sections (Event Feature) — distinct from the event''s longer description. '
  'NULL/blank means no Teaser; no fallback text is generated. Not used by '
  'Collections or Collection cards.';

ALTER TABLE public.content_guides
  ADD COLUMN IF NOT EXISTS teaser TEXT;

COMMENT ON COLUMN public.content_guides.teaser IS
  'Optional, short (~one sentence) editorial teaser for Homepage Feature '
  'sections (Guide Feature) — distinct from the guide''s intro/standfirst '
  'and body content. NULL/blank means no Teaser; no fallback text is '
  'generated. Not used by Collections or Collection cards.';
