-- =============================================================================
-- Happy Hour Compass — Security Hardening
-- Migration: 039_security_hardening.sql
--
-- CONTEXT:
--   Addresses warnings raised by Supabase Security Advisor (reviewed 2026-06-10).
--
-- CHANGES IN THIS MIGRATION:
--   1. Fix update_updated_at() — pin search_path to prevent search-path injection.
--   2. Revoke EXECUTE on create_owner_membership_on_operator_insert() from PUBLIC.
--   3. Tighten venues INSERT policy — remove always-true WITH CHECK.
--   4. Drop industry_reads_feedback RLS policies — access now via service-role only.
--   5. Add explicit GRANTs on all public-schema tables — future-proofs against
--      Supabase's planned change (Oct 2026) that removes automatic grants to
--      anon/authenticated/service_role for new tables.
--
-- WARNINGS INTENTIONALLY ACCEPTED (not changed here):
--   • events: authenticated read      USING (TRUE) — intentional; browser clients
--     (EventsManager, EventForm) run under the user's JWT. Scoping to owner-only
--     would break invited members who auth as a different email. Low data-exposure
--     risk (venue event data is not sensitive).
--   • events: insert authenticated    WITH CHECK (TRUE) — same reason; all INSERT
--     paths from server actions correctly set created_by_operator_id.
--   • media: authenticated read       USING (TRUE) — same reason as events.
--   • venue_claims: public insert     WITH CHECK (TRUE) — intentional public intake
--     form; no auth required by design.
--   • venue_suggestions: public insert WITH CHECK (TRUE) — same.
--   • operator_submissions: public insert WITH CHECK (TRUE) — same.
--   • storage.venue-images bucket listing — bucket is public (required for
--     getPublicUrl() paths used throughout the app); file paths include UUIDs so
--     enumeration yields no sensitive info. Accepted risk.
--
-- DASHBOARD-ONLY FIX (cannot be done via SQL):
--   • Leaked Password Protection — enable via Supabase Dashboard:
--     Authentication → Settings → "Enable HaveIBeenPwned integration".
--
-- HOW TO APPLY:
--   Option A — Supabase Dashboard: SQL Editor → paste → Run
--   Option B — Supabase CLI:       supabase db push
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FIX: update_updated_at() — pin search_path
--
-- WHY: With a mutable search_path, a malicious schema placed earlier in the
-- search path could shadow built-in functions (e.g. NOW()) used inside the
-- trigger, executing attacker-controlled code with the function's privileges.
-- Pinning SET search_path = public, pg_catalog removes that attack surface.
--
-- The function body is unchanged; only the security attribute is added.
-- SECURITY INVOKER is explicit (it was already the default) for clarity.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at() IS
  'Trigger function — sets updated_at to NOW() before every UPDATE. '
  'SECURITY INVOKER with pinned search_path prevents search-path injection.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FIX: Revoke EXECUTE on create_owner_membership_on_operator_insert()
--
-- WHY: The function is SECURITY DEFINER (runs as the function owner, bypassing
-- RLS on operator_memberships). It is called exclusively by the
-- on_operator_created trigger — no user or application code should ever call
-- it directly. Revoking EXECUTE from PUBLIC (which covers both anon and
-- authenticated roles) prevents a caller from escalating privileges by
-- invoking the function outside of the intended trigger context.
--
-- Triggers fire via the PostgreSQL trigger mechanism, not via the EXECUTE
-- privilege, so the trigger continues to work normally after this revoke.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE
  ON FUNCTION public.create_owner_membership_on_operator_insert()
  FROM PUBLIC;

-- PUBLIC covers all roles by default; also explicitly revoke from the two
-- application roles in case Supabase grants them separately.
REVOKE EXECUTE
  ON FUNCTION public.create_owner_membership_on_operator_insert()
  FROM anon;

REVOKE EXECUTE
  ON FUNCTION public.create_owner_membership_on_operator_insert()
  FROM authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FIX: venues INSERT — tighten always-true WITH CHECK
--
-- WHY: The original "venues: insert authenticated" policy used WITH CHECK (TRUE),
-- allowing any authenticated user to insert a venue row with any
-- created_by_operator_id, including one belonging to a different operator.
-- The tighter check enforces that the inserted row's created_by_operator_id
-- must belong to the authenticated operator (matched via JWT email).
--
-- All application INSERT paths (createVenueAdminAction, createVenueAction)
-- already set created_by_operator_id from the server-resolved operator row,
-- so this does not break any existing functionality.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "venues: insert authenticated" ON public.venues;

