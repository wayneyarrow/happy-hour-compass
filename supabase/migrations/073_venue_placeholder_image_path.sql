-- =============================================================================
-- 073_venue_placeholder_image_path.sql
--
-- Adds venues.placeholder_image_path — infrastructure only, not populated yet.
--
-- CONTEXT:
--   A categorized seeded venue image library was imported under
--   operator-admin/public/images/venues/<category>/venue-pic-<category>-<n>.jpg
--   (10 categories, 96 images). This column lets a specific image from that
--   library be assigned to a specific seeded venue, stored as the relative
--   path under images/venues/ — e.g. "images/venues/pub/venue-pic-pub-4.jpg".
--
--   This migration adds the column only. No venue rows are assigned a value
--   here — that is a separate, later step. The column is nullable and every
--   existing row will have NULL, which the application's placeholder
--   selection helper (src/lib/venuePlaceholderImage.ts) already treats as
--   "fall through to the existing generic establishment-type fallback" —
--   i.e. this migration changes no visible behavior on its own.
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   - Does not assign a value to any venue.
--   - Does not add a CHECK constraint tying values to the actual image
--     library on disk — the library lives in the Next.js app, not the
--     database, so there is nothing in Postgres to validate against. The
--     application is responsible for only ever writing paths that exist.
--   - No RLS policy changes — this is a plain column on an existing table
--     whose SELECT/UPDATE policies already apply at the row level and
--     therefore already cover this column.
--   - No GRANT changes — 039_security_hardening.sql's existing grants on
--     public.venues (SELECT/INSERT/UPDATE for authenticated, ALL for
--     service_role) already cover every column, including new ones.
-- =============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS placeholder_image_path TEXT;

COMMENT ON COLUMN public.venues.placeholder_image_path IS
  'Relative path (no leading slash) to an assigned seeded placeholder image '
  'under operator-admin/public/images/venues/, e.g. '
  '"images/venues/pub/venue-pic-pub-4.jpg". NULL means no placeholder has '
  'been assigned — the application falls back to its generic '
  'establishment-type-based placeholder. Only used when the venue has no '
  'operator-uploaded images (see src/lib/venuePlaceholderImage.ts); never '
  'read for venues that have real uploaded photos.';
