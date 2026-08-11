-- =============================================================================
-- Happy Hour Compass — Internal CRM Venue Contacts
-- Migration: 074_crm_venue_contacts.sql
--
-- PURPOSE:
--   Minimal internal CRM contact model for venue outreach (claim outreach,
--   operator relationship management, follow-up, future sales/marketing).
--   Created to surface a primary contact email on the existing Control Panel
--   Action Center "Seeded Venues Needing Claims" report.
--
-- THIS TABLE IS INTERNAL-ONLY. It must never become part of the public venue
-- profile, public API responses, structured data, metadata, sitemap, or any
-- consumer-facing query. See RLS/GRANT section below.
--
-- WHAT THIS TABLE DELIBERATELY DOES NOT STORE:
--   venue name, city, seeded status, claimed/unclaimed status, or a copy of
--   the operator id. Those all belong to the existing product data model
--   (public.venues / public.operators) and must be joined dynamically by
--   venue_id at read time — never duplicated here. This keeps venue claim
--   status derived from the existing venues/operators relationship as the
--   single source of truth (see venues.source + venues.created_by_operator_id,
--   migration 013_venue_source_attribution.sql), not from CRM data.
--
-- NAMING NOTE:
--   crm_venue_contacts.source describes where a *contact record* came from
--   (website_research | venue_claim | operator_submission | manual). This is
--   distinct from venues.source, which describes where a *venue record* came
--   from (seed | operator_submission | consumer_suggestion | internal). Same
--   column name, different table, different meaning — do not conflate them.
--
-- RELATIONSHIP:
--   Many contacts per venue (owner, GM, marketing contact, etc.) — not a 1:1
--   field on venues. is_primary + a partial unique index identify the single
--   contact a simple UI should surface for a venue, when one is set.
--
-- SECURITY PATTERN:
--   Mirrors venue_notes (035_venue_notes.sql) exactly: RLS enabled, zero
--   permissive policies, service-role-only GRANT. Only reachable via
--   createAdminClient() from Control Panel server code — never via the
--   anon/authenticated Supabase Data API.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: crm_venue_contacts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_venue_contacts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  venue_id           UUID        NOT NULL
                                  REFERENCES public.venues(id)
                                  ON DELETE CASCADE,

  -- Contact details — all nullable; a row may start as just an email, or
  -- just a name/role with no email yet found.
  full_name          TEXT,
  role               TEXT,                     -- e.g. "Owner", "General Manager"
  email              TEXT,
  phone              TEXT,

  -- Provenance of this contact record (see NAMING NOTE above).
  source             TEXT        NOT NULL,

  -- At most one primary contact per venue — enforced by the partial unique
  -- index below, not by this column alone.
  is_primary         BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Outreach lifecycle for this contact.
  outreach_status    TEXT        NOT NULL DEFAULT 'not_contacted',
  last_contacted_at  TIMESTAMPTZ,

  -- Attribution — mirrors venue_notes.created_by / created_by_email
  -- (035_venue_notes.sql): auth.uid() of the admin who added the row, plus
  -- an email snapshot at write time for display without a join. Nullable
  -- for audit resilience (e.g. rows written by a script/service job).
  created_by         UUID,
  created_by_email   TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.crm_venue_contacts IS
  'Internal-only CRM contact records for venue outreach (claim outreach, '
  'operator relationship management, follow-up, future sales/marketing). '
  'Never exposed to consumers — see RLS/GRANTs below. Venue name, city, '
  'seeded status, and claimed/unclaimed status are intentionally NOT stored '
  'here; they must be joined dynamically from public.venues at read time.';

COMMENT ON COLUMN public.crm_venue_contacts.venue_id IS
  'FK to venues(id). Cascades on delete. A venue may have zero, one, or '
  'many contact rows.';

COMMENT ON COLUMN public.crm_venue_contacts.source IS
  'Provenance of this CONTACT record: website_research | venue_claim | '
  'operator_submission | manual. Distinct from venues.source (provenance of '
  'the VENUE record) — same column name, different table, different meaning.';

COMMENT ON COLUMN public.crm_venue_contacts.is_primary IS
  'At most one TRUE per venue_id, enforced by '
  'crm_venue_contacts_one_primary_per_venue_idx below.';

COMMENT ON COLUMN public.crm_venue_contacts.outreach_status IS
  'Outreach lifecycle for this contact: not_contacted | contacted | '
  'responded | declined | claimed.';

COMMENT ON COLUMN public.crm_venue_contacts.created_by IS
  'auth.uid() of the admin who added this contact. Nullable for audit '
  'resilience (e.g. rows written by a script/service job).';

COMMENT ON COLUMN public.crm_venue_contacts.created_by_email IS
  'Email snapshot of the author at write time (denormalised for display). '
  'Nullable for audit resilience.';


-- ─────────────────────────────────────────────────────────────────────────────
-- CHECK CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_venue_contacts
  ADD CONSTRAINT crm_venue_contacts_source_check
  CHECK (source IN ('website_research', 'venue_claim', 'operator_submission', 'manual'));

ALTER TABLE public.crm_venue_contacts
  ADD CONSTRAINT crm_venue_contacts_outreach_status_check
  CHECK (outreach_status IN ('not_contacted', 'contacted', 'responded', 'declined', 'claimed'));


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- Reuses update_updated_at() from 001_initial_schema.sql (search_path pinned
-- by 039_security_hardening.sql).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER crm_venue_contacts_updated_at
  BEFORE UPDATE ON public.crm_venue_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- All contacts for a venue (primary access pattern for the Action Center join).
CREATE INDEX IF NOT EXISTS crm_venue_contacts_venue_id_idx
  ON public.crm_venue_contacts (venue_id);

-- At most one primary contact per venue.
CREATE UNIQUE INDEX IF NOT EXISTS crm_venue_contacts_one_primary_per_venue_idx
  ON public.crm_venue_contacts (venue_id)
  WHERE (is_primary);

-- Future operational queries: outreach queue ordered by most-recently-updated.
CREATE INDEX IF NOT EXISTS crm_venue_contacts_outreach_status_updated_idx
  ON public.crm_venue_contacts (outreach_status, updated_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — internal-only, no permissive policies.
-- Matches venue_notes / venue_claim_notes / operator_submission_notes /
-- platform_admins. The Control Panel reads/writes exclusively via
-- createAdminClient() (service-role), which bypasses RLS entirely. With RLS
-- enabled and no permissive policy, anon and authenticated get nothing via
-- the Supabase Data API.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_venue_contacts ENABLE ROW LEVEL SECURITY;

-- No permissive policies — intentional. Do not add an anon/authenticated
-- policy to this table without a deliberate, separately-reviewed decision:
-- this table must stay unreachable from any public or operator-facing surface.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — service_role only. No anon, no authenticated.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.crm_venue_contacts TO service_role;
