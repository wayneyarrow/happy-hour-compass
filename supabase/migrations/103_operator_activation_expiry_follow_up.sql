-- =============================================================================
-- Happy Hour Compass — Operator Activation Post-Expiry Personal Follow-Up
-- Migration: 103_operator_activation_expiry_follow_up.sql
--
-- STATUS: not yet applied. Must be applied BEFORE the code that reads these
-- columns is deployed (processActivationReminders.ts selects them).
--
-- WHAT THIS ADDS to public.operator_activation_lifecycles (columns only — no
-- new table, so no new GRANT block; RLS posture unchanged):
--
--   - expiry_follow_up_required — TRUE only for lifecycles whose expiry was
--     recorded by the post-expiry follow-up worker (it is set in the SAME
--     compare-and-swap UPDATE that sets expired_at). Every existing row —
--     including any lifecycle that already expired before this ships — keeps
--     the column default FALSE. That is the rollout cutoff: historical
--     expiries are never picked up for a #customer-success notification
--     backfill, and no "notified" timestamp is ever written for a
--     notification that did not happen. Historical expired-but-unactivated
--     rows stay visible in the Control Panel's Operator activation reviews
--     report (activationReviews.ts), which reads lifecycle state directly.
--
--   - expiry_follow_up_resolved_at / expiry_follow_up_skip_reason — set once
--     a required follow-up needs no further processing: every side effect
--     (Internal Note, #customer-success Slack, founder email) has completed
--     (skip_reason NULL), or the row became permanently ineligible
--     (skip_reason = 'activated' | 'ownership_changed' | 'origin_unresolved').
--     Resolved rows drop out of the reconciliation batch, so completed or
--     ineligible rows can never starve newer expiries.
--
--   - expiry_follow_up_last_attempted_at — when reconciliation last
--     processed this row. The batch is ordered by this (NULLS FIRST), so a
--     row whose Slack/email keeps failing rotates behind fresh rows instead
--     of occupying the batch forever.
--
--   - setup_link_claimed_at — short-lived claim (lifetime defined in code:
--     SETUP_LINK_LOCK_MS, src/lib/activation/setupLinkLock.ts) taken by the founder's
--     "Final resend setup email" / "Copy setup link" actions before they
--     generate a Supabase recovery link. Generating a recovery link
--     invalidates the operator's previous one, so two concurrent requests
--     must never both generate. Claimed via compare-and-swap on the
--     previously read value; cleared when the action finishes.
--
-- expiry_slack_notified_at (migration 099) is unchanged in meaning — "the
-- expiry Slack notification was delivered" — but from this migration's code
-- onward that notification goes to #customer-success, not #ops-alerts.
--
-- Changes zero existing rows' behaviour: every new column is NULL / FALSE
-- for existing rows, and nothing here touches deadline_at, expired_at,
-- released_at or any reminder_* column.
-- =============================================================================

ALTER TABLE public.operator_activation_lifecycles
  ADD COLUMN IF NOT EXISTS expiry_follow_up_required          BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expiry_follow_up_resolved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_follow_up_skip_reason       TEXT,
  ADD COLUMN IF NOT EXISTS expiry_follow_up_last_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_link_claimed_at              TIMESTAMPTZ;

ALTER TABLE public.operator_activation_lifecycles
  DROP CONSTRAINT IF EXISTS operator_activation_lifecycles_expiry_follow_up_skip_reason_check;

ALTER TABLE public.operator_activation_lifecycles
  ADD CONSTRAINT operator_activation_lifecycles_expiry_follow_up_skip_reason_check
  CHECK (
    expiry_follow_up_skip_reason IS NULL
    OR expiry_follow_up_skip_reason IN ('activated', 'ownership_changed', 'origin_unresolved')
  );

COMMENT ON COLUMN public.operator_activation_lifecycles.expiry_follow_up_required IS
  'TRUE when this lifecycle''s expiry was recorded by the post-expiry follow-up '
  'worker (set in the same UPDATE as expired_at). FALSE for every lifecycle that '
  'expired before migration 103 — the rollout cutoff; those are never backfilled '
  'with notifications and remain visible in the activation reviews report.';

COMMENT ON COLUMN public.operator_activation_lifecycles.expiry_follow_up_resolved_at IS
  'When post-expiry follow-up processing finished for this lifecycle — all side '
  'effects complete (skip_reason NULL) or permanently ineligible (skip_reason set).';

COMMENT ON COLUMN public.operator_activation_lifecycles.expiry_follow_up_skip_reason IS
  'Why follow-up stopped without completing: activated, ownership_changed, or '
  'origin_unresolved. NULL when every side effect completed.';

COMMENT ON COLUMN public.operator_activation_lifecycles.expiry_follow_up_last_attempted_at IS
  'Last reconciliation pass that processed this row. Batch order key (NULLS FIRST) '
  'so persistently failing rows rotate rather than starve newer expiries.';

COMMENT ON COLUMN public.operator_activation_lifecycles.setup_link_claimed_at IS
  'Short-lived claim (lifetime: SETUP_LINK_LOCK_MS in code) held while a founder final-follow-up action generates a '
  'recovery link, so concurrent requests cannot invalidate each other''s link.';

-- Supports the reconciliation batch query: required, unresolved, unreleased,
-- expired rows, oldest-attempted first.
CREATE INDEX IF NOT EXISTS operator_activation_lifecycles_expiry_follow_up_idx
  ON public.operator_activation_lifecycles (expiry_follow_up_last_attempted_at NULLS FIRST)
  WHERE expiry_follow_up_required = TRUE
    AND expiry_follow_up_resolved_at IS NULL
    AND released_at IS NULL
    AND expired_at IS NOT NULL;

-- No new GRANTs needed — operator_activation_lifecycles is already granted to
-- service_role only (migration 098) and this migration adds no new table. RLS
-- remains enabled with no permissive policy.
