-- =============================================================================
-- Migration 058: Collections & Homepages — Database Foundation
--
-- Database foundation for the approved Content → Collections → Homepages
-- architecture (see docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md, the
-- canonical reference for this migration). Schema only — no application
-- queries, server actions, admin UI, previews, or public rendering.
--
-- ── Architectural decision: new canonical model, existing rails untouched ──
--
-- The existing Discover Management tables (034_discover_rail_overrides,
-- 038_event_discover_controls) power the six live global consumer rails
-- (spotlight, patio-picks, highly-rated, featured-nearby, new-this-week,
-- featured-events) via a fixed `rail_key` TEXT that carries NO geography —
-- there is exactly one global instance of each rail today, curated
-- market-agnostically (confirmed: discover/discoverEngine.ts and the
-- control-panel discover UI take no market_id, and discover_rail_overrides
-- has no geography column).
--
-- Collections require a *required* market and *optional* city on every row
-- — geography the existing rail model was never built to carry. Retrofitting
-- geography onto `rail_key` would either break the live six-rail consumer
-- experience (Tier 1 — reused exactly, see CLAUDE.md) or require faking
-- geography onto rows that don't have it. So this migration creates a new,
-- geography-aware `collections` table rather than extending or renaming
-- discover_rail_overrides in place. All existing Discover Management tables,
-- columns, and data are left completely untouched by this migration.
--
-- The new membership/override tables below (collection_venue_overrides,
-- collection_event_overrides) intentionally mirror the *shape* of
-- discover_rail_overrides / discover_event_overrides (action include/exclude,
-- reason_type, note, created_by/updated_by) — same proven pattern, generalized
-- from a fixed rail_key to a reusable collection_id, plus a per-collection
-- `boost` column (see below). This is evolution of the pattern, not
-- duplication of the data: no existing override or venue/event column is
-- copied, renamed, or migrated here.
--
-- ── Transition plan for the six existing global rails ──
--
-- This migration does not migrate the six live rails — only documents the
-- intended path, since discover_rail_overrides/discover_event_overrides
-- must keep serving the production consumer app unmodified in the meantime:
--
-- 1. Stage: seed AFTER the Collections application query layer exists (a
--    generalized version of discoverEngine.ts that reads collections +
--    collection_venue_overrides/collection_event_overrides, keyed by
--    algorithm_key instead of rail_key) and AFTER Homepage Sections have a
--    real consumer-facing surface to assign the seeded Collections to.
--    Seeding Collections before either exists would create orphaned rows
--    with no reader — not a safe increment.
-- 2. Seed mechanism: deterministic, not fuzzy. For each of the 6 fixed
--    rail_key values (spotlight, patio-picks, highly-rated, featured-nearby,
--    new-this-week, featured-events), create one Collection per relevant
--    market with collections.algorithm_key = the existing rail_key value,
--    then copy each matching discover_rail_overrides /
--    discover_event_overrides row (action, reason_type, note,
--    created_by/at, updated_by/at) into the new collection_venue_overrides /
--    collection_event_overrides table under the new collection_id. A single
--    rail_key -> collection_id join table (or a documented lookup in the
--    migration itself) makes this a straight, auditable 1:1 copy — the
--    rail_key enum is small and fixed, so no fuzzy matching is needed.
-- 3. Consumer safety during the transition: the copy is additive-only.
--    discover_rail_overrides, discover_event_overrides, and
--    venues.internal_boost/spotlight_eligible/exclude_from_discover are
--    read directly by the live consumer app
--    (app/(consumer)/home/collections/[collection]/page.tsx and
--    discoverEngine.ts) and are never modified or removed by the seed step.
--    The consumer app keeps working, unmodified, throughout — only the new
--    website Homepage Sections read the seeded Collections at first.
-- 4. Avoiding two permanent systems: once discoverEngine.ts's own rail
--    functions are ported (a later, app-layer task) to read
--    collections/collection_*_overrides instead of
--    discover_rail_overrides/discover_event_overrides directly, the old
--    tables become dead. A final, separate cleanup migration can then
--    formally retire them (rename to *_deprecated, or drop after a
--    confirmed-unused grace period). That cleanup is intentionally not
--    bundled into the seed step — a two-phase (parallel-run, then retire)
--    transition avoids a risky single-shot cutover on live production data.
--
-- ── New tables in this migration ──
--   collections                 — reusable editorial curation asset
--   collection_venue_overrides  — per-collection venue include/exclude/boost
--   collection_event_overrides  — per-collection event include/exclude/boost
--   collection_guide_items      — per-collection guide membership (manual only
--                                  — guides have no algorithmic discovery pool
--                                  to evolve from, unlike venues/events)
--   homepages                   — first-class editorial object per geography
--   homepage_sections           — ordered Collection assignments on a Homepage
--
-- Plus one additive constraint on the existing `cities` table (see below).
--
-- ── Section Type / Collection Type compatibility enforcement ──
--
-- The spec requires that a Featured Venues section can only ever be assigned
-- a Venue Collection (never an Event or Guide Collection). This is enforced
-- with a real composite foreign key, not a trigger:
--
--   homepage_sections (collection_id, section_type)
--     REFERENCES collections (id, collection_type)
--
-- This only works because `homepage_sections.section_type` and
-- `collections.collection_type` intentionally share the same three V1 code
-- values ('venue' | 'event' | 'guide') — the human-facing label ("Featured
-- Venues") lives entirely in `homepage_sections.title`, fully independent and
-- editable. When collection_id IS NULL (an empty/unassigned template slot,
-- explicitly allowed by the spec), the composite FK is trivially satisfied
-- and not checked — Postgres does not enforce a multi-column FK when any
-- column in it is NULL.
--
-- One compatibility gap remains that CANNOT be safely expressed as a normal
-- FK/CHECK and must stay application-level: verifying that a venue/event/
-- guide added to a *City* Collection actually belongs to that city (and that
-- a Market Collection's members belong to *some* city within that market).
-- venues.market_id/city_id (migration 048) are nullable and not fully
-- backfilled yet, so a composite FK from collection_venue_overrides to
-- venues(id, market_id) would silently pass for any venue with a NULL
-- market_id — a false sense of safety worse than no constraint at all. This
-- geography-membership check must be enforced in the data/server-action layer
-- when membership rows are written (a later task), not in this migration.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIVE CONSTRAINT: cities (id, market_id) uniqueness
--
-- `id` is already globally unique (primary key), so this composite unique
-- constraint is free to add (no data change, near-instant validation on a
-- small reference table) and exists purely so `collections` and `homepages`
-- below can each declare a composite FK (city_id, market_id) -> cities
-- (id, market_id), guaranteeing at the database level that a row's declared
-- city always belongs to its declared market.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cities
  ADD CONSTRAINT cities_id_market_id_unique UNIQUE (id, market_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: collections
--
-- Reusable editorial curation asset. Evolves the proven Discover Management
-- curation model (algorithmic membership + manual include/exclude/boost +
-- ordering) into a geography-aware, reusable object — see header note.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  name             TEXT        NOT NULL,
  description      TEXT,

  collection_type  TEXT        NOT NULL,

  algorithm_key    TEXT,
  item_limit       INTEGER,

  market_id        UUID        NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  city_id          UUID        REFERENCES public.cities(id) ON DELETE RESTRICT,

  status           TEXT        NOT NULL DEFAULT 'draft',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       TEXT,

  CONSTRAINT collections_collection_type_check
    CHECK (collection_type IN ('venue', 'event', 'guide')),
  CONSTRAINT collections_item_limit_positive
    CHECK (item_limit IS NULL OR item_limit > 0),
  CONSTRAINT collections_status_check
    CHECK (status IN ('draft', 'published')),

  -- Lets homepage_sections declare a composite FK that enforces Section
  -- Type / Collection Type compatibility (see header note).
  CONSTRAINT collections_id_collection_type_unique
    UNIQUE (id, collection_type),

  -- A City Collection's city must belong to the collection's own market.
  -- Trivially satisfied when city_id IS NULL (Market Collections).
  CONSTRAINT collections_city_market_consistency
    FOREIGN KEY (city_id, market_id)
    REFERENCES public.cities (id, market_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.collections IS
  'Reusable editorial curation asset (Content -> Collections -> Homepages). '
  'See docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md. Owns membership '
  '(algorithmic, evaluated at query time by the application layer — not '
  'stored here) plus manual overrides via collection_venue_overrides / '
  'collection_event_overrides / collection_guide_items. Does not own '
  'presentation or SEO — see spec "Collections themselves are editorial '
  'assets and therefore do not require SEO."';
COMMENT ON COLUMN public.collections.collection_type IS
  'venue | event | guide (V1 scope). A Collection holds exactly one content '
  'type — Mixed Collections are explicitly deferred (see spec, Future '
  'Considerations).';
COMMENT ON COLUMN public.collections.algorithm_key IS
  'Optional. Names the bespoke algorithmic definition this Collection uses '
  '(e.g. highly-rated, patio-picks, featured-nearby, new-this-week), '
  'resolved to code at the application layer — the same named-key dispatch '
  'pattern already used by discover_rail_overrides.rail_key (034) and '
  'content_guide_channels.channel_key (055): deliberately unconstrained '
  'TEXT, no CHECK, so a new algorithm never requires a migration. NULL '
  'means this Collection is manual-only — its entire membership comes from '
  'collection_venue_overrides / collection_event_overrides / '
  'collection_guide_items. When set, the named algorithm supplies the base '
  'pool and its own native default sort order (mirroring "System '
  'Recommendations (algorithm) + Internal Curation = Final rail candidate '
  'pool" from migration 034''s own header comment); manual override rows '
  'still layer on top exactly as they do for the existing six rails today.';
COMMENT ON COLUMN public.collections.item_limit IS
  'Optional cap on how many items this Collection surfaces (e.g. a '
  'homepage section may only want the top 8). NULL means no explicit cap — '
  'the algorithm''s own default applies, or all manual items are shown.';
COMMENT ON COLUMN public.collections.market_id IS
  'Required. A Market Collection (city_id IS NULL) may draw content from any '
  'city within this market. Geography-membership matching for individual '
  'members is application-level — see migration header note.';
COMMENT ON COLUMN public.collections.city_id IS
  'Optional. When set, this is a City Collection and should contain only '
  'content belonging to this city (application-level enforcement — see '
  'migration header note). NULL means a Market Collection.';
COMMENT ON COLUMN public.collections.status IS
  'draft | published. Simplified status model per project convention — no '
  'scheduling, archiving, or approval states in V1.';

CREATE TRIGGER collections_updated_at
  BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS collections_market_id_idx ON public.collections (market_id);
CREATE INDEX IF NOT EXISTS collections_city_id_idx ON public.collections (city_id);
CREATE INDEX IF NOT EXISTS collections_status_idx ON public.collections (status);
CREATE INDEX IF NOT EXISTS collections_collection_type_idx ON public.collections (collection_type);

-- Partial index for the Discover Management transition (see migration
-- header): finding which Collection(s) already seed a given algorithm_key.
-- Mirrors the venues_spotlight_eligible_idx (033) "only index when set" style.
CREATE INDEX IF NOT EXISTS collections_algorithm_key_idx
  ON public.collections (algorithm_key)
  WHERE algorithm_key IS NOT NULL;

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
-- Internal editorial asset, admin/founder-managed only via the Control
-- Panel (createAdminClient() / service-role). No permissive policies —
-- matches content_guides (052). Public rendering (a later task) will not
-- read this table directly; it reads through homepage_sections instead.

GRANT ALL ON public.collections TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: collection_venue_overrides
--
-- Per-collection manual venue curation. Same proven shape as
-- discover_rail_overrides (034), generalized from a fixed rail_key to a
-- reusable collection_id, plus a `boost` column that lifts a venue's rank
-- *within this collection only* (distinct from venues.internal_boost, which
-- lifts a venue globally across every existing rail — untouched by this
-- migration).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collection_venue_overrides (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  collection_id UUID        NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  venue_id      UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,

  action        TEXT        NOT NULL,
  boost         INTEGER     NOT NULL DEFAULT 0,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  reason_type   TEXT,
  note          TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT,

  CONSTRAINT collection_venue_overrides_action_check
    CHECK (action IN ('include', 'exclude')),
  CONSTRAINT collection_venue_overrides_boost_range
    CHECK (boost BETWEEN 0 AND 100),
  CONSTRAINT collection_venue_overrides_unique_collection_venue
    UNIQUE (collection_id, venue_id)
);

COMMENT ON TABLE public.collection_venue_overrides IS
  'Manual venue curation scoped to a single Collection. Mirrors '
  'discover_rail_overrides (034) — action include/exclude, geography and '
  'venues.exclude_from_discover still apply at query time (application '
  'layer). Not a copy of that table''s data; discover_rail_overrides is left '
  'untouched by this migration.';
COMMENT ON COLUMN public.collection_venue_overrides.boost IS
  'Manual rank lift applied only within this Collection (0-100), distinct '
  'from the global venues.internal_boost. Meaningful primarily alongside '
  'action = include; harmless but inert when action = exclude.';
COMMENT ON COLUMN public.collection_venue_overrides.sort_order IS
  'Explicit manual position within this Collection — the spec''s '
  '"Ordering" capability, distinct from boost (a score lift, not a '
  'position). Authoritative when the parent collections.algorithm_key IS '
  'NULL (fully manual Collection); for an algorithmic Collection the '
  'algorithm''s native ranking is expected to take precedence at the '
  'application layer, with sort_order available as a secondary/tie-break '
  'signal. Mirrors collection_guide_items.sort_order.';
COMMENT ON COLUMN public.collection_venue_overrides.reason_type IS
  'Free-text, intentionally unconstrained (no CHECK) — matches the '
  'discover_event_overrides (038) convention rather than the earlier '
  'CHECK-enumerated discover_rail_overrides (034) one, so new reasons never '
  'require a migration.';

CREATE TRIGGER collection_venue_overrides_updated_at
  BEFORE UPDATE ON public.collection_venue_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.collection_venue_overrides ENABLE ROW LEVEL SECURITY;
-- Internal-only — no permissive policies. Same access model as collections.

GRANT ALL ON public.collection_venue_overrides TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: collection_event_overrides
--
-- Per-collection manual event curation. Mirrors discover_event_overrides
-- (038) the same way collection_venue_overrides mirrors discover_rail_overrides.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collection_event_overrides (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  collection_id UUID        NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  event_id      UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  action        TEXT        NOT NULL,
  boost         INTEGER     NOT NULL DEFAULT 0,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  reason_type   TEXT,
  note          TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT,

  CONSTRAINT collection_event_overrides_action_check
    CHECK (action IN ('include', 'exclude')),
  CONSTRAINT collection_event_overrides_boost_range
    CHECK (boost BETWEEN 0 AND 100),
  CONSTRAINT collection_event_overrides_unique_collection_event
    UNIQUE (collection_id, event_id)
);

COMMENT ON TABLE public.collection_event_overrides IS
  'Manual event curation scoped to a single Collection. Mirrors '
  'discover_event_overrides (038) the same way collection_venue_overrides '
  'mirrors discover_rail_overrides. discover_event_overrides is left '
  'untouched by this migration.';
COMMENT ON COLUMN public.collection_event_overrides.boost IS
  'Manual rank lift applied only within this Collection (0-100), distinct '
  'from the global events.internal_boost.';
COMMENT ON COLUMN public.collection_event_overrides.sort_order IS
  'Explicit manual position within this Collection — see the identical '
  'collection_venue_overrides.sort_order comment for full rationale.';

CREATE TRIGGER collection_event_overrides_updated_at
  BEFORE UPDATE ON public.collection_event_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.collection_event_overrides ENABLE ROW LEVEL SECURITY;
-- Internal-only — no permissive policies.

GRANT ALL ON public.collection_event_overrides TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: collection_guide_items
--
-- Guide Collection membership. Unlike venues/events, guides have no existing
-- algorithmic discovery pool or exclude_from_discover-style column to evolve
-- from (content_guides participates in discovery today only via the
-- Content Engine's channel_key-based content_guide_channels/placements —
-- migration 055 — a separate, untouched mechanism). Guide Collection
-- membership is therefore a plain manual list: a row exists, the guide is a
-- member, sort_order controls its position. No action/boost columns — with
-- no algorithm to include/exclude against or lift within, sort_order alone
-- fully controls guide ordering; adding boost/action here would be unused
-- surface area, not parity for its own sake.
--
-- This deliberately does not block Guide Collections from going algorithmic
-- later (e.g. Newest Published, Featured Guides, or a geography-aware
-- published-guides feed). collections.algorithm_key already lives on the
-- parent collections table, type-agnostically — a Guide Collection can set
-- it the same way a Venue or Event Collection would, with zero change to
-- this table. The only genuinely new need at that point — manually
-- excluding one guide the algorithm would otherwise auto-include, or
-- boosting one within the algorithmic pool — is a small additive
-- `ALTER TABLE ... ADD COLUMN action ...` (mirroring
-- collection_venue_overrides), not a redesign. V1 simply has no algorithmic
-- guide feed to override against yet, so that column stays out for now.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collection_guide_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  collection_id UUID        NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  guide_id      UUID        NOT NULL REFERENCES public.content_guides(id) ON DELETE CASCADE,

  sort_order    INTEGER     NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT,

  CONSTRAINT collection_guide_items_unique_collection_guide
    UNIQUE (collection_id, guide_id)
);

COMMENT ON TABLE public.collection_guide_items IS
  'Guide Collection membership — manual only (guides have no algorithmic '
  'discovery pool to evolve from). See table header note for why this table '
  'has no action/boost columns unlike the venue/event override tables.';

CREATE TRIGGER collection_guide_items_updated_at
  BEFORE UPDATE ON public.collection_guide_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS collection_guide_items_collection_sort_idx
  ON public.collection_guide_items (collection_id, sort_order);

ALTER TABLE public.collection_guide_items ENABLE ROW LEVEL SECURITY;
-- Internal-only — no permissive policies.

GRANT ALL ON public.collection_guide_items TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: homepages
--
-- First-class editorial object belonging to a geography. Never owns content
-- directly — assembles published Collections via homepage_sections.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homepages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  name              TEXT        NOT NULL,

  market_id         UUID        NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  city_id           UUID        REFERENCES public.cities(id) ON DELETE RESTRICT,

  status            TEXT        NOT NULL DEFAULT 'draft',

  -- SEO — same field set and nullability convention as content_guides (054).
  page_title        TEXT,
  meta_title        TEXT,
  meta_description  TEXT,
  og_title          TEXT,
  og_description    TEXT,
  canonical_url     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT,

  CONSTRAINT homepages_status_check
    CHECK (status IN ('draft', 'published')),

  -- A City Homepage's city must belong to the homepage's own market.
  -- Trivially satisfied when city_id IS NULL (Market Homepages).
  CONSTRAINT homepages_city_market_consistency
    FOREIGN KEY (city_id, market_id)
    REFERENCES public.cities (id, market_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.homepages IS
  'First-class editorial object per geography (Content -> Collections -> '
  'Homepages). Never owns content directly — assembles Collections via '
  'homepage_sections. Approved V1 public fallback (NOT implemented here — '
  'schema-only): use the City Homepage when one exists for the visitor''s '
  'geography, otherwise use the parent Market Homepage. See '
  'docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md, "Homepage Fallback".';
COMMENT ON COLUMN public.homepages.city_id IS
  'Optional. NULL = Market Homepage (e.g. the Greater Vancouver Homepage). '
  'Set = City Homepage (e.g. the Burnaby Homepage). Uniqueness enforced by '
  'homepages_one_market_homepage_per_market / '
  'homepages_one_homepage_per_city below, not by this column alone.';
COMMENT ON COLUMN public.homepages.canonical_url IS
  'Generated (or admin-overridden) canonical path, root-relative. Homepages '
  'have no separate slug column — the canonical path is derived from '
  'geography (market/city slug), matching content_guides'' canonical_url '
  'convention (054).';

CREATE TRIGGER homepages_updated_at
  BEFORE UPDATE ON public.homepages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Prevents duplicate Homepages for the same geography (spec requirement:
-- "One Greater Vancouver Market Homepage", "One Burnaby City Homepage").
-- Partial unique indexes, not a single UNIQUE(market_id, city_id) constraint,
-- because Market Homepages (city_id NULL) and City Homepages (city_id set)
-- have different uniqueness scopes:
CREATE UNIQUE INDEX IF NOT EXISTS homepages_one_market_homepage_per_market
  ON public.homepages (market_id)
  WHERE city_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS homepages_one_homepage_per_city
  ON public.homepages (city_id)
  WHERE city_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS homepages_market_id_idx ON public.homepages (market_id);
CREATE INDEX IF NOT EXISTS homepages_status_idx ON public.homepages (status);

ALTER TABLE public.homepages ENABLE ROW LEVEL SECURITY;
-- Internal editorial object, admin/founder-managed only via the Control
-- Panel (service-role). No permissive policies — public rendering of
-- published Homepages is a later task, matching content_guides (052).

GRANT ALL ON public.homepages TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: homepage_sections
--
-- Ordered Collection assignments on a Homepage. See migration header note
-- for how the (collection_id, section_type) composite FK enforces Section
-- Type / Collection Type compatibility at the database level.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homepage_sections (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  homepage_id    UUID        NOT NULL REFERENCES public.homepages(id) ON DELETE CASCADE,

  section_type   TEXT        NOT NULL,
  title          TEXT        NOT NULL,
  collection_id  UUID,

  display_order  INTEGER     NOT NULL DEFAULT 0,
  is_enabled     BOOLEAN     NOT NULL DEFAULT true,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     TEXT,

  CONSTRAINT homepage_sections_section_type_check
    CHECK (section_type IN ('venue', 'event', 'guide')),

  -- V1 has no Duplicate Sections capability (explicitly deferred — see
  -- spec, "Homepage Evolution"): a Homepage may have at most one section of
  -- each type.
  CONSTRAINT homepage_sections_unique_type_per_homepage
    UNIQUE (homepage_id, section_type),

  -- The enforcement point: a section can only be assigned a Collection whose
  -- collection_type exactly matches this section's section_type. NULL
  -- collection_id (empty/unassigned template slot) trivially satisfies this
  -- — Postgres does not check a multi-column FK when any column is NULL.
  -- ON DELETE RESTRICT: a Collection referenced by any section (draft or
  -- published Homepage) cannot be deleted — same backstop pattern as
  -- content_guide_faqs.faq_id (057). Full usage-reporting UI and
  -- unpublish-time validation are later tasks; this is the DB-level safety
  -- net that makes them possible without risk of orphaned references today.
  CONSTRAINT homepage_sections_collection_type_match
    FOREIGN KEY (collection_id, section_type)
    REFERENCES public.collections (id, collection_type)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.homepage_sections IS
  'Ordered Collection assignments on a Homepage. section_type values '
  '(venue | event | guide) intentionally mirror collections.collection_type '
  'so homepage_sections_collection_type_match can enforce compatibility as a '
  'real composite FK. The human-facing section label lives in `title`, '
  'fully independent and editable — it is NOT the section_type code. V1 '
  'scope is deliberately limited to the three Collection-backed section '
  'types named in the task; non-Collection presentational section types '
  '(e.g. a future Hero or Explore Nearby slot, mentioned in the product '
  'spec''s example template but out of scope here) can be added later via '
  'an additive CHECK-constraint widening — collection_id would simply stay '
  'NULL for those. Hero and Explore Nearby are excluded from this table on '
  'purpose, not by oversight: neither is Collection-backed. Hero is '
  'editorial copy/image/CTA content with no membership concept at all; '
  'Explore Nearby is expected to be a live proximity query (same family as '
  'the existing "Near Me" consumer-app behavior), not a static curated '
  'list. Where their editable data will live — new nullable columns on '
  'homepages, a separate small table, or no admin-editable data at all for '
  'Explore Nearby — is an open question deliberately deferred to the later '
  'Homepage Management / Homepage Editor task, once their product '
  'requirements are finalized. No speculative columns for either are added '
  'in this migration.';
COMMENT ON COLUMN public.homepage_sections.section_type IS
  'venue | event | guide. Determines the compatible Collection type, public '
  'renderer, card type, and View All destination (application-level — not '
  'stored here). See collections_collection_type_check for the mirrored '
  'value set.';
COMMENT ON COLUMN public.homepage_sections.title IS
  'Editable public-facing heading (e.g. "Patio Picks"), fully independent of '
  'section_type. A newly-created section is expected to default to a '
  'template label (e.g. "Featured Venues") at the application layer — no '
  'default is stored here.';
COMMENT ON COLUMN public.homepage_sections.collection_id IS
  'Nullable — an empty/unassigned template slot is valid (spec: a Section '
  'with no assigned Collection simply does not render publicly, it is not '
  'an error state). See homepage_sections_collection_type_match for the '
  'compatibility guarantee once a Collection is assigned.';

CREATE TRIGGER homepage_sections_updated_at
  BEFORE UPDATE ON public.homepage_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS homepage_sections_homepage_order_idx
  ON public.homepage_sections (homepage_id, display_order);

-- Supports future "which Homepages use this Collection" usage-reporting
-- (spec: "Collection Usage & Deletion Protection").
CREATE INDEX IF NOT EXISTS homepage_sections_collection_id_idx
  ON public.homepage_sections (collection_id);

ALTER TABLE public.homepage_sections ENABLE ROW LEVEL SECURITY;
-- Internal-only — no permissive policies. Same access model as homepages.

GRANT ALL ON public.homepage_sections TO service_role;
