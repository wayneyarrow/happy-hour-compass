-- =============================================================================
-- Migration: 078_consumer_brevo_welcome_cohort.sql
--
-- Adds consumer_profiles.brevo_welcome_backfilled_at — the durable HHC-owned
-- marker that defines the "existing consumer" welcome cohort ahead of the
-- future Brevo welcome automation.
--
-- Problem this solves: once an automated Brevo welcome flow exists, it must
-- never fire for a consumer who already received the one-time historical
-- "welcome to HHC" campaign sent to consumers who signed up before the
-- automation existed. Supabase/HHC — not Brevo — must own this distinction,
-- because Brevo contact timestamps (creation date, list-add date) do not
-- reliably track "was this consumer part of the pre-automation backfill" —
-- retries, re-syncs, and consent changes can all touch a Brevo contact's own
-- timestamps without that meaning anything about cohort membership.
--
-- NULL  → this consumer has never been included in the one-time historical
--         existing-consumer welcome backfill. Still eligible for the future
--         automated welcome flow once it ships.
-- set   → timestamp this consumer was included in the one-time historical
--         backfill/cohort. Permanent — must be treated by any future
--         automated-welcome eligibility check as "exclude," by reading THIS
--         Supabase column, never any Brevo-side contact/list timestamp.
--         Never updated again once set.
--
-- Set-once idempotency pattern (mirrors
-- 067_operator_account_activated.sql's account_activated_at column):
--   UPDATE consumer_profiles
--   SET    brevo_welcome_backfilled_at = now()
--   WHERE  id = $1
--   AND    brevo_welcome_backfilled_at IS NULL
--   RETURNING id
-- A row is returned only on the first successful call for a given consumer —
-- reruns, retries, and any future duplicate backfill invocation are all safe
-- no-ops. See scripts/backfillConsumerBrevoWelcomeCohort.ts, which uses this
-- exact pattern and only runs the UPDATE after confirming the consumer was
-- actually enqueued into brevo_sync_outbox in the same run — never marks a
-- consumer as backfilled without a corresponding successful enqueue.
--
-- Scope: this migration ONLY adds the column. It does not set a value for
-- any existing consumer, and it performs no backfill of any kind — cohort
-- population is a separate, explicitly-invoked script run, reviewed and
-- executed later as its own step (see CLAUDE.md-adjacent task notes; this is
-- deliberate per the task's "do not perform the actual bulk backfill in this
-- task" constraint).
--
-- GRANTs: no new GRANT statements are needed. This is a column addition on
-- an existing table (051_consumer_accounts_foundation.sql already granted
-- SELECT/INSERT/UPDATE on public.consumer_profiles to `authenticated` and
-- ALL to `service_role`) — Postgres GRANTs are table-scoped, not
-- column-scoped, here, so the existing grants already cover this column.
-- =============================================================================

ALTER TABLE public.consumer_profiles
  ADD COLUMN IF NOT EXISTS brevo_welcome_backfilled_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.consumer_profiles.brevo_welcome_backfilled_at IS
  'Timestamp this consumer was included in the one-time historical existing-consumer Brevo welcome backfill/cohort. NULL = never included (still eligible for the future automated welcome flow once built). Set = permanently part of the historical one-time cohort — any future automated-welcome eligibility check must exclude this consumer by reading this Supabase column, never a Brevo-side contact/list timestamp. Set at most once, via an atomic UPDATE ... WHERE brevo_welcome_backfilled_at IS NULL guard (see scripts/backfillConsumerBrevoWelcomeCohort.ts) — never updated again.';
