-- =============================================================================
-- Happy Hour Compass — Initial Database Schema
-- Migration: 001_initial_schema.sql
--
-- HOW TO APPLY:
--   Option A (Supabase Dashboard):
--     1. Open your Supabase project → SQL Editor
--     2. Paste this entire file and click "Run"
--
--   Option B (Supabase CLI):
--     supabase db push
--
-- NOTES:
--   • Row Level Security (RLS) is enabled on every table.
--   • All policies require a valid Supabase Auth session (auth.uid() IS NOT NULL).
--   • Ownership-based policies on operators use email matching from the JWT.
--   • Ownership policies for venues/events/media/claims can be tightened in
--     a future migration once the auth.users ↔ operators link is formalised.
-- =============================================================================

-- pgcrypto is needed for gen_random_uuid() on older Postgres versions.
-- On Supabase (Postgres 15+) it is already available; this is a safe no-op.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: operators
--   Tracks registered business operators (one row per operator account).
--   Linked to Supabase Auth via the email field.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operators (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT,
  email        TEXT        UNIQUE NOT NULL,
  is_approved  BOOLEAN     NOT NULL DEFAULT FALSE,
  role         TEXT        NOT NULL DEFAULT 'operator',  -- future values: 'admin'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE operators ENABLE ROW LEVEL SECURITY;

-- An operator can only read their own row (matched by email from the JWT).
CREATE POLICY "operators: read own row"
  ON operators FOR SELECT
  TO authenticated
  USING ((auth.jwt() ->> 'email') = email);

-- An operator can only update their own row.
CREATE POLICY "operators: update own row"
  ON operators FOR UPDATE
  TO authenticated
  USING  ((auth.jwt() ->> 'email') = email)
  WITH CHECK ((auth.jwt() ->> 'email') = email);

-- Any authenticated user can insert a row for themselves (first-time registration).
CREATE POLICY "operators: insert own row"
  ON operators FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'email') = email);


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: venues
--   Core venue / happy-hour data.  One row per physical location.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venues (
  id                      UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT             UNIQUE NOT NULL,
  name                    TEXT             NOT NULL,
  address_line1           TEXT,
  city                    TEXT,
  region                  TEXT,
  postal_code             TEXT,
  country                 TEXT,
  phone                   TEXT,
  website_url             TEXT,
  menu_url                TEXT,
  lat                     DOUBLE PRECISION,
  lng                     DOUBLE PRECISION,
  hours                   TEXT,
  payment_types           TEXT,  -- e.g. comma-separated: "credit, cash"
  hh_times                TEXT,
  hh_tagline              TEXT,
  hh_food_details         TEXT,
  hh_drink_details        TEXT,
  is_published            BOOLEAN          NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  created_by_operator_id  UUID             REFERENCES operators(id) ON DELETE SET NULL,
  updated_by_operator_id  UUID             REFERENCES operators(id) ON DELETE SET NULL
);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all venues (both published and draft).
-- Refine this to "own venues only" once ownership queries are optimised.
CREATE POLICY "venues: authenticated read"
  ON venues FOR SELECT
  TO authenticated
  USING (TRUE);

-- Only the operator who created the venue can update it.
CREATE POLICY "venues: update own"
  ON venues FOR UPDATE
  TO authenticated
  USING (
    created_by_operator_id IN (
      SELECT id FROM operators WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- Any authenticated operator can create a venue.
CREATE POLICY "venues: insert authenticated"
  ON venues FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: events
--   Recurring or one-off events tied to a venue.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  slug                    TEXT        UNIQUE NOT NULL,
  title                   TEXT        NOT NULL,
  event_time              TEXT,        -- human-readable, e.g. "6 – 9 PM"
  event_frequency         TEXT,        -- e.g. "Every Wednesday"
  description             TEXT,
  is_published            BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_operator_id  UUID        REFERENCES operators(id) ON DELETE SET NULL,
  updated_by_operator_id  UUID        REFERENCES operators(id) ON DELETE SET NULL
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events: authenticated read"
  ON events FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "events: update own"
  ON events FOR UPDATE
  TO authenticated
  USING (
    created_by_operator_id IN (
      SELECT id FROM operators WHERE email = (auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "events: insert authenticated"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: media
--   Images and other media assets linked to a venue.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,  -- 'logo' | 'interior' | 'food' | 'drink'
  url         TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media: authenticated read"
  ON media FOR SELECT
  TO authenticated
  USING (TRUE);

-- Only the venue owner can add media to their venue.
CREATE POLICY "media: insert for own venue"
  ON media FOR INSERT
  TO authenticated
  WITH CHECK (
    venue_id IN (
      SELECT v.id FROM venues v
      JOIN operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  );

-- Only the venue owner can delete media from their venue.
CREATE POLICY "media: delete for own venue"
  ON media FOR DELETE
  TO authenticated
  USING (
    venue_id IN (
      SELECT v.id FROM venues v
      JOIN operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: claims
--   An operator's request to take ownership of an existing venue listing.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS claims (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  operator_id  UUID        NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

-- Operators can only see their own claims.
CREATE POLICY "claims: read own"
  ON claims FOR SELECT
  TO authenticated
  USING (
    operator_id IN (
      SELECT id FROM operators WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- Operators can submit claims for themselves.
CREATE POLICY "claims: insert own"
  ON claims FOR INSERT
  TO authenticated
  WITH CHECK (
    operator_id IN (
      SELECT id FROM operators WHERE email = (auth.jwt() ->> 'email')
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every row change
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER operators_updated_at
  BEFORE UPDATE ON operators
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
