-- =============================================================================
-- Happy Hour Compass — Operator Activation Reminders & Expiry (Schema Foundation)
-- Migration: 099_operator_activation_reminders.sql
--
-- STATUS: not yet applied. Phase 2A-2 — schema + pure policy foundation only.
-- No cron, no orchestrator, no email, no Slack, and no kill switch exist yet
-- — see CLAUDE.md's Operator activation lifecycle section for the current
-- boundary. This migration makes ZERO existing row behave differently:
-- reminder_next_attempt_at stays NULL for every existing live lifecycle
-- (including the first real tracked one, Kelly Terris / Buffalo Rouge
-- Brewing Co.) until a future, still-unbuilt orchestrator's first enabled
-- pass computes it — see src/lib/activation/activationReminderPolicy.ts's
-- computeInitialNextAttempt() for that (not-yet-wired-up) logic.
--
-- reminder_stage SEMANTICS (redefined by the Phase 2A design audit — read
-- this before touching this column anywhere):
--   reminder_stage records the highest stage durably resolved (sent,
--   skipped-as-superseded, or obsoleted by extension) — never assume a
--   given stage was actually delivered without checking for its Internal
--   Note. A stage can be "resolved" three ways: its reminder was actually
--   sent; a LATER stage's reminder was sent instead, silently superseding
--   it (the catch-up policy never sends more than one reminder per pass —
--   see selectCatchUpStage() in activationReminderPolicy.ts); or a deadline
--   extension/reopen moved the deadline far enough that the stage's
--   original timing became moot before it was ever processed (see
--   computeExtensionResolution() in the same file). Only the corresponding
--   reminder_sent Internal Note (see event_key below) proves an actual
--   delivery — reminder_stage alone never does.
--
-- TIMING — deadline-relative, not start-relative:
--   Stage 1 = deadline_at - 11 days, Stage 2 = deadline_at - 7 days,
--   Stage 3 = deadline_at - 2 days, expiry = deadline_at. Anchoring to the
--   deadline (never to started_at, which a deadline extension never moves)
--   is what lets an extension recompute reminder timing correctly with no
--   special-casing — see src/lib/activation/activationReminderPolicy.ts.
--
-- WHAT THIS ADDS to public.operator_activation_lifecycles:
--   - reminder_next_attempt_at — materialized due-time for the next
--     unresolved stage; NULL once reminder_stage = 3, and NULL for every
--     existing row until lazily initialized (see above).
--   - reminder_attempt_count   — delivery attempts against the CURRENT
--     (not-yet-resolved) stage only; reset to 0 whenever reminder_stage
--     advances or the deadline is extended/reopened.
--   - reminder_last_attempted_at / reminder_last_error — mirrors the same
--     pattern already used by customer_success_events (migration 095).
--   - reminder_lease_stage / reminder_lease_started_at — the claim/lease a
--     future reminder worker uses to prevent two concurrent cron passes
--     from processing the same lifecycle twice. Both null = no worker
--     currently owns this lifecycle's reminder processing; both non-null =
--     a worker does. A CHECK below enforces they are never set
--     independently of each other. Deadline extension deliberately REFUSES
--     to run while this is non-null, rather than clearing or stealing it —
--     see extendActivationDeadlineImpl.ts.
--   - expiry_slack_notified_at / expiry_founder_email_sent_at — independent
--     completion markers for the two expiry notifications, so either can be
--     retried on a later pass without re-doing the other (mirrors
--     customer_success_events.sent_notification_sent_at's decoupled-retry
--     design, migration 095).
--
-- reminder_stage is widened from migration 098's original unbounded ">= 0"
-- CHECK to an exact 0-3 bound now that its full range is known (DROP + re-
-- ADD, matching that migration's own rerun-safety precedent).
--
-- WHAT THIS ADDS to public.venue_claim_notes and public.operator_submission_notes:
--   - event_key — a stable, deterministic identifier for a structured
--     system note tied to one specific reminder/expiry occurrence (e.g.
--     "hhc-activation-reminder:<lifecycleId>:<stage>",
--     "hhc-activation-expiry:<lifecycleId>" — see activationReminderPolicy.ts).
--     NULL for every existing note and every human-authored note — a NULL
--     value is a perfectly valid legacy/free-text note, not a defect. The
--     partial unique index below is what makes a future reminder/expiry
--     worker's note-insert safely retryable: attempting to insert the same
--     event_key twice fails with a 23505 unique-violation, treated by the
--     (not-yet-built) worker as "already written, not an error" — the same
--     insert-and-handle-23505 idiom already used throughout this codebase
--     (operators.email, this table's own origin-uniqueness indexes,
--     operator_activation_lifecycles' one-live-per-operator index).
--
-- GRANTS: no new table, so no new GRANT block (CLAUDE.md's GRANT rule only
--   applies to a new CREATE TABLE) — these are ALTERs to tables already
--   granted appropriately (operator_activation_lifecycles in migration 098;
--   venue_claim_notes/operator_submission_notes in migrations 022/023/039).
--
-- RLS: no change — operator_activation_lifecycles already has RLS enabled
--   with no permissive policy (migration 098); the two notes tables' own
--   RLS posture is untouched by this migration.
--
-- SCOPE: schema only. No INSERT/UPDATE/DELETE, no backfill. Every existing
--   row — Kelly's lifecycle included — is completely unchanged by applying
--   this migration; only new, nullable-or-defaulted columns are added.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New columns on operator_activation_lifecycles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_activation_lifecycles
  ADD COLUMN IF NOT EXISTS reminder_next_attempt_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_attempt_count       INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_last_attempted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_last_error          TEXT,
  ADD COLUMN IF NOT EXISTS reminder_lease_stage         INTEGER,
  ADD COLUMN IF NOT EXISTS reminder_lease_started_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_slack_notified_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_founder_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.operator_activation_lifecycles.reminder_stage IS
  'reminder_stage records the highest stage durably resolved (sent, '
  'skipped-as-superseded, or obsoleted by extension) — never assume a '
  'given stage was actually delivered without checking for its Internal '
  'Note. 0 = no stage resolved, 1 = stage 1 resolved, 2 = stages 1-2 '
  'resolved, 3 = stages 1-3 resolved. See '
  'src/lib/activation/activationReminderPolicy.ts for the full timing and '
  'catch-up/extension resolution rules.';
COMMENT ON COLUMN public.operator_activation_lifecycles.reminder_next_attempt_at IS
  'Materialized due-time for the next UNRESOLVED reminder stage. NULL once '
  'reminder_stage = 3 (no further automatic reminders), and NULL for any '
  'lifecycle the reminder system has not yet initialized (lazy init — see '
  'computeInitialNextAttempt() in activationReminderPolicy.ts). Deadline-'
  'relative: stage N is due at deadline_at minus 11/7/2 days for N=1/2/3.';
COMMENT ON COLUMN public.operator_activation_lifecycles.reminder_attempt_count IS
  'Delivery attempts against the CURRENT (not-yet-resolved) stage only. '
  'Reset to 0 whenever reminder_stage advances, or the deadline is '
  'extended/reopened.';
COMMENT ON COLUMN public.operator_activation_lifecycles.reminder_last_attempted_at IS
  'Timestamp of the most recent reminder delivery attempt.';
COMMENT ON COLUMN public.operator_activation_lifecycles.reminder_last_error IS
  'Sanitized/truncated error from the most recent failed reminder attempt. '
  'Never a secret or raw provider payload.';
COMMENT ON COLUMN public.operator_activation_lifecycles.reminder_lease_stage IS
  'The stage a worker currently owns processing for this lifecycle, or '
  'NULL if no worker currently holds this lifecycle''s reminder lease. Set '
  'together with reminder_lease_started_at — see the paired-shape CHECK '
  'below. Deadline extension refuses to run while this is non-null rather '
  'than clearing or stealing it (see extendActivationDeadlineImpl.ts).';
COMMENT ON COLUMN public.operator_activation_lifecycles.reminder_lease_started_at IS
  'When the current reminder-processing lease (if any) was claimed. A '
  'lease older than a worker''s stale-recovery threshold is considered '
  'abandoned by a crashed process and is freed for reclaiming — no such '
  'recovery process exists yet in this phase.';
COMMENT ON COLUMN public.operator_activation_lifecycles.expiry_slack_notified_at IS
  'When the one-time expiry Slack notification was posted. Independently '
  'retryable from expiry_founder_email_sent_at — mirrors '
  'customer_success_events.sent_notification_sent_at''s decoupled-retry '
  'design (migration 095). Slack delivery here is at-least-once, not '
  'exactly-once — no dedupe primitive exists for a plain incoming webhook.';
COMMENT ON COLUMN public.operator_activation_lifecycles.expiry_founder_email_sent_at IS
  'When the one-time expiry founder-notification email was sent. Unlike '
  'Slack, this send can safely use a deterministic Resend idempotency key '
  '(hhc-activation-expiry-founder-email:<lifecycleId>), so a retry after a '
  'crash cannot duplicate it.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Constraints — DROP + re-ADD, matching the established rerun-safety
--    precedent (migration 098's origin_type_check).
-- ─────────────────────────────────────────────────────────────────────────────

-- reminder_stage: widened from the original ">= 0" to an exact 0-3 bound,
-- now that its full range is known (see migration 098's original CHECK).
ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_stage_check;
ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_reminder_stage_check
  CHECK (reminder_stage BETWEEN 0 AND 3);

ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_attempt_count_check;
ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_reminder_attempt_count_check
  CHECK (reminder_attempt_count >= 0);

ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_lease_stage_check;
ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_reminder_lease_stage_check
  CHECK (reminder_lease_stage IS NULL OR reminder_lease_stage BETWEEN 1 AND 3);

-- Lease shape consistency: a lease is either fully absent or fully present —
-- never a stage number with no claim timestamp, or vice versa.
ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_reminder_lease_shape_check;
ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_reminder_lease_shape_check
  CHECK (
    (reminder_lease_stage IS NULL AND reminder_lease_started_at IS NULL) OR
    (reminder_lease_stage IS NOT NULL AND reminder_lease_started_at IS NOT NULL)
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes for the (not-yet-built) reminder worker's due-lifecycle and
--    stale-lease-recovery queries — analogous to customer_success_events_due_idx
--    / customer_success_events_processing_started_at_idx (migration 095).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS operator_activation_lifecycles_reminder_due_idx
  ON public.operator_activation_lifecycles (reminder_next_attempt_at)
  WHERE expired_at IS NULL AND released_at IS NULL;

CREATE INDEX IF NOT EXISTS operator_activation_lifecycles_reminder_lease_idx
  ON public.operator_activation_lifecycles (reminder_lease_started_at)
  WHERE reminder_lease_started_at IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. event_key — venue_claim_notes
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_claim_notes
  ADD COLUMN IF NOT EXISTS event_key TEXT;

COMMENT ON COLUMN public.venue_claim_notes.event_key IS
  'Stable, deterministic identifier for a structured system note tied to '
  'one specific reminder/expiry occurrence (e.g. '
  '"hhc-activation-reminder:<lifecycleId>:<stage>", '
  '"hhc-activation-expiry:<lifecycleId>" — see '
  'src/lib/activation/activationReminderPolicy.ts). NULL for every note '
  'predating this migration and every human-authored note — a NULL value '
  'is a valid legacy/free-text note, not a defect. The partial unique '
  'index below makes a note-insert for a given event safely retryable: a '
  'second attempt at the same event_key fails with 23505, treated as '
  '"already written, not an error."';

CREATE UNIQUE INDEX IF NOT EXISTS venue_claim_notes_event_key_uidx
  ON public.venue_claim_notes (event_key)
  WHERE event_key IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. event_key — operator_submission_notes (identical design)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.operator_submission_notes
  ADD COLUMN IF NOT EXISTS event_key TEXT;

COMMENT ON COLUMN public.operator_submission_notes.event_key IS
  'Stable, deterministic identifier for a structured system note tied to '
  'one specific reminder/expiry occurrence — see '
  'public.venue_claim_notes.event_key''s comment for the full design; '
  'identical here.';

CREATE UNIQUE INDEX IF NOT EXISTS operator_submission_notes_event_key_uidx
  ON public.operator_submission_notes (event_key)
  WHERE event_key IS NOT NULL;


-- No new GRANTs needed — every ALTERed table is already granted to
-- service_role only (operator_activation_lifecycles: migration 098;
-- venue_claim_notes/operator_submission_notes: migrations 022/023/039), and
-- this migration adds no new table. No RLS change — all three tables' RLS
-- posture (enabled, no permissive policy, service_role only) is untouched.
