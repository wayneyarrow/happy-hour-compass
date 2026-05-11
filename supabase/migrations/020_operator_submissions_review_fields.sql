-- =============================================================================
-- Happy Hour Compass — Operator Submissions: Review Fields + New Statuses
-- Migration: 020_operator_submissions_review_fields.sql
--
-- PURPOSE:
--   Adds review metadata fields to operator_submissions and extends the status
--   CHECK constraint to support founder review actions on Needs Review
--   submissions (no_match, rejected_by_user).
--
-- NEW STATUS VALUES:
--   needs_more_info — founder sent a "request more info" email to submitter
--   closed          — founder rejected / closed the submission
--
-- NEW COLUMNS:
--   review_notes TEXT                   — founder's internal note; sent to submitter
--                                         in the "request more info" email path.
--   reviewed_by  UUID                   — auth.uid() of the reviewing admin.
--   reviewed_at  TIMESTAMPTZ            — when the last review action was taken.
--   more_info_requested_at TIMESTAMPTZ  — set when status → needs_more_info.
--   rejected_at  TIMESTAMPTZ            — set when status → closed.
--
-- DESIGN NOTES:
--   - These are nullable throughout — older rows have no review data.
--   - reviewed_by stores auth.uid() (UUID), matching venue_claims.reviewed_by.
--   - review_notes is intentionally re-written on each review action (latest wins).
--   - The closed status is distinct from the legacy "rejected" value (which was
--     a manual pre-3B action). Using "closed" avoids ambiguity.
--   - needs_more_info is added to the Needs Review filter in the list view so
--     submissions waiting on a response remain visible.
-- =============================================================================

-- ── 1. Expand status CHECK constraint ────────────────────────────────────────

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
    -- Phase 3C founder review actions (this migration)
    'needs_more_info',
    'closed'
  ));

COMMENT ON COLUMN public.operator_submissions.status IS
  'Routing/review status. '
  'Legacy: new, approved, rejected, converted_to_operator. '
  'Phase 3B routing: confirmed_auto (auto-routed, venue linked), '
  'double_claim (venue already claimed/owned), '
  'rejected_by_user (submitter rejected the Google match), '
  'no_match (no Google match — needs founder review). '
  'Phase 3C founder review: needs_more_info (more info requested from submitter), '
  'closed (founder rejected or closed the submission).';


-- ── 2. Review metadata columns ────────────────────────────────────────────────

ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS review_notes              TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by               UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS more_info_requested_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at               TIMESTAMPTZ;

COMMENT ON COLUMN public.operator_submissions.review_notes IS
  'Internal review note written by the founder. For needs_more_info actions, '
  'this text is included verbatim in the email sent to the submitter — write it '
  'as a clear, specific request. Overwritten on each review action (latest wins).';

COMMENT ON COLUMN public.operator_submissions.reviewed_by IS
  'auth.uid() of the admin who last performed a review action (needs_more_info or closed). '
  'UUID. Mirrors venue_claims.reviewed_by.';

COMMENT ON COLUMN public.operator_submissions.reviewed_at IS
  'Timestamp of the last review action (needs_more_info or closed).';

COMMENT ON COLUMN public.operator_submissions.more_info_requested_at IS
  'Set when the founder sends a "request more info" email (status → needs_more_info). '
  'Re-set on subsequent requests. NULL for all other statuses.';

COMMENT ON COLUMN public.operator_submissions.rejected_at IS
  'Set when the founder closes/rejects the submission (status → closed). '
  'NULL for all other statuses.';
