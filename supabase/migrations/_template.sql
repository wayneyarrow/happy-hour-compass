-- =============================================================================
-- Happy Hour Compass — Migration Template
-- File: supabase/migrations/_template.sql
--
-- HOW TO USE:
--   1. Copy this file to a new migration: NNN_description.sql
--   2. Replace all <PLACEHOLDER> values.
--   3. Delete sections that don't apply (e.g. remove the anon GRANT if the
--      table is login-gated, remove INSERT/UPDATE if the role only reads).
--   4. Keep the GRANT section — it is required (see note below).
--
-- WHY EXPLICIT GRANTs ARE REQUIRED:
--   Supabase currently auto-grants anon/authenticated/service_role on new
--   public-schema tables. Starting October 30 2026, that automatic grant is
--   removed. Any table created without explicit GRANTs will be inaccessible
--   via the Supabase Data API for those roles.
--   See migration 039_security_hardening.sql for the full grant philosophy.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: <table_name>
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.<table_name> (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- <add columns here>
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.<table_name> IS '<describe what this table stores>';


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- Remove this block if the table has no updated_at column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER <table_name>_updated_at
  BEFORE UPDATE ON public.<table_name>
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Always enable RLS, even if no permissive policies are added yet.
-- No permissive policy = table is inaccessible to all non-service-role callers
-- (service-role bypasses RLS entirely).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;

-- Add policies below. Examples:

-- Public INSERT (unauthenticated intake form — no login required):
-- CREATE POLICY "<table_name>: public insert"
--   ON public.<table_name> FOR INSERT TO anon, authenticated
--   WITH CHECK (TRUE);

-- Authenticated read-own (operator sees only their own rows):
-- CREATE POLICY "<table_name>: read own"
--   ON public.<table_name> FOR SELECT TO authenticated
--   USING (
--     operator_id IN (
--       SELECT id FROM public.operators WHERE email = (auth.jwt() ->> 'email')
--     )
--   );

-- Internal-only (no policy) — access via service-role / createAdminClient() only.
-- No policy needed here; RLS enabled + no permissive policy = denied to anon/authenticated.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs  ← REQUIRED FOR ALL NEW TABLES (see header note)
--
-- Grant philosophy:
--   anon          — public-facing intake forms only (no login gate).
--                   Remove if the table is login-gated or internal.
--   authenticated — tables that the operator app reads/writes directly.
--                   Remove if the table is internal-only (service-role only).
--   service_role  — ALL tables, always. Bypasses RLS; required for
--                   createAdminClient() and Supabase Data API to function.
--
-- Scope each role to the minimum operations it actually performs:
--   SELECT               — reads only
--   INSERT               — writes only (e.g. intake forms)
--   SELECT, INSERT, UPDATE — typical operator-managed table
--   ALL                  — service_role only; never use ALL for anon/authenticated
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove the anon line if no unauthenticated access is needed:
GRANT INSERT                     ON public.<table_name> TO anon;

-- Remove or adjust if the table is internal-only:
GRANT SELECT, INSERT, UPDATE     ON public.<table_name> TO authenticated;

-- Always include service_role:
GRANT ALL                        ON public.<table_name> TO service_role;
