-- migration: 044_venue_suggestions_marketing_consent
--
-- Adds email marketing consent fields to venue_suggestions.
-- Captured at submission time when the consumer opts in to future updates
-- and occasional Happy Hour Compass news.
--
-- Both columns are nullable / default false — no existing rows are affected.
-- email_marketing_opted_in_at is only set when opt-in is true; it is NULL
-- when the consumer did not opt in (preserving the distinction between
-- "declined" and "never asked").
--
-- No new GRANTs needed — venue_suggestions already has grants from
-- migration 039_security_hardening.sql (anon INSERT, authenticated INSERT,
-- service_role ALL). Those grants cover all columns in the table.

ALTER TABLE public.venue_suggestions
  ADD COLUMN IF NOT EXISTS email_marketing_opt_in       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_marketing_opted_in_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.venue_suggestions.email_marketing_opt_in IS
  'TRUE when the consumer explicitly opted in to receive updates about their '
  'suggestion and occasional Happy Hour Compass news. Defaults to FALSE (not opted in). '
  'Captured from the opt-in checkbox on the consumer suggestion form.';

COMMENT ON COLUMN public.venue_suggestions.email_marketing_opted_in_at IS
  'Timestamp when the consumer opted in to marketing emails. '
  'Only set when email_marketing_opt_in = TRUE; NULL otherwise.';
