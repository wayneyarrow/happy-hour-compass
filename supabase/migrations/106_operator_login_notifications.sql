-- =============================================================================
-- Happy Hour Compass — Operator Login Notifications
-- Migration: 106_operator_login_notifications.sql
--
-- STATUS: not yet applied.
--
-- When an operator signs in through the Business Login form, the server
-- records "Operator logged in" in each associated venue's Control Panel
-- Internal Notes and posts at most one #customer-success Slack message per
-- person per America/Vancouver calendar day
-- (src/lib/operatorLogin/recordOperatorSignInImpl.ts).
--
-- WHAT THIS ADDS:
--
--   1. venue_notes.event_key — a stable, deterministic identifier for a
--      structured system note, with a partial unique index (WHERE event_key
--      IS NOT NULL). Mirrors venue_claim_notes.event_key /
--      operator_submission_notes.event_key (migration 099). Login notes use
--      hhc-operator-login:<auth session id>:<venue id>, so a repeated call,
--      retry or concurrent request for the same sign-in fails with 23505 —
--      treated by the app as "already recorded", never as an error. NULL for
--      every existing note and every other note writer (unchanged).
--
--   2. public.operator_login_slack_notifications — the durable, per-day
--      Slack claim. Primary key (auth_user_id, login_date): the first sign-in
--      of the Pacific day INSERTs the row and owns the send; every other
--      sign-in that day conflicts (23505) and sends nothing. A failed send
--      releases the claim (claimed_at -> NULL, compare-and-swap on the
--      holder's own claimed_at) so a later sign-in the same day may retry;
--      a successful send sets sent_at, after which no further message is
--      sent for that day. sent_at is only ever written after Slack answered
--      2xx.
--
-- No backfill, no DML. RLS enabled with no permissive policy; anon and
-- authenticated revoked; service_role only (reached exclusively via createAdminClient() from server code).
-- =============================================================================


-- ── 1. venue_notes.event_key ─────────────────────────────────────────────────

ALTER TABLE public.venue_notes
  ADD COLUMN IF NOT EXISTS event_key TEXT;

COMMENT ON COLUMN public.venue_notes.event_key IS
  'Stable identifier for a structured system note (e.g. '
  'hhc-operator-login:<session id>:<venue id>). A second insert with the same '
  'event_key fails with 23505, treated as already recorded. NULL for '
  'ordinary notes.';

CREATE UNIQUE INDEX IF NOT EXISTS venue_notes_event_key_uidx
  ON public.venue_notes (event_key)
  WHERE event_key IS NOT NULL;


-- ── 2. operator_login_slack_notifications ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.operator_login_slack_notifications (
  auth_user_id   UUID        NOT NULL
                             REFERENCES auth.users(id)
                             ON DELETE CASCADE,
  login_date     DATE        NOT NULL,
  operator_id    UUID        NOT NULL
                             REFERENCES public.operators(id)
                             ON DELETE CASCADE,
  claimed_at     TIMESTAMPTZ,
  sent_at        TIMESTAMPTZ,
  attempt_count  INTEGER     NOT NULL DEFAULT 1,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT operator_login_slack_notifications_pkey
    PRIMARY KEY (auth_user_id, login_date),
  CONSTRAINT operator_login_slack_notifications_attempt_count_check
    CHECK (attempt_count >= 1)
);

COMMENT ON TABLE public.operator_login_slack_notifications IS
  'Durable once-per-Pacific-day claim for the #customer-success "Operator '
  'logged in" Slack message. One row per signed-in person per '
  'America/Vancouver calendar day.';

COMMENT ON COLUMN public.operator_login_slack_notifications.login_date IS
  'America/Vancouver calendar date of the sign-in that created the row.';

COMMENT ON COLUMN public.operator_login_slack_notifications.claimed_at IS
  'Set when a request takes the send; NULL after a failed send released it.';

COMMENT ON COLUMN public.operator_login_slack_notifications.sent_at IS
  'Set only after Slack accepted the message (2xx). Non-NULL = done for the day.';


-- ── 3. Row Level Security ────────────────────────────────────────────────────

ALTER TABLE public.operator_login_slack_notifications ENABLE ROW LEVEL SECURITY;


-- ── 4. GRANTs ────────────────────────────────────────────────────────────────
-- service_role only — written and read exclusively via createAdminClient().
-- Explicit REVOKE first: this project's default privileges would otherwise
-- grant anon/authenticated full table privileges on creation (same pattern
-- as migration 100).

REVOKE ALL ON public.operator_login_slack_notifications FROM PUBLIC;
REVOKE ALL ON public.operator_login_slack_notifications FROM anon;
REVOKE ALL ON public.operator_login_slack_notifications FROM authenticated;
GRANT ALL ON public.operator_login_slack_notifications TO service_role;
