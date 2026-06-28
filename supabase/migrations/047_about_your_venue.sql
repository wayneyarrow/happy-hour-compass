-- =============================================================================
-- 047_about_your_venue.sql
--
-- Adds the about_your_venue TEXT column to the venues table.
--
-- Purpose: Operator-authored editorial description of the venue shown on the
-- public Venue Detail page. Tells customers what makes the venue worth visiting
-- (atmosphere, patio, signature dishes, entertainment, history, etc.).
--
-- Design decisions:
--   - Nullable TEXT; existing venues are valid with NULL.
--   - No max-length constraint in the DB — the 750-char limit is enforced by
--     the operator admin form and the server action, not the schema.
--   - The public website Venue Detail page should hide the "About" section
--     entirely when this value is NULL or blank (empty string).
-- =============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS about_your_venue TEXT;

COMMENT ON COLUMN public.venues.about_your_venue IS
  'Operator-authored description of the venue for the public Venue Detail page. '
  'Max 750 characters enforced by the operator admin form. '
  'NULL/blank means the public About section should be hidden entirely.';
