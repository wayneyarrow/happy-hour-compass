-- =============================================================================
-- Happy Hour Compass — Venue Claim Workflow V1: Intake Schema
-- Migration: 007_venue_claims.sql
--
-- PURPOSE:
--   This migration supports the "claim a seeded venue" flow.
--   A venue_claim is a public intake record — someone who already operates a
--   venue listed in our database submits their contact details so the founder
--   can review and grant them operator access to that listing.
--
--   This is DISTINCT from the future "operator creates a brand new venue" flow.
--   New-venue creation is handled by the existing venues table + operator auth.
--   venue_claims is ONLY for claiming pre-seeded / already-listed venues.
--
-- WHAT THIS MIGRATION DOES:
--   1. Creates the venue_claims intake table.
--   2. Adds CHECK constraint on status.
--   3. Adds indexes for founder review queries.
--   4. Adds a partial unique index: only one pending claim per venue at a time.
--   5. Adds claimed_at + claimed_by columns to venues.
--   6. Wires the existing update_updated_at() trigger to venue_claims.
--   7. Enables RLS on venue_claims with minimal safe V1 policies.
--
-- RLS NOTE:
--   INSERT is open to anon + authenticated (public claim form, no auth required).
--   SELECT / UPDATE / DELETE have no permissive policies → denied to all
--   non-service-role clients by default.
--   Founder review is performed via service-role in a secure server context.
--   An admin-role SELECT/UPDATE policy can be added in a future migration once
--   the operators.role = 'admin' pattern is formalised in RLS.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: venue_claims
--
--   Intake records for claims against seeded/pre-existing venues.
--   Claimants submit contact info without requiring a registered account.
--   Founder manually reviews each submission and sets status + review_notes.
--
--   NOTE: This table is NOT for operator-created new venues.
--   Operator-created venues go through the existing venues + operators flow.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_claims (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The existing seeded venue being claimed (required)
  venue_id      UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,

  -- Claimant contact details (no operator account required at intake)
  first_name    TEXT        NOT NULL,
  last_name     TEXT        NOT NULL,
  position      TEXT,                    -- e.g. "Owner", "General Manager"
  phone         TEXT,
  email         TEXT        NOT NULL,    -- plain text; claimant may not have an account yet

  -- Captured server-side for duplicate/fraud signals; nullable (proxies etc.)
  ip_address    TEXT,

  -- Founder review fields
  -- status values enforced by CHECK constraint below
  status        TEXT        NOT NULL DEFAULT 'pending',
  review_notes  TEXT,                    -- founder's internal notes
  reviewed_by   UUID,                    -- future: operator.id of reviewing admin; no FK yet
  reviewed_at   TIMESTAMPTZ,

  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.venue_claims IS
  'Public intake records for claims against pre-seeded venue listings. '
  'Distinct from the future operator-creates-new-venue flow. '
  'Founder reviews each submission manually before granting operator access.';

COMMENT ON COLUMN public.venue_claims.venue_id IS
  'The seeded/pre-existing venue being claimed. Must reference venues.id.';

COMMENT ON COLUMN public.venue_claims.email IS
  'Claimant contact email. Stored as plain text; claimant may not yet have '
  'a registered operator account at time of submission.';

COMMENT ON COLUMN public.venue_claims.ip_address IS
  'Captured at submission time for duplicate detection and fraud signals. '
  'Nullable; omit when unavailable (proxy, missing header, etc.).';

COMMENT ON COLUMN public.venue_claims.reviewed_by IS
  'UUID of the reviewing operator (founder/admin). Stored without FK for now '
  'because the operators.role = ''admin'' pattern is not yet formalised in RLS. '
  'Wire to operators(id) in a future migration once admin role is established.';

COMMENT ON COLUMN public.venue_claims.status IS
  'Claim review status. Constrained to: pending | approved | needs_more_info | rejected.';


-- ─────────────────────────────────────────────────────────────────────────────
-- CHECK CONSTRAINT: valid status values
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_claims
  ADD CONSTRAINT venue_claims_status_check
  CHECK (status IN ('pending', 'approved', 'needs_more_info', 'rejected'));


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- Founder review queue: filter by status, ordered newest-first
CREATE INDEX IF NOT EXISTS venue_claims_status_created_at_idx
  ON public.venue_claims (status, created_at DESC);

-- Look up all claims for a specific venue
CREATE INDEX IF NOT EXISTS venue_claims_venue_id_idx
  ON public.venue_claims (venue_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTIAL UNIQUE INDEX: one pending claim per venue at a time
--
-- Prevents duplicate in-flight submissions for the same venue.
-- Only applies to rows where status = 'pending'.
-- Approved, rejected, and needs_more_info claims do not block new submissions,
-- allowing re-submission after a rejection or stale claim.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS venue_claims_one_pending_per_venue_idx
  ON public.venue_claims (venue_id)
  WHERE (status = 'pending');


-- ─────────────────────────────────────────────────────────────────────────────
-- VENUES TABLE: add claim tracking columns
--
--   claimed_at  — timestamp when a claim was approved and operator access granted
--   claimed_by  — uuid of the operator granted access (no FK yet; see comment)
--
--   These are set by a future approval action, not by this migration.
--   They are nullable and default to NULL on all existing rows.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS claimed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by  UUID;

COMMENT ON COLUMN public.venues.claimed_at IS
  'Timestamp when a venue claim was approved and operator access was granted. '
  'NULL means unclaimed (seeded venue with no assigned operator).';

COMMENT ON COLUMN public.venues.claimed_by IS
  'UUID of the operator who was granted ownership via the claim workflow. '
  'Distinct from created_by_operator_id (which tracks who inserted the row, '
  'typically the seeder). No FK constraint until admin role is formalised.';


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on venue_claims
--
-- Reuses the existing update_updated_at() function from 001_initial_schema.sql.
-- Pattern matches operators_updated_at, venues_updated_at, events_updated_at.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER venue_claims_updated_at
  BEFORE UPDATE ON public.venue_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY: venue_claims
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_claims ENABLE ROW LEVEL SECURITY;

-- V1 INSERT policy: public claim form — no auth required.
-- Both anonymous visitors and authenticated users can submit a claim.
-- Matches the product requirement: consumer-facing claim form has no login gate.
DROP POLICY IF EXISTS "venue_claims: public insert" ON public.venue_claims;
CREATE POLICY "venue_claims: public insert"
  ON public.venue_claims
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);

-- SELECT, UPDATE, DELETE: no permissive policy.
-- With RLS enabled and no matching policy, all non-service-role access is denied.
-- Founder review is performed via service-role in a secure server action.
--
-- TODO (follow-up migration): once operators.role = 'admin' is used in RLS,
-- add a SELECT + UPDATE policy scoped to admin operators, e.g.:
--
--   CREATE POLICY "venue_claims: admin read"
--     ON public.venue_claims FOR SELECT TO authenticated
--     USING (
--       EXISTS (
--         SELECT 1 FROM public.operators
--         WHERE email = auth.jwt() ->> 'email'
--           AND role  = 'admin'
--       )
--     );
