-- =============================================================================
-- Migration 041: Audit Logs
--
-- Append-only audit trail for high-value platform operations.
--
-- Answers: who did it, what did they do, when, and to what object?
--
-- Design decisions:
--   - No updated_at column or trigger — rows are append-only, never updated.
--   - RLS enabled, no permissive policies — service-role only via
--     createAdminClient(). The CP audit-logs page queries via service-role.
--   - Indexes on created_at (pagination), actor_email (search), and
--     entity_type+entity_id (entity lookup).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: audit_logs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_email  TEXT        NOT NULL,
  action       TEXT        NOT NULL,
  entity_type  TEXT        NOT NULL,
  entity_id    TEXT,
  entity_name  TEXT,
  details_json JSONB
);

COMMENT ON TABLE  public.audit_logs IS
  'Append-only audit trail for high-value platform operations. '
  'Never updated — rows are inserted and retained indefinitely.';

COMMENT ON COLUMN public.audit_logs.actor_email  IS 'Email of the user who performed the action.';
COMMENT ON COLUMN public.audit_logs.action       IS 'Snake_case action identifier, e.g. claim_approved.';
COMMENT ON COLUMN public.audit_logs.entity_type  IS 'Type of the object acted on, e.g. venue_claim, venue, platform_admin.';
COMMENT ON COLUMN public.audit_logs.entity_id    IS 'UUID or ID of the object acted on. NULL for batch actions.';
COMMENT ON COLUMN public.audit_logs.entity_name  IS 'Human-readable name for display, e.g. venue name or email.';
COMMENT ON COLUMN public.audit_logs.details_json IS 'Optional additional context as JSONB (e.g. { "from": "free", "to": "pro" }).';


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- Primary access pattern: newest-first pagination.
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON public.audit_logs (created_at DESC);

-- Search by actor email.
CREATE INDEX IF NOT EXISTS audit_logs_actor_email_idx
  ON public.audit_logs (actor_email);

-- Entity lookup (partial — only rows where entity_id is set).
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON public.audit_logs (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Internal-only: no anon or authenticated direct access.
-- All reads/writes go through createAdminClient() (service-role).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- No permissive policies — service-role bypasses RLS and is the only caller.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs (required — see migration 039 + CLAUDE.md)
-- Internal-only: service_role only.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.audit_logs TO service_role;
