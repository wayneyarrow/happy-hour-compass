-- =============================================================================
-- Happy Hour Compass — Customer Success Foundation
-- Migration: 093_customer_success_foundation.sql
--
-- CONTEXT (Customer Success Phase 1A):
--   HHC intends to own post-sale / customer-success communications
--   internally over time, rather than driving operator lifecycle
--   communication through HubSpot/Brevo. This migration adds the reusable
--   foundation for detecting and recording Customer Success events —
--   starting with venue-view milestones — without sending anything.
--
--   Phase 1A is detection-only. No email is sent from this schema. Phase 1B
--   will add the communication delivery step; Phase 1C will add any
--   Founder Control Panel surfacing. See src/lib/customerSuccess/ for the
--   Phase 1A detector.
--
-- WHAT THIS ADDS:
--   1. customer_success_events    — one row per achieved/candidate CS event
--                                    (e.g. "venue crossed the 100-view
--                                    milestone"), carrying its communication
--                                    lifecycle (pending/superseded/sent/…).
--   2. customer_success_baselines — one row per (venue, event_type) marking
--                                    that the venue has been through initial
--                                    detector baselining for that event
--                                    type. Exists so a venue with substantial
--                                    pre-existing history (e.g. 183 views
--                                    the first time the detector ever runs)
--                                    does not flood customer_success_events
--                                    with a backlog of "newly achieved"
--                                    historic milestones the first time it's
--                                    observed — see detectVenueViewMilestones.ts
--                                    for the full initialization behaviour.
--
-- DESIGN — EXTENSIBLE WITHOUT A BESPOKE TABLE PER EVENT TYPE:
--   Both tables are generic over `event_type` (CHECK-constrained, following
--   the same enum-via-CHECK convention as venues.source /
--   operator_submissions.status — see migration 013 and 068 for precedent
--   on how this constraint is widened later as new event types are added).
--   Only 'venue_view_milestone' is allowed today. Do NOT add further event
--   type values in this migration — Phase 1A implements detection for
--   venue-view milestones only.
--
-- IDEMPOTENCY — ENFORCED BY DATABASE CONSTRAINT, NOT ONLY APPLICATION LOGIC:
--   customer_success_events has three partial unique indexes:
--     - (venue_id, event_type, milestone_value) WHERE milestone_value IS NOT NULL
--       — the same (venue, event_type, milestone) can never be recorded twice.
--     - (venue_id, event_type)                  WHERE milestone_value IS NULL
--       — a future non-threshold one-time event type (e.g. "First Daily
--         Special published") can never be recorded twice per venue either.
--     - (venue_id, event_type)                  WHERE communication_status = 'pending'
--       — added in the Phase 1A correction pass: at most one UNSENT
--         milestone may be 'pending' per venue at a time (cross-run
--         supersession — see that index's own comment below and
--         venueViewMilestones.ts's rule B').
--   customer_success_baselines has a plain UNIQUE(venue_id, event_type) —
--   a venue is baselined for a given event type at most once, ever.
--   An INSERT that races against an existing row fails with a unique-
--   constraint violation (Postgres 23505); the detector treats that as
--   "already recorded" rather than an error — see detectVenueViewMilestones.ts.
--
-- SECURITY:
--   Both tables are internal-only: RLS enabled, no permissive policies,
--   service-role access only (createAdminClient()). Customer Success write
--   operations must never be reachable from public/consumer clients.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: customer_success_events
--
-- One row per Customer Success event achieved (or superseded/skipped) for a
-- venue. For venue_view_milestone, `milestone_value` is the view-count
-- threshold reached (50/100/250/.../5000); `metric_value_at_detection` is
-- the actual observed metric value at the moment the detector recorded the
-- row (>= milestone_value), kept only as debugging/audit context — it is
-- never used for dedup.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_success_events (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                    UUID        NOT NULL REFERENCES public.venues(id),
  operator_id                 UUID        REFERENCES public.operators(id) ON DELETE SET NULL,

  -- event_type values enforced by CHECK constraint below
  event_type                  TEXT        NOT NULL,

  -- Threshold-style events only (e.g. venue_view_milestone). NULL for a
  -- future one-time, non-threshold event type (e.g. "profile incomplete").
  milestone_value             INTEGER,

  -- Observed raw metric value when this row was written. Audit/debugging
  -- context only — never part of the dedup key, never required.
  metric_value_at_detection   INTEGER,

  -- When the detector recorded this row. For a batch-detected milestone
  -- this is the detection time, not necessarily the exact moment the
  -- underlying metric crossed the threshold (view-level granularity of the
  -- exact crossing instant isn't tracked/needed).
  achieved_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- communication_status values enforced by CHECK constraint below
  communication_status        TEXT        NOT NULL DEFAULT 'pending',

  sent_at                     TIMESTAMPTZ,
  recipient_email             TEXT,
  provider_message_id         TEXT,

  -- Freeform extensibility context for future event types (e.g. which
  -- daily special, which event). Never used for dedup or lifecycle logic.
  metadata_json                JSONB,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.customer_success_events IS
  'Reusable Customer Success event/milestone log with a communication '
  'lifecycle. Phase 1A only detects and records rows here — nothing in this '
  'schema sends a communication. See src/lib/customerSuccess/.';

COMMENT ON COLUMN public.customer_success_events.venue_id  IS 'Venue the event/milestone belongs to.';
COMMENT ON COLUMN public.customer_success_events.operator_id IS
  'Operator who owned the venue (venues.created_by_operator_id) at detection time. '
  'Snapshot, not a live join — nullable for a future venue-less event type.';
COMMENT ON COLUMN public.customer_success_events.event_type IS
  'Customer Success event type. Currently only: venue_view_milestone. '
  'Extend the CHECK constraint (customer_success_events_event_type_check) in a '
  'future migration, following the precedent in migration 068, as new event '
  'types are added — see the "Future examples" list in the Phase 1A task.';
COMMENT ON COLUMN public.customer_success_events.milestone_value IS
  'Threshold reached, e.g. 100 for the 100-view milestone. NULL for a future '
  'one-time, non-threshold event type.';
COMMENT ON COLUMN public.customer_success_events.metric_value_at_detection IS
  'Observed raw metric value (e.g. all-time view count) when this row was '
  'written. Debugging/audit context only — not used for dedup.';
COMMENT ON COLUMN public.customer_success_events.communication_status IS
  'Lifecycle status. pending = achieved and eligible for future communication '
  '(Phase 1B). superseded = achieved but a higher milestone was reached at the '
  'same detection point (see detectVenueViewMilestones.ts skip logic) or this '
  'row was produced by initial venue baselining — must never be sent. '
  'sent = communication delivered (Phase 1B). skipped = deliberately not '
  'communicated (e.g. operator preference — Phase 1B/1C). failed = a Phase 1B '
  'delivery attempt failed permanently.';
COMMENT ON COLUMN public.customer_success_events.sent_at IS 'Set by Phase 1B when the communication is sent. NULL until then.';
COMMENT ON COLUMN public.customer_success_events.recipient_email IS 'Set by Phase 1B at send time. NULL until then.';
COMMENT ON COLUMN public.customer_success_events.provider_message_id IS 'Set by Phase 1B — the send provider''s message id, once available.';
COMMENT ON COLUMN public.customer_success_events.metadata_json IS 'Optional additional context as JSONB, for future event types.';

ALTER TABLE public.customer_success_events
  ADD CONSTRAINT customer_success_events_event_type_check
  CHECK (event_type IN (
    'venue_view_milestone'
  ));

ALTER TABLE public.customer_success_events
  ADD CONSTRAINT customer_success_events_communication_status_check
  CHECK (communication_status IN (
    'pending',
    'superseded',
    'sent',
    'skipped',
    'failed'
  ));

ALTER TABLE public.customer_success_events
  ADD CONSTRAINT customer_success_events_milestone_value_nonneg_check
  CHECK (milestone_value IS NULL OR milestone_value > 0);


-- Idempotency — see migration header. Two partial unique indexes cover both
-- threshold-style events (milestone_value set) and future one-time,
-- non-threshold events (milestone_value NULL).
CREATE UNIQUE INDEX IF NOT EXISTS customer_success_events_milestone_uidx
  ON public.customer_success_events (venue_id, event_type, milestone_value)
  WHERE milestone_value IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_success_events_onetime_uidx
  ON public.customer_success_events (venue_id, event_type)
  WHERE milestone_value IS NULL;

-- Lookups by venue (detector reads "what has this venue already recorded").
CREATE INDEX IF NOT EXISTS customer_success_events_venue_id_idx
  ON public.customer_success_events (venue_id);

-- Phase 1B will query "events ready to communicate" — partial index scoped
-- to the only status that query cares about.
CREATE INDEX IF NOT EXISTS customer_success_events_pending_idx
  ON public.customer_success_events (achieved_at)
  WHERE communication_status = 'pending';

-- CROSS-RUN SUPERSESSION INVARIANT (Phase 1A correction pass):
-- At most one 'pending' (unsent) row may exist per (venue_id, event_type)
-- at any time. When a later detection run crosses a higher milestone
-- before an earlier lower one was sent, the detector demotes the earlier
-- row to 'superseded' (UPDATE, guarded by `WHERE communication_status =
-- 'pending'` so a row that meanwhile became 'sent' is never touched — see
-- applyVenueViewMilestoneDecisions() in detectVenueViewMilestones.ts)
-- BEFORE inserting the new 'pending' row. This partial unique index
-- enforces that ordering/invariant at the database level too: an insert
-- that would create a second simultaneous 'pending' row fails outright
-- rather than silently leaving two milestones pending at once.
CREATE UNIQUE INDEX IF NOT EXISTS customer_success_events_one_pending_uidx
  ON public.customer_success_events (venue_id, event_type)
  WHERE communication_status = 'pending';


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- Reuses the update_updated_at() function defined in 001_initial_schema.sql.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER customer_success_events_updated_at
  BEFORE UPDATE ON public.customer_success_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — customer_success_events
-- Internal-only: no anon or authenticated access. All reads/writes go
-- through createAdminClient() (service-role). Never expose Customer
-- Success write operations to public/consumer clients.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customer_success_events ENABLE ROW LEVEL SECURITY;

-- GRANTs (required — see migration 039 + CLAUDE.md). No anon/authenticated
-- grant: this table is founder/internal-only, service-role access only.
GRANT ALL ON public.customer_success_events TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: customer_success_baselines
--
-- Detector bookkeeping, not a Customer Success event: one row per
-- (venue, event_type) marking that the detector has established an initial
-- baseline for that venue/event type. Its presence is what distinguishes
-- "this venue's crossed thresholds are pre-existing history being
-- initialized" from "this venue is actively growing through the system" —
-- see detectVenueViewMilestones.ts for the full initialization behaviour.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_success_baselines (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                    UUID        NOT NULL REFERENCES public.venues(id),

  -- event_type values enforced by CHECK constraint below (mirrors
  -- customer_success_events_event_type_check — extend both together).
  event_type                  TEXT        NOT NULL,

  -- Observed raw metric value at the moment baselining occurred. Audit
  -- context only.
  metric_value_at_baseline    INTEGER,

  baselined_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.customer_success_baselines IS
  'Detector bookkeeping: marks that a venue has been through initial '
  'Customer Success detector baselining for a given event type, so '
  'pre-existing history is never mistaken for newly-achieved growth. '
  'Not itself a Customer Success event — see customer_success_events.';

COMMENT ON COLUMN public.customer_success_baselines.venue_id  IS 'Venue that was baselined.';
COMMENT ON COLUMN public.customer_success_baselines.event_type IS
  'Customer Success event type this baseline applies to. Same allowed '
  'values as customer_success_events.event_type.';
COMMENT ON COLUMN public.customer_success_baselines.metric_value_at_baseline IS
  'Observed raw metric value (e.g. all-time view count) at baselining time. Audit context only.';
COMMENT ON COLUMN public.customer_success_baselines.baselined_at IS 'When this venue/event type was baselined.';

ALTER TABLE public.customer_success_baselines
  ADD CONSTRAINT customer_success_baselines_event_type_check
  CHECK (event_type IN (
    'venue_view_milestone'
  ));

-- A venue is baselined for a given event type at most once, ever.
ALTER TABLE public.customer_success_baselines
  ADD CONSTRAINT customer_success_baselines_venue_event_type_uidx
  UNIQUE (venue_id, event_type);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — customer_success_baselines
-- Same posture as customer_success_events: internal-only, service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customer_success_baselines ENABLE ROW LEVEL SECURITY;

-- GRANTs (required — see migration 039 + CLAUDE.md).
GRANT ALL ON public.customer_success_baselines TO service_role;
