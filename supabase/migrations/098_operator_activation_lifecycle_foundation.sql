-- =============================================================================
-- Happy Hour Compass — Operator Activation Lifecycle Foundation
-- Migration: 098_operator_activation_lifecycle_foundation.sql
--
-- STATUS: not yet applied, not yet committed. This file has been rewritten
-- in place twice during design review (see below) rather than superseded by
-- a follow-up migration, per repository convention for an unapplied file.
--
-- CONTEXT (Phase 1A — shared data foundation only):
--   Claims (venue_claims) and Add Your Venue submissions (operator_submissions)
--   both provision an operator account via the same shared function,
--   provisionOperatorForVenue() (src/lib/operatorActivation.ts), then wait
--   for the operator to set a password before operators.account_activated_at
--   (migration 067) is ever set. This migration adds exactly the schema
--   needed to make that wait authoritative and queryable — WHEN it began,
--   WHEN it should end, how many reminders have gone out — without yet
--   adding a reminder cron, auto-approval, OTP, or expiry execution.
--
-- DESIGN HISTORY — why this is a new table, not columns on the origin tables:
--   The first draft of this migration added activation_started_at/
--   activation_deadline_at/activation_reminder_stage/expired_at/released_at
--   directly to venue_claims and operator_submissions, mirroring this
--   codebase's usual "same columns on both tables" convention (e.g.
--   info_phone/info_website, migrations 021/024). That shape has a real
--   concurrency bug: "does a live lifecycle already exist for this
--   operator" was answered by reading venue_claims/operator_submissions,
--   and the answer was then written back later, in a SEPARATE statement, by
--   whichever caller was provisioning. Two concurrent provisioning requests
--   for the SAME still-unactivated operator (two different venues; one
--   Claim and one Submission; two Submissions) could both read "no live
--   lifecycle" before either had written one, and both then create a
--   competing lifecycle on two different rows — nothing in a normal
--   partial unique index on either table alone can prevent that, because
--   the invariant ("at most one live lifecycle per OPERATOR") spans BOTH
--   tables, and a partial unique index cannot span two tables.
--
--   This migration instead adds ONE canonical table,
--   operator_activation_lifecycles, keyed by operator_id, with a partial
--   unique index enforcing "at most one live row per operator_id" AT THE
--   DATABASE LEVEL. The check ("does a live one exist") and the write
--   ("create one") collapse into a single INSERT attempt — see
--   src/lib/activation/activationLifecycle.ts's claimOrReuseActivationLifecycle()
--   for the application-side half of this: it INSERTs, and either succeeds
--   (this call legitimately started a new lifecycle) or fails with
--   unique_violation (23505), in which case it reads back whichever row
--   actually won and reuses it. There is no read-then-decide-then-write
--   gap — the same INSERT-and-handle-23505 idiom already used throughout
--   this codebase (operators.email uniqueness, venue_claims' one-pending-
--   per-venue index migration 007, customer_success_events' one-active-per-
--   venue-and-type index migration 095). No new database function, trigger,
--   or advisory lock is needed or used.
--
--   Consequence: venue_claims and operator_submissions get NO new activation
--   columns at all in this revision — only their notes tables (see below).
--   Keeping a redundant copy of started_at/deadline_at on the origin tables
--   alongside this canonical table would be exactly the kind of state that
--   can drift without an atomic sync mechanism; the canonical table is the
--   single source of truth, referenced by origin_claim_id/origin_submission_id.
--
-- WHAT THIS ADDS: public.operator_activation_lifecycles (new table)
--   - operator_id           — FK to operators(id). The lifecycle "belongs
--                              to" the operator, not to a specific venue —
--                              activation is conceptually a one-time,
--                              per-operator event (get ANY account set up),
--                              even though it is always triggered by
--                              provisioning for a specific venue.
--   - origin_type            — 'claim' or 'submission': which flow started
--                               this lifecycle. Kept as a plain TEXT + CHECK
--                               (not a DB enum) to match this codebase's
--                               existing convention (e.g. venue_claims.status,
--                               operator_submissions.status are also plain
--                               TEXT + CHECK, not enums).
--   - origin_claim_id / origin_submission_id — exactly one is set, matching
--                               origin_type (enforced by a CHECK below). Real
--                               foreign keys to venue_claims(id) /
--                               operator_submissions(id) — this requires the
--                               origin row to already exist at insert time;
--                               see src/lib/activation/activationLifecycle.ts's
--                               header for the resulting ordering requirement
--                               (this table is populated AFTER the origin
--                               row's own write, in application code, never
--                               before).
--   - started_at / deadline_at / reminder_stage — the same semantics the
--                               first draft gave activation_started_at/
--                               activation_deadline_at/activation_reminder_stage:
--                               deadline_at = started_at + the 14-day default
--                               (src/lib/activation/activationState.ts),
--                               computed once; reminder_stage starts at 0
--                               (no reminder sent yet) and is only ever
--                               advanced by a later phase's reminder cron —
--                               nothing in this phase advances it.
--   - expired_at / released_at — reserved for a later phase (nothing in this
--                               codebase sets them yet). Overlay state on
--                               top of started_at/deadline_at, never a
--                               rewrite of them — matches the first draft's
--                               same design intent, just relocated here.
--
-- THE ATOMICITY GUARANTEE — read this before touching this table elsewhere:
--   operator_activation_lifecycles_one_live_per_operator_uidx is a UNIQUE
--   INDEX on (operator_id) WHERE expired_at IS NULL AND released_at IS NULL.
--   This is what makes "at most one live lifecycle per operator" a database
--   fact, not an application promise. Any future code that needs to create
--   a lifecycle row MUST go through this same insert-and-handle-23505
--   pattern — never a SELECT-then-INSERT check in application code, which
--   would reintroduce exactly the race this migration exists to close.
--
-- EXISTING ROWS / LEGACY OPERATORS: this table starts empty. No historical
--   claim/submission is backfilled into it in this phase (see the
--   accompanying task report's read-only backfill preview). An operator
--   with no row here is simply "not tracked" — completeOperatorAccountActivation()
--   falls back to its pre-existing (less precise, but unchanged) heuristic
--   for exactly this population, so already-in-flight legacy operators are
--   not regressed by this migration's absence of backfill.
--
-- WHAT THIS ADDS to public.venue_claim_notes and public.operator_submission_notes
-- (unchanged from the first draft — this part of the design was not affected
-- by the concurrency fix above):
--   - event_type    — a machine-readable event identifier (e.g.
--                      "activation_started", "account_activated" — full
--                      vocabulary in src/lib/activation/activationEvents.ts
--                      as a TypeScript union, not a DB CHECK, so a later
--                      phase can add event types without a migration). NULL
--                      for every existing note and every human-authored
--                      founder note — a NULL value is a valid legacy/
--                      free-text note, not a defect.
--   - metadata_json — optional structured context for a given event_type.
--                     Mirrors customer_success_events.metadata_json
--                     (migration 093/095). MUST NEVER contain a secret,
--                     token, OTP, password, or setup link — enforced by
--                     application discipline in
--                     src/lib/activation/activationNotes.ts, not a DB
--                     constraint, matching how the rest of this codebase
--                     already relies on written convention for note/email
--                     body contents.
--
-- GRANTS: operator_activation_lifecycles is a new table, so it needs a
--   fresh GRANT block (CLAUDE.md's rule) — service_role only, no anon/
--   authenticated access, matching the same "internal system table" pattern
--   as customer_success_events/brevo_sync_outbox. The two ALTERed notes
--   tables need no new GRANTs (already granted appropriately in migrations
--   022/023/039).
--
-- RLS: enabled on the new table with no permissive policy — inaccessible to
--   anon/authenticated by default, accessible only via service_role
--   (createAdminClient()), exactly matching the two notes tables' own RLS
--   posture and every other internal-only table in this codebase.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Canonical activation lifecycle table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_activation_lifecycles (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           UUID        NOT NULL REFERENCES public.operators(id),
  origin_type           TEXT        NOT NULL,
  origin_claim_id       UUID        REFERENCES public.venue_claims(id),
  origin_submission_id  UUID        REFERENCES public.operator_submissions(id),
  started_at            TIMESTAMPTZ NOT NULL,
  deadline_at           TIMESTAMPTZ NOT NULL,
  reminder_stage        INTEGER     NOT NULL DEFAULT 0,
  expired_at            TIMESTAMPTZ,
  released_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operator_activation_lifecycles IS
  'Canonical, single-source-of-truth record of the shared operator-'
  'activation lifecycle (Claims + Add Your Venue submissions). At most one '
  'LIVE row (expired_at IS NULL AND released_at IS NULL) may exist per '
  'operator_id — enforced by operator_activation_lifecycles_one_live_per_operator_uidx '
  'below, not by application logic. See this migration''s header for the '
  'concurrency bug this table exists to close, and '
  'src/lib/activation/activationLifecycle.ts for how a row is atomically '
  'claimed or reused.';

-- DROP + re-ADD, matching the established rerun-safety precedent in this
-- repository (migration 095's communication_status widening, itself
-- following migration 068's operator_submissions_status_check precedent) —
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so this is the safe idiom
-- for a constraint to survive an accidental re-application unchanged.
ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_origin_type_check;
ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_origin_type_check
  CHECK (origin_type IN ('claim', 'submission'));

ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_origin_shape_check;
ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_origin_shape_check
  CHECK (
    (origin_type = 'claim'      AND origin_claim_id      IS NOT NULL AND origin_submission_id IS NULL) OR
    (origin_type = 'submission' AND origin_submission_id IS NOT NULL AND origin_claim_id      IS NULL)
  );

ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_stage_check;
ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_reminder_stage_check
  CHECK (reminder_stage >= 0);

COMMENT ON COLUMN public.operator_activation_lifecycles.operator_id IS
  'The operator this lifecycle belongs to. Activation is a one-time, '
  'per-operator event (get any account set up) even though it is always '
  'triggered by provisioning for a specific venue.';
COMMENT ON COLUMN public.operator_activation_lifecycles.origin_type IS
  'Which flow started this lifecycle: ''claim'' or ''submission''. Plain '
  'TEXT + CHECK, matching venue_claims.status/operator_submissions.status''s '
  'existing convention rather than a DB enum.';
COMMENT ON COLUMN public.operator_activation_lifecycles.started_at IS
  'The authoritative provisioning moment this lifecycle began. Set once, '
  'never recomputed.';
COMMENT ON COLUMN public.operator_activation_lifecycles.deadline_at IS
  'started_at + the 14-day default (src/lib/activation/activationState.ts''s '
  'ACTIVATION_WINDOW_DAYS), computed once. Only a later phase''s explicit '
  'founder "extend deadline" action may move this forward — a manual '
  'setup-code/link resend must never touch it.';
COMMENT ON COLUMN public.operator_activation_lifecycles.reminder_stage IS
  'How many reminder milestones have been reached (0 = lifecycle started, '
  'no reminder sent yet). Only a later phase''s reminder cron advances this.';
COMMENT ON COLUMN public.operator_activation_lifecycles.expired_at IS
  'Set once activation is deemed expired (a later phase — nothing in this '
  'codebase sets it yet). Overlay state, never a rewrite of started_at/'
  'deadline_at.';
COMMENT ON COLUMN public.operator_activation_lifecycles.released_at IS
  'Set once the venue/ownership tied to an expired, unactivated lifecycle '
  'has actually been released or reverted (a later phase, requiring manual '
  'founder review per product decision — nothing in this codebase sets it '
  'yet). Distinct from expired_at: "overdue" and "acted upon" are '
  'different facts.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE atomicity guarantee — at most one LIVE lifecycle per operator
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS operator_activation_lifecycles_one_live_per_operator_uidx
  ON public.operator_activation_lifecycles (operator_id)
  WHERE expired_at IS NULL AND released_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Origin lookup — at most one lifecycle row per origin, ever
--
-- Not required for the concurrency guarantee (operator_id uniqueness above
-- already prevents two live rows for the same operator regardless of
-- origin), but a genuine integrity guarantee worth having for free: a given
-- claim/submission should never end up linked to more than one lifecycle
-- row across its lifetime. Also serves as the direct origin→lifecycle
-- lookup index for a future Control Panel detail page.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS operator_activation_lifecycles_origin_claim_uidx
  ON public.operator_activation_lifecycles (origin_claim_id)
  WHERE origin_claim_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS operator_activation_lifecycles_origin_submission_uidx
  ON public.operator_activation_lifecycles (origin_submission_id)
  WHERE origin_submission_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Index for a future reminder cron's due-lifecycle query
--
-- Scoped to live rows, ordered by deadline — this is exactly "what's due
-- right now," matching the same shape as customer_success_events_due_idx
-- (migration 095). A later phase reads THIS table for reminder eligibility,
-- never venue_claims/operator_submissions — there is nothing to guess
-- across two tables for.
--
-- WARNING for whoever writes that query: expired_at/released_at IS NULL
-- alone is NOT sufficient to prove an operator still needs a reminder — see
-- claimOrReuseActivationLifecycle()'s inline comment
-- (src/lib/activation/activationLifecycle.ts) for a narrow, accepted race
-- that can leave a live lifecycle row behind for an operator who has
-- already activated via a different venue. Any due-lifecycle query MUST
-- also join/filter on operators.account_activated_at IS NULL — never send a
-- reminder based on this index matching alone.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS operator_activation_lifecycles_due_idx
  ON public.operator_activation_lifecycles (deadline_at)
  WHERE expired_at IS NULL AND released_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Row Level Security — internal-only, service_role access only
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_activation_lifecycles ENABLE ROW LEVEL SECURITY;
-- No permissive policy — RLS enabled + no policy = inaccessible to
-- anon/authenticated by default; service_role bypasses RLS entirely.


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. GRANTs — new table, so a fresh GRANT block is required (CLAUDE.md rule)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.operator_activation_lifecycles TO service_role;
-- No anon/authenticated grants — this table is written and read exclusively
-- by server-side application code via createAdminClient(), never directly
-- by an operator or the public Data API.


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Structured Internal Note support — venue_claim_notes (unchanged design)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_claim_notes
  ADD COLUMN IF NOT EXISTS event_type    TEXT,
  ADD COLUMN IF NOT EXISTS metadata_json JSONB;

COMMENT ON COLUMN public.venue_claim_notes.event_type IS
  'Machine-readable event identifier for a structured system note (see the '
  'planned vocabulary in src/lib/activation/activationEvents.ts — enforced '
  'in application code as a TypeScript union, not a DB CHECK, so future '
  'event types never need a migration). NULL for every note predating this '
  'migration and for every human-authored founder note — a NULL value is a '
  'perfectly valid legacy/free-text note, not a defect.';
COMMENT ON COLUMN public.venue_claim_notes.metadata_json IS
  'Optional structured context for a given event_type (e.g. the activation '
  'deadline and originating flow for an "activation_started" event). Must '
  'never contain a secret, access token, OTP, password, or setup link — '
  'enforced by application discipline in '
  'src/lib/activation/activationNotes.ts, mirroring how '
  'customer_success_events.metadata_json (migration 093) is already '
  'documented as holding only non-secret operational context.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Structured Internal Note support — operator_submission_notes (unchanged)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submission_notes
  ADD COLUMN IF NOT EXISTS event_type    TEXT,
  ADD COLUMN IF NOT EXISTS metadata_json JSONB;

COMMENT ON COLUMN public.operator_submission_notes.event_type IS
  'Machine-readable event identifier for a structured system note (see the '
  'planned vocabulary in src/lib/activation/activationEvents.ts — enforced '
  'in application code as a TypeScript union, not a DB CHECK, so future '
  'event types never need a migration). NULL for every note predating this '
  'migration and for every human-authored founder note — a NULL value is a '
  'perfectly valid legacy/free-text note, not a defect.';
COMMENT ON COLUMN public.operator_submission_notes.metadata_json IS
  'Optional structured context for a given event_type (e.g. the activation '
  'deadline and originating flow for an "activation_started" event). Must '
  'never contain a secret, access token, OTP, password, or setup link — '
  'enforced by application discipline in '
  'src/lib/activation/activationNotes.ts, mirroring how '
  'customer_success_events.metadata_json (migration 093) is already '
  'documented as holding only non-secret operational context.';
