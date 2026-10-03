-- =============================================================================
-- Happy Hour Compass — Deferred Initial Setup Email
-- Migration: 105_deferred_initial_setup_email.sql
--
-- STATUS: not yet applied.
--
-- An automatic initial setup email (approval / auto-approval provisioning,
-- deferred email-code start, legacy tracking start) is only ever sent while
-- holding the operator's setup-contact claim (migration 104). The claim
-- lives up to 6 minutes when its holder crashed mid-send, because an
-- in-flight provider request can't be cancelled — longer than any request
-- can wait (functions are capped at 300 s). When the claim doesn't free up
-- within a short wait, the email is QUEUED here instead of being sent beside
-- another email, and the hourly operator-activation worker sends it under
-- the claim (src/lib/activation/deferredInitialSetup.ts).
--
-- WHAT THIS ADDS to public.operators (columns only — no new table, so no new
-- GRANT block; RLS and existing policies are unchanged):
--
--   - initial_setup_deferred_at — the time of the LATEST queue request; NULL
--     = nothing queued. A newer request moves it forward (never back), so a
--     request that arrives while an older one is being sent is never lost:
--     the worker clears the entry by compare-and-swap on the exact value it
--     sent for, which then no longer matches.
--   - initial_setup_deferred_attempt_started_at — set (CAS) just before the
--     worker starts a send for the queued request, cleared when the outcome
--     is recorded. Still set on a later pass = that attempt was interrupted
--     (the 60 s cron deadline, a crash) and its outcome is unknown unless
--     acceptance evidence (below) covers it — the worker then never resends
--     blindly.
--   - initial_setup_deferred_attempts / initial_setup_deferred_last_error —
--     definite rejections for the queued request (reset when cleared).
--
--   - last_setup_email_accepted_at — CONFIRMED delivery evidence: the START
--     time of the latest setup email to this unactivated operator that the
--     provider ACCEPTED. Written by sendTransactionalEmail() only after
--     acceptance (unlike migration 104's last_setup_contact_at, which is
--     written before every attempt, including ones that then fail). Stamped
--     with the attempt's start, not the acceptance, so an email decided
--     before a newer queue request never counts as answering it.
--
-- No backfill: every existing row keeps these NULL / 0.
-- =============================================================================

ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS initial_setup_deferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS initial_setup_deferred_attempt_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS initial_setup_deferred_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initial_setup_deferred_last_error text,
  ADD COLUMN IF NOT EXISTS last_setup_email_accepted_at timestamptz;

ALTER TABLE public.operators
  DROP CONSTRAINT IF EXISTS operators_initial_setup_deferred_attempts_check;
ALTER TABLE public.operators
  ADD CONSTRAINT operators_initial_setup_deferred_attempts_check CHECK (initial_setup_deferred_attempts >= 0);

-- The worker's due-row query: queued requests, oldest first.
CREATE INDEX IF NOT EXISTS operators_initial_setup_deferred_at_idx
  ON public.operators (initial_setup_deferred_at)
  WHERE initial_setup_deferred_at IS NOT NULL;
