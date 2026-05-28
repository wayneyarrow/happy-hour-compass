-- =============================================================================
-- Migration: 028_venues_is_verified.sql
--
-- Adds a dedicated is_verified boolean to the venues table to power the
-- "Verified Venue ✓" consumer trust badge.
--
-- Why a dedicated field rather than deriving from claimed_by/claimed_at:
--   - Derived logic is fragile: if ownership fields are cleared or re-pointed
--     (e.g. an operator leaves), verification state would silently flip.
--   - A dedicated boolean enables founder override/revocation later without
--     touching ownership fields.
--   - It is the single source of truth for the consumer badge — simple to
--     query, cache, and control.
--
-- Backfill logic (applied below):
--   A venue qualifies as verified if it has any of:
--   1. An approved venue claim (venue_claims.status = 'approved')
--   2. An approved operator submission linked to this venue
--      (operator_submissions.status = 'approved')
--   3. An operator currently linked via claimed_by or created_by_operator_id
--      (set by provisionOperatorForVenue — these were always provisioned
--      through approved claim or submission flows)
--
-- Future writes:
--   operatorActivation.provisionOperatorForVenue() sets is_verified = true
--   when linking a venue to a newly provisioned operator.
-- =============================================================================

-- ── Add column ────────────────────────────────────────────────────────────────

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Backfill: approved claims ─────────────────────────────────────────────────

UPDATE venues v
SET    is_verified = TRUE
WHERE  is_verified = FALSE
  AND  EXISTS (
    SELECT 1
    FROM   venue_claims vc
    WHERE  vc.venue_id = v.id
      AND  vc.status   = 'approved'
  );

-- ── Backfill: approved operator submissions ───────────────────────────────────

UPDATE venues v
SET    is_verified = TRUE
WHERE  is_verified = FALSE
  AND  EXISTS (
    SELECT 1
    FROM   operator_submissions os
    WHERE  os.venue_id = v.id
      AND  os.status   = 'approved'
  );

-- ── Backfill: venues legitimately linked to operators ────────────────────────
-- claimed_by and created_by_operator_id are only set by provisionOperatorForVenue,
-- which is called exclusively from approved-claim and approved-submission flows.

UPDATE venues
SET    is_verified = TRUE
WHERE  is_verified = FALSE
  AND  (claimed_by IS NOT NULL OR created_by_operator_id IS NOT NULL);

-- ── Index (optional, for future badge-filtered queries) ───────────────────────

CREATE INDEX IF NOT EXISTS idx_venues_is_verified ON venues (is_verified)
  WHERE is_verified = TRUE;
