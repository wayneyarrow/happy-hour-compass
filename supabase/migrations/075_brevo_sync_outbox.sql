-- =============================================================================
-- Happy Hour Compass — Brevo Sync Outbox
-- Migration: 075_brevo_sync_outbox.sql
--
-- PURPOSE:
--   Durable, generic outbox for synchronizing HHC entities (consumers today,
--   operators in a future phase) to Brevo. HHC has no generic job/queue
--   infrastructure (confirmed by architecture inspection — no pg_cron, no
--   Supabase Edge Functions, no third-party queue library) — this table plus
--   the two small functions below are the smallest durable primitive that
--   fits the existing stack, not a new queue framework.
--
-- PHASE 1 SCOPE:
--   This migration only creates the durable primitive. No application code
--   in this phase enqueues a row from any live consumer/operator flow —
--   see Brevo integration foundation report for the exact Phase 1 boundary.
--
-- DESIGN — desired-state, not one-time-command:
--   `payload` holds the desired Brevo contact state (email, attributes,
--   list, subscribed flag) rather than an irreversible one-shot instruction.
--   Re-enqueuing the same (entity_type, entity_id, operation) while a job is
--   still in flight coalesces into the existing row instead of creating a
--   duplicate — see the partial unique index and enqueue_brevo_contact_sync
--   below. Brevo's own contact upsert (POST /v3/contacts, updateEnabled:true)
--   is itself idempotent by email, so re-processing a completed operation is
--   also safe — the partial index just avoids the wasted duplicate work.
--
-- DEDUPE:
--   `dedupe_key` is caller-supplied and deterministic per (entity_type,
--   entity_id, operation) — e.g. "consumer:upsert_contact:<consumer_uuid>".
--   `brevo_sync_outbox_inflight_dedupe_idx` (partial UNIQUE on
--   (provider, dedupe_key) WHERE status IN ('pending','processing')) is the
--   actual dedupe mechanism: only one in-flight job per dedupe_key at a time.
--   Once a row reaches 'completed'/'failed'/'blocked' it no longer blocks a
--   fresh enqueue — this preserves history instead of clobbering it.
--
-- CLAIMING / CONCURRENCY:
--   claim_brevo_outbox_batch() uses `FOR UPDATE SKIP LOCKED` so multiple
--   concurrent processor invocations (e.g. a manual trigger overlapping a
--   scheduled one) never double-process the same row — no separate queue
--   library required for this.
--
-- RETRY / FAILURE:
--   attempt_count / max_attempts / next_attempt_at / last_error(_class)
--   give bounded retry with backoff computed in application code
--   (src/lib/brevo/outbox.ts) — not stored as a formula here. A transient
--   failure re-arms the row (status back to 'pending', next_attempt_at in
--   the future). A non-transient failure (auth/invalid_request/config) or
--   attempts-exhausted transient failure sets status='failed' immediately —
--   inspectable, never retried forever. 'blocked' is a distinct status for
--   the staging-allowlist refusal (see BREVO_TEST_EMAIL in
--   src/lib/brevo/stagingGuard.ts) — a deliberate safety refusal, not an
--   error.
--
-- PRIVACY:
--   `payload` intentionally may contain the contact's email (required to
--   call Brevo's contact API — there is no way to sync a contact without
--   it) but must never contain API keys, webhook tokens, or attributes
--   beyond what the Brevo integration actually sends. No other outbox
--   payload should carry more personal data than this.
--
-- RLS / GRANTs:
--   Internal-only — mirrors crm_venue_contacts (074) / venue_notes (035):
--   RLS enabled, zero permissive policies, service_role-only GRANT. Reached
--   exclusively via createAdminClient() from server-side Brevo integration
--   code (src/lib/brevo/) — never via the anon/authenticated Data API.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: brevo_sync_outbox
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brevo_sync_outbox (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  provider           TEXT        NOT NULL DEFAULT 'brevo',
  entity_type        TEXT        NOT NULL,
  entity_id          UUID        NOT NULL,
  operation          TEXT        NOT NULL,

  dedupe_key         TEXT        NOT NULL,
  payload            JSONB       NOT NULL,

  status             TEXT        NOT NULL DEFAULT 'pending',
  attempt_count      INTEGER     NOT NULL DEFAULT 0,
  max_attempts       INTEGER     NOT NULL DEFAULT 5,
  last_attempted_at  TIMESTAMPTZ,
  next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error         TEXT,
  last_error_class   TEXT,
  completed_at       TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT brevo_sync_outbox_provider_check
    CHECK (provider IN ('brevo')),
  CONSTRAINT brevo_sync_outbox_entity_type_check
    CHECK (entity_type IN ('consumer', 'operator')),
  CONSTRAINT brevo_sync_outbox_operation_check
    CHECK (operation IN ('upsert_contact')),
  CONSTRAINT brevo_sync_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'blocked')),
  CONSTRAINT brevo_sync_outbox_error_class_check
    CHECK (last_error_class IS NULL OR last_error_class IN
      ('transient', 'auth', 'invalid_request', 'config', 'blocked', 'unknown')),
  CONSTRAINT brevo_sync_outbox_attempt_count_check
    CHECK (attempt_count >= 0 AND max_attempts >= 1)
);

