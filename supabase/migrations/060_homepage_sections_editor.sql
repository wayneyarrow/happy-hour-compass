-- =============================================================================
-- Migration 060: Homepage Sections — Editor V1 (Collection + Feature content)
--
-- Extends public.homepage_sections (migration 058) to support the approved
-- Homepage Sections editor: six Section Types — Venue/Event/Guide Collection
-- (existing behavior, a Section assembles a reusable Collection) and the new
-- Venue/Event/Guide Feature (a Section assembles exactly one hand-picked
-- Venue, Event, or Guide directly, with no Collection in between). See
-- docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md for the Collection model
-- this extends, and the Homepage Sections Editor V1 task for the Feature
-- addition (an approved extension beyond that document's original V1 scope,
-- introduced because six real Section Types — not three — are now required
-- and an editor must be able to feature a single standout Venue/Event/Guide
-- without first wrapping it in a reusable Collection).
--
-- ── Design: content_mode + three nullable single-target FKs ─────────────────
--
-- section_type ('venue' | 'event' | 'guide' — unchanged, still the CHECK-ed
-- content *kind*) is joined by a new `content_mode` ('collection' | 'feature')
-- to fully describe a Section: e.g. section_type='venue' + content_mode=
-- 'feature' is a "Venue Feature" Section. This keeps section_type's existing
-- role intact — it still drives homepage_sections_collection_type_match
-- (the composite FK enforcing Collection-type compatibility, migration 058),
-- which continues to work unmodified for content_mode='collection' rows,
-- and is trivially satisfied (collection_id IS NULL) for content_mode=
-- 'feature' rows, exactly the same way it already tolerates an unassigned
-- template slot today.
--
-- A Feature Section's single target lives in one of three new nullable FK
-- columns — venue_id, event_id, guide_id — mirroring the established
-- per-content-type-column pattern already used by collection_venue_overrides
-- / collection_event_overrides / collection_guide_items (058) rather than a
-- single polymorphic column, which Postgres FKs cannot express safely across
-- three different target tables. ON DELETE CASCADE (not RESTRICT, unlike
-- collection_id) matches collection_venue_overrides.venue_id /
-- collection_event_overrides.event_id / collection_guide_items.guide_id's
-- own precedent: a Feature Section exists only to showcase that one specific
-- item, so if the item itself is deleted, the Section has nothing left to
-- show and is removed along with it — there is no "empty Feature slot"
-- concept worth preserving the way an unassigned Collection slot is.
--
-- homepage_sections_content_mode_target_check enforces that only the column
-- matching content_mode (and, for 'feature', matching section_type) may ever
-- be populated — the other two feature columns (and collection_id, for
-- 'feature' rows) must stay NULL. Each column may still independently be
-- NULL even when "active" for its mode/type (an unassigned slot) — the CHECK
-- only forbids the *wrong* column being set, mirroring collection_id's own
-- long-standing nullability rather than introducing a stricter NOT NULL rule
-- new Sections didn't have before.
--
-- ── Removing the one-Section-per-type limit ──────────────────────────────────
--
-- migration 058 added homepage_sections_unique_type_per_homepage (UNIQUE
-- homepage_id, section_type) specifically because V1's rigid three-slot
-- template (Featured Venues / Featured Events / Featured Guides) had no
-- concept of "more than one Venue Collection Section." The Homepage Sections
-- editor replaces that rigid template with a top-down "Add Section, repeat
-- as needed" workflow — an editor must be able to add e.g. both a "Trending
-- Venues" and a "Patio Picks" Venue Collection Section on the same Homepage.
-- That one-per-type constraint is dropped below. Duplicate *content* (the
-- same Collection, or the same single Venue/Event/Guide) is still never
-- allowed on one Homepage — see the four new partial unique indexes below,
-- which replace type-level dedup with content-level dedup, the actual rule
-- the product now requires ("A Homepage may not use the same Collection or
-- Feature more than once").
--
-- ── No GRANT changes needed ──────────────────────────────────────────────────
-- Adding columns/constraints/indexes to an existing table, or dropping one
-- constraint, does not require re-granting — public.homepage_sections already
-- has its full GRANT block from migration 058 (service_role only, internal
-- editorial asset).
-- =============================================================================

ALTER TABLE public.homepage_sections
  ADD COLUMN IF NOT EXISTS content_mode TEXT NOT NULL DEFAULT 'collection',
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS guide_id UUID REFERENCES public.content_guides(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.homepage_sections.content_mode IS
  'collection | feature. collection = this Section assembles a reusable '
  'Collection (collection_id, existing behavior). feature = this Section '
  'hand-picks exactly one Venue/Event/Guide directly (venue_id / event_id / '
  'guide_id, matching section_type) — no Collection involved. Defaults to '
  '''collection'' so every pre-existing row from migration 058 (including '
  'unassigned template slots) is classified correctly with no backfill '
  'needed.';
COMMENT ON COLUMN public.homepage_sections.venue_id IS
  'Feature target when content_mode=''feature'' and section_type=''venue''. '
  'NULL otherwise (see homepage_sections_content_mode_target_check). '
  'ON DELETE CASCADE: a Feature Section exists only to showcase this one '
  'Venue — if the Venue is deleted, the Section is removed with it.';
COMMENT ON COLUMN public.homepage_sections.event_id IS
  'Feature target when content_mode=''feature'' and section_type=''event''. '
  'Same nullability/CASCADE rationale as venue_id.';
COMMENT ON COLUMN public.homepage_sections.guide_id IS
  'Feature target when content_mode=''feature'' and section_type=''guide''. '
  'Same nullability/CASCADE rationale as venue_id.';

ALTER TABLE public.homepage_sections
  ADD CONSTRAINT homepage_sections_content_mode_check
    CHECK (content_mode IN ('collection', 'feature'));

-- The enforcement point: only the column matching content_mode (and, for
-- 'feature', matching section_type) may ever be populated. See header note —
-- this deliberately still allows that one matching column to be NULL (an
-- unassigned slot), it only forbids the *wrong* columns being set.
ALTER TABLE public.homepage_sections
  ADD CONSTRAINT homepage_sections_content_mode_target_check
    CHECK (
      (content_mode = 'collection' AND venue_id IS NULL AND event_id IS NULL AND guide_id IS NULL)
      OR
      (content_mode = 'feature' AND collection_id IS NULL AND (
        (section_type = 'venue' AND event_id IS NULL AND guide_id IS NULL) OR
        (section_type = 'event' AND venue_id IS NULL AND guide_id IS NULL) OR
        (section_type = 'guide' AND venue_id IS NULL AND event_id IS NULL)
      ))
    );

-- Repeat-as-needed: a Homepage may now have any number of Sections of the
-- same section_type (e.g. two Venue Collection Sections) — see header note.
ALTER TABLE public.homepage_sections
  DROP CONSTRAINT IF EXISTS homepage_sections_unique_type_per_homepage;

-- Content-level duplicate protection ("A Homepage may not use the same
-- Collection or Feature more than once") — DB-level backstop behind the
-- application-layer check in homepages.ts, mirroring the existing
-- homepages_one_market_homepage_per_market / homepages_one_homepage_per_city
-- partial-unique-index pattern (058) rather than a trigger.
CREATE UNIQUE INDEX IF NOT EXISTS homepage_sections_unique_collection_per_homepage
  ON public.homepage_sections (homepage_id, collection_id)
  WHERE collection_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS homepage_sections_unique_venue_per_homepage
  ON public.homepage_sections (homepage_id, venue_id)
  WHERE venue_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS homepage_sections_unique_event_per_homepage
  ON public.homepage_sections (homepage_id, event_id)
  WHERE event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS homepage_sections_unique_guide_per_homepage
  ON public.homepage_sections (homepage_id, guide_id)
  WHERE guide_id IS NOT NULL;

-- Partial indexes for the new feature-target columns — mirrors the "only
-- index the sparse/interesting value" style already used for
-- collections.algorithm_key (058) and collections.archived_at (059). Beyond
-- backing the unique indexes above, these also support the future public
-- rendering task's per-Section content lookups.
CREATE INDEX IF NOT EXISTS homepage_sections_venue_id_idx
  ON public.homepage_sections (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS homepage_sections_event_id_idx
  ON public.homepage_sections (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS homepage_sections_guide_id_idx
  ON public.homepage_sections (guide_id) WHERE guide_id IS NOT NULL;
