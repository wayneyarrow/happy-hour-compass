-- =============================================================================
-- 045_venue_cancellation.sql
--
-- Adds lifecycle cancellation fields to venues.
--
-- Supports operator-initiated "cancel venue management" without any data
-- deletion. When an operator cancels:
--   - is_published is set to false (separate column, existing behaviour)
--   - cancelled_at is stamped (the durable cancellation signal)
--   - cancellation_reason records why (operator-supplied reason code)
--   - cancelled_by_operator_id records who cancelled
--
-- All historical data (claims, analytics, audit logs, venue notes) is preserved.
-- The venue remains eligible for future reclaiming.
-- =============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS cancelled_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason        TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by_operator_id   UUID REFERENCES public.operators(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.venues.cancelled_at IS
  'Set when an operator cancels management of this venue. NULL = not cancelled.';

COMMENT ON COLUMN public.venues.cancellation_reason IS
  'Reason code for cancellation: business_closed | no_longer_managing | not_interested | duplicate_listing | other';

COMMENT ON COLUMN public.venues.cancelled_by_operator_id IS
  'The operator who initiated the cancellation. ON DELETE SET NULL preserves the column value as NULL if the operator row is later removed.';

-- Index for founder dashboard churn queries (cancelled venues over time windows).
-- Partial index: only rows where cancelled_at IS NOT NULL (skips uncancelled venues).
CREATE INDEX IF NOT EXISTS venues_cancelled_at_idx
  ON public.venues (cancelled_at)
  WHERE cancelled_at IS NOT NULL;
