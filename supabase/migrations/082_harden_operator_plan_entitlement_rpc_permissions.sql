-- =============================================================================
-- Happy Hour Compass — Harden sync_operator_plan_entitlement() RPC permissions
-- Migration: 082_harden_operator_plan_entitlement_rpc_permissions.sql
--
-- PURPOSE:
--   Closes a confirmed, currently-live privilege-escalation gap on
--   sync_operator_plan_entitlement() (migration 081), a SECURITY DEFINER
--   function that writes operator_subscriptions AND operators.plan.
--
--   PostgreSQL grants EXECUTE on every newly created function to PUBLIC by
--   default (unlike tables, which have no default grants). Migration 081's
--   GRANT block only added `GRANT EXECUTE ... TO service_role` — it never
--   revoked the default PUBLIC grant, and Supabase's own default privileges
--   for the public schema separately grant EXECUTE on new functions to
--   anon/authenticated as well. Verified directly against the live
--   production catalog (read-only, no writes) before authoring this
--   migration:
--
--     SELECT p.proacl FROM pg_proc p ... WHERE p.proname =
--       'sync_operator_plan_entitlement';
--     → {=X/postgres,postgres=X/postgres,anon=X/postgres,
--         authenticated=X/postgres,service_role=X/postgres}
--
--   The bare "=X/postgres" entry (empty grantee) IS the PUBLIC grant.
--   anon=X/postgres and authenticated=X/postgres are SEPARATE explicit
--   grants — not merely inherited from PUBLIC. All three mean the same
--   practical thing: any authenticated Supabase user, and even a
--   completely anonymous one, can currently call this SECURITY DEFINER
--   function directly and write to operator_subscriptions / operators.plan
--   with elevated privileges, bypassing RLS entirely (RLS is enabled on
--   both tables with zero permissive policies specifically so only
--   service-role code can touch them — a callable SECURITY DEFINER
--   function undermines that boundary completely).
--
-- WHAT THIS MIGRATION DOES:
--   1. REVOKE EXECUTE ... FROM PUBLIC
--   2. REVOKE EXECUTE ... FROM anon
--   3. REVOKE EXECUTE ... FROM authenticated
--   4. GRANT EXECUTE ... TO service_role (re-affirmed, in case a future
--      re-run of this migration follows a state where it was ever revoked)
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   - Does not CREATE OR REPLACE, ALTER, or otherwise touch the function
--     body. Behavior of sync_operator_plan_entitlement() is completely
--     unchanged — every existing service-role caller (updateOperatorPlan(),
--     syncStripeSubscription()) keeps working exactly as before.
--   - Does not touch operator_subscriptions or operators data. No row is
--     read, inserted, updated, or deleted by this migration.
--   - Does not change operators.plan/operator_subscriptions RLS policies —
--     both already have RLS enabled with zero permissive policies; this
--     migration closes the SECURITY DEFINER side-door around that
--     boundary, it doesn't touch the boundary itself.
--   - Does not alter migration 081 in place — 081 is already applied to
--     production; this migration is deliberately additive/corrective
--     rather than a retroactive edit of already-shipped SQL.
--
-- WHY THE EXPLICIT REVOKE IS REQUIRED FOR SECURITY DEFINER FUNCTIONS:
--   A SECURITY DEFINER function executes with the privileges of its
--   OWNER (here, effectively a superuser-equivalent role in the Supabase
--   provisioning flow), not the caller's own privileges — that is the
--   entire point of the pattern (it lets service-role code invoke one
--   function to atomically write two tables in one transaction, migration
--   081's actual purpose). But that same property means the ordinary
--   protection RLS gives every other table access path — "this role's own
--   privileges/session determine what it can touch" — does not apply once
--   a caller merely has EXECUTE. Whoever can call the function inherits
--   its owner's write access for the duration of that call, regardless of
--   their own role's RLS-visible rows. EXECUTE is therefore the entire
--   access-control boundary for a SECURITY DEFINER function, and
--   PostgreSQL's PUBLIC-by-default EXECUTE grant means that boundary is
--   OPEN unless explicitly closed — exactly the estabished, correct
--   pattern already used by migration 075's
--   enqueue_brevo_contact_sync()/claim_brevo_outbox_batch(), and by the
--   new migration introduced alongside this one for
--   sync_venue_plan_entitlement() (Phase 2A).
--
-- SAFE REPEATABILITY:
--   REVOKE and GRANT are both idempotent in PostgreSQL — re-running this
--   migration against a database where it has already applied is a no-op,
--   not an error (REVOKE on a privilege that isn't held simply does
--   nothing; GRANT on a privilege already held simply does nothing).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- Exact signature confirmed against the live production catalog (see header)
-- and against migration 081's own GRANT statement — not guessed.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.sync_operator_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.sync_operator_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.sync_operator_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.sync_operator_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