COMMENT ON TABLE public.brevo_sync_outbox IS
  'Durable outbox for HHC → Brevo entity sync (consumer today, operator future). '
  'Desired-state payload, not a one-time command. Internal-only — service_role access only.';

COMMENT ON COLUMN public.brevo_sync_outbox.dedupe_key IS
  'Deterministic per (entity_type, entity_id, operation) — e.g. '
  '"consumer:upsert_contact:<uuid>". Paired with '
  'brevo_sync_outbox_inflight_dedupe_idx to coalesce duplicate enqueues '
  'while a job is in flight.';

COMMENT ON COLUMN public.brevo_sync_outbox.payload IS
  'Desired Brevo contact state (email, attributes, list, subscribed flag). '
  'Never contains API keys or webhook tokens.';

COMMENT ON COLUMN public.brevo_sync_outbox.status IS
  'pending: awaiting processing. processing: claimed by a processor run. '
  'completed: synced successfully. failed: exhausted retries or hit a '
  'non-transient error — inspectable, not retried further. blocked: refused '
  'by the staging allowlist (BREVO_TEST_EMAIL) before any Brevo API call.';

COMMENT ON COLUMN public.brevo_sync_outbox.last_error_class IS
  'transient: retryable (network/5xx/429). auth/invalid_request/config: '
  'non-transient — retrying will not help, marked failed immediately. '
  'blocked: staging-allowlist refusal. unknown: unclassified error, treated '
  'as transient with the standard retry budget.';


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- Dedupe: at most one in-flight (pending/processing) job per dedupe_key.
CREATE UNIQUE INDEX IF NOT EXISTS brevo_sync_outbox_inflight_dedupe_idx
  ON public.brevo_sync_outbox (provider, dedupe_key)
  WHERE (status IN ('pending', 'processing'));

-- Claim path: processor pulls due, pending rows in next_attempt_at order.
CREATE INDEX IF NOT EXISTS brevo_sync_outbox_claim_idx
  ON public.brevo_sync_outbox (next_attempt_at)
  WHERE (status = 'pending');

-- Operational lookups by entity (support/debugging).
CREATE INDEX IF NOT EXISTS brevo_sync_outbox_entity_idx
  ON public.brevo_sync_outbox (entity_type, entity_id);

-- Stale-"processing" reclaim (a processor run that died mid-batch).
CREATE INDEX IF NOT EXISTS brevo_sync_outbox_processing_idx
  ON public.brevo_sync_outbox (last_attempted_at)
  WHERE (status = 'processing');


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- Reuses update_updated_at() from 001_initial_schema.sql.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER brevo_sync_outbox_updated_at
  BEFORE UPDATE ON public.brevo_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: enqueue_brevo_contact_sync