CREATE POLICY "venues: insert own"
  ON public.venues
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- The inserted row's ownership must point to the authenticated operator.
    created_by_operator_id IN (
      SELECT id
      FROM public.operators
      WHERE email = (auth.jwt() ->> 'email')
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FIX: industry_reads_feedback — drop always-true policies
--
-- WHY: Both existing policies used USING/WITH CHECK (true) scoped to
-- "authenticated", meaning any authenticated operator could read or insert
-- feedback. This table is internal-only (founder/Control Panel admin).
--
-- The SELECT query (control-panel/industry-reads/page.tsx) and the INSERT
-- action (control-panel/industry-reads/actions.ts) are both being updated
-- to use createAdminClient() (service-role), which bypasses RLS entirely.
-- With service-role access, no permissive RLS policies are needed.
--
-- After this migration, the table is inaccessible to anon and authenticated
-- roles via the Data API, matching the pattern used by other internal-only
-- tables (operator_memberships, venue_notes, etc.).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_select_feedback" ON public.industry_reads_feedback;
DROP POLICY IF EXISTS "authenticated_insert_feedback" ON public.industry_reads_feedback;

-- RLS remains ENABLED on industry_reads_feedback — no permissive policy means
-- the Data API returns nothing to anon/authenticated callers. Service-role
-- (createAdminClient) bypasses RLS and continues to work.


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. FUTURE-PROOFING: Explicit GRANTs on all public-schema tables
--
-- WHY: Supabase announced that starting October 30 2026, new tables in the
-- public schema will no longer automatically receive GRANTs for anon,
-- authenticated, and service_role. Explicitly granting privileges now ensures
-- migrations are portable and future-safe regardless of Supabase platform
-- defaults.
--
-- Grant philosophy:
--   • anon     — only tables that accept unauthenticated form submissions.
--   • authenticated — tables accessed by logged-in operators via the app.
--   • service_role  — all tables (service-role bypasses RLS; this GRANT
--     ensures the Data API endpoint can still reach every table).
--
-- Tables accessed only via service-role (no anon/authenticated grant needed):
--   industry_reads_feedback, operator_memberships, operator_subscriptions,
--   operator_impersonation_sessions, venue_notes, discover_rail_overrides,
--   operator_submission_notes, venue_claim_notes, discover_event_overrides.
--
-- NOTE: venue_review_confirmations does NOT exist as a table. Migration 025
-- added a review_confirmations JSONB column to the venues table instead.
-- ─────────────────────────────────────────────────────────────────────────────

-- operators — authenticated only (login-gated)
GRANT SELECT, INSERT, UPDATE ON public.operators TO authenticated;
GRANT ALL ON public.operators TO service_role;

-- venues — authenticated (operators manage their own venues)
GRANT SELECT, INSERT, UPDATE ON public.venues TO authenticated;
GRANT ALL ON public.venues TO service_role;

-- events — authenticated (operators manage events for their venues)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;

-- media — authenticated (operators upload/delete images)
GRANT SELECT, INSERT, DELETE ON public.media TO authenticated;
GRANT ALL ON public.media TO service_role;

-- claims (legacy) — authenticated only
GRANT SELECT, INSERT ON public.claims TO authenticated;
GRANT ALL ON public.claims TO service_role;

-- venue_claims — anon + authenticated INSERT (public claim form, no login gate)
GRANT INSERT ON public.venue_claims TO anon;
GRANT INSERT ON public.venue_claims TO authenticated;
GRANT ALL ON public.venue_claims TO service_role;

-- venue_suggestions — anon + authenticated INSERT (public suggestion form)
GRANT INSERT ON public.venue_suggestions TO anon;
GRANT INSERT ON public.venue_suggestions TO authenticated;
GRANT ALL ON public.venue_suggestions TO service_role;

-- operator_submissions — anon + authenticated INSERT (pre-auth intake form)
GRANT INSERT ON public.operator_submissions TO anon;
GRANT INSERT ON public.operator_submissions TO authenticated;
GRANT ALL ON public.operator_submissions TO service_role;

-- operator_memberships — service-role only (no direct Data API access)
GRANT ALL ON public.operator_memberships TO service_role;

-- operator_subscriptions — service-role only
GRANT ALL ON public.operator_subscriptions TO service_role;

-- industry_reads_feedback — service-role only (see section 4 above)
GRANT ALL ON public.industry_reads_feedback TO service_role;

-- operator_impersonation_sessions — service-role only
GRANT ALL ON public.operator_impersonation_sessions TO service_role;

-- contact_messages — anon + authenticated INSERT (public contact form)
GRANT INSERT ON public.contact_messages TO anon;
GRANT INSERT ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;

-- venue_notes — service-role only (internal CP tool)
GRANT ALL ON public.venue_notes TO service_role;

-- discover_rail_overrides — service-role only (internal CP tool)
GRANT ALL ON public.discover_rail_overrides TO service_role;

-- operator_submission_notes — service-role only (internal CP review tool)
GRANT ALL ON public.operator_submission_notes TO service_role;

-- venue_claim_notes — service-role only (internal CP review tool)
GRANT ALL ON public.venue_claim_notes TO service_role;

-- discover_event_overrides — service-role only (internal CP tool)
GRANT ALL ON public.discover_event_overrides TO service_role;
