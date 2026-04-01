-- migration: 014_venue_suggestions_contact_fields
--
-- Adds optional submitter contact fields to venue_suggestions.
-- Captured at submission time so the team can follow up if needed.
--
-- Both columns are nullable — no existing rows are affected, and blank
-- form submissions store NULL (not empty string).

ALTER TABLE public.venue_suggestions
  ADD COLUMN IF NOT EXISTS customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT;

COMMENT ON COLUMN public.venue_suggestions.customer_name IS
  'Submitter name — optional, collected from the consumer suggestion form.';

COMMENT ON COLUMN public.venue_suggestions.customer_email IS
  'Submitter email — optional, collected from the consumer suggestion form. '
  'Validated as a valid email format before storing.';
