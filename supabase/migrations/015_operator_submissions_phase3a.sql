-- =============================================================================
-- Happy Hour Compass — Operator Submissions Phase 3A Extension
-- Migration: 015_operator_submissions_phase3a.sql
--
-- PURPOSE:
--   Extends operator_submissions to support the Phase 3A intake flow:
--   operator submission form → backend Google Places lookup → match confirmation.
--
-- WHAT THIS MIGRATION ADDS:
--   1. Split name fields (first_name, last_name) alongside existing operator_name.
--   2. Submitted business location (street_address, city, province) for lookup
--      context and later pre-population when building the venue record.
--   3. position — the submitter's role at the business.
--   4. google_match_json — full Google Places result stored as JSONB for later
--      pre-population and review; avoids a second Places API call downstream.
--   5. match_status — tracks whether the submitter confirmed, rejected, or had
--      no match; kept separate from status (the review routing field).
--   6. rejection_notes, website, additional_notes — collected on the "not my
--      business" rejection path for manual review.
--   7. ip_address — captured at submit time for future trust signal use.
--
-- DESIGN DECISIONS:
--   - operator_name (existing NOT NULL) is kept and populated as
--     first_name || ' ' || last_name for backwards compatibility.
--   - first_name / last_name are nullable so old rows (if any) are unaffected.
--   - match_status is separate from status: status = review routing outcome
--     (new → approved → converted_to_operator); match_status = what the
--     submitter told us about the Google match during intake.
--   - google_match_json stores the full structured match so downstream phases
--     can pre-populate venue fields without a second Places API call.
--   - No auto-approval, no venue creation, no operator account — Phase 3A only.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SPLIT NAME FIELDS
--    first_name + last_name stored separately from operator_name.
--    operator_name (NOT NULL) is populated at insert time as the combined name.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name  TEXT;

COMMENT ON COLUMN public.operator_submissions.first_name IS
  'Submitter first name. Nullable for backwards-compatibility with rows that '
  'pre-date Phase 3A; new rows always have both first_name and last_name set.';

COMMENT ON COLUMN public.operator_submissions.last_name IS
  'Submitter last name. See first_name comment.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SUBMITTER ROLE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS position TEXT;

COMMENT ON COLUMN public.operator_submissions.position IS
  'Submitter''s role at the business (e.g. "Owner", "Manager"). '
  'Collected at intake time; used for trust signal context during review.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SUBMITTED BUSINESS LOCATION
--    Captures the address the operator entered in the form. Separate from
--    the Google-matched location so both can be compared during review.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS street_address TEXT,
  ADD COLUMN IF NOT EXISTS city           TEXT,
  ADD COLUMN IF NOT EXISTS province       TEXT;

COMMENT ON COLUMN public.operator_submissions.street_address IS
  'Street address submitted by the operator. Used as a lookup signal and '
  'stored for comparison against the Google-matched address during review.';

COMMENT ON COLUMN public.operator_submissions.city IS
  'City submitted by the operator. Primary signal for the Google Places lookup.';

COMMENT ON COLUMN public.operator_submissions.province IS
  'Province/state submitted by the operator. Used alongside city for lookup.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GOOGLE MATCH RESULT
--    Stores the full structured Places API response as JSONB so downstream
--    phases can pre-populate venue fields without an additional API call.
--    Includes: place_id, name, address, coordinates, phone, website,
--    opening hours, rating/review count, photo reference.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS google_match_json JSONB;

COMMENT ON COLUMN public.operator_submissions.google_match_json IS
  'Full structured Google Places match result captured at intake time. '
  'NULL when no Google match was found. Used by later phases to pre-populate '
  'venue fields. Shape is defined by the GoogleMatch type in the app source.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. MATCH STATUS
--    Tracks the submitter's response to the Google match confirmation screen.
--    Separate from status (the internal review routing column).
--
--    Values:
--      pending   — awaiting confirmation (default; should not remain after submit)
--      confirmed — submitter clicked "Yes, this is my business"
--      rejected  — submitter clicked "This is not my business"
--      no_match  — Google found no match; submitter proceeded without one
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.operator_submissions
  ADD CONSTRAINT operator_submissions_match_status_check
  CHECK (match_status IN ('pending', 'confirmed', 'rejected', 'no_match'));

COMMENT ON COLUMN public.operator_submissions.match_status IS
  'Submitter''s response to the Google match confirmation. '
  'Constrained to: pending | confirmed | rejected | no_match. '
  'Distinct from status, which tracks the internal review routing outcome.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. REJECTION PATH FIELDS
--    Collected when the submitter rejects the Google match.
--    Light-touch — one required field + two optional fields.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS rejection_notes  TEXT,
  ADD COLUMN IF NOT EXISTS website          TEXT,
  ADD COLUMN IF NOT EXISTS additional_notes TEXT;

COMMENT ON COLUMN public.operator_submissions.rejection_notes IS
  'What the submitter says is incorrect about the Google match (rejection path). '
  'Required when match_status = rejected.';

COMMENT ON COLUMN public.operator_submissions.website IS
  'Business website provided by the submitter on the rejection path. Optional.';

COMMENT ON COLUMN public.operator_submissions.additional_notes IS
  'Free-text notes the submitter adds on the rejection path. Optional.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. IP ADDRESS
--    Captured at submit time for future trust signal scoring (Phase 3B+).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

COMMENT ON COLUMN public.operator_submissions.ip_address IS
  'Submitter IP address captured at intake time. '
  'Stored for future trust signal evaluation; not used in Phase 3A.';
