-- =============================================================================
-- Migration 092: Daily Special Collections
--
-- Makes "Today's Specials" a first-class Collection/Homepage Section type,
-- replacing the render-time "insert after the section titled Patio Picks"
-- prototype (see the Today's Specials task history) with the same
-- Collections/Homepages architecture venue/event/guide sections already use
-- (migration 058_collections_homepages_foundation.sql,
-- 060_homepage_sections_editor.sql).
--
-- ── Why "widen the existing enums" rather than a parallel system ────────────
--
-- collections.collection_type and homepage_sections.section_type are
-- intentionally the same 3-value code space today ('venue' | 'event' |
-- 'guide') — homepage_sections_collection_type_match (058) is a composite
-- FK that only works because of that shared domain. Daily Specials fits
-- this exact shape: it is always algorithm-driven (never a hand-picked
-- single item — no "Daily Special Feature" is being added), always scoped
-- to a Collection, and always assigned to a Homepage Section the same way
-- Patio Picks (a venue Collection) already is. Adding a 4th value
-- ('daily_special') to both existing CHECK constraints is therefore the
-- smallest change that keeps the FK-enforced compatibility guarantee
-- intact, rather than inventing a second, parallel "section kind" system
-- alongside this one.
--
-- No change is needed to homepage_sections_content_mode_target_check (060):
-- its 'collection' branch already requires venue_id/event_id/guide_id all
-- NULL regardless of section_type, which is exactly right for a
-- 'daily_special' + content_mode='collection' section — no new nullable
-- target column, no new CHECK branch.
--
-- ── New table: collection_daily_special_overrides ───────────────────────────
--
-- Mirrors collection_venue_overrides (058) field-for-field — same action
-- (include/exclude), same boost range, same sort_order/reason_type/note/
-- audit shape, same UNIQUE(collection_id, <entity>_id) — generalized from
-- venue_id to daily_special_id. This is what lets a founder Include/Exclude/
-- Boost a Daily Special using the exact override semantics already proven
-- for venues/events, resolved by the application layer the same way
-- resolveAlgorithmicVenues/resolveAlgorithmicEvents already do (see
-- collectionsPreview.ts's new resolveAlgorithmicDailySpecials).
--
-- Critical product rule enforced at the APPLICATION layer, not here (see
-- todaysSpecialsRanking.ts / selectTodaysSpecials — unchanged by this
-- migration): a manual override can never resurrect a Special that isn't
-- eligible today (wrong weekday, expired one-time date, unpublished, wrong
-- market). This table only stores the override intent; eligibility is
-- always evaluated first, and overrides only ever act inside that already-
-- eligible pool.
--
-- ── Not authorized / not included ────────────────────────────────────────────
--   - No change to the 90 seeded daily_specials rows.
--   - No change to venues, events, claims, or subscriptions.
--   - No RLS weakening — same internal-only, service-role-only model as
--     every sibling override table.
--   - No Special-level analytics table (venue-level attribution, already
--     existing infrastructure, remains what Today's Specials uses).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- WIDEN: collections.collection_type
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.collections
  DROP CONSTRAINT collections_collection_type_check;
ALTER TABLE public.collections
  ADD CONSTRAINT collections_collection_type_check
    CHECK (collection_type IN ('venue', 'event', 'guide', 'daily_special'));

COMMENT ON COLUMN public.collections.collection_type IS
  'venue | event | guide | daily_special (V1 scope + migration 092''s '
  'Today''s Specials addition). A Collection holds exactly one content '
  'type — Mixed Collections are explicitly deferred (see spec, Future '
  'Considerations).';


-- ─────────────────────────────────────────────────────────────────────────────
-- WIDEN: homepage_sections.section_type
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.homepage_sections
  DROP CONSTRAINT homepage_sections_section_type_check;
ALTER TABLE public.homepage_sections
  ADD CONSTRAINT homepage_sections_section_type_check
    CHECK (section_type IN ('venue', 'event', 'guide', 'daily_special'));

COMMENT ON COLUMN public.homepage_sections.section_type IS
  'venue | event | guide | daily_special. Determines the compatible '
  'Collection type, public renderer, card type, and View All destination '
  '(application-level — not stored here). daily_special is always '
  'content_mode=''collection'' (algorithmic Today''s Specials) — there is '
  'no daily_special "feature" variant. See collections_collection_type_check '
  'for the mirrored value set.';


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: collection_daily_special_overrides
--
-- Per-collection manual Daily Special curation. Mirrors
-- collection_venue_overrides (058) field-for-field — see migration header.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collection_daily_special_overrides (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  collection_id     UUID        NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  daily_special_id  UUID        NOT NULL REFERENCES public.daily_specials(id) ON DELETE CASCADE,

  action            TEXT        NOT NULL,
  boost             INTEGER     NOT NULL DEFAULT 0,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  reason_type       TEXT,
  note              TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT,

  CONSTRAINT collection_daily_special_overrides_action_check
    CHECK (action IN ('include', 'exclude')),
  CONSTRAINT collection_daily_special_overrides_boost_range
    CHECK (boost BETWEEN 0 AND 100),
  CONSTRAINT collection_daily_special_overrides_unique_collection_special
    UNIQUE (collection_id, daily_special_id)
);

COMMENT ON TABLE public.collection_daily_special_overrides IS
  'Manual Daily Special curation scoped to a single (daily_special-type) '
  'Collection. Mirrors collection_venue_overrides (058) — action '
  'include/exclude, boost 0-100, sort_order tie-break. "Today" eligibility '
  '(weekday/one-time-date/recurrence-boundary/published/market) is enforced '
  'entirely at the application layer (selectTodaysSpecials, '
  'todaysSpecialsRanking.ts) BEFORE overrides are applied — an include row '
  'here can never resurrect a Special that is not eligible today, and boost '
  'never bypasses eligibility. This table only stores override intent.';
COMMENT ON COLUMN public.collection_daily_special_overrides.boost IS
  'Manual rank lift applied only within this Collection (0-100) and only '
  'ever among already-eligible-today candidates — see table comment.';
COMMENT ON COLUMN public.collection_daily_special_overrides.sort_order IS
  'Explicit manual position within this Collection — see the identical '
  'collection_venue_overrides.sort_order comment (058) for full rationale.';
COMMENT ON COLUMN public.collection_daily_special_overrides.reason_type IS
  'Free-text, intentionally unconstrained (no CHECK) — matches '
  'collection_venue_overrides.reason_type''s convention.';

CREATE TRIGGER collection_daily_special_overrides_updated_at
  BEFORE UPDATE ON public.collection_daily_special_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.collection_daily_special_overrides ENABLE ROW LEVEL SECURITY;
-- Internal-only — no permissive policies. Same access model as
-- collection_venue_overrides / collection_event_overrides.

GRANT ALL ON public.collection_daily_special_overrides TO service_role;
