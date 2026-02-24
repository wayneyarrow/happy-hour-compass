-- =============================================================================
-- Happy Hour Compass — Venues: restrict SELECT to owner operator
-- Migration: 002_venues_operator_rls.sql
--
-- CONTEXT:
--   001_initial_schema.sql created the `venues` table with a
--   `created_by_operator_id` FK to `operators(id)` as the canonical
--   ownership column.  The initial SELECT policy was intentionally
--   left permissive ("USING (TRUE)") pending this refinement.
--
-- WHAT THIS MIGRATION DOES:
--   1. Drops the overly-broad "venues: authenticated read" policy.
--   2. Creates "venues: read own" — an authenticated operator can only
--      SELECT venues whose `created_by_operator_id` matches their own
--      operator record (resolved via email from the JWT).
--      Venues with `created_by_operator_id = NULL` are not visible to
--      any operator (service-role access only).
--
-- HOW TO APPLY:
--   Option A — Supabase Dashboard:
--     SQL Editor → New query → paste this file → Run
--   Option B — Supabase CLI:
--     supabase db push
--
-- SAFE TO RE-RUN:
--   DROP POLICY IF EXISTS is idempotent.
--   CREATE POLICY will error if already applied; wrap in a transaction
--   or check the Policies tab first.
-- =============================================================================


-- ── Step 1: remove the permissive catch-all policy ────────────────────────────
DROP POLICY IF EXISTS "venues: authenticated read" ON public.venues;


-- ── Step 2: scoped read policy ────────────────────────────────────────────────
-- An authenticated operator can only see venues they own.
-- Ownership is resolved via the `operators` table using the JWT email,
-- matching the same pattern used by the UPDATE and events/media/claims policies.
--
-- Venues with `created_by_operator_id = NULL` are excluded (not matched
-- by the subquery), so they remain invisible to all operators.
CREATE POLICY "venues: read own"
  ON public.venues
  FOR SELECT
  TO authenticated
  USING (
    created_by_operator_id IN (
      SELECT id
      FROM public.operators
      WHERE email = auth.jwt() ->> 'email'
    )
  );
