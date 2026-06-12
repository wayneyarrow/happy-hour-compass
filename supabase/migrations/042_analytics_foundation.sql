-- =============================================================================
-- Migration 042: Analytics Foundation
--
-- Adds four data collection capabilities needed for future operator analytics:
--   1. plan_change_events  — tracks every plan transition with actor + trigger
--   2. operators.last_seen_at — nullable timestamp for operator activity signal
--   3. venue_view_events   — anonymous venue page view log (no PII)
--   4. event_view_events   — anonymous event page view log (no PII)
--
-- Design decisions:
--   - All event tables are append-only (no updated_at, no UPDATE needed).
--   - All tables are internal-only: RLS enabled, no permissive policies.
--     All reads/writes go through createAdminClient() (service-role).
--   - GRANTs follow the pattern established in 039_security_hardening.sql.
--   - last_seen_at uses a conditional UPDATE pattern (WHERE last_seen_at IS NULL
--     OR last_seen_at < now() - interval '1 hour') for efficient throttling.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLE: plan_change_events
--
-- Append-only log of every operator plan transition.
-- Captures who changed the plan, from what to what, and what triggered it.
-- Supplements (does not replace) the existing audit_logs table.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_change_events (
  id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id                       UUID        NOT NULL REFERENCES public.operators(id),
  from_plan                         TEXT        NOT NULL,
  to_plan                           TEXT        NOT NULL,
  changed_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_email                  TEXT,
  trigger                           TEXT        NOT NULL,
  billing_provider_subscription_id  TEXT
);

COMMENT ON TABLE  public.plan_change_events IS
  'Append-only log of every operator plan transition. '
  'Supplements audit_logs — never updated, rows retained indefinitely.';

COMMENT ON COLUMN public.plan_change_events.operator_id   IS 'Operator whose plan changed.';
COMMENT ON COLUMN public.plan_change_events.from_plan     IS 'Plan code before the change (e.g. free, pro).';
COMMENT ON COLUMN public.plan_change_events.to_plan       IS 'Plan code after the change.';
COMMENT ON COLUMN public.plan_change_events.changed_at    IS 'Timestamp of the change. Defaults to now().';
COMMENT ON COLUMN public.plan_change_events.changed_by_email IS
  'Email of the actor who initiated the change. NULL for automated Stripe events.';
COMMENT ON COLUMN public.plan_change_events.trigger       IS
  'Source of the change: manual_admin | impersonation | stripe_checkout | '
  'stripe_subscription_updated | stripe_subscription_deleted.';
COMMENT ON COLUMN public.plan_change_events.billing_provider_subscription_id IS
  'Stripe subscription ID when the trigger is Stripe-sourced. NULL for manual changes.';


-- Indexes
CREATE INDEX IF NOT EXISTS plan_change_events_operator_id_idx
  ON public.plan_change_events (operator_id);

CREATE INDEX IF NOT EXISTS plan_change_events_changed_at_idx
  ON public.plan_change_events (changed_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — plan_change_events
-- Internal-only: no anon or authenticated direct access.
-- All reads/writes go through createAdminClient() (service-role).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.plan_change_events ENABLE ROW LEVEL SECURITY;

-- GRANTs (required — see migration 039 + CLAUDE.md)
GRANT ALL ON public.plan_change_events TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. COLUMN: operators.last_seen_at
--
-- Nullable timestamp updated at most once per hour per operator.
-- Provides a reliable coarse-grained operator activity signal.
-- NULL means the operator has never been seen since this migration ran.
--
-- Update pattern used by application code:
--   UPDATE operators
--   SET    last_seen_at = now()
--   WHERE  email = $1
--   AND    (last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour')
-- This WHERE clause makes the update a fast no-op when called more frequently
-- than once per hour (matches 0 rows — no write I/O).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN public.operators.last_seen_at IS
  'Most recent confirmed activity timestamp for this operator. '
  'Updated at most once per hour — coarse activity signal, not a precise timestamp.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TABLE: venue_view_events
--
-- Append-only log of consumer venue detail page views.
-- Anonymous — no PII, no IP address.
-- session_id is a UUID generated client-side per browser session.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_view_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID        NOT NULL REFERENCES public.venues(id),
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id  TEXT        NOT NULL,
  city        TEXT
);

COMMENT ON TABLE  public.venue_view_events IS
  'Append-only log of consumer venue detail page views. '
  'Anonymous — no PII, no IP address stored.';

COMMENT ON COLUMN public.venue_view_events.venue_id    IS 'Venue that was viewed.';
COMMENT ON COLUMN public.venue_view_events.viewed_at   IS 'Timestamp of the view. Defaults to now().';
COMMENT ON COLUMN public.venue_view_events.session_id  IS
  'Anonymous client-side session identifier (UUID from sessionStorage). Not user-linked.';
COMMENT ON COLUMN public.venue_view_events.city        IS 'City of the venue at view time, for geographic aggregation.';


-- Indexes
CREATE INDEX IF NOT EXISTS venue_view_events_venue_id_idx
  ON public.venue_view_events (venue_id);

CREATE INDEX IF NOT EXISTS venue_view_events_viewed_at_idx
  ON public.venue_view_events (viewed_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — venue_view_events
-- Internal-only: service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_view_events ENABLE ROW LEVEL SECURITY;

-- GRANTs
GRANT ALL ON public.venue_view_events TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TABLE: event_view_events
--
-- Append-only log of consumer event detail page views.
-- Anonymous — no PII, no IP address.
-- session_id is a UUID generated client-side per browser session.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_view_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES public.events(id),
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id  TEXT        NOT NULL
);

COMMENT ON TABLE  public.event_view_events IS
  'Append-only log of consumer event detail page views. '
  'Anonymous — no PII, no IP address stored.';

COMMENT ON COLUMN public.event_view_events.event_id    IS 'Event that was viewed.';
COMMENT ON COLUMN public.event_view_events.viewed_at   IS 'Timestamp of the view. Defaults to now().';
COMMENT ON COLUMN public.event_view_events.session_id  IS
  'Anonymous client-side session identifier (UUID from sessionStorage). Not user-linked.';


-- Indexes
CREATE INDEX IF NOT EXISTS event_view_events_event_id_idx
  ON public.event_view_events (event_id);

CREATE INDEX IF NOT EXISTS event_view_events_viewed_at_idx
  ON public.event_view_events (viewed_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — event_view_events
-- Internal-only: service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.event_view_events ENABLE ROW LEVEL SECURITY;

-- GRANTs
GRANT ALL ON public.event_view_events TO service_role;
