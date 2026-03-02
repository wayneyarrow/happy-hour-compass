-- Migration: add image_url column to events table.
--
-- Used for the event's single hero/listing image (e.g. search card and
-- event detail hero). For beta, events store their image path directly
-- in this column rather than in the shared media table. Nullable so
-- existing events remain valid without an image.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.events.image_url IS
  'Storage path or URL for the event''s single hero/listing image. '
  'NULL means no image has been uploaded yet.';
