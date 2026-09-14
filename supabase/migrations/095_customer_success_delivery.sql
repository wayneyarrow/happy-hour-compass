-- =============================================================================
-- Happy Hour Compass — Customer Success Delivery
-- Migration: 095_customer_success_delivery.sql
--
-- CONTEXT (Customer Success Phase 1B — delivery/automation):
--   Phase 1A (migration 093) built detection-only: customer_success_events
--   rows reach communication_status = 'pending' but nothing ever sends them.
--   This migration adds exactly the columns/constraints needed for the
--   actual send pipeline — claiming, retrying, and terminal failure — on
--   top of the existing table. It does NOT touch migrations 093 or 094,
--   which remain as originally written; this is purely additive.
--
--   Application order once Supabase access is authorized: 093 → 094 → 095.
--   094 is a data backfill (UPDATE) — review its documented SELECT first.
--   This migration (095) is schema-only (ALTER TABLE / index changes), safe
--   to review independently of 094's data question.
--
-- WHAT THIS ADDS to public.customer_success_events:
--   - communication_status gains a new value: 'processing' — a transient
--     state while a send attempt is in flight, so two workers can never
--     both believe they own the same event (see DB INVARIANT below).
--   - next_attempt_at         — when this event is next due for a delivery
--                                attempt. NULL until the delivery
--                                processor computes it on first sight
--                                (lazily — Phase 1A's detector never sets
--                                this; it stays purely detection-focused).
--   - attempt_count           — delivery attempts made so far (0-3). Never
--                                incremented for a recipient-resolution
--                                block — that is not a delivery attempt.
--   - last_attempted_at       — timestamp of the most recent attempt.
--   - last_error              — sanitized/truncated error from the most
--                                recent failed attempt. Never a secret or
--                                raw provider payload — see
--                                processCustomerSuccessDeliveries.ts.
--   - processing_started_at   — set when an event is claimed into
--                                'processing'; used to detect and recover
--                                a stale claim left behind by a crashed
--                                process (see DB INVARIANT below).
--   - recipient_blocked_reason        — non-NULL means this event cannot
--                                        proceed for a data-resolution
--                                        reason (no valid recipient, or no
--                                        resolvable venue timezone). Does
--                                        NOT consume an attempt and does NOT
--                                        change communication_status — the
--                                        event stays 'pending' and
--                                        recoverable once account data is
--                                        fixed.
--   - recipient_blocked_notified_at   — when the one-time "recipient
--                                        blocked" Slack notification was
--                                        sent, so a later cron run does not
--                                        repost it for the same unresolved
--                                        reason every hour.
--   - sent_notification_sent_at       — when the success Slack
--                                        notification was posted. A
--                                        'sent' email whose Slack post
--                                        failed can have that notification
--                                        retried independently later
--                                        without resending the email
--                                        (recipient_email/sent_at/
--                                        provider_message_id — already on
--                                        this table since migration 093 —
--                                        are untouched either way).
--
-- DELIVERY SNAPSHOT (Correction Pass Section 2) — REUSES EXISTING COLUMNS,
-- NO NEW ONE ADDED:
--   Every retry of the same event must send materially the SAME content —
--   reusing the same idempotency key across attempts is unsafe if the
--   recipient email, greeting name, or venue name could differ between
--   attempt 1 and attempt 3. Rather than adding new columns, delivery locks
--   a snapshot into two fields that already exist:
--     - recipient_email (migration 093) — now written at the SAME moment
--       the event is first claimed into 'processing' (not only on success
--       as originally built), so it represents the actual locked-in send
--       target from attempt 1 onward, not just a record of a completed
--       send.
--     - metadata_json (migration 093, "Optional additional context...for
--       future event types") — now used to hold
--       `{"deliverySnapshot": {"recipientFirstName": "...", "venueName": "..."}}`
--       for this event type, written in that same claim UPDATE.
--   processCustomerSuccessDeliveries.ts treats `recipient_email IS NOT NULL`
--   as "a snapshot already exists" — every retry and every stale-processing
--   recovery reuses these locked values rather than re-resolving current
--   (possibly since-changed) membership/venue data. A recipient-resolution
--   block that happens BEFORE any snapshot is locked never writes
--   recipient_email — once the account is corrected, resolution is free to
--   run again and lock in a fresh snapshot at that point.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD:
--   No column stores a Resend idempotency key. It is fully deterministic
--   from the row's own id (`hhc-customer-success:<id>`), computed at send
--   time — see processCustomerSuccessDeliveries.ts — so persisting it
--   would be redundant.
--
-- DB INVARIANT — "a venue must never have multiple active unsent venue-view
-- milestone communications":
--   Migration 093 enforced this with a partial unique index scoped to
--   communication_status = 'pending' only. Now that 'processing' exists as
--   a second transient-but-active state, that invariant is widened to span
--   BOTH — customer_success_events_one_active_uidx below is a single
--   partial unique index on (venue_id, event_type) WHERE
--   communication_status IN ('pending', 'processing'). This still lets
--   detection (venueViewMilestones.ts / detectVenueViewMilestones.ts,
--   unchanged by this migration) supersede a 'pending' row before delivery
--   claims it — detection always runs first in the scheduled job (see
--   src/app/api/cron/customer-success-deliveries/route.ts) — and it also
--   means delivery can never leave two simultaneously-active rows for one
--   venue: claiming a 'pending' row into 'processing' is itself covered by
--   the same index, so a second claim attempt on the same venue+event_type
--   collides with the first row's still-active status rather than creating
--   a second one. 'sent', 'superseded', 'skipped', and 'failed' are all
--   terminal and fall outside this index, so a permanently failed old
--   milestone never blocks a future higher milestone from becoming active.
--
-- STALE-PROCESSING RECOVERY:
--   A crash between "claim into processing" and "record sent/failed" must
--   not strand an event forever. The delivery processor treats any row
--   with communication_status = 'processing' AND processing_started_at
--   older than 15 minutes as stale and resets it back to 'pending' (attempt
--   count and next_attempt_at preserved) before the normal due-event query
--   runs. 15 minutes is chosen because: the cron route's maxDuration is 60
--   seconds and each attempt is a single email send, so any real in-flight
--   attempt finishes or the whole route times out in well under a minute —
--   a 'processing' row still that way after 15 minutes reliably means the
--   process was killed, not that it is still legitimately working. Any
--   retry after recovery reuses the SAME deterministic idempotency key
--   (see above), so a provider-accepted-but-unrecorded send is never
--   duplicated even if the crash happened after Resend already accepted
--   the message.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customer_success_events
  ADD COLUMN IF NOT EXISTS next_attempt_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count                    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempted_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error                       TEXT,
  ADD COLUMN IF NOT EXISTS processing_started_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recipient_blocked_reason         TEXT,
  ADD COLUMN IF NOT EXISTS recipient_blocked_notified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_notification_sent_at        TIMESTAMPTZ;

COMMENT ON COLUMN public.customer_success_events.next_attempt_at IS
  'When this event is next due for a delivery attempt. NULL until the '
  'delivery processor computes an initial value on first sight (next '
  'business day ~3pm venue-local); bumped forward ~1 hour after each '
  'retryable failure.';
COMMENT ON COLUMN public.customer_success_events.attempt_count IS
  'Delivery attempts made so far (0-3). Never incremented for a '
  'recipient-resolution block — that is not a delivery attempt.';
COMMENT ON COLUMN public.customer_success_events.last_attempted_at IS
  'Timestamp of the most recent delivery attempt (send or retry).';
COMMENT ON COLUMN public.customer_success_events.last_error IS
  'Sanitized/truncated error message from the most recent failed attempt. '
  'Never a secret or raw provider payload.';
COMMENT ON COLUMN public.customer_success_events.processing_started_at IS
  'Set when this event is atomically claimed into communication_status = '
  '''processing''. Used to detect and recover a stale claim (see migration '
  'header — 15 minute threshold).';
COMMENT ON COLUMN public.customer_success_events.recipient_blocked_reason IS
  'Non-NULL means this event cannot proceed for a data-resolution reason — '
  'either no valid recipient could be resolved, or no resolvable venue '
  'timezone (no_resolvable_timezone — Correction Pass Section 4: deliveryScheduling.ts '
  'never silently defaults an unresolvable venue to Pacific). See the '
  'allowed-values CHECK constraint. Does not consume an attempt and does '
  'not change communication_status; stays ''pending'' and recoverable once '
  'the underlying data is fixed.';
COMMENT ON COLUMN public.customer_success_events.recipient_blocked_notified_at IS
  'When the one-time blocked-state Slack notification was sent for the '
  'CURRENT recipient_blocked_reason. Re-notify only if the reason changes '
  'to a different value.';
COMMENT ON COLUMN public.customer_success_events.sent_notification_sent_at IS
  'When the success Slack notification was posted. A ''sent'' email whose '
  'Slack post failed can have just that notification retried later '
  'without resending the email.';

-- Updated comments (not new columns) on two fields migration 093 already
-- added — see the DELIVERY SNAPSHOT note in this migration's header.
COMMENT ON COLUMN public.customer_success_events.recipient_email IS
  'The locked-in delivery snapshot recipient (Correction Pass Section 2) — '
  'written at the moment this event is first claimed into ''processing'', '
  'not only after a successful send. Every retry and stale-processing '
  'recovery reuses this value rather than re-resolving current membership '
  'data. NULL until the first claim; a NULL value is how the processor '
  'knows no snapshot has been locked yet.';
COMMENT ON COLUMN public.customer_success_events.metadata_json IS
  'For event_type = venue_view_milestone, holds the delivery snapshot '
  '(Correction Pass Section 2): {"deliverySnapshot": {"recipientFirstName": '
  '"...", "venueName": "..."}} — written in the same claim UPDATE as '
  'recipient_email, reused unchanged on every retry. Otherwise general '
  'optional context for future event types, as originally documented in '
  'migration 093.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Widen communication_status to add 'processing'
--
-- Follows the same DROP + re-ADD CHECK-widening precedent as migration 068
-- (operator_submissions_status_check).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customer_success_events
  DROP CONSTRAINT IF EXISTS customer_success_events_communication_status_check;

ALTER TABLE public.customer_success_events
  ADD CONSTRAINT customer_success_events_communication_status_check
  CHECK (communication_status IN (
    'pending',
    'processing',
    'superseded',
    'sent',
    'skipped',
    'failed'
  ));

COMMENT ON COLUMN public.customer_success_events.communication_status IS
  'Lifecycle status. pending = achieved and eligible for future communication; '
  'may be scheduled (next_attempt_at set) or awaiting recipient resolution '
  '(recipient_blocked_reason set). processing = an atomic claim on this event '
  'for an in-flight delivery attempt (see stale-processing recovery in this '
  'migration''s header). superseded = achieved but a higher milestone was '
  'reached at the same detection point, or this row was produced by initial '
  'venue baselining — must never be sent. sent = communication delivered. '
  'skipped = deliberately not communicated (e.g. operator preference — future '
  'phase). failed = exhausted all delivery attempts (terminal).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. New CHECK constraints
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customer_success_events
  ADD CONSTRAINT customer_success_events_recipient_blocked_reason_check
  CHECK (recipient_blocked_reason IS NULL OR recipient_blocked_reason IN (
    'no_active_recipient',
    'ambiguous_recipient',
    'no_resolvable_timezone'
  ));

ALTER TABLE public.customer_success_events
  ADD CONSTRAINT customer_success_events_attempt_count_range_check
  CHECK (attempt_count >= 0 AND attempt_count <= 3);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DB invariant — replace the pending-only unique index with one spanning
--    both active states (pending + processing). See migration header.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS customer_success_events_one_pending_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS customer_success_events_one_active_uidx
  ON public.customer_success_events (venue_id, event_type)
  WHERE communication_status IN ('pending', 'processing');


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Index for the scheduler's due-event lookup
--
-- Scoped to pending, ordered by due time — this is exactly the processor's
-- "what's due right now" query.
-- ─────────────────────────────────────────────────────────────────────────────
-- Not scoped to recipient_blocked_reason IS NULL: a blocked event is still
-- re-checked on its normal due cadence (next_attempt_at) so it can recover
-- automatically once account data is fixed — it just skips the Resend call
-- and re-notifies Slack only if the block reason changes (see
-- recipientResolution.ts / processCustomerSuccessDeliveries.ts).
CREATE INDEX IF NOT EXISTS customer_success_events_due_idx
  ON public.customer_success_events (next_attempt_at)
  WHERE communication_status = 'pending';

-- Index for the stale-processing recovery scan.
CREATE INDEX IF NOT EXISTS customer_success_events_processing_started_at_idx
  ON public.customer_success_events (processing_started_at)
  WHERE communication_status = 'processing';

-- No new GRANTs needed — this migration only alters an existing table
-- (customer_success_events), already GRANTed to service_role only in
-- migration 093, with no anon/authenticated access. See CLAUDE.md's GRANT
-- rule: only a new CREATE TABLE requires a fresh GRANT block.
