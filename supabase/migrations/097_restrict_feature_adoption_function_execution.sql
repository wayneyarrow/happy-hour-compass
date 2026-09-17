-- =============================================================================
-- Happy Hour Compass — Restrict Feature Adoption Function Execution
-- Migration: 097_restrict_feature_adoption_function_execution.sql
--
-- CONTEXT:
--   Migration 096 created three internal Feature Adoption functions
--   (public.record_feature_adoption, public.events_first_adoption_trigger,
--   public.daily_specials_first_adoption_trigger) and revoked EXECUTE from
--   PUBLIC on each, intending them to be callable only by service_role (via
--   RPC from a trusted server action) or, for the two trigger functions,
--   fired internally by Postgres.
--
--   Post-migration privilege inspection (read-only, via
--   has_function_privilege()) found that `anon` and `authenticated` could
--   still execute all three functions. Root cause: this Supabase project's
--   `public` schema has default privileges
--   (`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS
--   TO anon, authenticated, service_role`) configured — confirmed via
--   pg_default_acl — so every newly created function receives an explicit,
--   role-targeted EXECUTE grant to anon/authenticated at creation time. That
--   grant is a SEPARATE ACL entry from the implicit PUBLIC grant Postgres
--   also attaches by default: `REVOKE EXECUTE ... FROM PUBLIC` removes only
--   the latter and does nothing to the former. This exact two-part
--   requirement is what migrations 081/085's own precedent already
--   documents ("Explicit REVOKE FROM PUBLIC/anon/authenticated closes that
--   gap") and what 096 omitted for these three functions.
--
--   `record_feature_adoption` is the functionally significant exposure: it
--   is not SECURITY DEFINER and performs no ownership/authorization check
--   of its own, so anon/authenticated holding EXECUTE meant any API caller
--   (authenticated or not) could invoke it directly via PostgREST RPC and
--   attempt to upsert a venue_feature_adoption row for an arbitrary
--   venue_id. In practice this was very likely already blocked in effect —
--   venue_feature_adoption has RLS enabled with no permissive policy, and a
--   non-SECURITY-DEFINER function runs as its caller's role for RLS
--   purposes, so an anon/authenticated-role INSERT would itself be denied
--   by RLS before ever succeeding. The execution grant is nonetheless
--   removed explicitly here: relying on RLS as the only backstop for a
--   function never intended to be reachable at all is not the intended
--   contract, and this migration restores it precisely rather than leaving
--   defense-in-depth to chance. The two trigger functions were never
--   directly invocable this way regardless (Postgres rejects any attempt to
--   call a TRIGGER-returning function outside trigger context, independent
--   of EXECUTE privilege) — their grants are still tightened here for
--   contract consistency.
--
-- SCOPE: privilege-only. No table, column, data, function-body, trigger,
-- RLS, or policy change. Nothing in this file can alter existing Event,
-- Daily Special, venue, or Feature Adoption records.
-- =============================================================================

REVOKE EXECUTE
  ON FUNCTION public.record_feature_adoption(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
  ON FUNCTION public.events_first_adoption_trigger()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
  ON FUNCTION public.daily_specials_first_adoption_trigger()
  FROM PUBLIC, anon, authenticated;

-- record_feature_adoption is invoked directly via RPC (from
-- recordFeatureAdoption(), src/lib/customerSuccess/featureAdoption.ts, using
-- a service-role admin client) — service_role needs an explicit, standing
-- EXECUTE grant. Already granted by migration 096 and unaffected by the
-- REVOKEs above (which name only PUBLIC/anon/authenticated), but restated
-- here explicitly so this migration's own intended end-state is
-- self-evident without cross-referencing 096.
GRANT EXECUTE
  ON FUNCTION public.record_feature_adoption(UUID, TEXT, UUID)
  TO service_role;

-- No corresponding GRANT added here for the two trigger functions: Postgres
-- fires row-level triggers internally regardless of any role's EXECUTE
-- privilege on the trigger function (this is standard trigger semantics,
-- not something service_role needs a grant for), and neither function is
-- ever called directly by application code. Migration 096 already granted
-- EXECUTE to service_role on both, for documentation/consistency with this
-- table's other grants — left untouched and unaffected by this migration
-- either way. No broadening of access is introduced here.
