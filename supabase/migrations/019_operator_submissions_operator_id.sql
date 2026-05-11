-- =============================================================================
-- Happy Hour Compass — Operator Submissions: Operator ID Link
-- Migration: 019_operator_submissions_operator_id.sql
--
-- PURPOSE:
--   Links auto-confirmed operator submissions to the operator account that was
--   provisioned for them during the confirmed_auto routing step (Phase 3C).
--
-- WHAT THIS MIGRATION ADDS:
--   operator_id UUID FK → operators(id):
--     - Set when an operator account is created / linked during confirmed_auto
--       routing in saveOperatorSubmissionAction.
--     - NULL for double_claim, rejected_by_user, no_match submissions
--       (no operator account is provisioned for those paths).
--     - ON DELETE SET NULL: deleting an operator row does not cascade-delete
--       the submission history.
-- =============================================================================

ALTER TABLE public.operator_submissions
  ADD COLUMN IF NOT EXISTS operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.operator_submissions.operator_id IS
  'The operator account provisioned for this submission during confirmed_auto routing. '
  'Set only for confirmed_auto submissions where operator provisioning succeeded. '
  'NULL for double_claim, rejected_by_user, and no_match submissions. '
  'FK to operators(id), ON DELETE SET NULL.';

CREATE INDEX IF NOT EXISTS operator_submissions_operator_id_idx
  ON public.operator_submissions (operator_id)
  WHERE operator_id IS NOT NULL;
