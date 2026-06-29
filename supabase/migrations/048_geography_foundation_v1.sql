-- =============================================================================
-- 048_geography_foundation_v1.sql
--
-- Geography Data Foundation V1 — see docs/website/WEBSITE_PRODUCT_PLAYBOOK.md
-- ("Geographic Information Architecture") for the product decisions this
-- schema implements.
--
-- Terminology mapping (per Geographic Information Architecture):
--   Market   = internal operational region   → public.markets
--   Region   = public-facing label for Market → markets.name (same row, no
--              separate table; "Region" is a presentation-layer alias for
--              "Market", not a distinct geography level)
--   City     = primary consumer/SEO geography → public.cities
--   Neighbourhood = optional future layer      → public.neighbourhoods
--              (table created here; left UNSEEDED — see card notes)
--   Browsing Location = derived at the application layer
--              (src/lib/geo/geography.ts), not persisted
--
-- This migration is purely additive:
--   • Creates markets, cities, neighbourhoods as new tables.
--   • Adds nullable market_id / city_id / neighbourhood_id FKs to venues.
--   • Does NOT touch or remove venues.city / venues.region / venues.country
--     (existing text fields stay as the source of truth for legacy code
--     paths until all pages are migrated — see CLAUDE.md, "Website Vision &
--     Playbook").
--   • Does NOT change the config-based MARKETS array in src/lib/markets.ts
--     or the hhc_market cookie flow. Those keep driving live market
--     selection until a future card wires them to this table.
--
-- markets.slug values intentionally match MARKETS[].id in
-- src/lib/markets.ts (central-okanagan, greater-vancouver, victoria,
-- calgary) so a future migration can switch the config to read from this
-- table with a 1:1 slug match instead of a rename.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: markets
--   Operational region. Public-facing UI may label this "Region" — same row,
--   different presentation layer (see header note above).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.markets (
  id             UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT             UNIQUE NOT NULL,
  name           TEXT             NOT NULL,
  province       TEXT             NOT NULL,
  country        TEXT             NOT NULL DEFAULT 'CA',
  status         TEXT             NOT NULL DEFAULT 'coming_soon',
  center_lat     DOUBLE PRECISION,
  center_lng     DOUBLE PRECISION,
  radius_km      DOUBLE PRECISION,
  display_order  INTEGER          NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CONSTRAINT markets_status_check CHECK (status IN ('active', 'coming_soon'))
);

COMMENT ON TABLE public.markets IS
  'Operational region (internal "Market"). Public-facing copy may call this '
  '"Region" — see Geographic Information Architecture in '
  'docs/website/WEBSITE_PRODUCT_PLAYBOOK.md. Mirrors MARKETS in '
  'src/lib/markets.ts by slug; not yet the source of truth for live market '
  'selection.';

CREATE TRIGGER markets_updated_at
  BEFORE UPDATE ON public.markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;

-- Public reference data — no sensitive content (names, slugs, map centers).
-- Safe to read without authentication, unlike venues (which intentionally
-- has no public-read policy yet — see migration 039).
CREATE POLICY "markets: public read"
  ON public.markets FOR SELECT
  TO anon, authenticated
  USING (TRUE);

GRANT SELECT       ON public.markets TO anon;
GRANT SELECT       ON public.markets TO authenticated;
GRANT ALL          ON public.markets TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: cities
--   Primary consumer/SEO geography. Belongs to one market.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cities (
  id                       UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id                UUID             NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  slug                     TEXT             NOT NULL,
  name                     TEXT             NOT NULL,
  status                   TEXT             NOT NULL DEFAULT 'active',
  supports_neighbourhoods  BOOLEAN          NOT NULL DEFAULT FALSE,
  display_order            INTEGER          NOT NULL DEFAULT 0,
  center_lat               DOUBLE PRECISION,
  center_lng               DOUBLE PRECISION,
  created_at               TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CONSTRAINT cities_status_check CHECK (status IN ('active', 'coming_soon')),
  CONSTRAINT cities_market_slug_unique UNIQUE (market_id, slug)
);

COMMENT ON TABLE public.cities IS
  'Primary consumer-facing and SEO geography unit. One city belongs to one '
  'market. slug is unique within a market, not globally (two markets may '
  'each have a city with the same slug).';

CREATE TRIGGER cities_updated_at
  BEFORE UPDATE ON public.cities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS cities_market_id_idx ON public.cities (market_id);

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cities: public read"
  ON public.cities FOR SELECT
  TO anon, authenticated
  USING (TRUE);

GRANT SELECT       ON public.cities TO anon;
GRANT SELECT       ON public.cities TO authenticated;
GRANT ALL          ON public.cities TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- markets.default_city_id — added after cities exists to avoid a circular
-- table-creation dependency.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS default_city_id UUID REFERENCES public.cities(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.markets.default_city_id IS
  'City used as the search/map origin when a market is selected but no '
  'specific city has been chosen. See Search Origin Priority in the '
  'Geographic Information Architecture.';


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: neighbourhoods
--   Optional future layer. Table created now so the schema and FKs are in
--   place; intentionally left UNSEEDED in this migration — see card notes
--   in docs for why (no platform neighbourhood data exists yet; populating
--   requires per-city density/demand review, which is out of scope for this
--   foundation card).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.neighbourhoods (
  id             UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id        UUID             NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  slug           TEXT             NOT NULL,
  name           TEXT             NOT NULL,
  status         TEXT             NOT NULL DEFAULT 'active',
  display_order  INTEGER          NOT NULL DEFAULT 0,
  center_lat     DOUBLE PRECISION,
  center_lng     DOUBLE PRECISION,
  created_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CONSTRAINT neighbourhoods_status_check CHECK (status IN ('active', 'coming_soon')),
  CONSTRAINT neighbourhoods_city_slug_unique UNIQUE (city_id, slug)
);

COMMENT ON TABLE public.neighbourhoods IS
  'Optional future layer below City. Deferred: not populated by this '
  'migration. A city should only get neighbourhood rows when '
  'cities.supports_neighbourhoods = TRUE and venue density / search demand '
  'justify it (see Geographic Information Architecture).';

CREATE TRIGGER neighbourhoods_updated_at
  BEFORE UPDATE ON public.neighbourhoods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS neighbourhoods_city_id_idx ON public.neighbourhoods (city_id);

ALTER TABLE public.neighbourhoods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "neighbourhoods: public read"
  ON public.neighbourhoods FOR SELECT
  TO anon, authenticated
  USING (TRUE);

GRANT SELECT       ON public.neighbourhoods TO anon;
GRANT SELECT       ON public.neighbourhoods TO authenticated;
GRANT ALL          ON public.neighbourhoods TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- venues: additive geography FKs
--   Nullable by design — existing venues.city / venues.region / venues.country
--   text fields are untouched and remain authoritative for any code path not
--   yet migrated to the new model. Backfilled by
--   scripts/backfillVenueGeography.ts where the existing text fields confidently
--   match a seeded market/city; left NULL otherwise (see script output for the
--   unassigned list).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS market_id        UUID REFERENCES public.markets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS city_id          UUID REFERENCES public.cities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS neighbourhood_id UUID REFERENCES public.neighbourhoods(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.venues.market_id IS
  'Normalized FK to public.markets. Nullable; NULL means not yet backfilled '
  'or the venue falls outside all seeded markets (e.g. legacy out-of-region '
  'seed data). venues.city/region/country text fields remain authoritative '
  'until all read paths migrate to this column.';
COMMENT ON COLUMN public.venues.city_id IS
  'Normalized FK to public.cities. Nullable; see market_id comment.';
COMMENT ON COLUMN public.venues.neighbourhood_id IS
  'Normalized FK to public.neighbourhoods. Nullable; neighbourhoods are an '
  'unseeded future layer as of this migration, so this will be NULL for all '
  'venues until neighbourhood data exists.';

CREATE INDEX IF NOT EXISTS venues_market_id_idx ON public.venues (market_id);
CREATE INDEX IF NOT EXISTS venues_city_id_idx ON public.venues (city_id);

-- No RLS/GRANT changes needed on venues — these are plain columns on an
-- existing table; venues' existing policies and grants already cover them.
