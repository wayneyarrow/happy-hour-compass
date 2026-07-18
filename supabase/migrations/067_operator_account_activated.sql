-- =============================================================================
-- Migration: 067_operator_account_activated.sql
--
-- Adds account_activated_at to the operators table so the app can tell
-- "operator completed initial account setup (set their password) for the
-- first time" apart from "operator later reset/changed their password" —
-- both currently land on the same /operator/create-password page, regardless
-- of whether the account originated from a claim approval, an auto-confirmed
-- Add Your Venue submission, or a manually approved Add Your Venue submission.
--
-- NULL  → operator has never completed account setup via create-password.
-- set   → timestamp of the first successful setUser({ password }) call.
--         Never updated again — a later self-service password reset must
--         NOT re-fire the one-time "operator account activated" internal
--         notification this column gates.
--
-- Update pattern used by application code (atomic idempotency gate):
--   UPDATE operators
--   SET    account_activated_at = now()
--   WHERE  id = $1
--   AND    account_activated_at IS NULL
--   RETURNING id
-- A row is returned only on the first call for a given operator — retries,
-- double-submits, and later password resets are all safe no-ops.
--
-- Backfill: existing operators are marked as already activated (using their
-- created_at) so this migration does not retroactively fire the new
-- lifecycle notification for accounts set up before this column existed.
-- =============================================================================

ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS account_activated_at TIMESTAMPTZ;

UPDATE public.operators
SET    account_activated_at = created_at
WHERE  account_activated_at IS NULL;

COMMENT ON COLUMN public.operators.account_activated_at IS
  'Timestamp of the operator''s first completed account setup (password creation). '
  'Set at most once — gates the one-time "operator account activated" internal '
  'notification. Must not be updated on subsequent password resets.';
