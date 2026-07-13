-- =============================================================================
-- 064_collection_public_slug.sql
--
-- Adds a persistent public slug to public.collections, staged safely so
-- every existing row gets a deterministic, URL-safe value before the column
-- becomes required. This is the foundation the approved public route
-- /{market}/collections/{collection-slug} depends on (see the Collection
-- Landing Pages slug audit, which found Collections had no slug at all).
--
-- Precedent: mirrors public.content_guides.slug exactly (migration 052) —
-- market-scoped uniqueness (UNIQUE (market_id, slug)), not globally unique
-- and not additionally scoped to city. A City Collection's market_id is
-- always populated regardless of its (optional) city_id, so this single
-- constraint already covers both market-level and city-level Collections —
-- no separate city-level uniqueness rule is needed (same reasoning as
-- content_guides, which is itself always city-scoped but only enforces
-- uniqueness at the market level).
--
-- Stages (each one intentionally separable / re-runnable while the column is
-- still nullable, so a problem in the backfill can be diagnosed without
-- having already locked in NOT NULL):
--   1. Add collections.slug as nullable TEXT.
--   2. Backfill every existing row from its current `name`, deterministically.
--   3. Assert no row was left without a slug (safety check before NOT NULL).
--   4. Add the market-scoped UNIQUE constraint.
--   5. Set slug NOT NULL.
--
-- Backfill slug generation (SQL has no access to the TypeScript `slugify`
-- utility, src/lib/slugify.ts — reimplemented here to produce IDENTICAL
-- output for the same input: lowercase -> trim -> collapse any run of
-- non a-z0-9 characters to a single hyphen -> strip leading/trailing
-- hyphens):
--   regexp_replace(regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g')
--
-- Deduplication: within each Market, Collections are ordered deterministically
-- by created_at then id (a stable tiebreak for any exact-timestamp tie) and
-- numbered per distinct base slug via row_number(). The first (earliest)
-- occurrence of a base slug keeps it as-is; every later occurrence in that
-- same Market gets `-2`, `-3`, etc. appended — matching this task's approved
-- "first occurrence keeps the base slug, later occurrences receive numeric
-- suffixes" rule exactly.
--
-- Empty-base fallback: if a Collection's name produces an empty slug after
-- the transformation above (e.g. a name made entirely of punctuation/
-- emoji — not the case for any current Collection, verified before writing
-- this migration), NULLIF(..., '') makes that case detectable and
-- COALESCE falls back to a deterministic, guaranteed-non-empty,
-- guaranteed-URL-safe value: 'collection-' || the first 8 characters of the
-- row's own id. Deterministic because it is derived from the row's own
-- immutable primary key, never from wall-clock time or randomness.
--
-- No format-level CHECK constraint is added here — content_guides.slug
-- (052) has none either; slug format is validated at the application layer
-- (see the Add Public Slugs to Collections task's actions.ts changes),
-- consistent with that existing precedent.
--
-- Does not modify Collection names, status, archived state, geography,
-- resolution logic, or Homepage assignments. No GRANT changes: public.
-- collections already has its full GRANT block from migration 058 — adding
-- a column to an existing table does not require re-granting.
-- =============================================================================

-- ── Stage 1: add the column, nullable ───────────────────────────────────────
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- ── Stage 2: deterministic backfill from the current name ──────────────────
WITH base AS (
  SELECT
    c.id,
    c.market_id,
    c.created_at,
    NULLIF(
      regexp_replace(
        regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '-', 'g'),
        '^-+|-+$', '', 'g'
      ),
      ''
    ) AS base_slug
  FROM public.collections c
  WHERE c.slug IS NULL
),
safe AS (
  SELECT
    id,
    market_id,
    created_at,
    COALESCE(base_slug, 'collection-' || substr(id::text, 1, 8)) AS base_slug
  FROM base
),
numbered AS (
  SELECT
    id,
    base_slug,
    row_number() OVER (
      PARTITION BY market_id, base_slug
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM safe
)
UPDATE public.collections c
SET slug = CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || '-' || n.rn END
FROM numbered n
WHERE c.id = n.id;

-- ── Stage 3: safety assertion — no row left without a slug ──────────────────
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT count(*) INTO missing_count FROM public.collections WHERE slug IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'collections.slug backfill incomplete: % row(s) still NULL', missing_count;
  END IF;
END $$;

-- ── Stage 4: Market-scoped uniqueness (mirrors content_guides_market_slug_unique) ──
ALTER TABLE public.collections
  ADD CONSTRAINT collections_market_slug_unique UNIQUE (market_id, slug);

-- ── Stage 5: require slug going forward ─────────────────────────────────────
ALTER TABLE public.collections
  ALTER COLUMN slug SET NOT NULL;

COMMENT ON COLUMN public.collections.slug IS
  'Public slug for the Collection Landing Page route '
  '/{market}/collections/{slug}. Unique within market_id (not globally '
  'unique) — matches content_guides.slug''s scoping exactly. Auto-suggested '
  'from `name` via src/lib/slugify.ts on creation; never auto-overwritten '
  'once an editor has manually edited it or the Collection already exists '
  '(see CollectionForm.tsx). Existing Collections at migration time were '
  'backfilled deterministically from their name at that point, with a '
  'numeric suffix for any name collision within the same market.';
