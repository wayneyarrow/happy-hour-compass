-- =============================================================================
-- Happy Hour Compass — Operator Submissions: pending_review status
-- Migration: 068_operator_submissions_pending_review_status.sql
--
-- PURPOSE:
--   Fixes a pre-existing bug: saveOperatorSubmissionAction() (in
--   src/app/(consumer)/suggest/owner/actions.ts) computes routedStatus =
--   "pending_review" for Case B (a confirmed Google match against an
--   existing, unclaimed venue) and attempts to store it on
--   operator_submissions.status. The CHECK constraint added in
--   016_operator_submissions_phase3b.sql never included "pending_review" in
--   its allowed value list, so any submission that reaches that code path
--   fails the INSERT with a check-constraint violation and the submitter
--   sees a generic "Something went wrong" error — no row is ever created.
--   Confirmed against the live database: 0 rows currently have this status,
--   and a direct insert probe with status='pending_review' fails with
--   "violates check constraint operator_submissions_status_check".
--
--   This migration only widens the CHECK constraint to include the value
--   the application has always intended to store. It does not change any
--   application logic, does not modify existing rows, and does not rename
--   or remove any existing status value.
--
-- WHAT THIS MIGRATION DOES:
--   Drops and recreates operator_submissions_status_check to add
--   'pending_review' to the allowed status values.
--
-- SAFETY:
--   Purely additive — every row that satisfied the old constraint still
--   satisfies the new one. No data is modified. No new table, so no new
--   GRANT/RLS changes are required.
-- =============================================================================

-- Authoritative prior list per migration 021_operator_submissions_more_info.sql
-- (the most recent migration to touch this constraint), plus 'pending_review'.
ALTER TABLE public.operator_submissions
  DROP CONSTRAINT IF EXISTS operator_submissions_status_check;

ALTER TABLE public.operator_submissions
  ADD CONSTRAINT operator_submissions_status_check
  CHECK (status IN (
    -- Legacy manual-review values (pre-Phase 3B)
    'new',
    'approved',
    'rejected',
    'converted_to_operator',
    -- Phase 3B automated routing
    'confirmed_auto',
    'double_claim',
    'rejected_by_user',
    'no_match',
    -- Phase 3C founder review actions (migration 020)
    'needs_more_info',
    'closed',
    -- Phase 3D structured more-info form (migration 021)
    'info_submitted',
    -- This migration: the missing Phase 3B value — see PURPOSE above
    'pending_review'
  ));

COMMENT ON COLUMN public.operator_submissions.status IS
  'Routing/review status. Legacy values: new, approved, rejected, converted_to_operator. '
  'Phase 3B automated-routing values: confirmed_auto (auto-routed confirmed match, venue linked), '
  'double_claim (confirmed match, but the existing venue is already claimed/owned), '
  'pending_review (confirmed match against an existing but UNCLAIMED venue — awaiting founder review), '
  'rejected_by_user (submitter rejected the Google match), '
  'no_match (no Google match found — needs manual review). '
  'Founder-review-lifecycle values: needs_more_info, info_submitted, closed. '
  'Distinct from match_status, which tracks the submitter''s response to the match confirmation.';