-- Atomic upsert-into-pending-or-insert-new, using the partial unique index
-- above as the ON CONFLICT target. SECURITY DEFINER so it can be called via
-- RPC without depending on the caller's own row-level privileges.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_brevo_contact_sync(
  p_entity_type   TEXT,
  p_entity_id     UUID,
  p_operation     TEXT,
  p_dedupe_key    TEXT,
  p_payload       JSONB,
  p_max_attempts  INTEGER DEFAULT 5
)
RETURNS public.brevo_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.brevo_sync_outbox;
BEGIN
  INSERT INTO public.brevo_sync_outbox (
    entity_type, entity_id, operation, dedupe_key, payload, max_attempts
  )
  VALUES (
    p_entity_type, p_entity_id, p_operation, p_dedupe_key, p_payload, p_max_attempts
  )
  ON CONFLICT (provider, dedupe_key) WHERE (status IN ('pending', 'processing'))
  DO UPDATE SET
    payload         = EXCLUDED.payload,
    next_attempt_at = now(),
    updated_at      = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.enqueue_brevo_contact_sync IS
  'Atomically inserts a new outbox row, or coalesces the desired-state '
  'payload into an already in-flight row for the same dedupe_key. Never '
  'creates duplicate in-flight jobs for the same entity+operation.';


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: claim_brevo_outbox_batch
-- Atomically claims up to p_limit due, pending rows for processing.
-- FOR UPDATE SKIP LOCKED makes concurrent processor invocations safe without
-- any external lock/queue system.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_brevo_outbox_batch(
  p_limit INTEGER DEFAULT 10
)
RETURNS SETOF public.brevo_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.brevo_sync_outbox
  SET status             = 'processing',
      last_attempted_at  = now(),
      updated_at         = now()
  WHERE id IN (
    SELECT id FROM public.brevo_sync_outbox
    WHERE status = 'pending' AND next_attempt_at <= now()
    ORDER BY next_attempt_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.claim_brevo_outbox_batch IS
  'Atomically claims up to p_limit due pending rows (sets status=processing) '
  'using FOR UPDATE SKIP LOCKED — safe under concurrent processor runs.';


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — internal-only, no permissive policies.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.brevo_sync_outbox ENABLE ROW LEVEL SECURITY;

-- No permissive policies — intentional. Reachable only via createAdminClient()
-- (service-role) from src/lib/brevo/ server code.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — service_role only. No anon, no authenticated.
-- Functions default-grant EXECUTE to PUBLIC in Postgres — explicitly revoke
-- that and grant only to service_role, matching the table's own lockdown.
--
-- PUBLIC covers all roles by default, but Supabase also grants EXECUTE to
-- anon/authenticated separately on new functions (the same gap
-- 039_security_hardening.sql's fix 2 already documents and fixes for
-- create_owner_membership_on_operator_insert() — REVOKE ... FROM PUBLIC
-- alone does not remove those separate per-role grants). Both functions here
-- are SECURITY DEFINER and bypass RLS on brevo_sync_outbox, so an
-- un-revoked anon/authenticated EXECUTE grant would let any caller with the
-- public anon key enqueue arbitrary rows or read in-flight payloads
-- (including email addresses once Phase 2 populates them) directly via
-- Data API RPC — explicitly revoke from both roles, not just PUBLIC.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.brevo_sync_outbox TO service_role;

REVOKE EXECUTE ON FUNCTION public.enqueue_brevo_contact_sync(TEXT, UUID, TEXT, TEXT, JSONB, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_brevo_contact_sync(TEXT, UUID, TEXT, TEXT, JSONB, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_brevo_contact_sync(TEXT, UUID, TEXT, TEXT, JSONB, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_brevo_contact_sync(TEXT, UUID, TEXT, TEXT, JSONB, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_brevo_outbox_batch(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_brevo_outbox_batch(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_brevo_outbox_batch(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_brevo_outbox_batch(INTEGER) TO service_role;
