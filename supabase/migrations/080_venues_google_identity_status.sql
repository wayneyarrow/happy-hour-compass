-- migration: 080_venues_google_identity_status
--
-- Adds an explicit Google identity lifecycle state to venues, so
-- `place_id IS NULL` no longer has to mean two different things:
--   (a) Google identity has not yet been found/reconciled, or
--   (b) HHC has deliberately determined this venue has no independent
--       Google identity of its own (e.g. a hotel lounge indexed only under
--       the hotel's listing).
--
-- google_identity_status — constrained to: matched | unmatched | exempt.
--   matched   — venues.place_id (and, where available, google_rating /
--               google_review_count) reflect a confirmed Google listing.
--   unmatched — no confident Google match has been attached yet. Default
--               state for every venue, including brand-new ones. Eligible
--               for automatic reconciliation and for the Founder Control
--               Panel manual "Search Google Places" fallback.
--   exempt    — a founder/admin has explicitly determined this venue has no
--               independent Google identity to attach (e.g. The Placery, a
--               hotel lounge). Automatic reconciliation must skip exempt
--               venues; only a deliberate founder action clears this state.
--
-- google_identity_reason — free-text, nullable. Used primarily to record why
-- a venue was marked exempt (audit/context for a future reviewer). Not
-- required for the matched/unmatched states.
--
-- Founder/admin-only: both columns are written exclusively via service-role
-- (createAdminClient()) from Control Panel / internal server actions — never
-- from operator-facing forms. No RLS policy changes are needed since venues'
-- existing RLS posture already restricts writes this way.
--
-- Backfill: any venue that already has a place_id is considered matched.
-- Everything else defaults to 'unmatched' — no venue is ever auto-promoted
-- to 'exempt' by this migration (exempt is exclusively a deliberate, manual
-- founder action performed after this migration ships).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS google_identity_status TEXT NOT NULL DEFAULT 'unmatched',
  ADD COLUMN IF NOT EXISTS google_identity_reason TEXT;

COMMENT ON COLUMN public.venues.google_identity_status IS
  'Google identity lifecycle state. Constrained to: matched | unmatched | exempt. '
  'matched = place_id/rating reflect a confirmed Google listing. '
  'unmatched = not yet reconciled (default). '
  'exempt = founder has determined this venue has no independent Google identity '
  '(e.g. a hotel lounge indexed only under the hotel). Founder/admin-controlled only.';

COMMENT ON COLUMN public.venues.google_identity_reason IS
  'Free-text context for the current google_identity_status, primarily used to '
  'record why a venue was marked exempt. Nullable; not required for matched/unmatched.';

ALTER TABLE public.venues
  ADD CONSTRAINT venues_google_identity_status_check
  CHECK (google_identity_status IN ('matched', 'unmatched', 'exempt'));

-- Backfill: venues with an existing place_id are already matched.
UPDATE public.venues
  SET google_identity_status = 'matched'
  WHERE place_id IS NOT NULL
    AND google_identity_status <> 'matched';

-- Supports the Part 9-style audit queries (unmatched/exempt counts, filtering
-- by status in the Control Panel).
CREATE INDEX IF NOT EXISTS venues_google_identity_status_idx
  ON public.venues (google_identity_status);
